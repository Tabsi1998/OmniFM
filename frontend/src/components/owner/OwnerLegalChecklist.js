import { useEffect, useState } from 'react';
import { ExternalLink, Scale } from 'lucide-react';
import { LEGAL_PAGES, legalChecklist, legalPageLight } from '../../../../src/config/legal-requirements.js';

// The legal checklist of "Firma & Recht" (#424): per page what has to be
// there, with a traffic light. It reads what visitors see (the public
// answers), so a value from the server's environment counts too; the list is
// the one the cockpit and the API check (src/config/legal-requirements.js).

const LIGHTS = {
  green: { icon: '✓', color: '#0ca30c', label: 'Vollständig' },
  yellow: { icon: '!', color: '#fab219', label: 'Prüfen' },
  red: { icon: '✕', color: '#d03b3b', label: 'Pflichtangaben fehlen' },
};

const STATES = {
  ok: { icon: '✓', color: '#0ca30c', label: 'Eingetragen' },
  missing: { icon: '✕', color: '#d03b3b', label: 'Fehlt, muss rein' },
  open: { icon: '?', color: '#fab219', label: 'Nur wenn es auf dich zutrifft' },
  na: { icon: '–', color: '#64748b', label: 'Trifft nicht zu' },
  optional: { icon: '○', color: '#64748b', label: 'Freiwillig' },
};
// Within a page: what is missing first, then what may apply, then the rest.
const ORDER = { missing: 0, open: 1, ok: 2, na: 3, optional: 4 };

function Badge({ meta, testid }) {
  return (
    <span data-testid={testid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 9, background: meta.color, color: '#0b1120', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function Requirement({ item, notApplicable, onNotApplicable }) {
  const meta = STATES[item.state] || STATES.optional;
  const canSkip = item.level === 'conditional' && item.state !== 'ok';
  // What needs doing is spelled out; what is done or voluntary stays one line (reason on hover).
  const open = item.state === 'missing' || item.state === 'open';
  return (
    <li data-testid={`legal-item-${item.key}`} data-state={item.state} title={open ? undefined : item.why} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', gap: 10, padding: open ? '10px 0' : '6px 0', borderTop: '1px solid #1e293b' }}>
      <span aria-hidden="true" style={{ width: 18, height: 18, marginTop: 1, borderRadius: 9, background: meta.color, color: '#0b1120', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{meta.icon}</span>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
          <span style={{ color: open ? '#f8fafc' : '#cbd5e1', fontWeight: 700, fontSize: open ? 14 : 13 }}>{item.label}</span>
          <span style={{ color: meta.color === '#64748b' ? '#94a3b8' : meta.color, fontSize: 12, fontWeight: 700 }}>{meta.label}</span>
        </div>
        {open && <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, marginTop: 2 }}>{item.why}</div>}
        {open && item.source ? <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{item.source}</div> : null}
        {canSkip && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6, color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-testid={`legal-na-${item.key}`}
              checked={notApplicable.includes(item.key)}
              onChange={(event) => onNotApplicable(item.key, event.target.checked)}
            />
            Trifft nicht zu
          </label>
        )}
      </div>
    </li>
  );
}

export default function OwnerLegalChecklist({ apiGet, token, version, notApplicable = [], onNotApplicable, dirty = false }) {
  const [answers, setAnswers] = useState(null);
  const [error, setError] = useState('');

  // Again after every save: "version" is what the server last sent.
  useEffect(() => {
    let alive = true;
    Promise.all(['/api/legal', '/api/privacy', '/api/terms'].map((path) => apiGet(path, token)))
      .then(([legal, privacy, terms]) => {
        if (!alive) return;
        setAnswers({ legal, privacy, terms });
        setError('');
      })
      .catch((err) => { if (alive) setError(err?.message || 'nicht erreichbar'); });
    return () => { alive = false; };
  }, [apiGet, token, version]);

  const skipped = Array.isArray(notApplicable) ? notApplicable : [];
  const items = answers ? legalChecklist(answers, skipped) : [];

  return (
    <div className="oa-card" style={{ marginBottom: 18 }} data-testid="legal-checklist">
      <div className="oa-section-title"><Scale size={15} /> Rechtliches: was auf die Seiten muss</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
        Die Ampel zeigt, was Besucher gerade sehen. Die Liste folgt den üblichen Mustern für ein Einzelunternehmen in Österreich;
        sie ist keine Rechtsberatung. Im Zweifel helfen die Muster der WKO.
        {dirty ? ' Ungespeicherte Änderungen zählen erst nach dem Speichern.' : ''}
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>Die Seiten sind gerade nicht erreichbar ({error}).</div>}
      {!answers && !error && <div className="oa-sub">Prüfe die Seiten …</div>}
      {answers && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {LEGAL_PAGES.map((page) => {
            const own = items.filter((item) => item.page === page.key).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
            const light = legalPageLight(own);
            return (
              <section key={page.key} data-testid={`legal-page-${page.key}`} data-light={light} style={{ background: '#0f172a', border: '1px solid #1e293b', borderLeft: `4px solid ${LIGHTS[light].color}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <h3 style={{ margin: 0, color: '#f8fafc', fontSize: 15 }}>{page.label}</h3>
                  <Badge meta={LIGHTS[light]} testid={`legal-light-${page.key}`} />
                  <a
                    className="oa-btn ghost"
                    href={`${page.path}?lang=de`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`legal-preview-${page.key}`}
                    style={{ marginLeft: 'auto', height: 28, padding: '0 10px', fontSize: 12, textDecoration: 'none' }}
                  >
                    <ExternalLink size={12} /> Vorschau
                  </a>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {own.map((item) => (
                    <Requirement key={item.key} item={item} notApplicable={skipped} onNotApplicable={onNotApplicable} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
