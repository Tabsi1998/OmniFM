// ============================================================
// OmniFM: the people who connected the linked roles (#302)
// ============================================================
// Per person Discord's access and refresh token, only encrypted
// (src/lib/token-crypto.js), when they run out, and what Discord got last.
// /mydata shows that a connection exists and deletes it; Discord forgets
// the values when the person removes the connection there.
import { getDb, isConnected } from "./lib/db.js";
import { decryptToken, encryptToken, tokenKeyFrom } from "./lib/token-crypto.js";

export const LINKED_ROLES_COLLECTION = "linked_roles";

function cleanUserId(userId) {
  const id = String(userId || "").trim();
  return /^\d{17,22}$/.test(id) ? id : "";
}

function linkedCollection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(LINKED_ROLES_COLLECTION);
}

/**
 * @param {string} userId
 * @param {{ accessToken: string, refreshToken: string, expiresAt: Date, scope?: string }} tokens
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function saveLinkedRoleTokens(userId, { accessToken, refreshToken, expiresAt, scope = "" }, { now = new Date(), key = tokenKeyFrom() } = {}) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !accessToken || !refreshToken) return { ok: false, error: "invalid" };
  if (!key) return { ok: false, error: "no-key" };
  if (!linked) return { ok: false, error: "no-database" };
  await linked.updateOne(
    { _id: id },
    {
      $setOnInsert: { userId: id, linkedAt: now },
      $set: {
        accessToken: encryptToken(accessToken, key),
        refreshToken: encryptToken(refreshToken, key),
        expiresAt,
        scope: String(scope || ""),
        updatedAt: now,
        failures: 0,
      },
    },
    { upsert: true },
  );
  return { ok: true };
}

/** The decrypted tokens, or null without a connection or when the key does not open them. */
export async function getLinkedRoleTokens(userId, { key = tokenKeyFrom() } = {}) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !linked) return null;
  const row = await linked.findOne({ _id: id });
  if (!row) return null;
  const accessToken = decryptToken(row.accessToken, key);
  const refreshToken = decryptToken(row.refreshToken, key);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt || 0) };
}

export async function listLinkedUserIds() {
  const linked = linkedCollection();
  if (!linked) return [];
  return (await linked.find({}, { projection: { _id: 1 } }).toArray()).map((row) => String(row._id));
}

export async function countLinkedRoles() {
  const linked = linkedCollection();
  return linked ? linked.countDocuments({}) : 0;
}

/** What Discord got, and when. */
export async function markRoleConnectionPushed(userId, metadata, { now = new Date() } = {}) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !linked) return;
  await linked.updateOne({ _id: id }, { $set: { pushedAt: now, metadata, failures: 0 } });
}

/** A failed refresh or push; the third one in a row ends the connection. */
export async function noteLinkedRoleFailure(userId, { limit = 3 } = {}) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !linked) return false;
  const row = await linked.findOneAndUpdate({ _id: id }, { $inc: { failures: 1 } }, { returnDocument: "after" });
  if ((Number(row?.failures) || 0) >= limit) {
    await linked.deleteOne({ _id: id });
    return true;
  }
  return false;
}

/** /mydata: whether a connection exists and since when, without the tokens. */
export async function getLinkedRoleInfo(userId) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !linked) return null;
  const row = await linked.findOne({ _id: id }, { projection: { linkedAt: 1, pushedAt: 1, metadata: 1 } });
  return row ? { linkedAt: row.linkedAt || null, pushedAt: row.pushedAt || null, metadata: row.metadata || null } : null;
}

export async function forgetLinkedRoles(userId) {
  const id = cleanUserId(userId);
  const linked = linkedCollection();
  if (!id || !linked) return 0;
  return (await linked.deleteOne({ _id: id })).deletedCount || 0;
}

// The premium role in the support server (#302): whom OmniFM gave it to,
// so that it only ever takes it back from them.
export const SUPPORT_ROLES_COLLECTION = "support_premium_roles";

function supportRolesCollection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(SUPPORT_ROLES_COLLECTION);
}

export function supportRolesAvailable() {
  return supportRolesCollection() !== null;
}

export async function recordSupportRole(guildId, userId, roleId, { now = new Date() } = {}) {
  const roles = supportRolesCollection();
  if (!roles) return;
  await roles.updateOne({ _id: `${guildId}:${userId}` }, { $setOnInsert: { guildId, userId, roleId, since: now } }, { upsert: true });
}

export async function listSupportRoleRecords(guildId) {
  const roles = supportRolesCollection();
  return roles ? roles.find({ guildId: String(guildId) }).toArray() : [];
}

export async function deleteSupportRoleRecord(recordId) {
  const roles = supportRolesCollection();
  if (roles) await roles.deleteOne({ _id: String(recordId) });
}

export async function countSupportRolesOf(userId) {
  const id = cleanUserId(userId);
  const roles = supportRolesCollection();
  return id && roles ? roles.countDocuments({ userId: id }) : 0;
}

export async function forgetSupportRolesOf(userId) {
  const id = cleanUserId(userId);
  const roles = supportRolesCollection();
  if (!id || !roles) return 0;
  return (await roles.deleteMany({ userId: id })).deletedCount || 0;
}
