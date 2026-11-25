// OmniFM Radio DMs to server owners (#594) in the owner cockpit, in words.
import { radioTime } from './ownerRadio.js';

export const RADIO_DM_MODES = ['owners', 'optin', 'off'];

const MODE_LABELS = { owners: 'An alle Server-Besitzer', optin: 'Nur wer abonniert hat', off: 'Aus (Not-Aus)' };
const SOURCE_LABELS = {
  console: 'aus der Owner-Konsole',
  env: 'aus OMNIFM_RADIO_DM_MODE',
  default: 'Standard (keine Einstellung)',
  memory: 'nur im Speicher: „Aus“ gilt, ist aber noch nicht gespeichert (Datenbank)',
};
const STOP_LABELS = {
  off: 'Not-Aus',
  end: 'Sendung zu Ende',
  shutdown: 'Bot neu gestartet',
  client: 'Bot nicht angemeldet',
  discord: 'Discord bremst, DMs ausgeschaltet',
  failures: '5 Fehler in Folge, DMs ausgeschaltet',
  config: 'Einstellung fehlerhaft',
  error: 'Fehler',
};

export function radioDmModeLabel(mode) {
  return MODE_LABELS[mode] || '–';
}

export function radioDmSourceLabel(source) {
  return SOURCE_LABELS[source] || '–';
}

/** "Test · 25.11., 21:00: 3 gesendet · 1 übersprungen · 0 fehlgeschlagen · 2 offen · gestoppt: Not-Aus" */
export function radioDmRunText(run) {
  if (!run) return 'Noch keine Verteilung.';
  const parts = [`${run.sent || 0} gesendet`, `${run.skipped || 0} übersprungen`, `${run.failed || 0} fehlgeschlagen`];
  if (run.remaining) parts.push(`${run.remaining} offen`);
  if (run.stoppedBy) {
    const label = STOP_LABELS[run.stoppedBy] || run.stoppedBy;
    // The service's own words for "error" and "config"; the others say enough.
    const detail = ['error', 'config'].includes(run.stoppedBy) && run.error ? ` (${run.error})` : '';
    parts.push(`gestoppt: ${label}${detail}`);
  }
  return `${run.test ? 'Test · ' : ''}${radioTime(run.startedAt)}: ${parts.join(' · ')}`;
}
