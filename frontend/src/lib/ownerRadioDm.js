// OmniFM Radio DMs to server owners (#594) in the owner cockpit, in words.
import { radioTime } from './ownerRadio.js';

export const RADIO_DM_MODES = ['owners', 'optin', 'off'];

const MODE_LABELS = { owners: 'An alle Server-Besitzer', optin: 'Nur wer abonniert hat', off: 'Aus (Not-Aus)' };
const SOURCE_LABELS = { console: 'aus der Owner-Konsole', env: 'aus OMNIFM_RADIO_DM_MODE', default: 'Standard (keine Einstellung)' };
const STOP_LABELS = {
  off: 'Not-Aus',
  end: 'Sendung zu Ende',
  shutdown: 'Bot neu gestartet',
  error: 'Datenbank nicht erreichbar',
  client: 'Bot nicht angemeldet',
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
  if (run.stoppedBy) parts.push(`gestoppt: ${STOP_LABELS[run.stoppedBy] || run.stoppedBy}`);
  return `${run.test ? 'Test · ' : ''}${radioTime(run.startedAt)}: ${parts.join(' · ')}`;
}
