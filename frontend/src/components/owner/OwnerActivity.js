// OmniFM: owner console: recent license activity.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { KeyRound } from 'lucide-react';
import { relTime } from './ownerUi.js';

export default function OwnerActivity({ activity }) {
  return (
    <div className="oa-card oa-fade" data-testid="activity-log">
      {activity.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Keine Aktivität</div>}
      {activity.map((a, i) => (
        <div key={i} className="oa-integration" data-testid={`activity-row-${i}`}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,107,0,0.14)', color: '#ff6b00', display: 'grid', placeItems: 'center' }}><KeyRound size={15} /></span>
            <span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label}</span>
              <span style={{ display: 'block', fontSize: 12, color: '#64748b' }} className="oa-mono">{a.detail}{a.meta?.seats ? ` · ${a.meta.seats} Seats` : ''}</span>
            </span>
          </span>
          <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{relTime(a.at)}</span>
        </div>
      ))}
    </div>
  );
}
