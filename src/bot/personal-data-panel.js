// ============================================================
// OmniFM: /mydata – what OmniFM keeps about you (#285)
// ============================================================
// The private overview, the file with everything, and "delete everything"
// with a confirmation. Plain data in, payloads out; the runtime side is
// runtime-methods/personal-data.js, the data side lib/personal-data.js.
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";

import * as ui from "../discord/ui/index.js";

export const PERSONAL_DATA_PREFIX = "omnifm:mydata:";
const ACTIONS = new Set(["export", "erase", "eraseyes", "eraseno", "hourson", "hoursoff"]);

export function personalDataCustomId(action) {
  return `${PERSONAL_DATA_PREFIX}${action}`;
}

/** "omnifm:mydata:erase" -> "erase"; null for others. */
export function parsePersonalDataCustomId(customId) {
  const value = String(customId || "");
  if (!value.startsWith(PERSONAL_DATA_PREFIX)) return null;
  const action = value.slice(PERSONAL_DATA_PREFIX.length);
  return ACTIONS.has(action) ? action : null;
}

function rows({ t, counts }) {
  return [
    [t("💾 Merkliste", "💾 Saved songs"), counts.savedSongs, t("Songs", "songs")],
    [t("🗳 Votes (top.gg, discordbotlist)", "🗳 Votes (top.gg, discordbotlist)"), counts.votes, t("Votes", "votes")],
    [t("🔑 Dashboard-Anmeldungen", "🔑 Dashboard logins"), counts.dashboardLogins, t("aktiv", "active")],
    [t("📊 Laufende Umfragen, die du gestartet hast", "📊 Running polls you started"), counts.pollsStarted, ""],
    [t("📅 Events, die du angelegt hast", "📅 Events you created"), counts.eventsCreated, ""],
    [t("🛠 Deine Dashboard-Änderungen im Protokoll", "🛠 Your dashboard changes in the log"), counts.dashboardChanges, ""],
    counts.stationSuggestions ? [t("📻 Deine Sender-Vorschläge", "📻 Your station suggestions"), counts.stationSuggestions, ""] : null,
    counts.reports ? [t("📣 Deine Meldungen (mit „Gib mir Bescheid“)", "📣 Your reports (with “Tell me when it is done”)"), counts.reports, ""] : null,
    counts.easterEggs ? [t("🥚 Ostereiersuche (je Server und Jahr)", "🥚 Easter egg hunt (per server and year)"), counts.easterEggs, ""] : null,
    counts.linkedRoles ? [t("🔗 Verknüpfte Rollen in Discord", "🔗 Linked roles in Discord"), t("verbunden", "connected"), ""] : null,
    counts.supportRoles ? [t("⭐ Premium-Rolle im OmniFM-Support-Server", "⭐ Premium role in the OmniFM support server"), t("ja", "yes"), ""] : null,
    counts.ownerConsoleLogins ? [t("🔐 Anmeldungen in der Owner-Konsole", "🔐 Owner console logins"), counts.ownerConsoleLogins, ""] : null,
  ].filter(Boolean);
}

export function totalCount(counts = {}) {
  return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

/**
 * The overview: what is stored, the listening hours switch (#302) and the
 * two buttons. listening: { counting, hours } of the person.
 */
export function buildPersonalDataPayload({ t, counts, applicationId = null, listening = { counting: false, hours: 0 } }) {
  const lines = rows({ t, counts }).map(([label, count, unit]) => `${label}: **${count}**${unit ? ` ${unit}` : ""}`);
  lines.push(listening?.counting
    ? `${t("⏱ Hörstunden", "⏱ Listening hours")}: **${Number(listening.hours) || 0}** ${t("Std. (Zählen ist an)", "h (counting is on)")}`
    : `${t("⏱ Hörstunden", "⏱ Listening hours")}: **${t("aus", "off")}**`);
  const total = totalCount(counts);
  const body = [
    ui.text(lines.join("\n")),
    ui.separator(),
    ui.text(ui.subtext(t(
      "Hörstunden: Für verknüpfte Rollen (etwa „50 Stunden gehört“) zählt OmniFM die Zeit, in der du in einem Sprachkanal mit OmniFM bist. Nur, wenn du das hier einschaltest; Ausschalten löscht die Stunden.",
      "Listening hours: for linked roles (such as “listened 50 hours”) OmniFM counts the time you spend in a voice channel with OmniFM. Only if you switch it on here; switching it off deletes the hours."
    ))),
    ui.separator(),
    ui.text(ui.subtext(t(
      "Nicht dabei: Premium-Käufe und Rechnungen (die müssen wir aus steuerlichen Gründen aufbewahren) und die Einstellungen deiner Server (die gehören dem Server). Mehr dazu in der Datenschutzerklärung auf omnifm.xyz.",
      "Not included: premium purchases and invoices (we have to keep them for tax reasons) and your servers' settings (they belong to the server). More in the privacy policy on omnifm.xyz."
    ))),
  ];
  const actions = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(personalDataCustomId("export")).setStyle(ButtonStyle.Primary)
      .setLabel(t("📄 Als Datei schicken", "📄 Send as a file")),
    new ButtonBuilder().setCustomId(personalDataCustomId("erase")).setStyle(ButtonStyle.Danger)
      .setLabel(t("🗑 Alles löschen", "🗑 Delete everything")).setDisabled(total === 0),
    listening?.counting
      ? new ButtonBuilder().setCustomId(personalDataCustomId("hoursoff")).setStyle(ButtonStyle.Secondary)
        .setLabel(t("⏱ Hörstunden aus und löschen", "⏱ Hours off and deleted"))
      : new ButtonBuilder().setCustomId(personalDataCustomId("hourson")).setStyle(ButtonStyle.Success)
        .setLabel(t("⏱ Hörstunden zählen", "⏱ Count listening hours")),
  )];
  return ui.reply(ui.panel({
    title: `${ui.icon("info", applicationId)} ${t("Deine Daten bei OmniFM", "Your data at OmniFM")}`,
    subtitle: ui.subtext(t("Nur du siehst das.", "Only you see this.")),
    body,
    actions,
  }));
}

/** The file: everything as JSON, plus a short plain message (no V2, so the file shows). */
export function buildPersonalDataFile({ t, data }) {
  const file = new AttachmentBuilder(Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf8"), { name: "omnifm-meine-daten.json" });
  return {
    content: t(
      "Hier ist alles, was OmniFM über dich gespeichert hat, als Datei. Löschen kannst du es mit `/meine-daten`.",
      "Here is everything OmniFM has stored about you, as a file. You can delete it with `/mydata`."
    ),
    files: [file],
  };
}

/** The answer to "send as a file": in the DMs, or here when they are closed. */
export function buildPersonalDataFileSentPayload({ t, dmSent, applicationId = null }) {
  return ui.reply(ui.notice(dmSent ? "success" : "info", {
    title: dmSent ? t("Datei geschickt", "File sent") : t("Datei kommt hier", "File comes here"),
    body: dmSent
      ? t("Die Datei liegt in deinen Direktnachrichten.", "The file is in your direct messages.")
      : t("Deine Direktnachrichten sind zu, darum kommt die Datei gleich hier, nur für dich.", "Your direct messages are closed, so the file comes here in a moment, only for you."),
    applicationId,
  }));
}

export function buildPersonalDataFileHere({ t, data }) {
  return { ...buildPersonalDataFile({ t, data }), flags: MessageFlags.Ephemeral };
}

export function buildErasePersonalDataConfirm({ t, counts }) {
  return ui.reply(ui.confirm({
    title: t("Alles löschen?", "Delete everything?"),
    body: t(
      "OmniFM löscht deine Merkliste, deine Votes, deine Anmeldungen (du wirst im Dashboard abgemeldet), deine Hörstunden und die verknüpften Rollen. Bei Umfragen, Events und Dashboard-Änderungen bleibt der Eintrag für den Server, dein Name wird entfernt. Insgesamt {count} Einträge. Das lässt sich nicht rückgängig machen.",
      "OmniFM deletes your saved songs, your votes, your logins (you are signed out of the dashboard), your listening hours and the linked roles. Polls, events and dashboard changes stay with the server, your name is removed. {count} entries in all. This cannot be undone.",
      { count: totalCount(counts) }
    ),
    confirmId: personalDataCustomId("eraseyes"),
    cancelId: personalDataCustomId("eraseno"),
    confirmLabel: t("Ja, alles löschen", "Yes, delete everything"),
    danger: true,
    t,
  }));
}

export function buildPersonalDataErasedPayload({ t, counts, applicationId = null }) {
  return ui.reply(ui.notice("success", {
    title: t("Deine Daten sind gelöscht", "Your data is deleted"),
    body: t(
      "{count} Einträge gelöscht oder von dir gelöst. Stimmst du später wieder ab oder merkst dir einen Song, entsteht das neu.",
      "{count} entries deleted or detached from you. If you vote again or save a song later, that is stored anew.",
      { count: totalCount(counts) }
    ),
    applicationId,
  }));
}

export function buildPersonalDataProblemPayload({ t, error, applicationId = null }) {
  return ui.reply(ui.notice("error", {
    title: t("Gerade nicht möglich", "Not possible right now"),
    body: error === "db_unavailable"
      ? t("Die Datenbank ist gerade nicht erreichbar. Versuch es gleich noch einmal.", "The database is not reachable right now. Please try again in a moment.")
      : t("Das hat nicht geklappt. Versuch es gleich noch einmal.", "That did not work. Please try again in a moment."),
    applicationId,
  }));
}
