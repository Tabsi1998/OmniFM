// OmniFM: owner console: the audit log of owner actions.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { relTime } from './ownerUi.js';

export default function OwnerAudit({ auditLog }) {
  return (
    <div className="oa-card oa-fade" data-testid="audit-log">
      <div className="oa-stat-label" style={{ marginBottom: 8 }}>Owner Audit-Log — jede Konfigurationsänderung wird protokolliert</div>
      {auditLog.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Noch keine Einträge</div>}
      {auditLog.map((a, i) => {
        const st = a.status === 'error' ? 'red' : a.status === 'warn' ? 'amber' : 'green';
        return (
          <div key={i} className="oa-integration" data-testid={`audit-row-${i}`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span className="oa-pill orange" style={{ fontFamily: 'JetBrains Mono' }}>{a.action}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13.5, display: 'block' }}>{a.target || '—'}</span>
                <span className="oa-mono" style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 520 }}>{a.detail || ''} · {a.actor} · {a.ip}</span>
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`oa-pill ${st}`}>{a.status}</span>
              <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{relTime(a.at)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
