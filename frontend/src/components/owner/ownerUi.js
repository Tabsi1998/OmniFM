// OmniFM: owner console building blocks: plan colours, formatting, tiles, chart tooltip.
// Split out of frontend/src/components/OwnerAdmin.js (#296).


export const PLAN_COLORS = { free: '#64748b', pro: '#00e5ff', ultimate: '#ff6b00' };

export function Equalizer() {
  return (
    <span className="oa-eq" aria-hidden="true">
      <span /><span /><span /><span /><span />
    </span>
  );
}

export function fmtMoney(v, cur = 'EUR') {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `${Math.round(v || 0)} ${cur}`; }
}
export function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; }
}
export function relTime(v) {
  if (!v) return '';
  const d = (Date.now() - new Date(v).getTime()) / 1000;
  if (d < 60) return 'gerade eben';
  if (d < 3600) return `vor ${Math.floor(d / 60)} Min`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} Std`;
  return `vor ${Math.floor(d / 86400)} Tagen`;
}

export function fmtUptime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function StatTile({ label, value, foot, icon: Icon, accent = '#ff6b00', testid }) {
  return (
    <div className="oa-card hoverable oa-fade" data-testid={testid}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="oa-stat-label">{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${accent}1f`, color: accent }}>
          <Icon size={17} />
        </div>
      </div>
      <div className="oa-stat-value">{value}</div>
      {foot && <div className="oa-stat-foot">{foot}</div>}
    </div>
  );
}

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#0e111a', border: '1px solid #2a3450', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <b>{p.value}</b></div>
      ))}
    </div>
  );
}

// Browser-Abspielbarkeit pro Sender cachen, damit der 120-Sender-Check nicht
// jedes Mal alles neu ~2 Min probt. Key + URL + Zeitstempel; 24h gültig.
const BROWSER_CACHE_KEY = 'omnifm_browser_playable_v1';
export const BROWSER_CACHE_TTL = 24 * 3600 * 1000;
export function readBrowserCache() {
  try { return JSON.parse(window.localStorage.getItem(BROWSER_CACHE_KEY) || '{}') || {}; } catch { return {}; }
}
export function writeBrowserCache(cache) {
  try { window.localStorage.setItem(BROWSER_CACHE_KEY, JSON.stringify(cache)); } catch { /* noop */ }
}
