// OmniFM: owner console: the archive of deleted records, with restore.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { RefreshCw, Database } from 'lucide-react';
import { relTime } from './ownerUi.js';

export default function OwnerArchive({
  archiveBusy,
  archiveMsg,
  archiveRows,
  loadArchive,
  restoreArchiveOperation,
}) {
  return (
    <div className="oa-card oa-fade" data-testid="data-archive">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div className="oa-section-title" style={{ margin: 0 }}><Database size={15} /> Wiederherstellbares Datenarchiv</div>
          <div style={{ color: '#94a3b8', fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>Lizenz-, Sender-, Event-, Berechtigungs- und Statistikdaten werden vor dem Entfernen hier gesichert. Eine Wiederherstellung überschreibt niemals neuere aktive Daten.</div>
        </div>
        <button className="oa-btn ghost" style={{ height: 36, flexShrink: 0 }} onClick={loadArchive} disabled={Boolean(archiveBusy)} data-testid="archive-refresh"><RefreshCw size={14} /> Aktualisieren</button>
      </div>
      {archiveMsg && <div className={`oa-pill ${archiveMsg.ok ? 'green' : 'red'}`} style={{ marginBottom: 12 }}>{archiveMsg.text}</div>}
      {archiveRows.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 28 }}>Noch keine archivierten Lösch- oder Reset-Vorgänge.</div>}
      {archiveRows.map((row) => {
        const restored = Number(row.restoredCount || 0) >= Number(row.recordCount || 0) && Number(row.recordCount || 0) > 0;
        return (
          <div className="oa-integration" key={row.operationId} data-testid={`archive-row-${row.operationId}`}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="oa-pill orange" style={{ fontFamily: 'JetBrains Mono' }}>{row.operation || 'delete'}</span>
                <strong style={{ fontSize: 13.5 }}>{row.target || '—'}</strong>
              </span>
              <span className="oa-mono" style={{ display: 'block', color: '#64748b', fontSize: 10.5, marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {row.recordCount || 0} Datensätze · {(row.collections || []).join(', ')} · {relTime(row.archivedAt)} · {row.operationId}
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
              <span className={`oa-pill ${restored ? 'green' : 'amber'}`}>{restored ? 'Wiederhergestellt' : 'Archiviert'}</span>
              <button className="oa-btn ghost" style={{ height: 34 }} disabled={restored || Boolean(archiveBusy)} onClick={() => restoreArchiveOperation(row.operationId)} data-testid={`archive-restore-${row.operationId}`}><RefreshCw size={13} style={{ animation: archiveBusy === row.operationId ? 'spin 1s linear infinite' : 'none' }} /> Wiederherstellen</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
