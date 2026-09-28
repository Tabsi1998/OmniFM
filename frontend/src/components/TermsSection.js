// OmniFM: the terms of service (#422). Who offers OmniFM and the rules, in
// one readable column. Technical switches ("premium checkout: not active")
// are not terms and are not shown; what counts is said in the sections.
import { ScrollText } from 'lucide-react';
import { useI18n } from '../i18n.js';
import LegalDocument from './LegalDocument.js';

function TermsSection({ terms }) {
  const { copy } = useI18n();
  const text = copy.terms;
  const fields = text.fields;
  const sections = text.sections;
  const operator = terms?.operator || {};
  const contact = terms?.contact || {};

  const facts = [
    {
      title: text.cards.operator,
      rows: [
        { label: fields.providerName, value: operator.providerName },
        { label: fields.representative, value: operator.representative },
        { label: fields.businessPurpose, value: operator.businessPurpose },
        { label: fields.website, value: operator.website, kind: 'url' },
      ],
    },
    {
      title: text.cards.contact,
      rows: [
        { label: fields.contactEmail, value: contact.email, kind: 'email' },
        { label: fields.supportWebsite, value: contact.website, kind: 'url' },
        { label: fields.effectiveDate, value: contact.effectiveDate },
        { label: fields.governingLaw, value: contact.governingLaw },
      ],
    },
  ];

  const blocks = [
    ['overview', sections.overviewTitle, sections.overviewBody],
    ['scope', sections.scopeTitle, sections.scopeBody],
    ['discord', sections.discordTitle, sections.discordBody],
    ['preview', sections.previewTitle, sections.previewBody],
    ['custom-stations', sections.customStationsTitle, sections.customStationsBody],
    ['acceptable-use', sections.acceptableUseTitle, sections.acceptableUseBody, sections.acceptableUseItems],
    ['premium', sections.premiumTitle, sections.premiumBody()],
    ['stream-rights', sections.streamRightsTitle, sections.streamRightsBody],
    ['availability', sections.availabilityTitle, sections.availabilityBody],
    ['suspension', sections.suspensionTitle, sections.suspensionBody, sections.suspensionItems],
    ['liability', sections.liabilityTitle, sections.liabilityBody],
    ['law', sections.lawTitle, sections.lawBody({ governingLaw: contact.governingLaw || text.defaultGoverningLaw })],
    ['contact', sections.contactTitle, sections.contactBody({ email: contact.email, website: contact.website || operator.website })],
    ['note', copy.privacy.fields.customNote, terms?.customNote || ''],
  ].map(([key, title, body, items]) => ({ id: `terms-${key}`, title, body, items }));

  return (
    <LegalDocument
      id="terms"
      testId="terms-section"
      icon={ScrollText}
      eyebrow={text.eyebrow}
      title={text.title}
      subtitle={text.subtitle}
      showUpdated
      page="terms"
      facts={facts}
      sections={blocks}
      source={text.basis}
    />
  );
}

export default TermsSection;
