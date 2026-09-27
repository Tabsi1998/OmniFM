function pickLanguage(language, germanText, englishText) {
  return String(language || "").trim().toLowerCase().startsWith("de") ? germanText : englishText;
}

const TECHNICAL_ERROR_PATTERN = /\b(mongodb|mongo|worker|ffmpeg|stack|exception|internal server error|discord_[a-z_]+|prisma|redis|econn|enotfound|etimedout|socket|spawn|epipe|sql|database|fetch failed|network request failed|http\s+\d{3}|timeout)\b/i;

export function isSafeUserFacingErrorMessage(message) {
  const normalized = String(message || "").trim();
  if (!normalized) return false;
  if (normalized.length > 220) return false;
  return !TECHNICAL_ERROR_PATTERN.test(normalized);
}

export function resolveUserFacingErrorMessage(language, error, {
  fallbackDe = "Die Aktion konnte gerade nicht abgeschlossen werden.",
  fallbackEn = "The action could not be completed right now.",
} = {}) {
  const fallback = pickLanguage(language, fallbackDe, fallbackEn);
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  return isSafeUserFacingErrorMessage(message) ? message : fallback;
}
