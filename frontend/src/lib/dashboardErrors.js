function pickLanguage(language, germanText, englishText) {
  return String(language || "").trim().toLowerCase().startsWith('de') ? germanText : englishText;
}

const TECHNICAL_ERROR_PATTERN = /\b(mongodb|mongo|worker|ffmpeg|stack|exception|internal server error|discord_[a-z_]+|prisma|redis|econn|enotfound|etimedout|socket|spawn|epipe|sql|database|fetch failed|network request failed|http\s+\d{3}|timeout)\b/i;

export function isDashboardSafeUserMessage(message) {
  const normalized = String(message || '').trim();
  if (!normalized) return false;
  if (normalized.length > 220) return false;
  return !TECHNICAL_ERROR_PATTERN.test(normalized);
}

export function resolveDashboardApiErrorMessage(status, payloadError, language, { fallback = null } = {}) {
  const fallbackMessage = fallback || pickLanguage(
    language,
    'Die Aktion konnte gerade nicht abgeschlossen werden.',
    'The action could not be completed right now.'
  );
  const safePayload = isDashboardSafeUserMessage(payloadError) ? String(payloadError || '').trim() : '';

  if (status === 401) {
    return safePayload || pickLanguage(language, 'Bitte melde dich erneut an.', 'Please sign in again.');
  }
  if (status === 403) {
    return safePayload || pickLanguage(language, 'Dafuer hast du gerade keinen Zugriff.', 'You do not currently have access to this.');
  }
  if (status === 404) {
    return safePayload || pickLanguage(language, 'Die angeforderte Funktion ist gerade nicht verfuegbar.', 'The requested feature is currently unavailable.');
  }
  if (status === 429) {
    return pickLanguage(language, 'Zu viele Anfragen. Bitte versuche es gleich erneut.', 'Too many requests. Please try again shortly.');
  }
  if (status >= 500) {
    return pickLanguage(language, 'Der Dienst ist gerade voruebergehend nicht verfuegbar.', 'The service is temporarily unavailable.');
  }
  return safePayload || fallbackMessage;
}

export function resolveDashboardClientErrorMessage(error, language, { fallback = null } = {}) {
  const fallbackMessage = fallback || pickLanguage(
    language,
    'Die Aktion konnte gerade nicht abgeschlossen werden.',
    'The action could not be completed right now.'
  );
  const message = String(error?.message || '').trim();

  if (!message) return fallbackMessage;
  if (String(error?.name || '').trim() === 'AbortError') return fallbackMessage;
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message)) {
    return pickLanguage(language, 'Der Dienst ist gerade nicht erreichbar.', 'The service is currently unreachable.');
  }
  const httpMatch = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (httpMatch) {
    return resolveDashboardApiErrorMessage(Number(httpMatch[1]), '', language, { fallback: fallbackMessage });
  }
  return isDashboardSafeUserMessage(message) ? message : fallbackMessage;
}
