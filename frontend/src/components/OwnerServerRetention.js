import { useEffect, useState } from 'react';

// Servers OmniFM was removed from, and the day their data is deleted (#285).
// The server owner got a DM with the same date; inviting OmniFM again
// before then keeps everything.
function formatDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('de-DE');
}

export default function OwnerServerRetention({ apiGet }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/admin/server-retention')
      .then((value) => { if (!cancelled) setData(value); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [apiGet]);

  if (!data) return null;
  const pending = Array.isArray(data.pending) ? data.pending : [];
  const days = data.retentionDays || 30;

  return (
    <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="server-retention">
      <div className="oa-stat-label" style={{ marginBottom: 10 }}>Entfernte Server: Daten werden gelöscht</div>
      {pending.length ? (
        <div className="oa-table-wrap">
          <table className="oa-table">
            <thead>
              <tr><th>Server</th><th>Entfernt am</th><th>Löschung am</th><th>Owner informiert</th></tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.guildId}>
                  <td>{row.guildName || <span className="oa-mono">{row.guildId}</span>}</td>
                  <td>{formatDay(row.leftAt)}</td>
                  <td>{formatDay(row.deleteAfter)}</td>
                  <td>{row.ownerNotified ? 'per DM' : 'nicht erreichbar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          Kein Server wartet auf die Löschung. Wird OmniFM von einem Server entfernt, bekommt der Server-Owner eine Nachricht, und nach {days} Tagen löschen wir die Daten des Servers. Premium-Lizenzen bleiben.
        </div>
      )}
    </div>
  );
}
