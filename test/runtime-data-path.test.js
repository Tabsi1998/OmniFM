import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  resolveRuntimeDataDir,
  resolveRuntimeDataPath,
} from "../src/lib/runtime-data-path.js";

test("runtime data paths stay at the application root by default", () => {
  const rootDir = path.resolve(path.sep, "srv", "omnifm");
  assert.equal(resolveRuntimeDataDir({ env: {}, rootDir }), rootDir);
  assert.equal(
    resolveRuntimeDataPath("owner-audit.json", { env: {}, rootDir }),
    path.join(rootDir, "owner-audit.json")
  );
});

test("runtime data paths use an explicit runtime directory", () => {
  const rootDir = path.resolve(path.sep, "srv", "omnifm");
  const env = { OMNIFM_RUNTIME_DATA_DIR: "runtime-data" };

  assert.equal(resolveRuntimeDataDir({ env, rootDir }), path.join(rootDir, "runtime-data"));
  assert.equal(
    resolveRuntimeDataPath("logs/bot.log", { env, rootDir }),
    path.join(rootDir, "runtime-data", "logs", "bot.log")
  );
});

test("runtime data paths reject absolute and traversal paths", () => {
  assert.throws(() => resolveRuntimeDataPath(""), /non-empty relative path/i);
  assert.throws(() => resolveRuntimeDataPath("../owner-audit.json"), /traversal/i);
  assert.throws(() => resolveRuntimeDataPath("logs/../bot.log"), /traversal/i);
  assert.throws(() => resolveRuntimeDataPath(path.resolve(path.sep, "tmp", "audit.json")), /relative path/i);
});
