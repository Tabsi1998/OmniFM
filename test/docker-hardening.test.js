import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseDockerignoreRules(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => ({
      negated: line.startsWith("!"),
      pattern: line.replace(/^!/, ""),
    }));
}

function normalizeDockerPath(filePath) {
  return String(filePath)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function dockerIgnorePatternToRegExp(pattern) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "[") {
      const closingIndex = pattern.indexOf("]", index + 1);
      assert.notEqual(closingIndex, -1, `invalid Docker ignore character class: ${pattern}`);
      source += pattern.slice(index, closingIndex + 1);
      index = closingIndex;
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  return new RegExp(`${source}$`);
}

function finalDockerignoreRuleFor(filePath, rules) {
  const normalizedPath = normalizeDockerPath(filePath);
  return rules.filter((rule) => dockerIgnorePatternToRegExp(rule.pattern).test(normalizedPath)).at(-1);
}

test("Docker build context is an allowlist without environment or runtime data", () => {
  const dockerignore = readRepoFile(".dockerignore");
  const lines = parseDockerignoreRules(dockerignore).map((rule) => `${rule.negated ? "!" : ""}${rule.pattern}`);

  assert.equal(lines[0], "*", "the first effective build-context rule must exclude everything");
  assert.ok(lines.includes("!package-lock.json"));
  assert.ok(lines.includes("!data/**"));
  assert.equal(lines.includes("!.env"), false);
  assert.equal(lines.includes("!.env.*"), false);
  assert.equal(lines.includes("!runtime-data/**"), false);
});

test("Docker build context keeps nested environment and credential files excluded after allowlist re-includes", () => {
  const rules = parseDockerignoreRules(readRepoFile(".dockerignore"));
  const protectedPaths = [
    "src/.env",
    "src/config/.ENV.production",
    "frontend/.env.local",
    "frontend\\deploy\\.NETRC",
    "data/private/credentials.json",
    "web/Secrets/discord-token.txt",
    "src/auth/discord-token.txt",
    "src/tls/service.KEY",
    "frontend\\certs\\deploy.PEM",
    "data/keys/client.P12",
    "web/keys/browser.pfx",
    "src/keys/signing.P8",
    "frontend/keys/team.kdbx",
    "src/ssh/id_rsa",
    "web\\ssh\\ID_ED25519",
  ];

  for (const protectedPath of protectedPaths) {
    const finalRule = finalDockerignoreRuleFor(protectedPath, rules);
    assert.ok(finalRule, `expected a Docker ignore rule for ${protectedPath}`);
    assert.equal(
      finalRule.negated,
      false,
      `${protectedPath} must remain excluded after all allowlist re-includes (matched ${finalRule.pattern})`
    );
  }
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
