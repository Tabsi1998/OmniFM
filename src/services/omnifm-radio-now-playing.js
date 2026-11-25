// ============================================================
// OmniFM Radio (#591): now playing of the own station.
// Title and artist come from the AzuraCast API; when it does not answer
// (or has no song), the stream's ICY metadata like every other station.
// ============================================================
import { fetchCoverArtForTrack, fetchStreamSnapshot } from "./now-playing.js";
import { fetchOmnifmRadioNowPlaying } from "./omnifm-radio-api.js";
import { isOmnifmRadioKey } from "./omnifm-radio-station.js";

/** The now-playing snapshot of a station; same shape as fetchStreamSnapshot. */
export async function fetchStationSnapshot(stationKey, url, options = {}) {
  if (!isOmnifmRadioKey(stationKey)) return fetchStreamSnapshot(url, options);
  const api = await fetchOmnifmRadioNowPlaying();
  const displayTitle = api.ok ? (api.songText || [api.artist, api.title].filter(Boolean).join(" - ")) : "";
  if (!displayTitle) return fetchStreamSnapshot(url, options);
  const artist = api.artist || null;
  const title = api.title || null;
  return {
    name: null,
    description: null,
    streamTitle: displayTitle,
    artist,
    title,
    displayTitle,
    album: null,
    artworkUrl: options.includeCover ? await fetchCoverArtForTrack(artist, title || displayTitle) : null,
    metadataSource: "azuracast",
    metadataStatus: "ok",
    recognitionProvider: null,
    recognitionConfidence: null,
    musicBrainzRecordingId: null,
    musicBrainzReleaseId: null,
  };
}
