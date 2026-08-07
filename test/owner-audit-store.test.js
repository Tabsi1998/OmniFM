import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getOwnerAuditSnapshot,
  recordOwnerAudit,
  resetOwnerAuditForTests,
  resolveOwnerAuditFilePath,
} from "../src/lib/owner-audit-store.js";

test("owner audit store records events without leaking sensitive metadata values", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-audit-"));
  const auditFile = path.join(dir, "owner-audit.json");
  const previousAuditFile = process.env.OMNIFM_OWNER_AUDIT_FILE;
  process.env.OMNIFM_OWNER_AUDIT_FILE = auditFile;
  resetOwnerAuditForTests();

  t.after(async () => {
    if (previousAuditFile == null) delete process.env.OMNIFM_OWNER_AUDIT_FILE;
    else process.env.OMNIFM_OWNER_AUDIT_FILE = previousAuditFile;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const event = recordOwnerAudit({
    action: "owner.config.secrets.update",
    status: "success",
    actor: "owner",
    target: "env",
    summary: "Secrets aktualisiert",
    metadata: {
      updatedKeys: ["STRIPE_SECRET_KEY", "SMTP_PASS"],
      token: "must-not-leak",
      nested: { apiKey: "also-secret", visible: "ok" },
    },
  });

  assert.equal(event.metadata.token, "[redacted]");
  assert.equal(event.metadata.nested.apiKey, "[redacted]");
  assert.equal(event.metadata.nested.visible, "ok");
  assert.equal(resolveOwnerAuditFilePath(), auditFile);

  const snapshot = getOwnerAuditSnapshot();
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.events[0].action, "owner.config.secrets.update");
  assert.deepEqual(snapshot.events[0].metadata.updatedKeys, ["STRIPE_SECRET_KEY", "SMTP_PASS"]);

  const raw = await fs.readFile(auditFile, "utf8");
  assert.doesNotMatch(raw, /must-not-leak/);
  assert.doesNotMatch(raw, /also-secret/);
});

test("owner audit snapshot returns newest events first and honors limits", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-audit-"));
  const previousAuditFile = process.env.OMNIFM_OWNER_AUDIT_FILE;
  process.env.OMNIFM_OWNER_AUDIT_FILE = path.join(dir, "owner-audit.json");
  resetOwnerAuditForTests();

  t.after(async () => {
    if (previousAuditFile == null) delete process.env.OMNIFM_OWNER_AUDIT_FILE;
    else process.env.OMNIFM_OWNER_AUDIT_FILE = previousAuditFile;
    await fs.rm(dir, { recursive: true, force: true });
  });

  recordOwnerAudit({ action: "owner.first", status: "success", timestamp: "2026-06-11T06:00:00.000Z" });
  recordOwnerAudit({ action: "owner.second", status: "failed", timestamp: "2026-06-11T06:01:00.000Z" });

  const snapshot = getOwnerAuditSnapshot({ limit: 1 });
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].action, "owner.second");
  assert.equal(snapshot.events[0].status, "failed");
});

test("owner audit defaults to the persistent runtime data directory", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-audit-runtime-"));
  const previousRuntimeDir = process.env.OMNIFM_RUNTIME_DATA_DIR;
  const previousAuditFile = process.env.OMNIFM_OWNER_AUDIT_FILE;
  process.env.OMNIFM_RUNTIME_DATA_DIR = dir;
  delete process.env.OMNIFM_OWNER_AUDIT_FILE;
  resetOwnerAuditForTests();

  t.after(async () => {
    if (previousRuntimeDir == null) delete process.env.OMNIFM_RUNTIME_DATA_DIR;
    else process.env.OMNIFM_RUNTIME_DATA_DIR = previousRuntimeDir;
    if (previousAuditFile == null) delete process.env.OMNIFM_OWNER_AUDIT_FILE;
    else process.env.OMNIFM_OWNER_AUDIT_FILE = previousAuditFile;
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.equal(resolveOwnerAuditFilePath(), path.join(dir, "owner-audit.json"));
  recordOwnerAudit({ action: "owner.runtime.persist", status: "success" });
  assert.equal((await fs.stat(path.join(dir, "owner-audit.json"))).isFile(), true);
});

test("owner audit quarantines corrupt history instead of silently overwriting it", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-owner-audit-corrupt-"));
  const auditFile = path.join(dir, "owner-audit.json");
  const previousAuditFile = process.env.OMNIFM_OWNER_AUDIT_FILE;
  process.env.OMNIFM_OWNER_AUDIT_FILE = auditFile;
  await fs.writeFile(auditFile, "{not valid JSON", "utf8");

  t.after(async () => {
    if (previousAuditFile == null) delete process.env.OMNIFM_OWNER_AUDIT_FILE;
    else process.env.OMNIFM_OWNER_AUDIT_FILE = previousAuditFile;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const unavailable = getOwnerAuditSnapshot();
  assert.equal(unavailable.total, 0);
  assert.equal(unavailable.integrity?.status, "corrupt");
  assert.equal(await fs.readFile(auditFile, "utf8"), "{not valid JSON");

  recordOwnerAudit({ action: "owner.recovery.test", status: "success" });

  const entries = await fs.readdir(dir);
  const quarantined = entries.find((entry) => entry.startsWith("owner-audit.json.corrupt-"));
  assert.ok(quarantined, "the original corrupt audit history must be retained");
  assert.equal(await fs.readFile(path.join(dir, quarantined), "utf8"), "{not valid JSON");

  const recovered = getOwnerAuditSnapshot();
  assert.equal(recovered.total, 2);
  assert.equal(recovered.events[0].action, "owner.recovery.test");
  assert.equal(recovered.events[1].action, "owner.audit.integrity.recovered");
});
