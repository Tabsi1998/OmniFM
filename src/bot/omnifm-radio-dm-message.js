// ============================================================
// OmniFM Radio (#594): the DM to server owners when a show starts
// ============================================================
// Short on purpose: who is live, the title, why the person gets it, a link
// to the public player and "Abbestellen". The buttons carry only the action
// and the language, no session, so they work after any restart. Names and
// titles come from AzuraCast: escaped, and nobody is ever mentioned.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } from "discord.js";

import * as ui from "../discord/ui/index.js";
import { botTranslator, normalizeBotLanguage } from "../lib/bot-i18n.js";
import { log } from "../lib/logging.js";
import { sharedOmnifmRadioDmStore } from "../omnifm-radio-dm-store.js";
import { buildNoticePayload } from "./commands/command-helpers.js";

export const RADIO_DM_PREFIX = "omnifm:radiodm:";
const CUSTOM_ID = /^omnifm:radiodm:(unsub|resub):([a-z]{2})$/;
const NO_PINGS = Object.freeze({ parse: [] });

const radioDmId = (action, language) => `${RADIO_DM_PREFIX}${action}:${normalizeBotLanguage(language, "en")}`;

/** { action: "unsub" | "resub", language } of a DM button, or null. */
export function parseRadioDmCustomId(customId) {
  const match = CUSTOM_ID.exec(String(customId || ""));
  return match ? { action: match[1], language: normalizeBotLanguage(match[2], "en") } : null;
}

/** AzuraCast's public player of the station. */
export function radioDmListenUrl(config) {
  return `${String(config?.baseUrl || "").replace(/\/+$/, "")}/public/${encodeURIComponent(String(config?.station || ""))}`;
}

/** One line, at most `max` characters, no formatting, no mention (an @ gets a zero-width space). */
function safe(value, max) {
  const line = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return escapeMarkdown(line).replace(/@/g, "@​");
}

function buttonRow(button) {
  return new ActionRowBuilder().addComponents(button);
}

function subscriptionButton(subscribed, t, language) {
  return new ButtonBuilder()
    .setCustomId(radioDmId(subscribed ? "unsub" : "resub", language))
    .setStyle(ButtonStyle.Secondary)
    .setLabel(subscribed ? t("Abbestellen", "Unsubscribe") : t("Wieder abonnieren", "Subscribe again"));
}

/**
 * @param {{ show: { streamerName?: string, title?: string, source?: string }, language: string, config: { baseUrl: string, station: string }, guildName?: string, applicationId?: string | null }} input
 */
export function buildRadioDmMessage({ show, language, config, guildName = "", applicationId = null }) {
  const lang = normalizeBotLanguage(language, "en");
  const t = botTranslator(lang);
  const dj = safe(show?.streamerName, 100);
  const title = safe(show?.title, 300);
  const server = safe(guildName, 100);
  const heading = dj
    ? t("{dj} ist live auf OmniFM Radio", "{dj} is live on OmniFM Radio", { dj })
    : t("OmniFM Radio ist jetzt live", "OmniFM Radio is live now");
  const why = server
    ? t(
      "Du bekommst das, weil dir „{server}“ gehört und OmniFM dort läuft. Höchstens eine Nachricht in 12 Stunden.",
      "You get this because you own “{server}”, where OmniFM runs. At most one message in 12 hours.",
      { server },
    )
    : t(
      "Du bekommst das, weil dir ein Server mit OmniFM gehört. Höchstens eine Nachricht in 12 Stunden.",
      "You get this because you own a server with OmniFM. At most one message in 12 hours.",
    );
  const notes = [why];
  if (show?.source === "test") {
    notes.unshift(t(
      "🧪 Test-Sendung: Diese Nachricht bekommen nur die Besitzer der Test-Server.",
      "🧪 Test show: only the owners of the test servers get this message.",
    ));
  }
  const listen = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(radioDmListenUrl(config))
    .setLabel(t("Jetzt hören", "Listen now"));
  return {
    ...ui.message(ui.panel({
      accent: ui.UI_COLORS.live,
      title: `${ui.icon("live", applicationId)} ${heading}`,
      subtitle: title,
      body: [ui.text(ui.subtext(notes.join("\n")))],
      actions: [new ActionRowBuilder().addComponents(listen, subscriptionButton(true, t, lang))],
    })),
    allowedMentions: NO_PINGS,
  };
}

function subscriptionChangedMessage({ subscribed, language, applicationId }) {
  const t = botTranslator(language);
  return {
    ...ui.message(ui.notice("success", {
      title: subscribed ? t("Wieder abonniert", "Subscribed again") : t("Abbestellt", "Unsubscribed"),
      body: subscribed
        ? t(
          "Wenn OmniFM Radio live geht, bekommst du wieder Bescheid, höchstens einmal in 12 Stunden.",
          "When OmniFM Radio goes live, you hear about it again, at most once in 12 hours.",
        )
        : t(
          "Du bekommst keine Nachricht mehr, wenn OmniFM Radio live geht. Das bleibt so, bis du wieder abonnierst.",
          "You will not get a message any more when OmniFM Radio goes live. That stays so until you subscribe again.",
        ),
      actions: [buttonRow(subscriptionButton(subscribed, t, language))],
      applicationId,
    })),
    allowedMentions: NO_PINGS,
  };
}

/**
 * "Abbestellen" and "Wieder abonnieren" in the DM: stored for the person
 * who clicks, then the DM itself shows the new state. Not stored: the DM
 * stays and only the person hears that it did not work.
 * @returns {Promise<boolean>} false when the button is not one of the DM's
 */
export async function handleRadioDmComponent(interaction, { store = sharedOmnifmRadioDmStore(), now = Date.now } = {}) {
  const parsed = parseRadioDmCustomId(interaction?.customId);
  if (!parsed || !interaction.isButton?.()) return false;
  const { language } = parsed;
  const subscribed = parsed.action === "resub";
  try {
    await store.setSubscribed(interaction.user?.id, subscribed, { now: now() });
  } catch (error) {
    log("WARN", `[OmniFM Radio] DM-${subscribed ? "Abo" : "Abmeldung"} nicht gespeichert: ${error?.message || error}`);
    await interaction.reply(buildNoticePayload({ t: botTranslator(language), language, code: "failed" }));
    return true;
  }
  await interaction.update(subscriptionChangedMessage({ subscribed, language, applicationId: interaction.applicationId || null }));
  return true;
}
