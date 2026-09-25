export const COMMAND_PERMISSION_COMMANDS = [
  "play",
  "pause",
  "resume",
  "stop",
  "setvolume",
  "sleep",
  "stations",
  "list",
  "now",
  "stats",
  "history",
  "status",
  "health",
  "diag",
  "addstation",
  "removestation",
  "mystations",
  "event",
];

const MANAGED_SET = new Set(COMMAND_PERMISSION_COMMANDS);

export function normalizePermissionCommandName(rawCommand) {
  return String(rawCommand || "").trim().toLowerCase().replace(/^\//, "");
}

export function isPermissionManagedCommand(rawCommand) {
  return MANAGED_SET.has(normalizePermissionCommandName(rawCommand));
}

export function getPermissionCommandChoices() {
  return COMMAND_PERMISSION_COMMANDS.map((command) => ({
    name: `/${command}`,
    value: command,
  }));
}
