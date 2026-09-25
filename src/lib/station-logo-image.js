// ============================================================
// OmniFM: an uploaded station logo becomes a 256x256 PNG (#340)
// ============================================================
// PNG, JPG or WebP up to 256 KB. The type comes from the file's first bytes,
// not from its name. The picture is cut to a centred square, so a wide logo
// loses its edges instead of being squashed.
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const STATION_LOGO_MAX_BYTES = 256 * 1024;
export const STATION_LOGO_SIZE = 256;

/** "png" | "jpeg" | "webp" | null from the magic bytes. */
export function detectLogoImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * @param {Buffer} buffer the uploaded file
 * @returns {Promise<{ ok: true, png: Buffer } | { ok: false, error: "too-large" | "wrong-type" | "unreadable" }>}
 */
export async function processStationLogo(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, error: "unreadable" };
  if (buffer.length > STATION_LOGO_MAX_BYTES) return { ok: false, error: "too-large" };
  if (!detectLogoImageType(buffer)) return { ok: false, error: "wrong-type" };
  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  if (!width || !height) return { ok: false, error: "unreadable" };
  const side = Math.min(width, height);
  const canvas = createCanvas(STATION_LOGO_SIZE, STATION_LOGO_SIZE);
  canvas.getContext("2d").drawImage(
    image,
    (width - side) / 2, (height - side) / 2, side, side,
    0, 0, STATION_LOGO_SIZE, STATION_LOGO_SIZE
  );
  return { ok: true, png: await canvas.encode("png") };
}
