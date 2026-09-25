import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitDir = path.join(repoRoot, "deploy", "systemd");
const UNITS = ["omnifm-backend", "omnifm-frontend", "omnifm-bot"];
const PLACEHOLDERS = {
  __ROOT__: "/opt/omnifm",
  __USER__: "omnifm",
  __BACKEND_PORT__: "8001",
  __FRONTEND_PORT__: "3000",
  __NODE__: "/usr/bin/node",
  __NODE_DIR__: "/usr/bin",
};

function readUnit(name) {
  return fs.readFileSync(path.join(unitDir, `${name}.service`), "utf8");
}

function render(text) {
  return Object.entries(PLACEHOLDERS).reduce((out, [key, value]) => out.split(key).join(value), text);
}

function directive(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function withoutComments(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("every OmniFM component has a supervised systemd unit template", () => {
  for (const name of UNITS) {
    const text = readUnit(name);
    assert.equal(directive(text, "Restart"), "always", `${name}: restarts on crash`);
    assert.ok(Number(directive(text, "RestartSec")) >= 1, `${name}: waits before a restart`);
    assert.equal(directive(text, "User"), "__USER__", `${name}: runs as the deploying user`);
    assert.match(directive(text, "WorkingDirectory") || "", /^__ROOT__/, `${name}: works inside the checkout`);
    assert.equal(directive(text, "WantedBy"), "multi-user.target", `${name}: starts on boot`);
    assert.match(text, /^After=.*network-online\.target/m, `${name}: waits for the network`);

    const rendered = withoutComments(render(text));
    assert.doesNotMatch(rendered, /__[A-Z_]+__/, `${name}: start.sh replaces every placeholder`);
  }
});

test("backend and bot wait for MongoDB, the bot never restart-loops on a missing commander", () => {
  const backend = readUnit("omnifm-backend");
  assert.match(backend, /^After=.*mongod\.service/m);
  assert.match(backend, /^Wants=.*mongod\.service/m);
  assert.doesNotMatch(backend, /^Requires=/m, "a remote MongoDB has no local unit, so Requires would break the start");
  assert.match(directive(backend, "ExecStart") || "", /uvicorn server:app .*--port __BACKEND_PORT__/);
  assert.equal(directive(backend, "EnvironmentFile"), "-__ROOT__/backend/.env");

  const bot = readUnit("omnifm-bot");
  assert.match(bot, /^After=.*mongod\.service.*omnifm-backend\.service/m);
  assert.equal(directive(bot, "RestartPreventExitStatus"), "78");
  assert.equal(directive(bot, "SuccessExitStatus"), "78");
  assert.equal(directive(bot, "ExecStart"), "__NODE__ src/entrypoints/from-owner-config.mjs");
  assert.equal(directive(bot, "EnvironmentFile"), "-__ROOT__/backend/.env", "runtime tuning lives in backend/.env");
  assert.equal(directive(bot, "KillSignal"), "SIGTERM", "the runtime persists its state on SIGTERM");

  const frontend = readUnit("omnifm-frontend");
  // serve.json holds the security headers and the page-path fallback; -s
  // would answer every missing file with index.html again.
  assert.match(directive(frontend, "ExecStart") || "", /serve build --config \.\.\/serve\.json -l tcp:\/\/0\.0\.0\.0:__FRONTEND_PORT__/);
});

function bash() {
  if (process.platform === "win32") return process.env.OMNIFM_TEST_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
  return process.env.OMNIFM_TEST_BASH || "bash";
}

// The real render script, as start.sh calls it (#262).
function renderWithScript(file, prefix) {
  return execFileSync(bash(), [path.join(repoRoot, "scripts", "render-systemd-unit.sh"), path.join(unitDir, file)], {
    encoding: "utf8",
    env: {
      ...process.env,
      UNIT_PREFIX: prefix,
      ROOT: "/opt/omnifm",
      RUN_USER: "omnifm",
      BACKEND_PORT: "8001",
      FRONTEND_PORT: "3000",
      NODE_BIN: "/usr/bin/node",
      NODE_DIR: "/usr/bin",
    },
  });
}

test("start.sh renders every template through the render script, stop.sh stops the units", () => {
  for (const file of [...UNITS.map((name) => `${name}.service`), "omnifm-backup.service", "omnifm-backup.timer"]) {
    assert.doesNotMatch(withoutComments(renderWithScript(file, "omnifm")), /__[A-Z_]+__/, `${file}: every placeholder filled`);
  }
  assert.match(renderWithScript("omnifm-bot.service", "omnifm"), /^After=.*omnifm-backend\.service/m);

  const startSh = fs.readFileSync(path.join(repoRoot, "start.sh"), "utf8");
  const stopSh = fs.readFileSync(path.join(repoRoot, "stop.sh"), "utf8");
  assert.match(startSh, /for part in backend frontend bot; do\s+render_unit_file "omnifm-\$part\.service"/);
  assert.match(startSh, /scripts\/render-systemd-unit\.sh/);
  assert.match(stopSh, /for unit in "\$UNIT_PREFIX-bot" "\$UNIT_PREFIX-frontend" "\$UNIT_PREFIX-backend"/);
  assert.ok(startSh.includes("MONGO_WAIT_SECONDS"), "start.sh waits for MongoDB before the preflight");
  assert.doesNotMatch(startSh, /Type=oneshot/, "the oneshot stack unit is gone");
});

test("a staging instance gets its own unit names everywhere, production keeps its own (#262)", () => {
  const bot = renderWithScript("omnifm-bot.service", "omnifm-staging");
  assert.match(bot, /^After=.*omnifm-staging-backend\.service/m);
  assert.doesNotMatch(bot, /omnifm-backend\.service/, "staging never waits for the production backend");
  assert.equal(directive(renderWithScript("omnifm-backup.timer", "omnifm-staging"), "Unit"), "omnifm-staging-backup.service");

  for (const script of ["start.sh", "stop.sh", "update.sh"]) {
    assert.match(fs.readFileSync(path.join(repoRoot, script), "utf8"), /\. "\$ROOT\/scripts\/instance-env\.sh"/, `${script} loads instance.env`);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-instance-"));
  try {
    const prefixOf = () => execFileSync(bash(), ["-c", `ROOT="$1"; . "$2"; printf '%s' "$UNIT_PREFIX"`, "_", root,
      path.join(repoRoot, "scripts", "instance-env.sh")], { encoding: "utf8" });
    assert.equal(prefixOf(), "omnifm", "production has no instance.env");
    fs.writeFileSync(path.join(root, "instance.env"), "OMNIFM_INSTANCE=staging\n");
    assert.equal(prefixOf(), "omnifm-staging");
    fs.writeFileSync(path.join(root, "instance.env"), "OMNIFM_INSTANCE=../../etc\n");
    assert.throws(prefixOf, "an instance name can never leave the unit name");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the nightly backup timer runs the backup script and catches up missed nights (#259)", () => {
  const service = fs.readFileSync(path.join(unitDir, "omnifm-backup.service"), "utf8");
  const timer = fs.readFileSync(path.join(unitDir, "omnifm-backup.timer"), "utf8");
  assert.equal(directive(service, "Type"), "oneshot");
  assert.equal(directive(service, "User"), "__USER__");
  assert.equal(directive(service, "ExecStart"), "/bin/bash __ROOT__/scripts/scheduled-backup.sh");
  assert.equal(directive(service, "EnvironmentFile"), "-__ROOT__/backend/.env");
  assert.equal(directive(service, "IOSchedulingClass"), "idle", "backups must not slow the radio down");
  assert.doesNotMatch(withoutComments(render(service)), /__[A-Z_]+__/);

  assert.match(directive(timer, "OnCalendar") || "", /^\*-\*-\* \d{2}:\d{2}:00$/);
  assert.equal(directive(timer, "Persistent"), "true");
  assert.equal(directive(timer, "Unit"), "omnifm-backup.service");
  assert.equal(directive(timer, "WantedBy"), "timers.target");

  const startSh = fs.readFileSync(path.join(repoRoot, "start.sh"), "utf8");
  const stopSh = fs.readFileSync(path.join(repoRoot, "stop.sh"), "utf8");
  assert.match(startSh, /render_unit_file omnifm-backup\.service/);
  assert.match(startSh, /render_unit_file omnifm-backup\.timer/);
  assert.match(startSh, /enable --now omnifm-backup\.timer/);
  assert.doesNotMatch(stopSh, /omnifm-backup/, "backups keep running while OmniFM is stopped");
});

test("bot and backend keep their runtime files in runtime-data and logs in logs", () => {
  for (const unit of ["omnifm-bot.service", "omnifm-backend.service"]) {
    const text = fs.readFileSync(path.join(unitDir, unit), "utf8");
    assert.match(text, /^Environment=OMNIFM_RUNTIME_DATA_DIR=__ROOT__\/runtime-data$/m, unit);
    assert.match(text, /^Environment=LOGS_DIR=__ROOT__\/logs$/m, unit);
  }
});
