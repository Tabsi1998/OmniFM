// ============================================================
// OmniFM: /help as an interactive panel (#269)
// ============================================================
// A category menu instead of a wall of commands. Every page says in a few
// lines what matters and has buttons that start the thing right away.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";

import * as ui from "../discord/ui/index.js";
import { planSummaryLine } from "./plan-texts.js";
import {
  INVITE_COMPONENT_ID_OPEN,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_OPEN,
} from "./runtime-links.js";

export const HELP_COMPONENT_PREFIX = "omnifm:help:";
export const HELP_SECTION_SELECT_ID = `${HELP_COMPONENT_PREFIX}section`;

export const HELP_SECTIONS = Object.freeze(["overview", "playback", "stations", "events", "settings", "premium", "troubleshooting"]);

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setStyle(style).setLabel(label);
}

function link(url, label) {
  return new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

/**
 * @param {object} input
 * @param {(de: string, en: string) => string} input.t
 * @param {string} [input.section]
 * @param {object} input.plan   { name, bitrate, maxBots }
 * @param {string} [input.guildName]
 * @param {object} input.urls   { dashboard, guide, website, support, premium }
 * @param {string|null} [input.applicationId]
 * @param {object} [input.planContext] { freeStations, allStations } of the catalogue (#413)
 */
export function buildHelpPayload(input) {
  const { t, plan = {}, urls = {}, applicationId: appId = null, planContext = {} } = input;
  const language = t("de", "en");
  const section = HELP_SECTIONS.includes(input.section) ? input.section : "overview";
  const labels = {
    overview: [t("Überblick", "Overview"), "info"],
    playback: [t("Abspielen", "Playback"), "play"],
    stations: [t("Sender", "Stations"), "radio"],
    events: [t("Events", "Events"), "history"],
    settings: [t("Einstellungen & Rechte", "Settings & permissions"), "settings"],
    premium: ["Premium", "premium"],
    troubleshooting: [t("Probleme lösen", "Troubleshooting"), "help"],
  };

  const pages = {
    overview: {
      body: [
        ui.statusLine([`${t("Plan", "Plan")}: **${plan.name || "Free"}**`, plan.bitrate ? `${plan.bitrate} Audio` : null, plan.maxBots ? t(`${plan.maxBots} Worker`, `${plan.maxBots} workers`) : null]),
        "",
        t("**So geht's los:**", "**Getting started:**"),
        t("1. Geh in einen Sprachkanal.", "1. Join a voice channel."),
        t("2. Tippe auf **Schnellstart** oder wähle einen Sender.", "2. Tap **Quick start** or pick a station."),
        t("3. OmniFM spielt rund um die Uhr, auch wenn alle weg sind.", "3. OmniFM plays around the clock, even when everyone left."),
      ],
      actions: [
        row(button(PLAY_COMPONENT_ID_OPEN, t("Schnellstart", "Quick start"), ButtonStyle.Primary), button(STATIONS_COMPONENT_ID_OPEN, t("Sender", "Stations")), button(WORKERS_COMPONENT_ID_OPEN, "Worker")),
      ],
    },
    playback: {
      body: [
        t("`/play` startet einen Sender, `/pause` und `/resume` halten an und machen weiter, `/stop` beendet.", "`/play` starts a station, `/pause` and `/resume` hold and continue, `/stop` ends it."),
        t("`/setvolume` stellt die Lautstärke, `/now` zeigt, was gerade läuft.", "`/setvolume` sets the volume, `/now` shows what is playing."),
        t("`/sleep` schaltet das Radio nach 15 Minuten bis 2 Stunden leise aus.", "`/sleep` turns the radio off softly after 15 minutes to 2 hours."),
        t("`/umfrage` lässt den Server abstimmen, welcher Sender als Nächstes läuft.", "`/poll` lets the server vote which station plays next."),
        t("Stimmt etwas nicht? **Problem melden** im Panel schickt es direkt ans OmniFM-Team.", "Something wrong? **Report a problem** in the panel sends it straight to the OmniFM team."),
        t("Im Now-Playing-Panel geht das alles auch per Knopf.", "The now-playing panel does all of this with buttons too."),
        t("Gefällt dir ein Song? **💾 Merken** im Panel schickt ihn dir per DM, `/merkliste` zeigt deine Liste.", "Like a song? **💾 Save** in the panel sends it to you by DM, `/saved` shows your list."),
      ],
      actions: [row(button(PLAY_COMPONENT_ID_OPEN, t("Jetzt abspielen", "Play now"), ButtonStyle.Primary))],
    },
    stations: {
      body: [
        t("`/stations` öffnet den Sender-Browser mit Genres, Suche und Abspielen-Knopf.", "`/stations` opens the station browser with genres, search and a play button."),
        t("`/history` zeigt die letzten Songs, `/stats` die Hörstatistik deines Servers.", "`/history` shows the last songs, `/stats` your server's listening stats."),
        t("`/jahresrueckblick` zeigt euer Jahr: Stunden, Sender, Songs und Uhrzeiten.", "`/year-review` shows your year: hours, stations, songs and times."),
        t("Eigene Sender (Ultimate): `/addstation`, `/mystations`, `/removestation`.", "Your own stations (Ultimate): `/addstation`, `/mystations`, `/removestation`."),
        t("Ein Sender fehlt im Katalog? Schlag ihn mit `/sender-vorschlagen` vor; du bekommst per DM Bescheid.", "A station missing from the catalogue? Suggest it with `/suggest-station`; you hear back by DM."),
      ],
      actions: [row(button(STATIONS_COMPONENT_ID_OPEN, t("Sender-Browser öffnen", "Open the station browser"), ButtonStyle.Primary))],
    },
    events: {
      body: [
        t("Mit `/event create` spielt OmniFM zu einer festen Zeit einen Sender, auf Wunsch wiederholt und als Server-Event.", "With `/event create` OmniFM plays a station at a set time, repeating if you like and as a server event."),
        t("`/event list` zeigt alle, `/event edit` und `/event delete` ändern sie.", "`/event list` shows them all, `/event edit` and `/event delete` change them."),
        t("-# Zeit z. B. `20:00`, `morgen 18:30` oder `24.12.2026 20:00`.", "-# Time e.g. `20:00`, `tomorrow 18:30` or `2026-12-24 20:00`."),
      ],
      actions: urls.dashboard ? [row(link(urls.dashboard, t("Events im Dashboard", "Events in the dashboard")))] : [],
    },
    settings: {
      body: [
        t("`/setup` führt Schritt für Schritt durch die Einrichtung.", "`/setup` walks you through the setup."),
        t("`/invite` holt weitere Worker auf den Server, `/workers` zeigt, welcher gerade spielt.", "`/invite` brings more workers to the server, `/workers` shows which one plays."),
        t("`/perm` legt fest, welche Rollen welche Befehle dürfen; `/language` stellt Deutsch oder Englisch ein.", "`/perm` sets which roles may use which commands; `/language` switches between German and English."),
        t("`/meine-daten` zeigt, was OmniFM über dich speichert; dort holst du es als Datei oder löschst alles.", "`/mydata` shows what OmniFM keeps about you; there you get it as a file or delete everything."),
      ],
      actions: [row(button(INVITE_COMPONENT_ID_OPEN, t("Worker einladen", "Invite workers"), ButtonStyle.Primary), button(WORKERS_COMPONENT_ID_OPEN, t("Worker ansehen", "See workers")))],
    },
    premium: {
      body: [
        // #413: the same lines as the website, from src/config/plan-features.js.
        planSummaryLine("pro", language, planContext),
        planSummaryLine("ultimate", language, planContext),
        t("`/premium` zeigt deinen Plan, `/license` verwaltet die Lizenz.", "`/premium` shows your plan, `/license` manages the license."),
      ],
      actions: urls.premium ? [row(link(urls.premium, t("Premium ansehen", "See Premium")))] : [],
    },
    troubleshooting: {
      body: [
        t("**Kein Ton?** Rechtsklick auf OmniFM im Sprachkanal → Server-Stummschaltung aufheben.", "**No sound?** Right-click OmniFM in the voice channel → remove the server mute."),
        t("**Bot kommt nicht in den Kanal?** OmniFM braucht dort *Verbinden* und *Sprechen*.", "**Bot does not join?** OmniFM needs *Connect* and *Speak* there."),
        t("**Sender still?** Wähle einen anderen; OmniFM wechselt bei Ausfällen auch selbst zum Ersatzsender.", "**Station silent?** Pick another; OmniFM also switches to a backup station on its own."),
        t("`/status` zeigt, was gerade los ist, `/diag` die Technik dahinter.", "`/status` shows what is going on, `/diag` the technical details."),
        t("Mit `/problem`, `/idee` und `/feedback` schreibst du direkt dem OmniFM-Team.", "With `/report`, `/idea` and `/feedback` you write straight to the OmniFM team."),
      ],
      actions: [row(button(STATIONS_COMPONENT_ID_OPEN, t("Anderen Sender wählen", "Pick another station")), urls.support ? link(urls.support, "Support") : null)],
    },
  };

  const select = new StringSelectMenuBuilder()
    .setCustomId(HELP_SECTION_SELECT_ID)
    .setPlaceholder(t("Thema wählen", "Choose a topic"))
    .addOptions(HELP_SECTIONS.map((key) => ({
      label: labels[key][0],
      value: key,
      default: key === section,
      emoji: ui.componentEmoji(labels[key][1], appId),
    })));

  const links = row(
    urls.dashboard ? link(urls.dashboard, "Dashboard") : null,
    urls.guide ? link(urls.guide, t("Anleitung", "Guide")) : null,
    urls.website ? link(urls.website, "Website") : null,
    urls.support ? link(urls.support, "Support") : null,
  );
  const page = pages[section];
  return ui.reply(ui.panel({
    title: `${ui.icon(labels[section][1], appId)} ${section === "overview" ? t("OmniFM-Hilfe", "OmniFM help") : labels[section][0]}`,
    subtitle: input.guildName ? ui.subtext(input.guildName) : "",
    body: [ui.text(page.body.join("\n"))],
    actions: [row(select), ...page.actions, links.components.length ? links : null],
    footer: "/help",
  }));
}
