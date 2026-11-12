// ============================================================
// OmniFM: the song fields of a now-playing update (#548)
// ============================================================
// One place for the poll and the start path: each field cleaned by the
// runtime (no station name, no "unknown"), an ad break's spot dropped as a
// whole, and the display title made from artist and title when the stream
// sends none.
import { withoutAdvertTrack } from "../../lib/advert-titles.js";

/**
 * @param {{ normalizeNowPlayingValue: (value: any, station: any, meta: any, maxLength: number) => string | null }} runtime
 * @param {any} station
 * @param {{ artist?: any, title?: any, streamTitle?: any, displayTitle?: any }} meta
 * @returns {{ artist: string | null, title: string | null, streamTitle: string | null, displayTitle: string | null }}
 */
export function nowPlayingTrackFields(runtime, station, meta) {
  const { artist, title, streamTitle, displayTitle } = withoutAdvertTrack({
    artist: runtime.normalizeNowPlayingValue(meta?.artist, station, meta, 120),
    title: runtime.normalizeNowPlayingValue(meta?.title, station, meta, 120),
    streamTitle: runtime.normalizeNowPlayingValue(meta?.streamTitle, station, meta, 180),
    displayTitle: runtime.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180),
  });
  return {
    artist,
    title,
    streamTitle,
    displayTitle: displayTitle || ([artist, title].filter(Boolean).join(" - ") || null),
  };
}
