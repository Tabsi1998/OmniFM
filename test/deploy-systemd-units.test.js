import assert from "node:assert/strict";
import fs from "node:fs";
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

test("start.sh renders the templates and stop.sh stops the units", () => {
  const startSh = fs.readFileSync(path.join(repoRoot, "start.sh"), "utf8");
  const stopSh = fs.readFileSync(path.join(repoRoot, "stop.sh"), "utf8");
  for (const name of UNITS) {
    assert.ok(startSh.includes(name), `start.sh knows ${name}`);
    assert.ok(stopSh.includes(name), `stop.sh stops ${name}`);
  }
  assert.ok(startSh.includes("deploy/systemd"), "start.sh reads the templates from deploy/systemd");
  for (const placeholder of Object.keys(PLACEHOLDERS)) {
    assert.ok(startSh.includes(placeholder), `start.sh substitutes ${placeholder}`);
  }
  assert.ok(startSh.includes("MONGO_WAIT_SECONDS"), "start.sh waits for MongoDB before the preflight");
  assert.doesNotMatch(startSh, /Type=oneshot/, "the oneshot stack unit is gone");
});

test("bot and backend keep their runtime files in runtime-data and logs in logs", () => {
  for (const unit of ["omnifm-bot.service", "omnifm-backend.service"]) {
    const text = fs.readFileSync(path.join(unitDir, unit), "utf8");
    assert.match(text, /^Environment=OMNIFM_RUNTIME_DATA_DIR=__ROOT__\/runtime-data$/m, unit);
    assert.match(text, /^Environment=LOGS_DIR=__ROOT__\/logs$/m, unit);
  }
});
