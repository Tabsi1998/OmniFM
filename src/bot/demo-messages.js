// ============================================================
// OmniFM: what the website's live demos show from the bot (#431)
// ============================================================
// The demos on the start page show the bot's real messages, built by the
// bot's own code with example data: the "Now Playing" panel (like the
// dashboard's panel designer, #281), the answer to /invite and the
// descriptions Discord shows for /play and /invite in every language.
// scripts/build-demo-messages.mjs writes them to
// frontend/src/components/demo/demoMessages.json; a test fails when the
// file and the bot drift apart.
import { buildCommandsJson } from "../commands.js";
import { versionTag } from "./brand-embed.js";
import { buildPanelPreview } from "./now-playing/panel-preview.js";
import { menuMethods } from "./runtime-methods/menus.js";

/** The bot answers in German or English; German visitors see German, everybody else English. */
export const DEMO_BOT_LANGUAGES = ["de", "en"];
// The website's languages and Discord's names for them.
const DISCORD_LOCALES = { de: "de", en: null, fr: "fr", es: "es-ES", it: "it", pl: "pl", tr: "tr", pt: "pt-BR", nl: "nl" };

const FAVORITES = [
  { key: "lofi", name: "Lofi Café", color: "#A78BFA" },
  { key: "lounge", name: "Lounge", color: "#F59E0B" },
  { key: "charts", name: "Charts", color: "#F43F5E" },
];

const LOFI = {
  station: { name: "Lofi Café", key: "lofi", genre: "Lofi", tier: "free", color: 0xa78bfa, logoUrl: null },
  track: { hasTrack: true, headline: "Rainy Window", artist: "Mellow Hours", album: "Late Study", artworkUrl: "https://omnifm.xyz/demo/cover-lofi.svg" },
  searchQuery: "Mellow Hours Rainy Window",
  recent: ["Kairo – Blue Hour", "Aurora – Soft Light", "Mellow – Late Night"],
};

/** The moments of the panel: after /play lofi, paused, and after a click on a favourite. */
export const DEMO_PANEL_SAMPLES = {
  lofi: LOFI,
  paused: { ...LOFI, playback: { phase: "paused", paused: true } },
  lounge: {
    station: { name: "Lounge", key: "lounge", genre: "Chillout", tier: "free", color: 0xf59e0b, logoUrl: null },
    track: { hasTrack: true, headline: "Sunset Drive", artist: "Nightwave", album: "Coastline", artworkUrl: "https://omnifm.xyz/demo/cover-lounge.svg" },
    searchQuery: "Nightwave Sunset Drive",
    recent: ["Rainy Window – Mellow Hours", "Kairo – Blue Hour", "Aurora – Soft Light"],
  },
};

const toJson = (part) => (typeof part?.toJSON === "function" ? part.toJSON() : part);

// The footer names the running version and commit ("OmniFM · v3.12.0 · 6773a6f"); the demo shows
// neither, so the website's copy stays the same from build to build and never shows an old version.
function withoutVersion(payload) {
  const tag = versionTag();
  return tag ? JSON.parse(JSON.stringify(payload).split(`OmniFM · ${tag}`).join("OmniFM")) : payload;
}

/** The answer to /invite on a new Free server with two workers, built by the bot's own menu code. */
async function inviteAnswer(language) {
  const t = (de, en) => (language === "de" ? de : en);
  const workers = [1, 2].map((slot) => ({
    slot, botIndex: null, name: `OmniFM ${slot}`, requiredTier: "free", tierLocked: false, online: true,
    inviteUrl: `https://discord.com/oauth2/authorize?client_id=10000000000000000${slot}`, alreadyInvited: false, selectable: true,
  }));
  const runtime = {
    ...menuMethods,
    client: { guilds: { cache: new Map() } },
    createInteractionTranslator: () => ({ t, language }),
    collectInviteWorkerState: async () => ({
      guildTier: "free", maxIndex: 2, workers, selectableWorkers: workers, invitedWorkers: [], lockedWorkers: [],
    }),
  };
  const payload = await menuMethods.buildInviteMenuPayload.call(runtime, { guild: { id: "123456789012345678", name: "OmniFM Demo" } });
  return { embeds: payload.embeds.map(toJson), components: payload.components.map(toJson) };
}

/** What Discord shows for /play (and its option) and /invite, in the website's nine languages. */
function commandTexts() {
  const commands = buildCommandsJson();
  const play = commands.find((command) => command.name === "play");
  const station = play.options.find((option) => option.name === "station");
  const invite = commands.find((command) => command.name === "invite");
  const pick = (entry, locale) => (locale && entry.description_localizations?.[locale]) || entry.description;
  return Object.fromEntries(Object.entries(DISCORD_LOCALES).map(([language, locale]) => [language, {
    play: pick(play, locale),
    station: pick(station, locale),
    invite: pick(invite, locale),
  }]));
}

/** Everything the demos need: { panels: { de, en }, invite: { de, en }, commands: { de, en, fr, … } }. */
export async function buildDemoMessages() {
  const panels = {};
  const invite = {};
  for (const language of DEMO_BOT_LANGUAGES) {
    panels[language] = Object.fromEntries(Object.entries(DEMO_PANEL_SAMPLES).map(([moment, sample]) => [
      moment,
      withoutVersion(buildPanelPreview({ language, sample, favorites: FAVORITES, workerName: "OmniFM 1", planTier: "free" })),
    ]));
    // eslint-disable-next-line no-await-in-loop -- two languages, one after the other
    invite[language] = withoutVersion(await inviteAnswer(language));
  }
  return { panels, invite, commands: commandTexts() };
}
