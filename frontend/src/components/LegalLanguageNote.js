// OmniFM: above the imprint, the privacy policy and the terms in every
// language but German: only the German version is binding (#306).
import { useI18n } from '../i18n.js';
import { buildPageHref } from '../lib/pageRouting.js';

export default function LegalLanguageNote({ page }) {
  const { copy, locale } = useI18n();
  if (locale === 'de') return null;
  return (
    <p
      data-testid="legal-language-note"
      style={{ margin: '14px 0 0', maxWidth: 760, color: '#71717A', fontSize: 14, lineHeight: 1.6 }}
    >
      {copy.legalNote.text}{' '}
      <a href={buildPageHref('de', page)} style={{ color: '#00E5FF' }}>{copy.legalNote.link}</a>
    </p>
  );
}
