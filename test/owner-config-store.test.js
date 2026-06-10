import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getOwnerConfigSnapshot,
  patchOwnerConfig,
} from "../src/lib/owner-config-store.js";

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("owner config snapshot reads editable values and hides secret values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-config-"));
  const envFile = path.join(dir, ".env");
  await fs.writeFile(envFile, "PUBLIC_WEB_URL=https://omnifm.xyz\nAPI_ADMIN_TOKEN=super-secret\n", "utf8");
  const restoreEnv = setEnv({ OMNIFM_ENV_FILE: envFile });

  try {
    const snapshot = getOwnerConfigSnapshot();
    const webGroup = snapshot.groups.find((group) => group.id === "web");
    const publicUrl = webGroup.fields.find((field) => field.key === "PUBLIC_WEB_URL");
    const adminToken = snapshot.secrets.find((secret) => secret.key === "API_ADMIN_TOKEN");

    assert.equal(publicUrl.value, "https://omnifm.xyz");
    assert.equal(publicUrl.editable, true);
    assert.equal(adminToken.configured, true);
    assert.equal(adminToken.secret, true);
    assert.equal(Object.hasOwn(adminToken, "value"), false);
  } finally {
    restoreEnv();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("owner config patch persists allowlisted values and rejects secrets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-config-"));
  const envFile = path.join(dir, ".env");
  await fs.writeFile(envFile, "# OmniFM\nPUBLIC_WEB_URL=https://old.example\nLOG_MAX_MB=5\n", "utf8");
  const restoreEnv = setEnv({ OMNIFM_ENV_FILE: envFile });

  try {
    const patched = patchOwnerConfig({
      values: {
        PUBLIC_WEB_URL: "https://omnifm.xyz",
        CORS_ALLOWED_ORIGINS: "https://omnifm.xyz, https://www.omnifm.xyz/path",
        LOG_MAX_MB: "10",
        DEFAULT_LANGUAGE: "de",
        PRO_TRIAL_ENABLED: "ja",
      },
    });
    const content = await fs.readFile(envFile, "utf8");

    assert.equal(patched.restartRequired, true);
    assert.deepEqual(new Set(patched.updatedKeys), new Set([
      "PUBLIC_WEB_URL",
      "CORS_ALLOWED_ORIGINS",
      "LOG_MAX_MB",
      "DEFAULT_LANGUAGE",
      "PRO_TRIAL_ENABLED",
    ]));
    assert.match(content, /PUBLIC_WEB_URL=https:\/\/omnifm\.xyz/);
    assert.match(content, /CORS_ALLOWED_ORIGINS=https:\/\/omnifm\.xyz,https:\/\/www\.omnifm\.xyz/);
    assert.match(content, /LOG_MAX_MB=10/);
    assert.match(content, /DEFAULT_LANGUAGE=de/);
    assert.match(content, /PRO_TRIAL_ENABLED=1/);
    assert.equal(process.env.PUBLIC_WEB_URL, "https://omnifm.xyz");
    await fs.access(`${envFile}.bak-owner`);

    assert.throws(
      () => patchOwnerConfig({ values: { API_ADMIN_TOKEN: "new-secret" } }),
      /geheim/
    );
    assert.throws(
      () => patchOwnerConfig({ values: { PUBLIC_WEB_URL: "not a url" } }),
      /gueltige URL/
    );
  } finally {
    restoreEnv();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
