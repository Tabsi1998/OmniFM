// OmniFM: server dashboard subscription: plan colours and names, dates, a feature row.
// Split out of frontend/src/components/DashboardSubscription.js (#296).


export const TIER_COLORS = { free: '#71717A', pro: '#10B981', ultimate: '#8B5CF6' };
export const TIER_LABELS = { free: 'Free', pro: 'Pro', ultimate: 'Ultimate' };

export function formatLicenseDate(isoStr, formatDate) {
  if (!isoStr) return '-';
  try {
    return formatDate(isoStr, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '-';
  }
}

export function FeatureRow({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span style={{ fontSize: 13, color: '#D4D4D8' }}>{label}</span>
    </div>
  );
}
