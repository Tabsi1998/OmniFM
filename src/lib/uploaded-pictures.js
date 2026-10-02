// ============================================================
// OmniFM: pictures the owner uploads (#486)
// ============================================================
// A partner's logo can live on this server instead of the partner's: the
// owner uploads it in the console, MongoDB keeps it, /api/image/sponsor/<n>
// serves it. Nothing has to be fetched from another server, which OmniFM
// cannot always reach (one on the same network, a router without hairpin
// NAT). The sponsor's logo field then holds "upload:<id>"; the id comes from
// the picture itself, so the same file twice is one entry.
import { createHash } from "node:crypto";

export const UPLOADED_PICTURES_COLLECTION = "uploaded_pictures";
export const UPLOAD_REF_PREFIX = "upload:";
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const UPLOAD_REF = /^upload:([0-9a-f]{32})$/;

export class PictureError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The type by the file's first bytes, whatever its name says; "" for anything but a picture. */
export function pictureTypeOf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
  return "";
}

export function uploadIdOf(ref) {
  return UPLOAD_REF.exec(String(ref || "").trim())?.[1] || "";
}

/** Keeps a picture and returns its reference "upload:<id>". */
export async function storeUploadedPicture(db, buffer, { now = new Date() } = {}) {
  if (!db) throw new PictureError(503, "Keine Datenbank verbunden – Hochladen nicht möglich.");
  if (!buffer?.length) throw new PictureError(400, "Keine Datei.");
  if (buffer.length > UPLOAD_MAX_BYTES) throw new PictureError(413, "Das Bild ist größer als 2 MB.");
  const type = pictureTypeOf(buffer);
  if (!type) throw new PictureError(415, "Nur PNG, JPEG, WebP oder GIF.");
  const id = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  await db.collection(UPLOADED_PICTURES_COLLECTION).updateOne(
    { _id: id },
    { $setOnInsert: { type, body: buffer, bytes: buffer.length, createdAt: now } },
    { upsert: true },
  );
  return { ref: `${UPLOAD_REF_PREFIX}${id}`, type, bytes: buffer.length };
}

/** The picture behind "upload:<id>", or null. */
export async function loadUploadedPicture(db, ref) {
  const id = uploadIdOf(ref);
  if (!db || !id) return null;
  const doc = await db.collection(UPLOADED_PICTURES_COLLECTION).findOne({ _id: id });
  if (!doc?.body || !doc.type) return null;
  // MongoDB hands binary data back as a Binary, not a Buffer.
  const raw = doc.body;
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer ?? raw);
  return { type: doc.type, body };
}
