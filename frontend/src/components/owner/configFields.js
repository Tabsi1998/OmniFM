import { CheckCircle2, Save, XCircle } from 'lucide-react';

// The form building blocks of the owner console's settings pages (OwnerConfig.js and its topic modules).
export const labelStyle = {
  fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: 6, display: 'block',
};

export function Field({ label, value, onChange, placeholder, type = 'text', textarea, testid, hint, width }) {
  return (
    <div style={{ marginBottom: 14, gridColumn: width === 'full' ? '1 / -1' : 'auto' }}>
      <label style={labelStyle}>{label}</label>
      {textarea ? (
        <textarea
          className="oa-input" data-testid={testid} value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ height: 96, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }}
        />
      ) : (
        <input
          className="oa-input" data-testid={testid} type={type} value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, testid }) {
  return (
    <button
      type="button" data-testid={testid} onClick={() => onChange(!checked)}
      className="oa-card" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        cursor: 'pointer', padding: '12px 16px', marginBottom: 14, width: '100%', textAlign: 'left',
        border: checked ? '1px solid #10b981' : '1px solid var(--oa-border-active)',
      }}
    >
      <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{label}</span>
      <span style={{
        width: 46, height: 26, borderRadius: 999, background: checked ? '#10b981' : '#2a3450',
        position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease',
        }} />
      </span>
    </button>
  );
}

// Stays at the bottom of the page and says when something is not saved yet (#356).
export function SaveBar({ onSave, saving, msg, testid, dirty = false }) {
  return (
    <div data-testid={`${testid}-bar`} style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, padding: '10px 0', background: 'var(--oa-bg, #0b1120)', borderTop: dirty ? '1px solid #fab219' : '1px solid transparent' }}>
      <button className="oa-btn primary" onClick={onSave} disabled={saving || !dirty} data-testid={testid}>
        <Save size={16} /> {saving ? 'Speichert…' : 'Speichern'}
      </button>
      {dirty && !saving && (
        <span data-testid={`${testid}-dirty`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#fab219' }}>
          ! Ungespeicherte Änderungen
        </span>
      )}
      {msg && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: msg.ok ? '#10b981' : '#ff8fab' }}>
          {msg.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {msg.text}
        </span>
      )}
    </div>
  );
}
