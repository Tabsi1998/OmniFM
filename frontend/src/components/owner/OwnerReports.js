// OmniFM: owner console: reports from Discord (#436, #437). The open ones
// with links to their card in the team channel and to the forum post;
// deciding happens on the card in Discord. Below, where reports go: the
// private team channel, a forum per kind and the names of the status tags.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { DEFAULT_REPORT_TAGS, REPORT_STATUSES, normalizeReportSettings } from '../../../../src/lib/problem-reports.js';
import { Field, SaveBar } from './configFields.js';

const KIND = { problem: '🐞 Problem', idea: '💡 Idee', feedback: '💬 Feedback' };
const STATUS = { new: 'neu', 'in-progress': 'in Arbeit', done: 'erledigt', rejected: 'abgelehnt', duplicate: 'doppelt' };
const SOURCE = { command: 'Befehl', panel: 'Panel', dashboard: 'Dashboard' };
const FORUMS = [['problem', 'Forum für Probleme'], ['idea', 'Forum für Ideen'], ['feedback', 'Forum für Feedback']];
const SNOWFLAKE = /^\d{17,22}$/;

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ReportRow({ item }) {
  return (
    <div data-testid={`owner-report-${item.id}`} style={{ padding: '12px 0', borderTop: '1px solid #1b2133' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 12.5, color: '#94a3b8' }}>
        <b style={{ color: '#f3f4f8' }}>{KIND[item.kind] || item.kind}</b>
        <span className="oa-pill" style={{ padding: '1px 8px' }}>{STATUS[item.status] || item.status}</span>
        <span>{fmtDate(item.createdAt)}</span>
        <span>{SOURCE[item.source] || item.source}</span>
        {item.server ? <span>{item.server}</span> : null}
        {item.station ? <span>📻 {item.station}</span> : null}
        <span>{item.plan}</span>
        <span>{item.from ? `von ${item.from}` : 'ohne Namen'}</span>
        {item.public ? <span>🌐 darf ins Forum</span> : null}
      </div>
      <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.text}</div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12.5 }}>
        {item.teamLink ? <a href={item.teamLink} target="_blank" rel="noopener noreferrer" style={{ color: '#00e5ff' }}><ExternalLink size={12} /> Karte im Team-Kanal</a> : <span className="oa-sub">{item.delivered ? '' : 'noch nicht im Team-Kanal'}</span>}
        {item.forumLink ? <a href={item.forumLink} target="_blank" rel="noopener noreferrer" style={{ color: '#00e5ff' }}><ExternalLink size={12} /> Forum-Beitrag</a> : null}
      </div>
    </div>
  );
}

/** Owner page "Meldungen" (#436, #437): the open reports and where they go. */
export default function OwnerReports({ apiGet, reports, setReports, onSave, saving, msg, dirty }) {
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiGet(`/api/admin/reports${showAll ? '?all=1' : ''}`);
      setRows(Array.isArray(data?.reports) ? data.reports : []);
      setError('');
    } catch (err) {
      setRows([]);
      setError(err.message);
    }
  }, [apiGet, showAll]);

  useEffect(() => { load(); }, [load]);

  if (!reports) return <div className="oa-sub">Lade Konfiguration…</div>;
  const setField = (patch) => setReports((current) => ({ ...current, ...patch }));
  const setForum = (kind, value) => setReports((current) => ({ ...current, forums: { ...(current.forums || {}), [kind]: value.trim() } }));
  const setTag = (status, value) => setReports((current) => ({ ...current, tags: { ...(current.tags || {}), [status]: value } }));
  const teamChannelId = String(reports.teamChannelId || '');
  const idProblem = [teamChannelId, ...FORUMS.map(([kind]) => String(reports.forums?.[kind] || ''))].some((value) => value && !SNOWFLAKE.test(value));

  return (
    <div className="oa-fade" data-testid="owner-reports">
      <div className="oa-card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="oa-section-title" style={{ margin: 0 }}>Meldungen aus Discord</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#94a3b8' }}>
            <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} data-testid="owner-reports-all" /> auch entschiedene zeigen
          </label>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', margin: '8px 0 4px', lineHeight: 1.6 }}>
          Probleme, Ideen und Feedback aus /problem, /idee, /feedback und dem Panel. Entschieden wird auf der Karte im Team-Kanal (Owner und Support); hier steht, wo jede Meldung steht.
        </div>
        {!SNOWFLAKE.test(teamChannelId) ? (
          <div className="oa-pill amber" style={{ margin: '10px 0' }} data-testid="owner-reports-unconfigured">
            <AlertTriangle size={13} /> Kein Team-Kanal eingestellt: Meldungen landen wie bisher nur als Vorfälle im Live-Status, nichts geht nach Discord.
          </div>
        ) : null}
        {error ? <div className="oa-pill red" style={{ margin: '10px 0' }}>{error}</div> : null}
        {rows === null ? <div className="oa-sub">Lade Meldungen…</div> : null}
        {rows && !rows.length ? <div className="oa-sub" style={{ padding: '12px 0' }}>{showAll ? 'Noch keine Meldungen.' : 'Keine offenen Meldungen.'}</div> : null}
        {(rows || []).map((item) => <ReportRow key={item.id} item={item} />)}
      </div>

      <div className="oa-card" style={{ marginBottom: 18 }} data-testid="config-reports">
        <div className="oa-section-title">Wohin Meldungen gehen</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
          Jede Meldung geht zuerst in den privaten Team-Kanal. Öffentlich im Forum steht sie nur, wenn die Person zugestimmt hat und jemand im Team auf „Im Forum veröffentlichen“ klickt; dort stehen nur der Text, der Sender und der Plan.
          Der Team-Kanal muss ein Textkanal sein, den @everyone nicht sieht; sonst postet der Bot dort nichts.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px' }}>
          <Field label="Team-Kanal (privat)" value={teamChannelId} onChange={(value) => setField({ teamChannelId: value.trim() })} placeholder="123456789012345678" testid="cfg-reports-team" />
          {FORUMS.map(([kind, label]) => (
            <Field key={kind} label={label} value={reports.forums?.[kind] || ''} onChange={(value) => setForum(kind, value)} placeholder="optional" testid={`cfg-reports-forum-${kind}`} />
          ))}
        </div>
        <div className="oa-stat-label" style={{ margin: '6px 0 8px' }}>Tags im Forum, je Status</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 14px' }}>
          {REPORT_STATUSES.map((status) => (
            <Field key={status} label={STATUS[status]} value={reports.tags?.[status] ?? DEFAULT_REPORT_TAGS[status]} onChange={(value) => setTag(status, value)} placeholder="kein Tag" testid={`cfg-reports-tag-${status}`} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 6 }}>
          IDs findest du in Discord mit eingeschaltetem Entwicklermodus: Rechtsklick auf den Kanal → „Kanal-ID kopieren“. Der Commander braucht im Team-Kanal „Kanal ansehen“ und „Nachrichten senden“, in den Foren „Beiträge erstellen“ und „Threads verwalten“ (für die Tags).
          Die Tags legst du im Forum an (Forum bearbeiten → Tags); der Bot sucht sie hier nach dem Namen, Groß- und Kleinschreibung egal. Ein leeres Feld heißt: kein Tag.
        </div>
        {idProblem ? <div className="oa-pill red" style={{ marginTop: 10 }}>Eine Kanal-ID sieht nicht richtig aus (nur Ziffern, 17 bis 22 Stellen).</div> : null}
      </div>
      <SaveBar onSave={() => onSave(normalizeReportSettings(reports))} saving={saving} msg={msg} testid="cfg-reports-save" dirty={dirty} />
    </div>
  );
}
