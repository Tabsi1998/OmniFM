import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Docker build context is an allowlist without environment or runtime data", () => {
  const dockerignore = readRepoFile(".dockerignore");
  const lines = dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.equal(lines[0], "*", "the first effective build-context rule must exclude everything");
  assert.ok(lines.includes("!package-lock.json"));
  assert.ok(lines.includes("!data/**"));
  assert.equal(lines.includes("!.env"), false);
  assert.equal(lines.includes("!.env.*"), false);
  assert.equal(lines.includes("!runtime-data/**"), false);
});

test("Docker runtime is non-root, retains only runtime dependencies, and keeps station data", () => {
  const dockerfile = readRepoFile("Dockerfile");

  assert.match(dockerfile, /ARG NODE_IMAGE=node:22\.23\.1-bookworm-slim/);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS runtime-deps/);
  assert.match(dockerfile, /COPY --chown=node:node data \.\/data/);
  assert.match(dockerfile, /ENV OMNIFM_RUNTIME_DATA_DIR=\/app\/runtime-data/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/docker-entrypoint\.sh"\]/);
  assert.match(dockerfile, /CMD \["node", "\/app\/src\/index\.js"\]/);
});

test("Compose uses one persistent data directory and preserves entrypoint initialization in split mode", () => {
  const monolith = readRepoFile("docker-compose.yml");
  const split = readRepoFile("docker-compose.split.yml");

  for (const compose of [monolith, split]) {
    assert.match(compose, /image: mongo:7\.0\.39-jammy/);
    assert.match(compose, /\.\/runtime-data:\/app\/runtime-data/);
    assert.match(compose, /no-new-privileges:true/);
    assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
    assert.doesNotMatch(compose, /\.\/premium\.json:\/app\/premium\.json/);
  }

  assert.match(split, /x-omnifm-worker-environment:[\s\S]*OMNIFM_RUNTIME_DATA_DIR: \/app\/runtime-data/);
  assert.match(split, /environment:\s*\n\s*<<: \*omnifm_worker_environment\s*\n\s*BOT_PROCESS_INDEX: "20"/);
});

test("runtime initialization covers owner audit data and validates data before custom role commands", () => {
  const entrypoint = readRepoFile("docker-entrypoint.sh");
  const initializer = readRepoFile("init-data.sh");

  assert.match(entrypoint, /init_json_file "\$OMNIFM_RUNTIME_DATA_DIR\/owner-audit\.json"/);
  assert.match(entrypoint, /is_default_app_command\(\)/);
  assert.ok(
    entrypoint.indexOf('init_json_file "$OMNIFM_RUNTIME_DATA_DIR/owner-audit.json"')
      < entrypoint.indexOf('exec "$@"'),
    "custom split commands must pass the runtime-data initialization first"
  );
  assert.match(initializer, /seed_json_file "owner-audit\.json"/);
  assert.match(initializer, /Refusing to follow it for runtime data safety/);
});
