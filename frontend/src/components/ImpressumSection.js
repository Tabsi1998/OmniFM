// OmniFM: the imprint and the disclosure (#422). Only what the owner filled
// in is shown; what is still missing, the owner console says (#424).
import { FileText } from 'lucide-react';
import { useI18n } from '../i18n.js';
import LegalDocument, { addressLines } from './LegalDocument.js';

function ImpressumSection({ legal }) {
  const { copy } = useI18n();
  const info = legal?.legal || {};
  const fields = copy.legal.fields;

  const facts = [
    {
      title: copy.legal.cards.provider,
      rows: [
        { label: fields.providerName, value: info.providerName },
        { label: fields.legalForm, value: info.legalForm },
        { label: fields.representative, value: info.representative },
        { label: fields.businessPurpose, value: info.businessPurpose },
        { label: fields.address, value: addressLines(info, copy.legal.defaultCountry), multiline: true },
        { label: fields.website, value: info.website, kind: 'url' },
      ],
    },
    {
      title: copy.legal.cards.contact,
      rows: [
        { label: fields.email, value: info.email, kind: 'email' },
        { label: fields.phone, value: info.phone },
        { label: fields.supervisoryAuthority, value: info.supervisoryAuthority },
        { label: fields.chamber, value: info.chamber },
        { label: fields.profession, value: info.profession },
        { label: fields.professionRules, value: info.professionRules },
      ],
    },
    {
      title: copy.legal.cards.company,
      rows: [
        { label: fields.commercialRegisterNumber, value: info.commercialRegisterNumber },
        { label: fields.commercialRegisterCourt, value: info.commercialRegisterCourt },
        { label: fields.vatId, value: info.vatId },
        { label: copy.legal.vatStatusLabel, value: info.kleinunternehmer ? copy.legal.kleinunternehmerNote : '' },
      ],
    },
    {
      title: copy.legal.cards.media,
      rows: [
        { label: fields.mediaOwner, value: info.mediaOwner },
        { label: fields.editorialResponsible, value: info.editorialResponsible },
        { label: fields.mediaLine, value: info.mediaLine },
      ],
    },
  ];

  return (
    <LegalDocument
      id="impressum"
      testId="impressum-section"
      icon={FileText}
      eyebrow={copy.legal.eyebrow}
      title={copy.legal.title}
      subtitle={copy.legal.subtitle}
      page="imprint"
      facts={facts}
      source={copy.legal.basis}
    />
  );
}

export default ImpressumSection;
