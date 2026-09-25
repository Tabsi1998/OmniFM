// Pictures for the bot look (#280) are made smaller in the browser before
// the upload: an avatar to 512 x 512, a banner to 1200 x 480. A small
// animated GIF stays as it is, so it keeps moving.

export const AVATAR_BOX = { width: 512, height: 512 };
export const BANNER_BOX = { width: 1200, height: 480 };
const GIF_KEEP_BYTES = 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** The scale that fits `width x height` into `box`, never larger than 1. */
export function fitScale(width, height, box) {
  if (!width || !height) return 1;
  return Math.min(1, box.width / width, box.height / height);
}

/** A data URL for the upload: resized PNG/JPEG, or the small GIF unchanged. */
export async function prepareProfileImage(file, box) {
  if (!file) return null;
  if (file.type === 'image/gif' && file.size <= GIF_KEEP_BYTES) return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = fitScale(bitmap.width, bitmap.height, box);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return file.type === 'image/png'
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.9);
}
