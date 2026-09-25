// The owner cockpit (#355): what a state looks like and the headline.
// A colour never stands alone: every state has its icon and its word.

export const COCKPIT_STATES = Object.freeze({
  fail: { label: 'Fehler', icon: '✕', color: '#d03b3b', rank: 0 },
  warn: { label: 'Prüfen', icon: '!', color: '#fab219', rank: 1 },
  off: { label: 'Nicht eingerichtet', icon: '○', color: '#64748b', rank: 2 },
  pending: { label: 'Wird geprüft', icon: '…', color: '#475569', rank: 3 },
  ok: { label: 'OK', icon: '✓', color: '#0ca30c', rank: 4 },
});

export function stateMeta(state) {
  return COCKPIT_STATES[state] || COCKPIT_STATES.pending;
}

/** Red first, then yellow, then not set up; green last, each group in the fixed order. */
export function sortCockpitChecks(checks) {
  return (Array.isArray(checks) ? checks : [])
    .map((check, index) => ({ check, index }))
    .sort((a, b) => stateMeta(a.check.state).rank - stateMeta(b.check.state).rank || a.index - b.index)
    .map(({ check }) => check);
}

/** One sentence for the top of the page. */
export function cockpitHeadline(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const count = (state) => list.filter((check) => check.state === state).length;
  const fail = count('fail');
  const warn = count('warn');
  const off = count('off');
  if (!list.length || count('pending') === list.length) return { state: 'pending', text: 'Die erste Prüfung läuft …' };
  if (fail) return { state: 'fail', text: `${fail} ${fail === 1 ? 'Dienst funktioniert' : 'Dienste funktionieren'} nicht.` };
  if (warn) return { state: 'warn', text: `Alles läuft, ${warn} ${warn === 1 ? 'Punkt braucht' : 'Punkte brauchen'} einen Blick.` };
  if (off) return { state: 'ok', text: `Alles läuft. ${off} ${off === 1 ? 'Dienst ist' : 'Dienste sind'} nicht eingerichtet.` };
  return { state: 'ok', text: 'Alles läuft.' };
}

/** The last hours as cells, oldest first, for the strip under each tile. */
export function historyCells(history, count = 36) {
  const list = Array.isArray(history) ? history.slice(-count) : [];
  return list.map((entry) => ({
    state: entry?.state || 'pending',
    at: entry?.at || null,
    title: `${entry?.at ? new Date(entry.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?'} · ${stateMeta(entry?.state).label}`,
  }));
}
