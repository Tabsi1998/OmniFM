// ============================================================
// OmniFM: share cards, 1200 × 630 PNG (#279, #282)
// ============================================================
// One renderer for the link preview of a station (Open Graph image) and
// the "now playing" card the panel posts. @napi-rs/canvas ships prebuilt
// binaries (nothing is compiled on the server); the font is Outfit (OFL,
// assets/fonts). Cards are cached; remote logos and covers go through the
// SSRF-safe fetch with a size limit.
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

import { safeFetch } from "./safe-outbound-http.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const BRAND_ORANGE = "#FF6B00";
const BACKGROUND = "#07070B";
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 4000;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FONT = "Outfit";

let fontsReady = false;
const cardCache = new Map();

function ensureFonts() {
  if (fontsReady) return;
  for (const weight of ["Regular", "SemiBold", "Bold"]) {
    GlobalFonts.registerFromPath(fileURLToPath(new URL(`../../assets/fonts/Outfit-${weight}.ttf`, import.meta.url)), FONT);
  }
  fontsReady = true;
}

/** "#14B8A6" -> "#14B8A6"; anything else -> the brand orange. */
export function cardColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || "").trim());
  return match ? `#${match[1].toUpperCase()}` : BRAND_ORANGE;
}

/** Loads a remote image (https, public host, at most 2 MB); null when it does not work. */
export async function fetchCardImage(url, { fetchImpl = safeFetch } = {}) {
  const text = String(url || "").trim();
  if (!/^https:\/\//i.test(text)) return null;
  try {
    const response = await fetchImpl(text, { timeoutMs: IMAGE_TIMEOUT_MS });
    if (!response?.ok) return null;
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (length > IMAGE_MAX_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length && buffer.length <= IMAGE_MAX_BYTES ? buffer : null;
  } catch {
    return null;
  }
}

/** Splits text into at most `maxLines` lines that fit `width`; the last one gets "…". */
export function wrapCardText(ctx, text, width, maxLines = 2) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= width || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let lastLine = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (lastLine.length > 1 && ctx.measureText(`${lastLine}…`).width > width) lastLine = lastLine.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${lastLine}…`;
  return kept;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

async function drawArtwork(ctx, imageBuffer, { x, y, size, color, fallbackText }) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, 36);
  ctx.clip();
  let drawn = false;
  if (imageBuffer) {
    try {
      const image = await loadImage(imageBuffer);
      ctx.drawImage(image, x, y, size, size);
      drawn = true;
    } catch {
      drawn = false;
    }
  }
  if (!drawn) {
    // No picture: the station colour with its first letter.
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "#111118");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 ${Math.round(size * 0.45)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(fallbackText || "O").trim().charAt(0).toUpperCase() || "O", x + size / 2, y + size / 2 + size * 0.03);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

/**
 * The common frame: dark background with a glow in `color`, artwork on the
 * left, a label, a big title, up to two lines below and the brand line.
 */
async function renderCard({ color, image, fallbackText, label, title, lines = [], footer }) {
  ensureFonts();
  const accent = cardColor(color);
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const glow = ctx.createRadialGradient(260, 315, 40, 260, 315, 720);
  glow.addColorStop(0, `${accent}66`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 10);

  const size = 400;
  await drawArtwork(ctx, image, { x: 80, y: (CARD_HEIGHT - size) / 2, size, color: accent, fallbackText: fallbackText || title });

  const textX = 540;
  const textWidth = CARD_WIDTH - textX - 70;
  let y = 150;
  ctx.fillStyle = accent;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(String(label || "").toUpperCase().slice(0, 60), textX, y);

  // The title shrinks until it fits in two lines.
  let titleSize = 76;
  let titleLines;
  do {
    ctx.font = `700 ${titleSize}px ${FONT}`;
    titleLines = wrapCardText(ctx, title, textWidth, 2);
    if (titleLines.every((line) => !line.endsWith("…")) || titleSize <= 50) break;
    titleSize -= 6;
  } while (titleSize > 50);
  ctx.fillStyle = "#FFFFFF";
  y += 24;
  for (const line of titleLines) {
    y += titleSize * 1.08;
    ctx.fillText(line, textX, y);
  }

  ctx.font = `400 34px ${FONT}`;
  ctx.fillStyle = "#C9C9D6";
  // Extra lines may wrap; together at most three, so the brand line stays free.
  const extraLines = lines.filter(Boolean).flatMap((line) => wrapCardText(ctx, line, textWidth, 2)).slice(0, titleLines.length > 1 ? 2 : 3);
  for (const line of extraLines) {
    y += 52;
    ctx.fillText(line, textX, y);
  }

  ctx.fillStyle = BRAND_ORANGE;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText("OmniFM", textX, CARD_HEIGHT - 70);
  const brandWidth = ctx.measureText("OmniFM").width;
  ctx.fillStyle = "#8A8A99";
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(`· ${footer || "24/7 Radio für Discord"}`.slice(0, 70), textX + brandWidth + 14, CARD_HEIGHT - 70);

  return canvas.encode("png");
}

function cached(key, build) {
  const hit = cardCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = build().catch((error) => {
    cardCache.delete(key);
    throw error;
  });
  cardCache.set(key, { at: Date.now(), promise });
  if (cardCache.size > CACHE_MAX) cardCache.delete(cardCache.keys().next().value);
  return promise;
}

/** The link preview of a station: logo, name, genre. */
export function renderStationCard({ key, name, genre, color, logoUrl, footer, t = (...parts) => parts[0], fetchImage = fetchCardImage }) {
  return cached(`station:${key}:${logoUrl || ""}:${t("de", "en")}`, async () => renderCard({
    color,
    image: await fetchImage(logoUrl),
    fallbackText: name,
    label: genre || t("Radio", "Radio"),
    title: name || key,
    lines: [t("Rund um die Uhr in deinem Discord-Server", "Around the clock in your Discord server")],
    footer,
  }));
}

/** The card the panel posts: cover, title, artist, station, server. */
export function renderNowPlayingCard({ title, artist, stationName, guildName, color, coverUrl, t = (...parts) => parts[0], fetchImage = fetchCardImage }) {
  return cached(`np:${stationName}:${artist}:${title}:${guildName}:${coverUrl || ""}:${t("de", "en")}`, async () => renderCard({
    color,
    image: await fetchImage(coverUrl),
    fallbackText: stationName,
    label: t("Jetzt läuft", "Now playing"),
    title: title || stationName,
    lines: [artist, [stationName, guildName].filter(Boolean).join(" · ")],
    footer: t("24/7 Radio für Discord", "24/7 radio for Discord"),
  }));
}

/** A page of the website (premium, invite, stations): title and subtitle. */
export function renderPageCard({ page, title, subtitle, color = BRAND_ORANGE, t = (...parts) => parts[0] }) {
  return cached(`page:${page}:${t("de", "en")}`, async () => renderCard({
    color,
    image: null,
    fallbackText: "O",
    label: "omnifm.xyz",
    title,
    lines: [subtitle],
    footer: t("24/7 Radio für Discord", "24/7 radio for Discord"),
  }));
}

export function clearShareCardCacheForTests() {
  cardCache.clear();
}
