import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBash() {
  if (process.platform === "win32") {
    return process.env.OMNIFM_TEST_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
  }
  return process.env.OMNIFM_TEST_BASH || "bash";
}

function withCompleteClientIds(envText) {
  const text = String(envText || "");
  const tokenIndexes = [...text.matchAll(/^BOT_(\d+)_TOKEN=/gm)]
    .map((match) => Number.parseInt(match[1], 10));
  const additions = tokenIndexes
    .filter((index) => !new RegExp(`^BOT_${index}_CLIENT_ID=`, "m").test(text))
    .map((index) => `BOT_${index}_CLIENT_ID=1000000000000000${index}`);
  if (additions.length === 0) return text;
  return `${text.trimEnd()}\n${additions.join("\n")}\n`;
}

async function createSandbox(t, {
  envText,
  completeClientIds = true,
  staleWorkers = "",
  rmFailFor = "",
  runningCommanderIndex = "",
  runningCommanderRole = "commander",
  stoppedCommanderIndex = "",
  stoppedCommanderRole = "commander",
} = {}) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-worker-reconcile-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const binDir = path.join(sandbox, "bin");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "runtime-compose.sh"), path.join(scriptsDir, "runtime-compose.sh"));
  await fs.copyFile(path.join(repoRoot, "scripts", "compose.sh"), path.join(scriptsDir, "compose.sh"));
  await fs.writeFile(path.join(sandbox, ".env"), completeClientIds ? withCompleteClientIds(envText) : envText, "utf8");
  await fs.writeFile(path.join(sandbox, "docker-compose.split.yml"), "services: {}\n", "utf8");
  await fs.writeFile(path.join(sandbox, "init-data.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await fs.writeFile(path.join(sandbox, "stale-workers.txt"), staleWorkers, "utf8");
  await fs.writeFile(path.join(sandbox, "docker.log"), "", "utf8");

const fakeDocker = `#!/usr/bin/env bash
set -euo pipefail

printf '%s\\n' "$*" >> "\${FAKE_DOCKER_LOG:?}"
service="\${!#}"
worker_index="\${service##*-}"

if [[ " $* " == *" ps --services "* ]]; then
  if [[ -n "\${FAKE_RUNNING_COMMANDER_INDEX:-}" ]] && [[ ! -f "\${FAKE_COMMANDER_STOPPED:?}" ]]; then
    printf 'omnifm\\n'
  fi
  exit 0
fi

if [[ " $* " == *" ps --all --quiet omnifm "* ]]; then
  if [[ -n "\${FAKE_STOPPED_COMMANDER_INDEX:-}" ]]; then
    printf 'abcdef0123456789\\n'
  fi
  exit 0
fi

if [[ " $* " == *" inspect "* ]]; then
  if [[ -n "\${FAKE_STOPPED_COMMANDER_INDEX:-}" ]]; then
    printf 'BOT_PROCESS_ROLE=%s\\nCOMMANDER_BOT_INDEX=%s\\n' "\${FAKE_STOPPED_COMMANDER_ROLE:-commander}" "\${FAKE_STOPPED_COMMANDER_INDEX}"
  fi
  exit 0
fi

if [[ " $* " == *" exec "* ]]; then
  if [[ -n "\${FAKE_RUNNING_COMMANDER_INDEX:-}" ]]; then
    printf '%s\\t%s\\n' "\${FAKE_RUNNING_COMMANDER_ROLE:-commander}" "\${FAKE_RUNNING_COMMANDER_INDEX}"
  fi
  exit 0
fi

if [[ " $* " == *" stop "* ]] && [[ "$service" == "omnifm" ]]; then
  : > "\${FAKE_COMMANDER_STOPPED:?}"
  exit 0
fi

case " $* " in
  *" ps "*)
    if [[ -f "\${FAKE_STALE_WORKERS:?}" ]] && grep -Fqx "$worker_index" "$FAKE_STALE_WORKERS"; then
      printf 'container-%s\\n' "$worker_index"
    fi
    ;;
  *" rm "*)
    if [[ "\${FAKE_RM_FAIL_FOR:-}" == "$worker_index" ]]; then
      exit 42
    fi
    if [[ -f "\${FAKE_STALE_WORKERS:?}" ]]; then
      temp_file="\${FAKE_STALE_WORKERS}.tmp"
      grep -Fvx "$worker_index" "$FAKE_STALE_WORKERS" > "$temp_file" || true
      mv "$temp_file" "$FAKE_STALE_WORKERS"
    fi
    ;;
esac
`;
  const dockerPath = path.join(binDir, "docker");
  await fs.writeFile(dockerPath, fakeDocker, "utf8");
  await fs.chmod(dockerPath, 0o755);

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  return {
    sandbox,
    shellEnv: {
      ...process.env,
      FAKE_DOCKER_LOG: "docker.log",
      FAKE_STALE_WORKERS: "stale-workers.txt",
      FAKE_RM_FAIL_FOR: rmFailFor,
      FAKE_RUNNING_COMMANDER_INDEX: runningCommanderIndex,
      FAKE_RUNNING_COMMANDER_ROLE: runningCommanderRole,
      FAKE_STOPPED_COMMANDER_INDEX: stoppedCommanderIndex,
      FAKE_STOPPED_COMMANDER_ROLE: stoppedCommanderRole,
      FAKE_COMMANDER_STOPPED: "commander-stopped.txt",
    },
  };
}

async function runBash(sandbox, shellEnv, command) {
  return execFile(resolveBash(), ["-lc", `PATH="$PWD/bin:$PATH"; ${command}`], {
    cwd: sandbox,
    env: shellEnv,
  });
}

test("split reconciliation removes only inactive profile workers", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "BOT_3_TOKEN=three",
      "COMMANDER_BOT_INDEX=3",
      "",
    ].join("\n"),
    staleWorkers: "17\n20\n",
  });

  await runBash(sandbox, shellEnv, "source ./scripts/runtime-compose.sh; refresh_omnifm_compose_env \"$PWD\"; compose_reconcile_split_workers \"$PWD\"");

  assert.equal(await fs.readFile(path.join(sandbox, "stale-workers.txt"), "utf8"), "");
  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const removals = calls.filter((line) => line.includes(" rm "));
  assert.equal(removals.length, 2);
  assert.match(removals[0], /--profile worker-17 rm --stop --force omnifm-worker-17$/);
  assert.match(removals[1], /--profile worker-20 rm --stop --force omnifm-worker-20$/);
  assert.equal(removals.some((line) => /omnifm-worker-(1|2)(?:\s|$)/.test(line)), false);
  assert.equal(removals.some((line) => line.includes("--volumes")), false);
});

test("compose wrapper stops a changed commander before starting split workers", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    runningCommanderIndex: "1",
  });

  await runBash(sandbox, shellEnv, "./scripts/compose.sh up -d");

  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const stopIndex = calls.findIndex((line) => /\bstop -t 20 omnifm$/.test(line));
  const upIndex = calls.findIndex((line) => /\bup -d$/.test(line));
  assert.notEqual(stopIndex, -1);
  assert.notEqual(upIndex, -1);
  assert.ok(stopIndex < upIndex, "the old commander must stop before `up` can start workers");
  assert.ok(calls.some((line) => line.includes("exec -T omnifm sh -lc")));
  await fs.access(path.join(sandbox, "commander-stopped.txt"));
});

test("split topology preflight leaves an unchanged commander running", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    runningCommanderIndex: "2",
  });

  await runBash(sandbox, shellEnv, "source ./scripts/runtime-compose.sh; refresh_omnifm_compose_env \"$PWD\"; compose_prepare_split_topology_before_start \"$PWD\"");

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.doesNotMatch(calls, /\bstop -t 20 omnifm\b/);
});

test("compose start refuses to revive a stopped commander from a different topology", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    stoppedCommanderIndex: "1",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh start"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /compose start ist nicht sicher/i);
      return true;
    }
  );

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /ps --all --quiet omnifm/);
  assert.match(calls, /inspect --format/);
  assert.doesNotMatch(calls, /\bstop -t 20 omnifm\b/);
  assert.doesNotMatch(calls, /\bstart\b$/m);
});

test("compose wrapper refuses an inactive worker profile before it can recreate a stale worker", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "BOT_3_TOKEN=three",
      "COMMANDER_BOT_INDEX=3",
      "",
    ].join("\n"),
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh --profile worker-17 up -d"),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Profil worker-17 .* nicht aktiv/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper stops before up when stale-worker removal fails", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    staleWorkers: "17\n",
    rmFailFor: "17",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /nicht sicher entfernt werden|nicht sicher vorbereitet werden/i);
      return true;
    }
  );

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /--profile worker-17 rm --stop --force omnifm-worker-17/);
  assert.doesNotMatch(calls, /\sup\s/);
});

test("compose wrapper rejects an invalid commander before it can reconcile workers", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=17",
      "",
    ].join("\n"),
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /COMMANDER_BOT_INDEX=17/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper rejects incomplete numbered bot configuration before cleanup", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    completeClientIds: false,
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    staleWorkers: "17\n",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /BOT_1_CLIENT_ID/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper rejects duplicate bot identities before cleanup", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    completeClientIds: false,
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=shared-token",
      "BOT_1_CLIENT_ID=10000000000000001",
      "BOT_2_TOKEN=shared-token",
      "BOT_2_CLIENT_ID=10000000000000002",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    staleWorkers: "17\n",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Tokens duerfen nicht doppelt/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper rejects non-contiguous numbered bots before auto-mode cleanup", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    completeClientIds: false,
    envText: [
      "BOT_1_TOKEN=one",
      "BOT_1_CLIENT_ID=10000000000000001",
      "BOT_3_TOKEN=three",
      "BOT_3_CLIENT_ID=10000000000000003",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    staleWorkers: "3\n",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /ohne Luecke/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper rejects a numbered bot sequence that does not start at BOT_1", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    completeClientIds: false,
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_2_TOKEN=two",
      "BOT_2_CLIENT_ID=10000000000000002",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    staleWorkers: "2\n",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /ohne Luecke/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper accepts quoted CRLF values and honors the quoted commander index", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    completeClientIds: false,
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=\"split\"",
      "BOT_1_TOKEN=\"one\"",
      "BOT_1_CLIENT_ID=\"10000000000000001\"",
      "BOT_2_TOKEN=\"two\"",
      "BOT_2_CLIENT_ID=\"10000000000000002\"",
      "COMMANDER_BOT_INDEX=\"2\"",
      "",
    ].join("\r\n"),
    runningCommanderIndex: "1",
  });

  await runBash(sandbox, shellEnv, "./scripts/compose.sh up -d");

  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const stopIndex = calls.findIndex((line) => /\bstop -t 20 omnifm$/.test(line));
  const upIndex = calls.findIndex((line) => /\bup -d$/.test(line));
  assert.notEqual(stopIndex, -1);
  assert.notEqual(upIndex, -1);
  assert.ok(stopIndex < upIndex);
});

test("compose wrapper rejects up --no-recreate before a commander switch can revive old env", async (t) => {
  const envLines = ["OMNIFM_DEPLOYMENT_MODE=split"];
  for (let index = 1; index <= 17; index += 1) {
    envLines.push(`BOT_${index}_TOKEN=token-${index}`);
  }
  envLines.push("COMMANDER_BOT_INDEX=17", "");
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: envLines.join("\n"),
    runningCommanderIndex: "1",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh up -d --no-recreate"),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /--no-recreate/i);
      return true;
    }
  );

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("compose wrapper fails closed when start would revive a stopped split commander in monolith mode", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=monolith",
      "BOT_1_TOKEN=one",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    stoppedCommanderIndex: "1",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh start"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Topologie-Wechsel|alte Split-Topologie/i);
      return true;
    }
  );

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /ps --all --quiet omnifm/);
  assert.doesNotMatch(calls, /\bcompose start(?:\s|$)/);
});

test("compose wrapper refuses restart when a running commander belongs to another topology", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    runningCommanderIndex: "1",
  });

  await assert.rejects(
    runBash(sandbox, shellEnv, "./scripts/compose.sh restart"),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Topologie-Wechsel/i);
      return true;
    }
  );

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.doesNotMatch(calls, /\bcompose restart(?:\s|$)/);
});

test("compose wrapper stops a running split commander before split-to-monolith up", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=monolith",
      "BOT_1_TOKEN=one",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    runningCommanderIndex: "1",
  });

  await runBash(sandbox, shellEnv, "./scripts/compose.sh up -d");

  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const stopIndex = calls.findIndex((line) => /\bstop -t 20 omnifm$/.test(line));
  const upIndex = calls.findIndex((line) => /\bup -d$/.test(line));
  assert.notEqual(stopIndex, -1);
  assert.notEqual(upIndex, -1);
  assert.ok(stopIndex < upIndex, "the split commander must stop before monolith up");
});

test("compose wrapper does not mutate topology for a dry-run", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    staleWorkers: "17\n",
    runningCommanderIndex: "1",
  });

  await runBash(sandbox, shellEnv, "./scripts/compose.sh --dry-run up -d");

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /--dry-run up -d/);
  assert.doesNotMatch(calls, /\srm\s/);
  assert.doesNotMatch(calls, /\sstop\s/);
});

test("compose wrapper determines the actual subcommand instead of matching CLI payload text", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=2",
      "",
    ].join("\n"),
    staleWorkers: "17\n",
    runningCommanderIndex: "1",
  });

  await runBash(sandbox, shellEnv, "./scripts/compose.sh exec omnifm sh -lc 'echo up'");

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /exec omnifm sh -lc echo up/);
  assert.doesNotMatch(calls, /\srm\s/);
  assert.doesNotMatch(calls, /\sstop\s/);
});

test("compose wrapper rejects one-off runtime containers before Docker can duplicate a bot identity", async (t) => {
  const { sandbox, shellEnv } = await createSandbox(t, {
    envText: [
      "OMNIFM_DEPLOYMENT_MODE=split",
      "BOT_1_TOKEN=one",
      "BOT_2_TOKEN=two",
      "COMMANDER_BOT_INDEX=1",
      "",
    ].join("\n"),
    runningCommanderIndex: "1",
  });

  for (const service of ["omnifm", "omnifm-worker-2"]) {
    await assert.rejects(
      runBash(sandbox, shellEnv, `./scripts/compose.sh run ${service}`),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /docker compose run.*gesperrt/i);
        return true;
      }
    );
  }

  assert.equal(await fs.readFile(path.join(sandbox, "docker.log"), "utf8"), "");
});

test("PowerShell split launcher blocks before up when stale-worker removal fails", {
  skip: process.platform !== "win32",
}, async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-worker-reconcile-pwsh-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const binDir = path.join(sandbox, "bin");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "start-split.ps1"), path.join(scriptsDir, "start-split.ps1"));
  await fs.writeFile(path.join(sandbox, ".env"), [
    "BOT_1_TOKEN=one",
    "BOT_1_CLIENT_ID=10000000000000001",
    "BOT_2_TOKEN=two",
    "BOT_2_CLIENT_ID=10000000000000002",
    "COMMANDER_BOT_INDEX=1",
    "",
  ].join("\r\n"), "utf8");
  await fs.writeFile(path.join(sandbox, "docker-compose.split.yml"), "services: {}\r\n", "utf8");
  await fs.writeFile(path.join(sandbox, "docker.log"), "", "utf8");
  await fs.writeFile(path.join(binDir, "docker.cmd"), [
    "@echo off",
    "setlocal EnableExtensions EnableDelayedExpansion",
    "echo %*>>\"%FAKE_DOCKER_LOG%\"",
    "set last=",
    "for %%a in (%*) do set last=%%~a",
    "echo %* | findstr /C:\" ps \" >nul",
    "if not errorlevel 1 (",
    "  if \"!last!\"==\"omnifm-worker-17\" echo container-17",
    "  exit /b 0",
    ")",
    "echo %* | findstr /C:\" rm \" >nul",
    "if not errorlevel 1 (",
    "  if \"!last!\"==\"omnifm-worker-17\" exit /b 42",
    "  exit /b 0",
    ")",
    "exit /b 0",
    "",
  ].join("\r\n"), "utf8");

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  await assert.rejects(
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scriptsDir, "start-split.ps1")], {
      cwd: sandbox,
      env: {
        ...process.env,
        PATH: `${binDir};${process.env.PATH}`,
        FAKE_DOCKER_LOG: path.join(sandbox, "docker.log"),
      },
    }),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(`${error.stdout}\n${error.stderr}`, /konnte nicht sicher entfernt werden|trotz Bereinigung weiterhin vorhanden/i);
      return true;
    }
  );

  const calls = await fs.readFile(path.join(sandbox, "docker.log"), "utf8");
  assert.match(calls, /--profile worker-17 rm --stop --force omnifm-worker-17/);
  assert.doesNotMatch(calls, /\sup\s/);
});

test("PowerShell split launcher stops a changed commander before up", {
  skip: process.platform !== "win32",
}, async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-worker-reconcile-pwsh-topology-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const binDir = path.join(sandbox, "bin");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "start-split.ps1"), path.join(scriptsDir, "start-split.ps1"));
  await fs.writeFile(path.join(sandbox, ".env"), [
    "BOT_1_TOKEN=one",
    "BOT_1_CLIENT_ID=10000000000000001",
    "BOT_2_TOKEN=two",
    "BOT_2_CLIENT_ID=10000000000000002",
    "COMMANDER_BOT_INDEX=2",
    "",
  ].join("\r\n"), "utf8");
  await fs.writeFile(path.join(sandbox, "docker-compose.split.yml"), "services: {}\r\n", "utf8");
  await fs.writeFile(path.join(sandbox, "docker.log"), "", "utf8");
  await fs.writeFile(path.join(binDir, "docker.cmd"), [
    "@echo off",
    "setlocal EnableExtensions EnableDelayedExpansion",
    "echo %*>>\"%FAKE_DOCKER_LOG%\"",
    "echo %* | findstr /C:\"ps --all --quiet\" >nul",
    "if not errorlevel 1 exit /b 0",
    "echo %* | findstr /C:\"ps --services\" >nul",
    "if not errorlevel 1 (",
    "  if exist \"%FAKE_COMMANDER_STOPPED%\" exit /b 0",
    "  echo omnifm",
    "  exit /b 0",
    ")",
    "echo %* | findstr /C:\" exec \" >nul",
    "if not errorlevel 1 (",
    "  echo commander\t1",
    "  exit /b 0",
    ")",
    "echo %* | findstr /C:\" stop \" >nul",
    "if not errorlevel 1 (",
    "  >\"%FAKE_COMMANDER_STOPPED%\" echo stopped",
    "  exit /b 0",
    ")",
    "exit /b 0",
    "",
  ].join("\r\n"), "utf8");

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  await execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scriptsDir, "start-split.ps1")], {
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${binDir};${process.env.PATH}`,
      FAKE_DOCKER_LOG: path.join(sandbox, "docker.log"),
      FAKE_COMMANDER_STOPPED: path.join(sandbox, "commander-stopped.txt"),
    },
  });

  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const stopIndex = calls.findIndex((line) => /\bstop -t 20 omnifm$/.test(line));
  const upIndex = calls.findIndex((line) => /\bup -d$/.test(line));
  assert.notEqual(stopIndex, -1);
  assert.notEqual(upIndex, -1);
  assert.ok(stopIndex < upIndex, "the old commander must stop before PowerShell can start workers");
});

test("PowerShell split launcher normalizes quoted CRLF configuration before choosing worker profiles", {
  skip: process.platform !== "win32",
}, async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-worker-reconcile-pwsh-quoted-"));
  const scriptsDir = path.join(sandbox, "scripts");
  const binDir = path.join(sandbox, "bin");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "start-split.ps1"), path.join(scriptsDir, "start-split.ps1"));
  await fs.writeFile(path.join(sandbox, ".env"), [
    "BOT_1_TOKEN=\"one\"",
    "BOT_1_CLIENT_ID=\"10000000000000001\"",
    "BOT_2_TOKEN=\"two\"",
    "BOT_2_CLIENT_ID=\"10000000000000002\"",
    "COMMANDER_BOT_INDEX=\"2\"",
    "",
  ].join("\r\n"), "utf8");
  await fs.writeFile(path.join(sandbox, "docker-compose.split.yml"), "services: {}\r\n", "utf8");
  await fs.writeFile(path.join(sandbox, "docker.log"), "", "utf8");
  await fs.writeFile(path.join(binDir, "docker.cmd"), [
    "@echo off",
    "echo %*>>\"%FAKE_DOCKER_LOG%\"",
    "exit /b 0",
    "",
  ].join("\r\n"), "utf8");

  t.after(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  await execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scriptsDir, "start-split.ps1")], {
    cwd: sandbox,
    env: {
      ...process.env,
      PATH: `${binDir};${process.env.PATH}`,
      FAKE_DOCKER_LOG: path.join(sandbox, "docker.log"),
    },
  });

  const calls = (await fs.readFile(path.join(sandbox, "docker.log"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const upCall = calls.find((line) => /\bup -d(?:\s|$)/.test(line));
  assert.ok(upCall, "the split launcher should invoke compose up");
  assert.match(upCall, /--profile worker-1/);
  assert.doesNotMatch(upCall, /--profile worker-2/);
});

test("update and PowerShell launch paths preserve worker cleanup and topology safeguards", async () => {
  const updateScript = await fs.readFile(path.join(repoRoot, "update.sh"), "utf8");
  const powerShellLauncher = await fs.readFile(path.join(repoRoot, "scripts", "start-split.ps1"), "utf8");
  const composeWrapper = await fs.readFile(path.join(repoRoot, "scripts", "compose.sh"), "utf8");
  const stripeSetup = await fs.readFile(path.join(repoRoot, "setup-stripe.sh"), "utf8");
  const systemdUnit = await fs.readFile(path.join(repoRoot, "radio-bot.service"), "utf8");

  assert.match(updateScript, /reconcile_split_workers_before_start\(\) \{\s*refresh_compose_environment\s*if compose_prepare_split_topology_before_start/);
  assert.match(updateScript, /commander\)[\s\S]{0,900}compose_running_commander_requires_stop_before_split_start[\s\S]{0,300}run_update_deploy_strategy "rolling"/);
  assert.match(updateScript, /compose_stopped_commander_requires_recreate_before_split_start[\s\S]{0,300}run_update_deploy_strategy "rolling"/);
  assert.match(updateScript, /rolling\)[\s\S]{0,1100}compose_build[\s\S]{0,350}reconcile_split_workers_before_start/);
  assert.match(updateScript, /compose_up_no_deps --skip-worker-reconciliation "\$service"/);
  assert.match(updateScript, /compose_up\(\) \{\s*refresh_compose_environment\s*reconcile_split_workers_before_start \|\| return 1/s);
  assert.match(updateScript, /compose_up_with_build\(\) \{\s*refresh_compose_environment\s*reconcile_split_workers_before_start \|\| return 1/s);
  assert.match(updateScript, /repair_runtime_json_mount_dirs\(\)[\s\S]*?compose_prepare_split_topology_before_start "\$APP_DIR" "start"[\s\S]{0,500}compose_up \|\| warn/s);

  assert.match(composeWrapper, /compose_subcommand/);
  assert.match(composeWrapper, /--no-recreate/);
  assert.match(composeWrapper, /--dry-run/);
  assert.match(composeWrapper, /up\|create\|start\|restart/);
  assert.match(composeWrapper, /docker compose run ist ueber diesen Sicherheits-Wrapper gesperrt/);

  assert.match(stripeSetup, /warn\(\)/);
  assert.match(stripeSetup, /bash "\$APP_DIR\/scripts\/compose\.sh" up -d --build --remove-orphans/);
  assert.doesNotMatch(stripeSetup, /^\s*docker compose (?:up|start)\b/m);

  assert.match(systemdUnit, /^Environment=OMNIFM_CONTAINER_UID=1000$/m);
  assert.match(systemdUnit, /^Environment=OMNIFM_CONTAINER_GID=1000$/m);
  assert.match(systemdUnit, /^ExecStart=\/usr\/bin\/bash "__APP_DIR__\/scripts\/compose\.sh" up -d --build$/m);
  assert.match(systemdUnit, /^ExecStop=\/usr\/bin\/bash "__APP_DIR__\/scripts\/compose\.sh" down --remove-orphans$/m);

  assert.match(powerShellLauncher, /foreach \(\$workerIndex in 1\.\.20\)/);
  assert.match(powerShellLauncher, /"ps", "--all", "--quiet", \$service/);
  assert.match(powerShellLauncher, /"rm", "--stop", "--force", \$service/);
  assert.match(powerShellLauncher, /throw "Verwaister Worker konnte nicht sicher entfernt werden: \$service"/);
  assert.match(powerShellLauncher, /\$env:COMPOSE_PROFILES = \$profileNames -join ","/);
  assert.match(powerShellLauncher, /\$configuredBots -notcontains \$commanderIndex/);
  assert.match(powerShellLauncher, /function Prepare-SplitTopologyBeforeStart \{\s*Remove-StaleSplitWorkers\s*if \(Test-RunningCommanderRequiresStopBeforeSplitStart\)/);
  assert.match(powerShellLauncher, /BOT_PROCESS_ROLE:-/);
  assert.match(powerShellLauncher, /"stop", "-t", "20", "omnifm"/);
  const removeCommand = powerShellLauncher.match(/^\s*\$removeCommand = .*$/m)?.[0] || "";
  assert.doesNotMatch(removeCommand, /--volumes/);
});
