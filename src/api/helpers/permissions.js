// OmniFM API: role and command permission rules of the dashboard.
// Split out of src/api/server.js (#293).
import { getSupportedPermissionCommands } from "../../command-permissions-store.js";

function normalizeDashboardRoleToken(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const mention = text.match(/^<@&(\d{17,22})>$/);
  if (mention) return mention[1];
  return text;
}

async function resolveGuildRoleIds(guild, rawRoles) {
  const roleIds = [];
  const unresolved = [];
  const seen = new Set();
  const roleCollection = guild?.roles?.cache || new Map();

  if (guild?.roles?.fetch) {
    try {
      await guild.roles.fetch();
    } catch {}
  }

  for (const rawRole of Array.isArray(rawRoles) ? rawRoles : []) {
    const token = normalizeDashboardRoleToken(rawRole);
    if (!token) continue;

    let roleId = /^\d{17,22}$/.test(token) ? token : "";
    if (!roleId) {
      const lowerToken = token.toLowerCase();
      const match = [...roleCollection.values()].find((role) => String(role?.name || "").trim().toLowerCase() === lowerToken);
      roleId = String(match?.id || "").trim();
    }

    if (!/^\d{17,22}$/.test(roleId)) {
      unresolved.push(token);
      continue;
    }
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    roleIds.push(roleId);
  }

  return { roleIds, unresolved };
}

export function formatDashboardPermissionMapForClient(commandRules, guild) {
  const output = {};
  const roleCollection = guild?.roles?.cache || new Map();
  const supportedCommands = getSupportedPermissionCommands();

  for (const command of supportedCommands) {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? rule.allowRoleIds : [];
    output[command] = allowRoleIds.map((roleId) => roleCollection.get(roleId)?.name || roleId);
  }

  return output;
}

export function formatDashboardPermissionRulesForClient(commandRules, guild) {
  const roleCollection = guild?.roles?.cache || new Map();
  return getSupportedPermissionCommands().map((command) => {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? [...new Set(rule.allowRoleIds)] : [];
    return {
      command,
      allowRoleIds,
      allowRoles: allowRoleIds.map((roleId) => ({
        id: roleId,
        name: roleCollection.get(roleId)?.name || roleId,
      })),
    };
  });
}

function extractDashboardPermissionRuleTokens(rawRule) {
  const tokens = [];
  for (const roleId of Array.isArray(rawRule?.allowRoleIds) ? rawRule.allowRoleIds : []) {
    tokens.push(roleId);
  }
  for (const roleEntry of Array.isArray(rawRule?.allowRoles) ? rawRule.allowRoles : []) {
    if (typeof roleEntry === "string") {
      tokens.push(roleEntry);
      continue;
    }
    if (!roleEntry || typeof roleEntry !== "object") continue;
    tokens.push(roleEntry.id || roleEntry.roleId || roleEntry.name || "");
  }
  return tokens.filter(Boolean);
}

export async function resolveDashboardPermissionRuleUpdates(guild, body) {
  const supportedCommands = getSupportedPermissionCommands();
  const unresolved = [];
  const resolvedCommands = [];

  if (Array.isArray(body?.rules)) {
    for (const rawRule of body.rules) {
      const command = String(rawRule?.command || "").trim().replace(/^\//, "").toLowerCase();
      if (!supportedCommands.includes(command)) continue;
      // eslint-disable-next-line no-await-in-loop -- one command after the other, the roles come from Discord
      const resolved = await resolveGuildRoleIds(guild, extractDashboardPermissionRuleTokens(rawRule));
      if (resolved.unresolved.length) {
        unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
        continue;
      }
      resolvedCommands.push({ command, roleIds: resolved.roleIds });
    }
    return { supportedCommands, unresolved, resolvedCommands };
  }

  const incomingMap = body?.commandRoleMap && typeof body.commandRoleMap === "object"
    ? body.commandRoleMap
    : {};
  for (const [rawCommand, rawRoles] of Object.entries(incomingMap)) {
    const command = String(rawCommand || "").trim().replace(/^\//, "").toLowerCase();
    if (!supportedCommands.includes(command)) continue;
    // eslint-disable-next-line no-await-in-loop -- one command after the other, the roles come from Discord
    const resolved = await resolveGuildRoleIds(guild, rawRoles);
    if (resolved.unresolved.length) {
      unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
      continue;
    }
    resolvedCommands.push({ command, roleIds: resolved.roleIds });
  }
  return { supportedCommands, unresolved, resolvedCommands };
}
