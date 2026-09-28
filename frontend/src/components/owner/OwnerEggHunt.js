// OmniFM: owner console: the Easter egg hunt (#429). Per server the top three
// of the last year with eggs, prepared for a reward later (for example a free
// month). Only the Discord IDs and the counts; nothing is decided here.
import { useEffect, useState } from 'react';
import { Egg } from 'lucide-react';

const eggs = (count) => (count === 1 ? '1 Ei' : `${count} Eier`);

export default function OwnerEggHunt({ apiGet }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    apiGet('/api/admin/egg-hunt')
      .then((answer) => {
        if (!alive) return;
        setData(answer || { year: null, servers: [] });
        setError('');
      })
      .catch((err) => {
        if (!alive) return;
        setData({ year: null, servers: [] });
        setError(err.message);
      });
    return () => { alive = false; };
  }, [apiGet]);

  const servers = Array.isArray(data?.servers) ? data.servers : [];
  return (
    <div className="oa-card" style={{ marginBottom: 18 }} data-testid="owner-egg-hunt">
      <div className="oa-section-title"><Egg size={15} /> Ostereiersuche: Top 3 je Server{data?.year ? ` (${data.year})` : ''}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12, lineHeight: 1.6 }}>
        Von Palmsonntag bis Ostermontag bringt etwa jeder achte Song ein Ei ins Panel; wer zuerst klickt, bekommt es. Hier stehen je Server die drei, die am meisten gefunden haben, etwa für einen Gratis-Monat. Die Zahlen werden 30 Tage nach Ostermontag gelöscht.
      </div>
      {error ? <div className="oa-pill red" style={{ marginBottom: 10 }}>{error}</div> : null}
      {data === null ? <div className="oa-sub">Lade Ostereier…</div> : null}
      {data && !servers.length && !error ? <div className="oa-sub">Noch keine Eier gefunden.</div> : null}
      {servers.map((server) => (
        <div key={server.guildId} data-testid={`owner-egg-server-${server.guildId}`} style={{ padding: '10px 0', borderTop: '1px solid #1b2133' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 12.5, color: '#94a3b8' }}>
            <b style={{ color: '#f3f4f8' }}>{server.name || server.guildId}</b>
            {server.name ? <span className="oa-mono">{server.guildId}</span> : null}
            <span>{eggs(server.eggs)} · {server.finders} Finder</span>
          </div>
          <ol style={{ margin: '6px 0 0', paddingLeft: 22, fontSize: 13.5, lineHeight: 1.6 }}>
            {(server.top || []).map((row) => (
              <li key={row.userId} value={row.rank}>
                <span className="oa-mono">{row.userId}</span> · {eggs(row.count)}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
