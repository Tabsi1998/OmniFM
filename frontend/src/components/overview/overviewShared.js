// OmniFM: server dashboard overview: colours, weekdays, stat and chart cards.
// Split out of frontend/src/components/DashboardOverview.js (#296).


export const COLORS = ['#5865F2', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#F97316'];
export const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function StatCard({ label, value, sub, accent = '#00e5ff', testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '18px 16px',
      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 110,
    }}>
      <span style={{ fontSize: 11, color: '#71717A', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      <strong style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, lineHeight: 1.1, color: accent }}>{value}</strong>
      {sub && <span style={{ fontSize: 12, color: '#52525B' }}>{sub}</span>}
    </div>
  );
}

export function ChartCard({ title, children, testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '16px',
    }}>
      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, marginBottom: 14, color: '#D4D4D8' }}>{title}</h4>
      {children}
    </div>
  );
}

export function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#18181B', border: '1px solid #27272A', padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: '#A1A1AA', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
}
