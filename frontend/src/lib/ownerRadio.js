// OmniFM Radio in the owner cockpit (#592): the live state in words.

/** "1 h 12 min", "5 min", "unter 1 min", like the operator message. */
export function radioShowDuration(ms) {
  const total = Math.round(Math.max(0, Number(ms) || 0) / 60000);
  if (total < 1) return 'unter 1 min';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const SOURCE_LABELS = { webhook: 'Webhook', poll: 'Abfrage', test: 'Test' };

export function radioSourceLabel(source) {
  return SOURCE_LABELS[source] || '–';
}

export function radioShowLabel(show) {
  return [show?.streamerName, show?.title].filter(Boolean).join(' – ') || 'Ohne Namen';
}

function seconds(ms) {
  return Math.round((Number(ms) || 0) / 1000);
}

export function radioDetectionText(data) {
  const poll = `alle ${seconds(data?.pollMs)} s`;
  const grace = `kurze Aussetzer bis ${seconds(data?.graceMs)} s zählen nicht`;
  if (data?.webhook) return `Webhook an · Abfrage ${poll} als Rückfall · ${grace}`;
  const off = data?.webhookSecretTooShort ? 'Webhook aus, Geheimnis zu kurz (mind. 16 Zeichen)' : 'Webhook aus';
  return `${off}: nur die Abfrage ${poll} · ${grace}`;
}

export function radioTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** The one line at the top: live with DJ and time, or the auto DJ. */
export function radioStateText(data, now = Date.now()) {
  if (!data?.enabled) return 'Die Live-Erkennung läuft nicht: OmniFM Radio ist aus, oder der Bot startet gerade.';
  if (data.readable === false) return 'Zustand nicht lesbar (Datenbank). Bis MongoDB antwortet, wird nichts erkannt oder gemeldet.';
  const current = data.current || {};
  if (current.isLive) {
    const since = current.startedAt ? ` · seit ${radioTime(current.startedAt)} (${radioShowDuration(now - Date.parse(current.startedAt))})` : '';
    const test = current.source === 'test' ? ' · Test-Sendung' : '';
    const drop = current.offlineSince ? ' · Verbindung kurz weg' : '';
    return `Live: ${radioShowLabel(current)}${since}${test}${drop}`;
  }
  return current.endedAt ? `Nicht live, der Auto-DJ spielt. Zuletzt live bis ${radioTime(current.endedAt)}.` : 'Nicht live, der Auto-DJ spielt.';
}
