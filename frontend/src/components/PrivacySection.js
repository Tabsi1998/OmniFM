import React from 'react';
import {
  AlertTriangle,
  Building2,
  HardDrive,
  Mail,
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
            background: 'rgba(0,240,255,0.08)',
            border: '1px solid rgba(0,240,255,0.18)',
          }}
        >
          <Icon size={18} color="#00F0FF" />
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
                  color: '#39FF14',
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

function PrivacySection({ legal, privacy }) {
  const { copy } = useI18n();
  const controller = privacy?.controller || {};
  const contact = privacy?.contact || {};
  const dpo = privacy?.dpo || {};
  const hosting = privacy?.hosting || {};
  const authority = privacy?.authority || {};
  const features = privacy?.features || {};
  const retention = privacy?.retention || {};
  const missingCoreFields = Array.isArray(privacy?.missingCoreFields) ? privacy.missingCoreFields : [];
  const hasAnyAddressPart = Boolean(
    controller.streetAddress || controller.postalCode || controller.city || controller.country
  );
  const addressLines = [
    controller.streetAddress,
    [controller.postalCode, controller.city].filter(Boolean).join(' ').trim(),
    hasAnyAddressPart ? (controller.country || copy.privacy.defaultCountry) : '',
  ].filter(Boolean);
  const missingLabels = missingCoreFields
    .map((field) => copy.privacy.fields[field] || field)
    .filter(Boolean)
    .join(', ');

  const controllerRows = [
    { label: copy.privacy.fields.controllerName, value: controller.name },
    { label: copy.privacy.fields.representative, value: controller.representative },
    { label: copy.privacy.fields.address, value: addressLines.join('\n'), multiline: true },
    { label: copy.privacy.fields.website, value: controller.website || legal?.legal?.website, kind: 'url' },
  ];

  const contactRows = [
    { label: copy.privacy.fields.email, value: contact.email, kind: 'email' },
    { label: copy.privacy.fields.phone, value: contact.phone },
    { label: copy.privacy.fields.dpoName, value: dpo.name },
    { label: copy.privacy.fields.dpoEmail, value: dpo.email, kind: 'email' },
  ];

  const hostingRows = [
    { label: copy.privacy.fields.hostingProvider, value: hosting.provider },
    { label: copy.privacy.fields.hostingLocation, value: hosting.location },
    { label: copy.privacy.fields.additionalRecipients, value: privacy?.additionalRecipients, multiline: true },
    { label: copy.privacy.fields.customNote, value: privacy?.customNote, multiline: true },
  ];

  const authorityRows = [
    { label: copy.privacy.fields.authorityName, value: authority.name || copy.privacy.defaultAuthorityName },
    { label: copy.privacy.fields.authorityWebsite, value: authority.website || copy.privacy.defaultAuthorityWebsite, kind: 'url' },
    { label: copy.privacy.fields.logDays, value: retention.logDays ? copy.privacy.logDaysValue({ days: retention.logDays }) : '' },
    {
      label: copy.privacy.fields.songHistory,
      value: retention.songHistoryEnabled
        ? copy.privacy.songHistoryValue({ maxEntries: retention.songHistoryMaxPerGuild || 0 })
        : copy.privacy.booleanDisabled,
    },
  ];

  return (
    <section
      id="privacy"
      data-testid="privacy-section"
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
              background: 'rgba(57,255,20,0.08)',
              border: '1px solid rgba(57,255,20,0.18)',
              color: '#39FF14',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginBottom: 20,
            }}
          >
            <ShieldCheck size={14} />
            {copy.privacy.eyebrow}
          </div>

          <h2
            style={{
              margin: '0 0 14px',
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 'clamp(30px, 4vw, 44px)',
              lineHeight: 1.08,
            }}
          >
            {copy.privacy.title}
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
            {copy.privacy.subtitle}
          </p>
        </div>

        {missingCoreFields.length > 0 && (
          <div
            style={{
              marginBottom: 28,
              padding: '18px 20px',
              borderRadius: 20,
              background: 'rgba(255,184,0,0.08)',
              border: '1px solid rgba(255,184,0,0.18)',
              color: '#F4F4F5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}
          >
            <AlertTriangle size={18} color="#FFB800" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {copy.privacy.warningTitle}
              </div>
              <div>
                {copy.privacy.warning({ fields: missingLabels || copy.privacy.warningFallback })}
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
            title={copy.privacy.cards.controller}
            rows={controllerRows}
            emptyLabel={copy.privacy.notProvided}
          />
          <FieldCard
            icon={Mail}
            title={copy.privacy.cards.contact}
            rows={contactRows}
            emptyLabel={copy.privacy.notProvided}
          />
          <FieldCard
            icon={HardDrive}
            title={copy.privacy.cards.hosting}
            rows={hostingRows}
            emptyLabel={copy.privacy.notProvided}
          />
          <FieldCard
            icon={ShieldCheck}
            title={copy.privacy.cards.authority}
            rows={authorityRows}
            emptyLabel={copy.privacy.notProvided}
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
            title={copy.privacy.sections.overviewTitle}
            body={copy.privacy.sections.overviewBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.websiteTitle}
            body={copy.privacy.sections.websiteBody({
              localeStorageKey: features.localeStorageKey || 'omnifm.web.locale',
            })}
          />
          <PolicyBlock
            title={copy.privacy.sections.cookiesTitle}
            body={copy.privacy.sections.cookiesBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.analyticsTitle}
            body={copy.privacy.sections.analyticsBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.previewTitle}
            body={copy.privacy.sections.previewBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.botTitle}
            body={copy.privacy.sections.botBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.premiumTitle}
            body={copy.privacy.sections.premiumBody({
              stripeEnabled: features.stripeEnabled,
              smtpEnabled: features.smtpEnabled,
            })}
          />
          <PolicyBlock
            title={copy.privacy.sections.integrationsTitle}
            body={copy.privacy.sections.integrationsBody({
              stripeEnabled: features.stripeEnabled,
              smtpEnabled: features.smtpEnabled,
              discordBotListEnabled: features.discordBotListEnabled,
              botsGGEnabled: features.botsGGEnabled,
              topGGEnabled: features.topGGEnabled,
              recognitionEnabled: features.recognitionEnabled,
            })}
          />
          <PolicyBlock
            title={copy.privacy.sections.retentionTitle}
            body={copy.privacy.sections.retentionBody({
              logDays: retention.logDays || 14,
              songHistoryMaxPerGuild: retention.songHistoryMaxPerGuild || 100,
            })}
          />
          <PolicyBlock
            title={copy.privacy.sections.basisTitle}
            body={copy.privacy.sections.basisBody}
          />
          <PolicyBlock
            title={copy.privacy.sections.rightsTitle}
            body={copy.privacy.sections.rightsBody}
            items={copy.privacy.sections.rightsItems}
          />
          <PolicyBlock
            title={copy.privacy.sections.contactTitle}
            body={copy.privacy.sections.contactBody({
              authorityName: authority.name || copy.privacy.defaultAuthorityName,
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
            {copy.privacy.noteTitle}
          </div>
          <div>{copy.privacy.note}</div>
          <div style={{ marginTop: 8 }}>
            {copy.privacy.basis}
          </div>
        </div>
      </div>
    </section>
  );
}

export default PrivacySection;
