// OmniFM: the privacy policy (#422, #423). The facts come from the owner's
// company data; only what is filled in is shown. The text says what OmniFM
// does with data in everyday words, including transfers outside the EU.
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n.js';
import LegalDocument, { addressLines } from './LegalDocument.js';

function PrivacySection({ legal, privacy }) {
  const { copy } = useI18n();
  const text = copy.privacy;
  const fields = text.fields;
  const sections = text.sections;
  const controller = privacy?.controller || {};
  const contact = privacy?.contact || {};
  const dpo = privacy?.dpo || {};
  const hosting = privacy?.hosting || {};
  const authority = privacy?.authority || {};
  const features = privacy?.features || {};
  const retention = privacy?.retention || {};

  const facts = [
    {
      title: text.cards.controller,
      rows: [
        { label: fields.controllerName, value: controller.name },
        { label: fields.representative, value: controller.representative },
        { label: fields.address, value: addressLines(controller, text.defaultCountry), multiline: true },
        { label: fields.website, value: controller.website || legal?.legal?.website, kind: 'url' },
      ],
    },
    {
      title: text.cards.contact,
      rows: [
        { label: fields.email, value: contact.email, kind: 'email' },
        { label: fields.phone, value: contact.phone },
        { label: fields.dpoName, value: dpo.name },
        { label: fields.dpoEmail, value: dpo.email, kind: 'email' },
      ],
    },
    {
      title: text.cards.hosting,
      rows: [
        { label: fields.hostingProvider, value: hosting.provider },
        { label: fields.hostingLocation, value: hosting.location },
        { label: fields.additionalRecipients, value: privacy?.additionalRecipients, multiline: true },
      ],
    },
    {
      title: sections.retentionTitle,
      rows: [
        { label: fields.logDays, value: retention.logDays ? text.logDaysValue({ days: retention.logDays }) : '' },
        {
          label: fields.songHistory,
          value: retention.songHistoryEnabled === false
            ? text.booleanDisabled
            : text.songHistoryValue({ maxEntries: retention.songHistoryMaxPerGuild || 100 }),
        },
      ],
    },
    {
      title: text.cards.authority,
      rows: [
        { label: fields.authorityName, value: authority.name || text.defaultAuthorityName },
        { label: fields.authorityWebsite, value: authority.website || text.defaultAuthorityWebsite, kind: 'url' },
      ],
    },
  ];

  const blocks = [
    ['overview', sections.overviewTitle, sections.overviewBody],
    ['website', sections.websiteTitle, sections.websiteBody({ localeStorageKey: features.localeStorageKey || 'omnifm.web.locale' })],
    ['cookies', sections.cookiesTitle, sections.cookiesBody],
    ['analytics', sections.analyticsTitle, sections.analyticsBody],
    ['preview', sections.previewTitle, sections.previewBody],
    ['bot', sections.botTitle, sections.botBody],
    ['charts', sections.chartsTitle, sections.chartsBody],
    ['year-review', sections.yearReviewTitle, sections.yearReviewBody],
    ['suggestions', sections.suggestionsTitle, sections.suggestionsBody],
    ['saved-songs', sections.savedSongsTitle, sections.savedSongsBody],
    ['my-data', sections.selfServiceTitle, sections.selfServiceBody],
    ['premium', sections.premiumTitle, sections.premiumBody({ smtpEnabled: features.smtpEnabled })],
    ['recipients', sections.integrationsTitle, sections.integrationsBody({
      smtpEnabled: features.smtpEnabled,
      discordBotListEnabled: features.discordBotListEnabled,
      botsGGEnabled: features.botsGGEnabled,
      topGGEnabled: features.topGGEnabled,
      recognitionEnabled: features.recognitionEnabled,
    })],
    ['transfers', sections.transfersTitle, sections.transfersBody],
    ['retention', sections.retentionTitle, sections.retentionBody({
      logDays: retention.logDays || 14,
      songHistoryMaxPerGuild: retention.songHistoryMaxPerGuild || 100,
    })],
    ['basis', sections.basisTitle, sections.basisBody],
    ['voluntary', sections.voluntaryTitle, sections.voluntaryBody],
    ['rights',sections.rightsTitle, sections.rightsBody, sections.rightsItems],
    ['contact', sections.contactTitle, sections.contactBody({ authorityName: authority.name || text.defaultAuthorityName })],
    ['note', fields.customNote, privacy?.customNote || ''],
  ].map(([key, title, body, items]) => ({ id: `privacy-${key}`, title, body, items }));

  return (
    <LegalDocument
      id="privacy"
      testId="privacy-section"
      icon={ShieldCheck}
      eyebrow={text.eyebrow}
      title={text.title}
      subtitle={text.subtitle}
      showUpdated
      page="privacy"
      facts={facts}
      sections={blocks}
      source={text.basis}
    />
  );
}

export default PrivacySection;
