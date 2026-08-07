// ============================================================
// OmniFM: Now-Playing / ICY Metadata / Album Cover
// ============================================================
import {
  clipText,
  concatUint8Arrays,
  NOW_PLAYING_COVER_ENABLED,
  NOW_PLAYING_COVER_TIMEOUT_MS,
  NOW_PLAYING_COVER_CACHE_TTL_MS,
  NOW_PLAYING_FETCH_TIMEOUT_MS,
  NOW_PLAYING_MAX_METAINT_BYTES,
} from "../lib/helpers.js";
import { safeFetch } from "../lib/safe-outbound-http.js";
import { recognizeTrackFromStream } from "./audio-recognition.js";

const nowPlayingCoverCache = new Map();
const nowPlayingCoverInFlight = new Map();
let globalNowPlayingQueue = null; // Will be set by runtime.js
const BLOCKED_TRACK_VALUES = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
const TRACK_PREFIX_PATTERNS = [
  /^now playing\s*[:|\-]+\s*/i,
  /^currently playing\s*[:|\-]+\s*/i,
  /^playing now\s*[:|\-]+\s*/i,
  /^on air\s*[:|\-]+\s*/i,
  /^playing\s*[:|\-]+\s*/i,
  /^np\s*[:|\-]+\s*/i,
];
const METADATA_TRACK_FIELDS = ["streamtitle", "title", "song", "track", "trackname"];
const METADATA_ARTIST_FIELDS = ["artist", "streamartist", "creator"];
const METADATA_TITLE_FIELDS = ["title", "song", "track", "trackname", "streamtitle"];
const METADATA_ALBUM_FIELDS = ["album", "streamalbum", "songalbum", "release"];
const SEARCH_NOISE_PATTERNS = [
  /\((?:played by|mix(?:ed)? by|live (?:at|from)|freedom tml|radio edit|clean edit|explicit edit).*?\)/gi,
  /\[(?:played by|mix(?:ed)? by|live (?:at|from)|radio edit|clean edit|explicit edit).*?\]/gi,
  /\s+-\s+played by .*$/gi,
];

function setNowPlayingQueue(queue) {
  globalNowPlayingQueue = queue;
}

function extractIcyField(metadataText, fieldName) {
  const escapedFieldName = String(fieldName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedFieldName) return null;
  const match = String(metadataText || "").match(new RegExp(`${escapedFieldName}\\s*=\\s*'([^']*)'`, "i"));
  return match?.[1] || null;
}

function normalizeTrackText(raw) {
  let text = String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/[\u2010-\u2015]+/g, " - ")
    .replace(/\u00e2\u0080[\u0090-\u0095]/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  for (const pattern of TRACK_PREFIX_PATTERNS) {
    text = text.replace(pattern, "").trim();
  }

  text = text.replace(/^[-:|~\/\s]+/, "").replace(/[-:|~\/\s]+$/, "").trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (BLOCKED_TRACK_VALUES.has(lower)) return null;
  return text;
}

function parseTrackFromStreamTitle(rawTitle) {
  const cleaned = normalizeTrackText(rawTitle);
  if (!cleaned) {
    return { raw: null, artist: null, title: null, displayTitle: null };
  }

  const separators = [" - ", " – ", " — ", " | ", " ~ ", " / ", " :: ", ": "];
  for (const separator of separators) {
    const index = cleaned.indexOf(separator);
    if (index <= 0 || index >= cleaned.length - separator.length) continue;
    const left = normalizeTrackText(cleaned.slice(0, index));
    const right = normalizeTrackText(cleaned.slice(index + separator.length));
    if (!left || !right) continue;
    return {
      raw: cleaned,
      artist: left,
      title: right,
      displayTitle: `${left} - ${right}`,
    };
  }

  return {
    raw: cleaned,
    artist: null,
    title: cleaned,
    displayTitle: cleaned,
  };
}

function normalizeTrackSearchText(raw) {
  let text = normalizeTrackText(raw);
  if (!text) return null;

  for (const pattern of SEARCH_NOISE_PATTERNS) {
    text = text.replace(pattern, " ").trim();
  }

  text = text.replace(/\s{2,}/g, " ").trim();
  return text ? clipText(text, 160) : null;
}

function extractMetadataEntries(metadataText) {
  const entries = new Map();
  const regex = /([A-Za-z0-9_-]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^;]*))/g;
  const text = String(metadataText || "");
  let match;
  while ((match = regex.exec(text)) !== null) {
    const key = String(match[1] || "").trim().toLowerCase();
    const value = String(match[2] || match[3] || match[4] || "").trim();
    if (!key || !value || entries.has(key)) continue;
    entries.set(key, value);
  }
  return entries;
}

function pickMetadataValue(entries, fieldNames = []) {
  for (const fieldName of fieldNames) {
    const rawValue = entries.get(String(fieldName || "").trim().toLowerCase());
    const normalized = normalizeTrackText(rawValue);
    if (normalized) return normalized;
  }
  return null;
}

function extractTrackFromMetadataText(metadataText) {
  const entries = extractMetadataEntries(metadataText);
  const streamTitleRaw = pickMetadataValue(entries, METADATA_TRACK_FIELDS);
  const parsedStreamTitle = parseTrackFromStreamTitle(streamTitleRaw);
  const artist = parsedStreamTitle.artist || pickMetadataValue(entries, METADATA_ARTIST_FIELDS);
  const title = parsedStreamTitle.title || pickMetadataValue(entries, METADATA_TITLE_FIELDS);
  const album = pickMetadataValue(entries, METADATA_ALBUM_FIELDS);
  const combinedDisplayTitle = normalizeTrackText([artist, title].filter(Boolean).join(" - "));
  const displayTitle = (artist && title && !parsedStreamTitle.artist)
    ? combinedDisplayTitle
    : parsedStreamTitle.displayTitle
    || combinedDisplayTitle
    || title
    || artist
    || null;

  return {
    raw: parsedStreamTitle.raw || streamTitleRaw || displayTitle || null,
    artist: artist || null,
    title: title || null,
    album: album || null,
    displayTitle: displayTitle || null,
  };
}

function hasUsableStreamTrack(track) {
  return Boolean(
    normalizeTrackText(track?.displayTitle || "")
    || normalizeTrackText(track?.artist || "")
    || normalizeTrackText(track?.title || "")
    || normalizeTrackText(track?.raw || "")
  );
}

function shouldAttemptRecognition(track) {
  return !hasUsableStreamTrack(track);
}

async function fetchCoverArtFromItunes(query) {
  try {
    const endpoint = new URL("https://itunes.apple.com/search");
    endpoint.searchParams.set("term", query);
    endpoint.searchParams.set("media", "music");
    endpoint.searchParams.set("entity", "song");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0" },
      signal: AbortSignal.timeout(Math.min(NOW_PLAYING_COVER_TIMEOUT_MS, 2000)),
    });
    
    if (!response.ok) return null;
    
    const payload = await response.json().catch(() => null);
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    let artworkUrl = result?.artworkUrl100 || result?.artworkUrl60 || null;
    
    if (artworkUrl) {
      artworkUrl = artworkUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");
    }
    
    return artworkUrl || null;
  } catch {
    return null;
  }
}

async function fetchCoverArtFromMusicBrainz(artist, title) {
  try {
    const query = `artist:"${artist}" recording:"${title}"`;
    const endpoint = new URL("https://musicbrainz.org/ws/2/recording");
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("fmt", "json");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0 (+omnifm.radio)" },
      signal: AbortSignal.timeout(2500),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json().catch(() => null);
    if (!data?.recordings || !Array.isArray(data.recordings) || data.recordings.length === 0) {
      return null;
    }

    const recording = data.recordings[0];
    const releases = recording.releases || [];

    for (const release of releases) {
      const releaseId = String(release?.id || "").trim();
      if (!releaseId) continue;

      const hasFrontCover = release?.["cover-art-archive"]?.front === true;
      const candidateUrls = [
        `https://coverartarchive.org/release/${releaseId}/front-500`,
        `https://coverartarchive.org/release/${releaseId}/front`,
      ];

      if (hasFrontCover) {
        return candidateUrls[0];
      }

      for (const candidateUrl of candidateUrls) {
        const headResponse = await fetch(candidateUrl, {
          method: "HEAD",
          headers: { "User-Agent": "OmniFM/3.0 (+omnifm.radio)" },
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);
        if (headResponse?.ok) {
          return candidateUrl;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchCoverArtFromDiscogs(artist, title) {
  try {
    // Discogs API - Release Search
    const query = `${artist} ${title}`;
    const endpoint = new URL("https://api.discogs.com/database/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("type", "release");
    endpoint.searchParams.set("per_page", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0 (+omnifm.radio)" },
      signal: AbortSignal.timeout(2500),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json().catch(() => null);
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    
    // Discogs gibt cover_image direkt zurück
    const release = data.results[0];
    if (release?.cover_image && release.cover_image.trim() !== "") {
      return release.cover_image;
    }
    
    return null;
  } catch {
    return null;
  }
}

async function fetchCoverArtForTrack(artist, title) {
  if (!NOW_PLAYING_COVER_ENABLED) return null;

  const artistPart = normalizeTrackSearchText(artist);
  const titlePart = normalizeTrackSearchText(title);
  const queries = [
    clipText([artistPart, titlePart].filter(Boolean).join(" "), 180),
    clipText(titlePart || "", 180),
  ].filter((value, index, items) => value && value.length >= 3 && items.indexOf(value) === index);
  if (!queries.length) return null;

  const cacheKey = queries[0].toLowerCase();
  const now = Date.now();

  // Check shared queue cache first (accessed by multiple guilds)
  if (globalNowPlayingQueue) {
    const cached = globalNowPlayingQueue.getCachedCover(cacheKey);
    if (cached) return cached;
  }

  // Check local cache
  const cached = nowPlayingCoverCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.url || null;

  if (nowPlayingCoverInFlight.has(cacheKey)) {
    return nowPlayingCoverInFlight.get(cacheKey);
  }

  const request = (async () => {
    let artworkUrl = null;
    
    try {
      // Versuch 1: iTunes (schnell & populär)
      for (const query of queries) {
        artworkUrl = await fetchCoverArtFromItunes(query);
        if (!artworkUrl) continue;
        nowPlayingCoverCache.set(cacheKey, {
          url: artworkUrl,
          expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
        });
        if (globalNowPlayingQueue) {
          globalNowPlayingQueue.setCachedCover(cacheKey, artworkUrl, NOW_PLAYING_COVER_CACHE_TTL_MS);
        }
        return artworkUrl;
      }
      
      // Versuch 2: MusicBrainz (zuverlässig für klassische Musik & Professionelle Labels)
      if (artistPart && titlePart) {
        artworkUrl = await fetchCoverArtFromMusicBrainz(artistPart, titlePart);
        if (artworkUrl) {
          nowPlayingCoverCache.set(cacheKey, {
            url: artworkUrl,
            expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
          });
          if (globalNowPlayingQueue) {
            globalNowPlayingQueue.setCachedCover(cacheKey, artworkUrl, NOW_PLAYING_COVER_CACHE_TTL_MS);
          }
          return artworkUrl;
        }
      }
      
      // Versuch 3: Discogs (Elektronik, Indie, Alternative)
      if (artistPart && titlePart) {
        artworkUrl = await fetchCoverArtFromDiscogs(artistPart, titlePart);
        if (artworkUrl) {
          nowPlayingCoverCache.set(cacheKey, {
            url: artworkUrl,
            expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
          });
          if (globalNowPlayingQueue) {
            globalNowPlayingQueue.setCachedCover(cacheKey, artworkUrl, NOW_PLAYING_COVER_CACHE_TTL_MS);
          }
          return artworkUrl;
        }
      }
    } catch {
      // ignore all errors
    }

    // Kein Cover gefunden
    nowPlayingCoverCache.set(cacheKey, {
      url: null,
      expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
    });
    if (globalNowPlayingQueue) {
      globalNowPlayingQueue.setCachedCover(cacheKey, null, NOW_PLAYING_COVER_CACHE_TTL_MS);
    }
    return null;
  })().finally(() => {
    nowPlayingCoverInFlight.delete(cacheKey);
  });

  nowPlayingCoverInFlight.set(cacheKey, request);
  return request;
}

async function fetchStreamSnapshot(url, { includeCover = false, allowRecognition = true } = {}) {
  const empty = {
    name: null,
    description: null,
    streamTitle: null,
    artist: null,
    title: null,
    displayTitle: null,
    album: null,
    artworkUrl: null,
    metadataSource: null,
    metadataStatus: "unavailable",
    recognitionProvider: null,
    recognitionConfidence: null,
    musicBrainzRecordingId: null,
    musicBrainzReleaseId: null,
  };

  let res = null;
  let reader = null;

  try {
    res = await safeFetch(url, {
      method: "GET",
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "OmniFM/3.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(NOW_PLAYING_FETCH_TIMEOUT_MS),
      timeoutMs: NOW_PLAYING_FETCH_TIMEOUT_MS,
    });

    const snapshot = {
      ...empty,
      name: normalizeTrackText(res.headers.get("icy-name")),
      description: normalizeTrackText(res.headers.get("icy-description")),
    };

    const metaint = Number.parseInt(String(res.headers.get("icy-metaint") || "").trim(), 10);
    if (!res.body || !Number.isFinite(metaint) || metaint <= 0 || metaint > NOW_PLAYING_MAX_METAINT_BYTES) {
      snapshot.metadataSource = "stream";
      snapshot.metadataStatus = "unsupported";
      return snapshot;
    }

    reader = res.body.getReader();
    let buffer = new Uint8Array(0);

    const readAtLeast = async (requiredBytes) => {
      while (buffer.length < requiredBytes) {
        const { done, value } = await reader.read();
        if (done) return false;
        if (value?.length) {
          buffer = concatUint8Arrays(buffer, value);
        }
      }
      return true;
    };

    let track = null;
    for (let metadataBlock = 0; metadataBlock < 4; metadataBlock += 1) {
      if (!(await readAtLeast(metaint + 1))) {
        break;
      }

      buffer = buffer.slice(metaint);
      const metadataLength = (buffer[0] || 0) * 16;
      buffer = buffer.slice(1);
      if (metadataLength <= 0) {
        continue;
      }

      if (!(await readAtLeast(metadataLength))) {
        break;
      }

      const metadataChunk = buffer.slice(0, metadataLength);
      buffer = buffer.slice(metadataLength);
      const metadataText = new TextDecoder("utf-8")
        .decode(metadataChunk)
        .replace(/\u0000+/g, "")
        .trim();
      const extractedTrack = extractTrackFromMetadataText(metadataText);
      if (extractedTrack.displayTitle || extractedTrack.artist || extractedTrack.title) {
        track = extractedTrack;
        break;
      }
    }

    let recognizedTrack = null;
    const hadStreamTrack = hasUsableStreamTrack(track);
    if (allowRecognition && shouldAttemptRecognition(track)) {
      recognizedTrack = await recognizeTrackFromStream(url, { existingTrack: track });
    }

    if (recognizedTrack?.displayTitle || recognizedTrack?.artist || recognizedTrack?.title) {
      track = {
        raw: recognizedTrack.raw || track?.raw || recognizedTrack.displayTitle || null,
        artist: recognizedTrack.artist || track?.artist || null,
        title: recognizedTrack.title || track?.title || null,
        album: recognizedTrack.album || track?.album || null,
        displayTitle: recognizedTrack.displayTitle || track?.displayTitle || recognizedTrack.raw || null,
      };
      snapshot.album = recognizedTrack.album || recognizedTrack.releaseTitle || track?.album || null;
      snapshot.artworkUrl = recognizedTrack.artworkUrl || null;
      snapshot.recognitionProvider = recognizedTrack.recognitionProvider || null;
      snapshot.recognitionConfidence = recognizedTrack.recognitionConfidence || null;
      snapshot.musicBrainzRecordingId = recognizedTrack.musicBrainzRecordingId || null;
      snapshot.musicBrainzReleaseId = recognizedTrack.musicBrainzReleaseId || null;
      snapshot.metadataSource = hadStreamTrack ? "icy+recognition" : "recognition";
      snapshot.metadataStatus = "recognized";
    } else {
      snapshot.metadataSource = "icy";
      snapshot.metadataStatus = track ? "ok" : "empty";
    }

    snapshot.streamTitle = track?.raw || null;
    snapshot.artist = track?.artist || null;
    snapshot.title = track?.title || null;
    snapshot.album = snapshot.album || track?.album || null;
    snapshot.displayTitle = track?.displayTitle || null;

    if (!snapshot.artworkUrl && includeCover && (track?.displayTitle || track?.title)) {
      snapshot.artworkUrl = await fetchCoverArtForTrack(track?.artist, track?.title || track?.displayTitle);
    }

    return snapshot;
  } catch {
    return empty;
  } finally {
    try {
      if (reader) await reader.cancel();
    } catch {
      // ignore
    }
    try {
      await res?.body?.cancel?.();
    } catch {
      // ignore
    }
  }
}

async function fetchStreamInfo(url) {
  const snapshot = await fetchStreamSnapshot(url, { includeCover: false });
  return {
    name: snapshot.name,
    description: snapshot.description,
    streamTitle: snapshot.streamTitle,
    artist: snapshot.artist,
    title: snapshot.title,
    displayTitle: snapshot.displayTitle,
    album: snapshot.album,
    artworkUrl: null,
    metadataSource: snapshot.metadataSource,
    metadataStatus: snapshot.metadataStatus,
    recognitionProvider: snapshot.recognitionProvider,
    recognitionConfidence: snapshot.recognitionConfidence,
    musicBrainzRecordingId: snapshot.musicBrainzRecordingId,
    musicBrainzReleaseId: snapshot.musicBrainzReleaseId,
    updatedAt: new Date().toISOString(),
  };
}

export {
  extractIcyField,
  extractMetadataEntries,
  extractTrackFromMetadataText,
  hasUsableStreamTrack,
  normalizeTrackText,
  normalizeTrackSearchText,
  parseTrackFromStreamTitle,
  fetchCoverArtForTrack,
  fetchStreamSnapshot,
  fetchStreamInfo,
  nowPlayingCoverCache,
  setNowPlayingQueue,
};
