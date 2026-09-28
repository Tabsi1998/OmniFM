// OmniFM: "Problem melden" in the dashboard (#436): a problem, an idea or
// feedback for the OmniFM team, the same way as /problem in Discord. The two
// ticks are voluntary: may it stand in the public forum (without server and
// name), and a direct message when it is done.
import { useEffect, useRef, useState } from 'react';
import { MessageSquareWarning, X } from 'lucide-react';

const KINDS = ['problem', 'idea', 'feedback'];
const TEXT_MIN = 5;
const TEXT_MAX = 1500;

export default function DashboardReportDialog({ apiRequest, guildId, t, onClose }) {
  const [kind, setKind] = useState('problem');
  const [text, setText] = useState('');
  const [publicOk, setPublicOk] = useState(false);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const field = useRef(null);

  useEffect(() => {
    field.current?.focus?.();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const labels = { problem: t('Problem', 'Problem'), idea: t('Idee', 'Idea'), feedback: t('Feedback', 'Feedback') };
  const ready = text.trim().length >= TEXT_MIN && !busy;

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const answer = await apiRequest(`/api/dashboard/reports?serverId=${encodeURIComponent(guildId)}`, {
        method: 'POST',
        body: JSON.stringify({ kind, text, consent: { public: publicOk, notify } }),
      });
      if (answer?.ok) {
        setResult({ ok: true, text: t('Danke! Deine Meldung ist beim OmniFM-Team angekommen.', 'Thanks! Your report has reached the OmniFM team.') });
        setText('');
      } else if (answer?.reason === 'cooldown') {
        setResult({ ok: false, text: t('Du hast eben schon etwas gemeldet. Die nächste Meldung geht in ein paar Minuten.', 'You reported something a moment ago. The next report can go in a few minutes.') });
      } else {
        setResult({ ok: false, text: t('Melden über Discord geht gerade nicht. Deine Meldung ist trotzdem beim OmniFM-Team angekommen, nur ohne Forum und ohne Rückmeldung an dich.', 'Reporting through Discord does not work right now. Your report still reached the OmniFM team, only without the forum and without a reply to you.') });
      }
    } catch (err) {
      setResult({ ok: false, text: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(3,4,8,0.72)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        data-testid="report-dialog"
        className="oa-card"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h2 id="report-dialog-title" className="oa-display" style={{ fontSize: 20, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <MessageSquareWarning size={18} color="#ff6b00" /> {t('Ans OmniFM-Team melden', 'Tell the OmniFM team')}
          </h2>
          <button type="button" className="oa-btn ghost" onClick={onClose} aria-label={t('Schließen', 'Close')} style={{ height: 34, padding: '0 10px' }}><X size={15} /></button>
        </div>
        <div role="radiogroup" aria-label={t('Worum geht es?', 'What is it about?')} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {KINDS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={kind === entry}
              className={`oa-nav-btn ${kind === entry ? 'active' : ''}`}
              style={{ width: 'auto' }}
              onClick={() => setKind(entry)}
              data-testid={`report-kind-${entry}`}
            >
              {labels[entry]}
            </button>
          ))}
        </div>
        <label className="oa-stat-label" htmlFor="report-dialog-text">{t('Worum geht es?', 'What is it about?')}</label>
        <textarea
          id="report-dialog-text"
          ref={field}
          className="oa-input"
          data-testid="report-text"
          value={text}
          maxLength={TEXT_MAX}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Was ist passiert, oder was wünschst du dir?', 'What happened, or what would you like?')}
          style={{ marginTop: 6, height: 130, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }}
        />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.45 }}>
          <input type="checkbox" checked={publicOk} onChange={(event) => setPublicOk(event.target.checked)} data-testid="report-public" style={{ marginTop: 3 }} />
          {t('Darf öffentlich im Forum stehen (nur der Text, Sender und Plan; kein Server, kein Name)', 'May be shown in the public forum (only the text, station and plan; no server, no name)')}
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 8, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.45 }}>
          <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} data-testid="report-notify" style={{ marginTop: 3 }} />
          {t('Gib mir Bescheid, wenn es erledigt ist (per Direktnachricht in Discord)', 'Tell me when it is done (by direct message in Discord)')}
        </label>
        {result ? <div className={`oa-pill ${result.ok ? 'green' : 'amber'}`} style={{ marginTop: 14, whiteSpace: 'normal', lineHeight: 1.45 }} data-testid="report-result">{result.text}</div> : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="oa-btn ghost" onClick={onClose}>{t('Abbrechen', 'Cancel')}</button>
          <button type="button" className="oa-btn primary" onClick={send} disabled={!ready} data-testid="report-send">{busy ? t('Sende …', 'Sending …') : t('Senden', 'Send')}</button>
        </div>
      </div>
    </div>
  );
}
