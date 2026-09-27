// OmniFM: listening stats: listener samples, segments and timeline buckets, pure math.
// Split out of src/listening-stats-store.js (#295).
import { todayDateString } from "../listening-stats-store.js";
import { normalizeCount, normalizeDateOnly, normalizeTimestamp } from "./normalize.js";

export function buildConnectionTimelineBuckets(rows = [], days = 7, nowMs = Date.now()) {
  const safeDays = Math.max(1, Math.min(90, Number.parseInt(String(days || 7), 10) || 7));
  const buckets = [];
  const bucketMap = new Map();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = todayDateString(nowMs - (offset * 86400_000));
    const bucket = {
      date,
      connects: 0,
      reconnects: 0,
      retries: 0,
      disconnects: 0,
      errors: 0,
    };
    buckets.push(bucket);
    bucketMap.set(date, bucket);
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const timestampMs = Date.parse(row?.timestamp);
    const derivedDate = Number.isFinite(timestampMs) ? todayDateString(timestampMs) : "";
    const date = normalizeDateOnly(row?.date) || normalizeDateOnly(derivedDate);
    const bucket = date ? bucketMap.get(date) : null;
    if (!bucket) continue;
    const count = normalizeCount(row?.count ?? 1);
    if (row?.eventType === "connect") bucket.connects += count;
    else if (row?.eventType === "reconnect") bucket.reconnects += count;
    else if (row?.eventType === "retry") bucket.retries += count;
    else if (row?.eventType === "disconnect") bucket.disconnects += count;
    else if (row?.eventType === "error") bucket.errors += count;
  }

  return buckets;
}

export function buildConnectionTimelineBucketsFromEvents(events = [], days = 7, nowMs = Date.now()) {
  return buildConnectionTimelineBuckets(
    (Array.isArray(events) ? events : []).map((event) => ({
      date: todayDateString(Date.parse(event?.timestamp)),
      eventType: String(event?.eventType || ""),
      count: 1,
    })),
    days,
    nowMs
  );
}

export const SESSION_SAMPLE_MIN_INTERVAL_MS = 30_000;
export const MAX_SESSION_SAMPLES = 4_320;

function normalizeSampleEntries(samples, startedAtMs, endedAtMs) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  const entries = [];

  for (const sample of Array.isArray(samples) ? samples : []) {
    const timestamp = Math.min(endMs, Math.max(startMs, normalizeTimestamp(sample?.t) || startMs));
    const listeners = normalizeCount(sample?.n);
    const previous = entries[entries.length - 1];
    if (previous && previous.t === timestamp) {
      previous.n = listeners;
    } else {
      entries.push({ t: timestamp, n: listeners });
    }
  }

  entries.sort((a, b) => a.t - b.t);

  const collapsed = [];
  for (const entry of entries) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.t === entry.t) {
      previous.n = entry.n;
    } else {
      collapsed.push(entry);
    }
  }

  if (!collapsed.length) {
    return [{ t: startMs, n: 0 }];
  }

  if (collapsed[0].t > startMs) {
    collapsed.unshift({ t: startMs, n: collapsed[0].n });
  } else if (collapsed[0].t < startMs) {
    collapsed[0] = { ...collapsed[0], t: startMs };
  }

  return collapsed;
}

export function buildSessionListenerSegments({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  if (endMs <= startMs) return [];

  const normalizedSamples = normalizeSampleEntries(samples, startMs, endMs);
  const segments = [];

  for (let index = 0; index < normalizedSamples.length; index += 1) {
    const current = normalizedSamples[index];
    const next = normalizedSamples[index + 1];
    const segmentStartMs = Math.min(endMs, Math.max(startMs, current.t));
    const segmentEndMs = next
      ? Math.min(endMs, Math.max(segmentStartMs, next.t))
      : endMs;
    if (segmentEndMs <= segmentStartMs) continue;

    segments.push({
      startAtMs: segmentStartMs,
      endAtMs: segmentEndMs,
      durationMs: segmentEndMs - segmentStartMs,
      listeners: normalizeCount(current.n),
    });
  }

  return segments;
}

export function summarizeSessionListeners({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  const segments = buildSessionListenerSegments({ samples, startedAtMs: startMs, endedAtMs: endMs });
  const durationMs = Math.max(0, endMs - startMs);

  let humanListeningMs = 0;
  let weightedListenerMs = 0;
  let peakListeners = 0;

  for (const segment of segments) {
    peakListeners = Math.max(peakListeners, normalizeCount(segment.listeners));
    weightedListenerMs += segment.durationMs * normalizeCount(segment.listeners);
    if (segment.listeners > 0) {
      humanListeningMs += segment.durationMs;
    }
  }

  return {
    durationMs,
    peakListeners,
    humanListeningMs: Math.min(humanListeningMs, durationMs),
    avgListeners: durationMs > 0 ? Math.round(weightedListenerMs / durationMs) : 0,
    segments,
  };
}

export function buildDailyListeningBreakdown({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const summary = summarizeSessionListeners({ samples, startedAtMs, endedAtMs });
  const days = new Map();

  for (const segment of summary.segments) {
    let cursorMs = segment.startAtMs;
    while (cursorMs < segment.endAtMs) {
      const cursorDate = new Date(cursorMs);
      const nextMidnightMs = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
        0, 0, 0, 0
      ).getTime();
      const sliceEndMs = Math.min(segment.endAtMs, nextMidnightMs);
      const sliceDurationMs = Math.max(0, sliceEndMs - cursorMs);
      const date = todayDateString(cursorMs);
      const current = days.get(date) || {
        date,
        totalListeningMs: 0,
        peakListeners: 0,
      };

      if (segment.listeners > 0) {
        current.totalListeningMs += sliceDurationMs;
      }
      current.peakListeners = Math.max(current.peakListeners, segment.listeners);
      days.set(date, current);
      cursorMs = sliceEndMs;
    }
  }

  if (!days.size) {
    const date = todayDateString(startedAtMs);
    days.set(date, { date, totalListeningMs: 0, peakListeners: 0 });
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
