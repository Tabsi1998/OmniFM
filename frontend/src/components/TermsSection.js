import React from 'react';
import {
  AlertTriangle,
  Building2,
  FileText,
  Mail,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { useI18n } from '../i18n.js';

function renderFieldValue(value, emptyLabel, kind = 'text') {
  const text = String(value || '').trim();
  if (!text) {
    return (
      <span style={{ color: '#71717A' }}>
        {emptyLabel}
      </span>
    );
  }

  if (kind === 'email') {
    return (
      <a
        href={`mailto:${text}`}
        style={{ color: '#F4F4F5', textDecoration: 'none' }}
      >
        {text}
      </a>
    );
  }

  if (kind === 'url') {
    return (
      <a
        href={text}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#F4F4F5', textDecoration: 'none' }}
      >
        {text}
      </a>
    );
  }

  return <span>{text}</span>;
}

function FieldCard({ icon: Icon, title, rows, emptyLabel }) {
  return (
    <div
      style={{
        padding: '28px 24px',
        borderRadius: 24,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0,229,255,0.08)',
            border: '1px solid rgba(0,229,255,0.18)',
          }}
        >
          <Icon size={18} color="#00e5ff" />
        </div>
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          {title}
        </h3>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: 'grid', gap: 4 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#71717A',
              }}
            >
              {row.label}
            </div>
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.65,
                color: '#F4F4F5',
                whiteSpace: row.multiline ? 'pre-line' : 'normal',
                overflowWrap: 'anywhere',
              }}
            >
              {renderFieldValue(row.value, emptyLabel, row.kind)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyBlock({ title, body, items = [] }) {
  return (
    <div
      style={{
        padding: '24px 24px 22px',
        borderRadius: 24,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <h3
        style={{
          margin: '0 0 10px',
          fontSize: 18,
          fontWeight: 700,
          color: '#F4F4F5',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          color: '#A1A1AA',
          lineHeight: 1.75,
          fontSize: 15,
        }}
      >
        {body}
      </p>
      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          {items.map((item) => (
            <div
              key={item}
              style={{
                paddingLeft: 18,
                position: 'relative',
                color: '#F4F4F5',
                lineHeight: 1.65,
                fontSize: 15,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  color: '#ff6b00',
                  fontWeight: 700,
                }}
              >
                •
              </span>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TermsSection({ terms }) {
  const { copy } = useI18n();
  const operator = terms?.operator || {};
  const contact = terms?.contact || {};
  const service = terms?.service || {};
  const billing = terms?.billing || {};
  const missingCoreFields = Array.isArray(terms?.missingCoreFields) ? terms.missingCoreFields : [];
  const missingLabels = missingCoreFields
    .map((field) => copy.terms.fields[field] || field)
    .filter(Boolean)
    .join(', ');

  const enabledLabel = copy.terms.booleanEnabled;
  const disabledLabel = copy.terms.booleanDisabled;

  const operatorRows = [
    { label: copy.terms.fields.providerName, value: operator.providerName },
    { label: copy.terms.fields.representative, value: operator.representative },
    { label: copy.terms.fields.businessPurpose, value: operator.businessPurpose },
    { label: copy.terms.fields.website, value: operator.website, kind: 'url' },
  ];

  const contactRows = [
    { label: copy.terms.fields.contactEmail, value: contact.email, kind: 'email' },
    { label: copy.terms.fields.supportWebsite, value: contact.website, kind: 'url' },
    { label: copy.terms.fields.effectiveDate, value: contact.effectiveDate },
    { label: copy.terms.fields.governingLaw, value: contact.governingLaw },
  ];

  const serviceRows = [
    { label: copy.terms.fields.discordBot, value: service.discordBotEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.dashboard, value: service.dashboardEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.stationPreview, value: service.stationPreviewEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.scheduledEvents, value: service.scheduledEventsEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.customStations, value: service.customStationsEnabled ? enabledLabel : disabledLabel },
  ];

  const billingRows = [
    { label: copy.terms.fields.premiumCheckout, value: billing.premiumCheckoutEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.paymentProvider, value: billing.paymentProvider || disabledLabel },
    { label: copy.terms.fields.emailDelivery, value: billing.emailDeliveryEnabled ? enabledLabel : disabledLabel },
    { label: copy.terms.fields.trialMonth, value: billing.trialEnabled ? enabledLabel : disabledLabel },
  ];

  return (
    <section
      id="terms"
      data-testid="terms-section"
      style={{
        position: 'relative',
        padding: '110px 24px 40px',
      }}
    >
      <div className="section-container" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ maxWidth: 900, marginBottom: 28 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              borderRadius: 999,
              background: 'rgba(255,42,95,0.08)',
              border: '1px solid rgba(255,42,95,0.18)',
              color: '#ff2a5f',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom: 20,
            }}
          >
            <FileText size={14} />
            {copy.terms.eyebrow}
          </div>

          <h2
            style={{
              margin: '0 0 14px',
              fontFamily: "'Syne', sans-serif",
              fontSize: 'clamp(30px, 4vw, 44px)',
              lineHeight: 1.08,
            }}
          >
            {copy.terms.title}
          </h2>

          <p
            style={{
              margin: 0,
              maxWidth: 820,
              color: '#A1A1AA',
              fontSize: 16,
              lineHeight: 1.75,
            }}
          >
            {copy.terms.subtitle}
          </p>
        </div>

        {missingCoreFields.length > 0 && (
          <div
            style={{
              marginBottom: 28,
              padding: '18px 20px',
              borderRadius: 20,
              background: 'rgba(255,107,0,0.08)',
              border: '1px solid rgba(255,107,0,0.18)',
              color: '#F4F4F5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <AlertTriangle size={18} color="#ff6b00" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {copy.terms.warningTitle}
              </div>
              <div>
                {copy.terms.warning({ fields: missingLabels || copy.terms.warningFallback })}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 22,
            marginBottom: 28,
          }}
        >
          <FieldCard
            icon={Building2}
            title={copy.terms.cards.operator}
            rows={operatorRows}
            emptyLabel={copy.terms.notProvided}
          />
          <FieldCard
            icon={Mail}
            title={copy.terms.cards.contact}
            rows={contactRows}
            emptyLabel={copy.terms.notProvided}
          />
          <FieldCard
            icon={Radio}
            title={copy.terms.cards.service}
            rows={serviceRows}
            emptyLabel={copy.terms.notProvided}
          />
          <FieldCard
            icon={ShieldCheck}
            title={copy.terms.cards.billing}
            rows={billingRows}
            emptyLabel={copy.terms.notProvided}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 22,
          }}
        >
          <PolicyBlock
            title={copy.terms.sections.overviewTitle}
            body={copy.terms.sections.overviewBody}
          />
          <PolicyBlock
            title={copy.terms.sections.scopeTitle}
            body={copy.terms.sections.scopeBody}
          />
          <PolicyBlock
            title={copy.terms.sections.discordTitle}
            body={copy.terms.sections.discordBody}
          />
          <PolicyBlock
            title={copy.terms.sections.previewTitle}
            body={copy.terms.sections.previewBody}
          />
          <PolicyBlock
            title={copy.terms.sections.customStationsTitle}
            body={copy.terms.sections.customStationsBody}
          />
          <PolicyBlock
            title={copy.terms.sections.acceptableUseTitle}
            body={copy.terms.sections.acceptableUseBody}
            items={copy.terms.sections.acceptableUseItems}
          />
          <PolicyBlock
            title={copy.terms.sections.premiumTitle}
            body={copy.terms.sections.premiumBody({
              premiumCheckoutEnabled: billing.premiumCheckoutEnabled,
              paymentProvider: billing.paymentProvider,
            })}
          />
          <PolicyBlock
            title={copy.terms.sections.streamRightsTitle}
            body={copy.terms.sections.streamRightsBody}
          />
          <PolicyBlock
            title={copy.terms.sections.availabilityTitle}
            body={copy.terms.sections.availabilityBody}
          />
          <PolicyBlock
            title={copy.terms.sections.suspensionTitle}
            body={copy.terms.sections.suspensionBody}
            items={copy.terms.sections.suspensionItems}
          />
          <PolicyBlock
            title={copy.terms.sections.liabilityTitle}
            body={copy.terms.sections.liabilityBody}
          />
          <PolicyBlock
            title={copy.terms.sections.lawTitle}
            body={copy.terms.sections.lawBody({ governingLaw: contact.governingLaw || copy.terms.defaultGoverningLaw })}
          />
          <PolicyBlock
            title={copy.terms.sections.contactTitle}
            body={copy.terms.sections.contactBody({
              email: contact.email,
              website: contact.website || operator.website,
            })}
          />
        </div>

        <div
          style={{
            marginTop: 26,
            padding: '18px 20px',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#A1A1AA',
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 700, color: '#F4F4F5', marginBottom: 6 }}>
            {copy.terms.noteTitle}
          </div>
          <div>{copy.terms.note}</div>
          {terms?.customNote && (
            <div style={{ marginTop: 8, color: '#F4F4F5', whiteSpace: 'pre-line' }}>
              {terms.customNote}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            {copy.terms.basis}
          </div>
        </div>
      </div>
    </section>
  );
}

export default TermsSection;
