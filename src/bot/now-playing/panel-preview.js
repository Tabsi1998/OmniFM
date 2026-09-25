// ============================================================
// OmniFM: the dashboard's panel preview (#281)
// ============================================================
// The preview is the real panel: buildNowPlayingPanel with example data and
// the design being edited, sent as Discord's JSON. The dashboard only draws
// that JSON, so preview and panel can never drift apart.
import { buildNowPlayingPanel } from "./now-playing-panel.js";

const SAMPLE_FAVORITES = [
  { key: "lounge", name: "Lounge", color: "#8B5CF6" },
  { key: "charts", name: "Charts", color: "#F59E0B" },
];

/** The input the preview hands the panel: a song playing, three listeners, a few earlier songs. */
export function buildPanelPreviewInput({ design, language = "de", applicationId = null, planTier = "pro", favorites = null, workerName = "OmniFM" } = {}) {
  const t = (de, en) => (language === "de" ? de : en);
  return {
    t,
    applicationId,
    workerName,
    planTier,
    station: { name: "OmniFM Lounge", key: "lounge", genre: "Chillout", tier: "free", color: 0x8b5cf6, logoUrl: null },
    track: {
      hasTrack: true,
      headline: "Sunset Drive",
      artist: "Nightwave",
      album: "Coastline",
      artworkUrl: null,
      sourceNote: null,
      sourceLabel: t("Titel vom Sender", "Title from the station"),
      metadataHint: null,
    },
    playback: { phase: "playing", paused: false, listeners: 3, bitrate: "128k", volume: 80, channelId: null, sleepUntilMs: 0 },
    notices: {},
    recent: ["Aurora – Northern Lights", "Mellow – Late Night", "Kairo – Blue Hour"],
    favorites: Array.isArray(favorites) && favorites.length ? favorites.slice(0, 5) : SAMPLE_FAVORITES,
    shareEnabled: true,
    searchQuery: "Nightwave Sunset Drive",
    musicBrainzUrl: null,
    fallbackImageUrl: null,
    pollSeconds: null,
    design,
  };
}

/** Discord's JSON of the example panel: { components, flags }. */
export function buildPanelPreview(options = {}) {
  const payload = buildNowPlayingPanel(buildPanelPreviewInput(options));
  return {
    flags: payload.flags,
    components: payload.components.map((component) => (typeof component.toJSON === "function" ? component.toJSON() : component)),
  };
}
