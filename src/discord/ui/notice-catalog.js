// ============================================================
// OmniFM Discord design system: the notice catalog (#270)
// ============================================================
// Every recurring problem has one code, one text in German and English and,
// where possible, a button that fixes it. Commands say `code`, the catalog
// says what the user reads and can do.

/**
 * code -> { kind, title: [de, en], body: (params) => [de, en], fix }
 * fix: "quickstart" | "stations" | "premium" | "permissions" | null
 */
export const NOTICE_CATALOG = Object.freeze({
  "guild-only": {
    kind: "warning",
    title: ["Nur auf Servern", "Servers only"],
    body: () => ["Das funktioniert nur auf einem Discord-Server, nicht in Direktnachrichten.", "This only works in a Discord server, not in direct messages."],
    fix: null,
  },
  "commander-only": {
    kind: "warning",
    title: ["Nur beim Commander", "Commander only"],
    body: () => ["Das bedient der Commander-Bot von OmniFM, nicht die Worker. Nutze den Befehl beim Commander.", "The OmniFM commander bot handles this, not the workers. Use the command with the commander."],
    fix: null,
  },
  "manage-server-required": {
    kind: "warning",
    title: ["Nur für Server-Verwalter", "Server managers only"],
    body: () => [
      "Die Einrichtung braucht das Recht **Server verwalten**. Radio starten kannst du trotzdem mit dem Schnellstart.",
      "The setup needs the **Manage Server** permission. You can still start the radio with the quick start.",
    ],
    fix: "quickstart",
  },
  "not-in-voice": {
    kind: "info",
    title: ["Kein Sprachkanal", "No voice channel"],
    body: () => ["Geh in einen Sprachkanal oder wähle im Schnellstart einen aus.", "Join a voice channel or choose one in the quick start."],
    fix: "quickstart",
  },
  "missing-permissions": {
    kind: "error",
    title: ["Mir fehlen Rechte", "I am missing permissions"],
    body: ({ missing = [], channel = "" } = {}) => {
      const list = missing.length ? missing.join(", ") : "-";
      return [
        `In ${channel || "diesem Kanal"} fehlt mir: **${list}**. Gib OmniFM diese Rechte in den Kanal- oder Rolleneinstellungen.`,
        `In ${channel || "this channel"} I am missing: **${list}**. Give OmniFM these permissions in the channel or role settings.`,
      ];
    },
    fix: "permissions",
  },
  "premium-required": {
    kind: "premium",
    title: ["Premium nötig", "Premium needed"],
    body: ({ tier = "Pro" } = {}) => [`Das gibt es ab **${tier}**.`, `This comes with **${tier}**.`],
    fix: "premium",
  },
  "station-unknown": {
    kind: "warning",
    title: ["Sender nicht gefunden", "Station not found"],
    body: () => ["Diesen Sender gibt es nicht (mehr). Wähle einen anderen.", "This station does not exist (any more). Pick another one."],
    fix: "stations",
  },
  "station-offline": {
    kind: "warning",
    title: ["Sender gerade nicht erreichbar", "Station unreachable right now"],
    body: ({ station = "" } = {}) => [
      `${station || "Der Sender"} antwortet gerade nicht. Versuch es später oder nimm einen anderen.`,
      `${station || "The station"} is not answering right now. Try later or pick another one.`,
    ],
    fix: "stations",
  },
  "nothing-playing": {
    kind: "info",
    title: ["Gerade läuft nichts", "Nothing is playing"],
    body: () => ["Starte einen Sender mit dem Schnellstart oder aus der Senderliste.", "Start a station with the quick start or from the station list."],
    fix: "quickstart",
  },
  "action-expired": {
    kind: "info",
    title: ["Nicht mehr gültig", "No longer valid"],
    body: () => ["Diese Ansicht ist abgelaufen. Öffne sie mit dem Befehl neu.", "This view has expired. Open it again with the command."],
    fix: null,
  },
  "unknown-action": {
    kind: "warning",
    title: ["Unbekannte Aktion", "Unknown action"],
    body: ({ command = "" } = {}) => [`Diese Aktion kennt ${command || "der Befehl"} nicht.`, `${command || "The command"} does not know this action.`],
    fix: null,
  },
  "failed": {
    kind: "error",
    title: ["Hat nicht geklappt", "That did not work"],
    body: ({ detail = "" } = {}) => [
      detail ? `Fehler: ${detail}` : "Etwas ist schiefgegangen. Versuch es gleich noch einmal.",
      detail ? `Error: ${detail}` : "Something went wrong. Please try again in a moment.",
    ],
    fix: null,
  },
});

export const NOTICE_CODES = Object.freeze(Object.keys(NOTICE_CATALOG));
