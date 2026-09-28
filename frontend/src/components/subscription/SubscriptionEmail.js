// OmniFM: server dashboard subscription: the license email, shown and edited.
// Split out of components/DashboardSubscription.js (#296); its state stays there.
import { Mail } from 'lucide-react';

export default function SubscriptionEmail({
  emailDraft,
  emailEditing,
  emailSaving,
  lic,
  saveLicenseEmail,
  setEmailDraft,
  setEmailEditing,
  t,
}) {
  return (
    <div data-testid="subscription-email-card" style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Mail size={14} color="#71717A" />
            <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Lizenz-E-Mail', 'License email')}
            </span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: '#A1A1AA' }}>
            {lic.emailMasked || t('Noch keine gueltige E-Mail gespeichert', 'No valid email stored yet')}
          </div>
        </div>
        <button
          data-testid="subscription-email-edit-toggle"
          onClick={() => {
            setEmailEditing((current) => !current);
            setEmailDraft('');
          }}
          style={{
            border: '1px solid #1A1A2E',
            background: 'transparent',
            color: '#A1A1AA',
            padding: '8px 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {emailEditing ? t('Schließen', 'Close') : t('E-Mail ändern', 'Change email')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
        {t(
          'Diese Adresse wird für Checkout, Rechnungen und Lizenz-Kommunikation verwendet.',
          'This address is used for checkout, invoices, and license communication.'
        )}
      </div>
      {emailEditing ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 }}>
          <input
            data-testid="subscription-email-input"
            type="email"
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder={t('name@beispiel.de', 'name@example.com')}
            style={{
              height: 40,
              border: '1px solid #1A1A2E',
              background: '#050505',
              color: '#fff',
              padding: '0 12px',
              outline: 'none',
            }}
          />
          <button
            data-testid="subscription-email-save-btn"
            onClick={saveLicenseEmail}
            disabled={emailSaving}
            style={{
              border: 'none',
              background: '#10B981',
              color: '#042f2e',
              padding: '0 14px',
              fontWeight: 700,
              cursor: emailSaving ? 'wait' : 'pointer',
              opacity: emailSaving ? 0.7 : 1,
            }}
          >
            {emailSaving ? t('Speichert...', 'Saving...') : t('Speichern', 'Save')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
