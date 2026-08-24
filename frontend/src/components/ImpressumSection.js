import React from 'react';
import {
  AlertTriangle,
  Building2,
  FileText,
  Mail,
  MapPin,
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

function ImpressumSection({ legal }) {
  const { copy } = useI18n();
  const legalInfo = legal?.legal || {};
  const missingCoreFields = Array.isArray(legal?.missingCoreFields) ? legal.missingCoreFields : [];
  const hasAnyAddressPart = Boolean(legalInfo.streetAddress || legalInfo.postalCode || legalInfo.city || legalInfo.country);
  const addressLines = [
    legalInfo.streetAddress,
    [legalInfo.postalCode, legalInfo.city].filter(Boolean).join(' ').trim(),
    hasAnyAddressPart ? (legalInfo.country || copy.legal.defaultCountry) : '',
  ].filter(Boolean);

  const missingLabels = missingCoreFields
    .map((field) => copy.legal.fields[field] || field)
    .filter(Boolean)
    .join(', ');

  const providerRows = [
    { label: copy.legal.fields.providerName, value: legalInfo.providerName },
    { label: copy.legal.fields.legalForm, value: legalInfo.legalForm },
    { label: copy.legal.fields.representative, value: legalInfo.representative },
    { label: copy.legal.fields.businessPurpose, value: legalInfo.businessPurpose },
    { label: copy.legal.fields.address, value: addressLines.join('\n'), multiline: true },
    { label: copy.legal.fields.website, value: legalInfo.website, kind: 'url' },
  ];

  const contactRows = [
    { label: copy.legal.fields.email, value: legalInfo.email, kind: 'email' },
    { label: copy.legal.fields.phone, value: legalInfo.phone },
    { label: copy.legal.fields.supervisoryAuthority, value: legalInfo.supervisoryAuthority },
    { label: copy.legal.fields.chamber, value: legalInfo.chamber },
    { label: copy.legal.fields.profession, value: legalInfo.profession },
    { label: copy.legal.fields.professionRules, value: legalInfo.professionRules },
  ];

  const companyRows = [
    { label: copy.legal.fields.commercialRegisterNumber, value: legalInfo.commercialRegisterNumber },
    { label: copy.legal.fields.commercialRegisterCourt, value: legalInfo.commercialRegisterCourt },
    { label: copy.legal.fields.vatId, value: legalInfo.vatId },
    ...(legalInfo.kleinunternehmer
      ? [{ label: copy.legal.vatStatusLabel, value: copy.legal.kleinunternehmerNote, multiline: true }]
      : []),
  ];

  const mediaRows = [
    { label: copy.legal.fields.mediaOwner, value: legalInfo.mediaOwner },
    { label: copy.legal.fields.editorialResponsible, value: legalInfo.editorialResponsible },
    { label: copy.legal.fields.mediaLine, value: legalInfo.mediaLine },
  ];

  return (
    <section
      id="impressum"
      data-testid="impressum-section"
      style={{
        position: 'relative',
        padding: '110px 24px 40px',
      }}
    >
      <div className="section-container" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ maxWidth: 860, marginBottom: 28 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 16px',
              borderRadius: 999,
              background: 'rgba(255,107,0,0.08)',
              border: '1px solid rgba(255,107,0,0.18)',
              color: '#ff6b00',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom: 20,
            }}
          >
            <FileText size={14} />
            {copy.legal.eyebrow}
          </div>

          <h2
            style={{
              margin: '0 0 14px',
              fontFamily: "'Syne', sans-serif",
              fontSize: 'clamp(30px, 4vw, 44px)',
              lineHeight: 1.08,
            }}
          >
            {copy.legal.title}
          </h2>

          <p
            style={{
              margin: 0,
              maxWidth: 760,
              color: '#A1A1AA',
              fontSize: 16,
              lineHeight: 1.75,
            }}
          >
            {copy.legal.subtitle}
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
                {copy.legal.warningTitle}
              </div>
              <div>
                {copy.legal.warning({ fields: missingLabels || copy.legal.warningFallback })}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 22,
          }}
        >
          <FieldCard
            icon={Building2}
            title={copy.legal.cards.provider}
            rows={providerRows}
            emptyLabel={copy.legal.notProvided}
          />
          <FieldCard
            icon={Mail}
            title={copy.legal.cards.contact}
            rows={contactRows}
            emptyLabel={copy.legal.notProvided}
          />
          <FieldCard
            icon={ShieldCheck}
            title={copy.legal.cards.company}
            rows={companyRows}
            emptyLabel={copy.legal.notProvided}
          />
          <FieldCard
            icon={MapPin}
            title={copy.legal.cards.media}
            rows={mediaRows}
            emptyLabel={copy.legal.notProvided}
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
            {copy.legal.noteTitle}
          </div>
          <div>{copy.legal.note}</div>
          <div style={{ marginTop: 8 }}>
            {copy.legal.basis}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ImpressumSection;
