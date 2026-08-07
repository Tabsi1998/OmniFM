import fs from "node:fs";
import path from "node:path";
import {
  COMMAND_PERMISSION_COMMANDS,
  isPermissionManagedCommand,
  normalizePermissionCommandName,
} from "./config/command-permissions.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const DEFAULT_STORE_FILE = resolveRuntimeDataPath("command-permissions.json");
const STORE_FILE = path.resolve(process.env.OMNIFM_COMMAND_PERMISSIONS_FILE || DEFAULT_STORE_FILE);
const STORE_BACKUP_FILE = STORE_FILE + ".bak";

function emptyStore() {
  return { guilds: {} };
}

function isDiscordSnowflake(value) {
  return /^\d{17,22}$/.test(String(value || "").trim());
}

function normalizeGuildId(rawGuildId) {
  const guildId = String(rawGuildId || "").trim();
  return isDiscordSnowflake(guildId) ? guildId : "";
}

function normalizeRoleId(rawRoleId) {
  const roleId = String(rawRoleId || "").trim();
  return isDiscordSnowflake(roleId) ? roleId : "";
}

function uniqueRoleIds(input) {
  if (!Array.isArray(input)) return [];
  const ids = [];
  const seen = new Set();
  for (const raw of input) {
    const roleId = normalizeRoleId(raw);
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    ids.push(roleId);
  }
  return ids;
}

function normalizeRule(rawRule) {
  const allowRoleIds = uniqueRoleIds(rawRule?.allowRoleIds);
  const denyRoleIds = uniqueRoleIds(rawRule?.denyRoleIds).filter((id) => !allowRoleIds.includes(id));
  return { allowRoleIds, denyRoleIds };
}

function hasRuleEntries(rule) {
  return (rule.allowRoleIds?.length || 0) > 0 || (rule.denyRoleIds?.length || 0) > 0;
}

function normalizeCommandRules(rawRules) {
  const source = rawRules && typeof rawRules === "object" ? rawRules : {};
  const out = {};
  for (const [rawCommand, rawRule] of Object.entries(source)) {
    const command = normalizePermissionCommandName(rawCommand);
    if (!isPermissionManagedCommand(command)) continue;
    const rule = normalizeRule(rawRule);
    if (!hasRuleEntries(rule)) continue;
    out[command] = rule;
  }
  return out;
}

function normalizeStore(rawStore) {
  const root = rawStore && typeof rawStore === "object" ? rawStore : {};
  const sourceGuilds = root.guilds && typeof root.guilds === "object" ? root.guilds : root;
  const guilds = {};

  for (const [rawGuildId, rawEntry] of Object.entries(sourceGuilds || {})) {
    const guildId = normalizeGuildId(rawGuildId);
    if (!guildId) continue;

    const rawCommands = rawEntry?.commands && typeof rawEntry.commands === "object"
      ? rawEntry.commands
      : rawEntry;
    const commands = normalizeCommandRules(rawCommands);
    if (!Object.keys(commands).length) continue;

    guilds[guildId] = { commands };
  }

  return { guilds };
}

function readFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return emptyStore();
    return JSON.parse(raw);
  } catch (err) {
    logStoreLoadError("command-permissions", filePath, err);
    return null;
  }
}

function load() {
  const data = readFileSafe(STORE_FILE) || readFileSafe(STORE_BACKUP_FILE) || emptyStore();
  return normalizeStore(data);
}

function save(data) {
  const payload = JSON.stringify(normalizeStore(data), null, 2) + "\n";
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    if (fs.existsSync(STORE_FILE) && fs.statSync(STORE_FILE).isDirectory()) {
      return;
    }

    if (fs.existsSync(STORE_FILE)) {
      try {
        fs.copyFileSync(STORE_FILE, STORE_BACKUP_FILE);
      } catch {
        // ignore backup errors
      }
    }

    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, payload, "utf8");
    }
  } catch (err) {
    log("ERROR", `[command-permissions] Save error: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function cloneRule(rule) {
  return {
    allowRoleIds: [...(rule?.allowRoleIds || [])],
    denyRoleIds: [...(rule?.denyRoleIds || [])],
  };
}

function getRuleOrEmpty(commands, command) {
  const rule = commands?.[command];
  return rule ? cloneRule(rule) : { allowRoleIds: [], denyRoleIds: [] };
}

function ensureGuildEntry(data, guildId) {
  if (!data.guilds[guildId]) data.guilds[guildId] = { commands: {} };
  if (!data.guilds[guildId].commands) data.guilds[guildId].commands = {};
  return data.guilds[guildId];
}

function cleanupGuildEntry(data, guildId) {
  const entry = data.guilds[guildId];
  if (!entry) return;
  if (!entry.commands || !Object.keys(entry.commands).length) {
    delete data.guilds[guildId];
  }
}

export function getSupportedPermissionCommands() {
  return [...COMMAND_PERMISSION_COMMANDS];
}

export function getGuildCommandPermissionRules(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return {};
  const data = load();
  const entry = data.guilds[gid];
  if (!entry?.commands) return {};

  const out = {};
  for (const [command, rule] of Object.entries(entry.commands)) {
    out[command] = cloneRule(rule);
  }
  return out;
}

export function getCommandPermissionRule(guildId, commandName) {
  const gid = normalizeGuildId(guildId);
  const command = normalizePermissionCommandName(commandName);
  if (!gid || !isPermissionManagedCommand(command)) {
    return { allowRoleIds: [], denyRoleIds: [] };
  }
  const data = load();
  const commands = data.guilds[gid]?.commands || {};
  return getRuleOrEmpty(commands, command);
}

export function setCommandRolePermission(guildId, commandName, roleId, mode = "allow") {
  const gid = normalizeGuildId(guildId);
  const command = normalizePermissionCommandName(commandName);
  const rid = normalizeRoleId(roleId);
  const normalizedMode = String(mode || "").trim().toLowerCase();

  if (!gid) return { ok: false, message: "Ungueltige Guild-ID." };
  if (!isPermissionManagedCommand(command)) return { ok: false, message: "Command wird nicht unterstuetzt." };
  if (!rid) return { ok: false, message: "Ungueltige Rollen-ID." };
  if (normalizedMode !== "allow" && normalizedMode !== "deny") {
    return { ok: false, message: "Mode muss 'allow' oder 'deny' sein." };
  }

  const data = load();
  const entry = ensureGuildEntry(data, gid);
  const rule = normalizeRule(entry.commands[command]);

  if (normalizedMode === "allow") {
    if (!rule.allowRoleIds.includes(rid)) rule.allowRoleIds.push(rid);
    rule.denyRoleIds = rule.denyRoleIds.filter((id) => id !== rid);
  } else {
    if (!rule.denyRoleIds.includes(rid)) rule.denyRoleIds.push(rid);
    rule.allowRoleIds = rule.allowRoleIds.filter((id) => id !== rid);
  }

  if (hasRuleEntries(rule)) {
    entry.commands[command] = rule;
  } else {
    delete entry.commands[command];
  }
  cleanupGuildEntry(data, gid);
  save(data);

  return { ok: true, rule: getCommandPermissionRule(gid, command) };
}

export function removeCommandRolePermission(guildId, commandName, roleId) {
  const gid = normalizeGuildId(guildId);
  const command = normalizePermissionCommandName(commandName);
  const rid = normalizeRoleId(roleId);

  if (!gid) return { ok: false, message: "Ungueltige Guild-ID." };
  if (!isPermissionManagedCommand(command)) return { ok: false, message: "Command wird nicht unterstuetzt." };
  if (!rid) return { ok: false, message: "Ungueltige Rollen-ID." };

  const data = load();
  const entry = ensureGuildEntry(data, gid);
  const rule = normalizeRule(entry.commands[command]);
  const beforeAllow = rule.allowRoleIds.length;
  const beforeDeny = rule.denyRoleIds.length;

  rule.allowRoleIds = rule.allowRoleIds.filter((id) => id !== rid);
  rule.denyRoleIds = rule.denyRoleIds.filter((id) => id !== rid);

  const changed = rule.allowRoleIds.length !== beforeAllow || rule.denyRoleIds.length !== beforeDeny;

  if (hasRuleEntries(rule)) {
    entry.commands[command] = rule;
  } else {
    delete entry.commands[command];
  }

  cleanupGuildEntry(data, gid);
  save(data);
  return { ok: true, changed, rule: getCommandPermissionRule(gid, command) };
}

export function resetCommandPermissions(guildId, commandName = null) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return { ok: false, message: "Ungueltige Guild-ID." };

  const data = load();
  const entry = data.guilds[gid];
  if (!entry) return { ok: true, changed: false };

  if (commandName) {
    const command = normalizePermissionCommandName(commandName);
    if (!isPermissionManagedCommand(command)) {
      return { ok: false, message: "Command wird nicht unterstuetzt." };
    }
    const changed = Boolean(entry.commands?.[command]);
    if (changed) delete entry.commands[command];
    cleanupGuildEntry(data, gid);
    save(data);
    return { ok: true, changed };
  }

  delete data.guilds[gid];
  save(data);
  return { ok: true, changed: true };
}

export function evaluateCommandPermission(guildId, commandName, memberRoleIds = []) {
  const gid = normalizeGuildId(guildId);
  const command = normalizePermissionCommandName(commandName);
  if (!gid || !isPermissionManagedCommand(command)) {
    return {
      managed: false,
      configured: false,
      allowed: true,
      reason: "not_managed",
      allowRoleIds: [],
      denyRoleIds: [],
      matchedRoleIds: [],
    };
  }

  const rule = getCommandPermissionRule(gid, command);
  const allowRoleIds = rule.allowRoleIds;
  const denyRoleIds = rule.denyRoleIds;
  const configured = allowRoleIds.length > 0 || denyRoleIds.length > 0;

  if (!configured) {
    return {
      managed: true,
      configured: false,
      allowed: true,
      reason: "open",
      allowRoleIds,
      denyRoleIds,
      matchedRoleIds: [],
    };
  }

  const roleSet = new Set(uniqueRoleIds(memberRoleIds));
  const matchedDeny = denyRoleIds.filter((id) => roleSet.has(id));
  if (matchedDeny.length > 0) {
    return {
      managed: true,
      configured: true,
      allowed: false,
      reason: "deny",
      allowRoleIds,
      denyRoleIds,
      matchedRoleIds: matchedDeny,
    };
  }

  if (allowRoleIds.length > 0) {
    const matchedAllow = allowRoleIds.filter((id) => roleSet.has(id));
    if (matchedAllow.length > 0) {
      return {
        managed: true,
        configured: true,
        allowed: true,
        reason: "allow",
        allowRoleIds,
        denyRoleIds,
        matchedRoleIds: matchedAllow,
      };
    }
    return {
      managed: true,
      configured: true,
      allowed: false,
      reason: "allow_required",
      allowRoleIds,
      denyRoleIds,
      matchedRoleIds: [],
    };
  }

  return {
    managed: true,
    configured: true,
    allowed: true,
    reason: "open",
    allowRoleIds,
    denyRoleIds,
    matchedRoleIds: [],
  };
}

// Legacy aliases expected by runtime imports.
export const getCommandPermission = getCommandPermissionRule;
export function setCommandPermission(guildId, commandName, roleId, mode = "allow") {
  return setCommandRolePermission(guildId, commandName, roleId, mode);
}
export function removeCommandPermission(guildId, commandName, roleId) {
  return removeCommandRolePermission(guildId, commandName, roleId);
}
export const listCommandPermissions = getGuildCommandPermissionRules;
