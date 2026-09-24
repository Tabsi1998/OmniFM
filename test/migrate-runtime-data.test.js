import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/migrate-runtime-data.sh", import.meta.url));
const bash = spawnSync("bash", ["--version"]).status === 0 ? "bash" : null;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-migrate-"));
  fs.writeFileSync(path.join(root, "bot-state.json"), "{\"a\":1}");
  fs.writeFileSync(path.join(root, "bot-state.json.bak"), "{}");
  fs.mkdirSync(path.join(root, "bot-state"));
  fs.writeFileSync(path.join(root, "bot-state", "bot-2.json"), "{}");
  fs.writeFileSync(path.join(root, "premium.json"), "{\"root\":true}");
  fs.writeFileSync(path.join(root, "stations.json"), "{}");
  fs.mkdirSync(path.join(root, "runtime-data"));
  fs.writeFileSync(path.join(root, "runtime-data", "premium.json"), "{\"runtime\":true}");
  return root;
}

function run(...args) {
  // Forward slashes: Git Bash on Windows and bash on Linux both accept them.
  return execFileSync(bash, [script.replace(/\\/g, "/"), ...args.map((arg) => arg.replace(/\\/g, "/"))], { encoding: "utf8" });
}

test("runtime files move from the root into runtime-data with a backup first", { skip: !bash && "bash is not installed" }, (t) => {
  const root = makeRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const output = run(root);
  assert.match(output, /^backup .*runtime-root-\d{8}-\d{6}\.tar\.gz$/m);
  assert.match(output, /^moved bot-state\.json$/m);
  assert.match(output, /^moved bot-state\.json\.bak$/m);
  assert.match(output, /^moved bot-state$/m);
  assert.match(output, /^kept premium\.json /m);

  assert.equal(fs.readFileSync(path.join(root, "runtime-data", "bot-state.json"), "utf8"), "{\"a\":1}");
  assert.ok(fs.existsSync(path.join(root, "runtime-data", "bot-state", "bot-2.json")));
  assert.equal(fs.existsSync(path.join(root, "bot-state.json")), false);
  assert.equal(fs.readFileSync(path.join(root, "runtime-data", "premium.json"), "utf8"), "{\"runtime\":true}", "never overwritten");
  assert.equal(fs.readFileSync(path.join(root, "premium.json"), "utf8"), "{\"root\":true}", "the root copy stays");
  assert.ok(fs.existsSync(path.join(root, "stations.json")), "the tracked seed catalog is no runtime file");
  const archives = fs.readdirSync(path.join(root, ".update-backups", "runtime-root"));
  assert.equal(archives.length, 1);

  assert.equal(run("--list", root).trim(), "left in root: premium.json");
  assert.equal(run(root).trim(), "kept premium.json (runtime-data/premium.json already exists, the root copy stays)");
});

test("nothing to move means no output and no backup", { skip: !bash && "bash is not installed" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-migrate-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(run(root), "");
  assert.equal(fs.existsSync(path.join(root, ".update-backups")), false);
});
