// OmniFM: a part of the dashboard the server's plan does not have yet (#413).
// Says which plan brings it and what else that plan brings, with the lines of
// the bot's plan file, so the dashboard, the website and /premium agree.
import { Lock } from 'lucide-react';
import { PLAN_NAMES, planCardLines } from '../../../src/config/plan-features.js';

export default function PlanLock({ plan = 'pro', title, t, locale = 'de', testId = 'plan-lock' }) {
  const language = String(locale || 'de').startsWith('en') ? 'en' : 'de';
  const { lines } = planCardLines(plan, { language, highlightsOnly: true });
  const name = PLAN_NAMES[plan] || plan;
  return (
    <div className="oa-card" data-testid={testId} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <Lock size={22} color="#94a3b8" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div className="oa-sub" style={{ marginTop: 4 }}>{t(`Das gibt es ab ${name}. ${name} bringt außerdem:`, `This comes with ${name}. ${name} also brings:`)}</div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#cbd5e1', fontSize: 13, lineHeight: 1.7 }}>
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </div>
  );
}
