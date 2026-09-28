// OmniFM: the layout of the imprint, the privacy policy and the terms (#422).
// Only filled facts are shown, the text reads in one column with a table of
// contents, and nothing meant for the operator reaches visitors: what is
// still missing, the owner console says (#424).
import { useI18n } from '../i18n.js';
import LegalLanguageNote from './LegalLanguageNote.js';

// When the legal texts in the language files last changed; shown as "Stand".
export const LEGAL_TEXTS_UPDATED = '2026-09-28';

const filled = (value) => String(value ?? '').trim() !== '';

/** The fact groups with their empty rows left out, and empty groups too. */
export function visibleFactGroups(groups = []) {
  return groups
    .map((group) => ({ ...group, rows: (group.rows || []).filter((row) => filled(row.value)) }))
    .filter((group) => group.rows.length > 0);
}

/** "Street", "1234 City", "Country" as lines; the country only with an address. */
export function addressLines({ streetAddress, postalCode, city, country }, defaultCountry) {
  const hasAddress = [streetAddress, postalCode, city].some(filled);
  return [
    streetAddress,
    [postalCode, city].filter(filled).join(' '),
    hasAddress ? (country || defaultCountry) : '',
  ].filter(filled).join('\n');
}

function FactValue({ row }) {
  const text = String(row.value).trim();
  if (row.kind === 'email') return <a className="legal-link" href={`mailto:${text}`}>{text}</a>;
  if (row.kind === 'url') return <a className="legal-link" href={text} target="_blank" rel="noopener noreferrer">{text}</a>;
  return <span style={{ whiteSpace: row.multiline ? 'pre-line' : 'normal' }}>{text}</span>;
}

const css = `
.legal-document { position: relative; padding: 110px 24px 56px; }
.legal-inner { max-width: 880px; margin: 0 auto; position: relative; z-index: 2; }
.legal-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 999px;
  background: rgba(255,107,0,0.08); border: 1px solid rgba(255,107,0,0.18); color: #ff6b00;
  font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 20px; }
.legal-title { margin: 0 0 10px; font-family: 'Syne', sans-serif; font-size: clamp(24px, 6.5vw, 44px); line-height: 1.08; overflow-wrap: break-word; hyphens: auto; }
.legal-updated { margin: 0 0 12px; color: #8A8A93; font-size: 13px; }
.legal-subtitle { margin: 0; max-width: 720px; color: #A1A1AA; font-size: 16px; line-height: 1.75; }
.legal-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 12px 40px; margin: 36px 0 12px; }
.legal-fact-group h2, .legal-toc h2 { margin: 0 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #ff6b00; }
.legal-fact-group dl { margin: 0 0 20px; }
.legal-fact { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr); gap: 16px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
.legal-fact dt { color: #A1A1AA; font-size: 14px; }
.legal-fact dd { margin: 0; color: #F4F4F5; font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; }
.legal-link { color: #00E5FF; text-decoration: none; }
.legal-link:hover { text-decoration: underline; }
.legal-toc { margin: 28px 0 8px; padding: 18px 20px; border-radius: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); }
.legal-toc ol { margin: 8px 0 0; padding-left: 20px; columns: 2 16rem; column-gap: 32px; color: #8A8A93; }
.legal-toc li { margin: 4px 0; break-inside: avoid; }
.legal-toc a { color: #D4D4D8; text-decoration: none; font-size: 14px; line-height: 1.5; }
.legal-toc a:hover { color: #00E5FF; }
.legal-article { max-width: 720px; padding: 26px 0 4px; scroll-margin-top: 96px; }
.legal-article h2 { margin: 0 0 10px; font-family: 'Syne', sans-serif; font-size: 20px; line-height: 1.3; color: #F4F4F5; }
.legal-article p { margin: 0 0 10px; color: #D4D4D8; font-size: 15.5px; line-height: 1.8; white-space: pre-line; }
.legal-article ul { margin: 6px 0 10px; padding-left: 20px; color: #D4D4D8; font-size: 15.5px; line-height: 1.8; }
.legal-source { max-width: 720px; margin: 32px 0 0; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.07); color: #8A8A93; font-size: 13px; line-height: 1.6; }
@media (max-width: 640px) {
  .legal-fact { grid-template-columns: 1fr; gap: 2px; }
  .legal-toc ol { columns: 1; }
}
@media print {
  body { background: #fff !important; }
  body * { visibility: hidden; }
  .legal-document, .legal-document * { visibility: visible; color: #000 !important; }
  .legal-document { position: absolute; inset: 0; padding: 0; }
  .legal-toc, [data-testid="legal-language-note"] a { display: none; }
  .legal-eyebrow { border: none; background: none; padding: 0; }
  .legal-fact { border-bottom-color: #ddd; }
}
`;

/**
 * A legal page: header, the filled facts in groups, a table of contents when
 * there are more than three sections, the sections, and a small source line.
 * sections: [{ id, title, body, items }]; a section without body and items is left out.
 */
export default function LegalDocument({
  id,
  testId,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  showUpdated = false,
  page,
  facts = [],
  sections = [],
  source,
}) {
  const { copy, formatDate } = useI18n();
  const groups = visibleFactGroups(facts);
  const shown = sections.filter((section) => filled(section.body) || (section.items && section.items.length > 0));
  const updated = showUpdated
    ? copy.legalNote.updated({ date: formatDate(`${LEGAL_TEXTS_UPDATED}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' }) })
    : '';

  return (
    <section id={id} data-testid={testId} className="legal-document">
      <style>{css}</style>
      <div className="legal-inner">
        <header>
          <div className="legal-eyebrow">{Icon ? <Icon size={14} /> : null}{eyebrow}</div>
          <h1 className="legal-title">{title}</h1>
          {updated ? <p className="legal-updated" data-testid="legal-updated">{updated}</p> : null}
          {subtitle ? <p className="legal-subtitle">{subtitle}</p> : null}
          <LegalLanguageNote page={page} />
        </header>

        {groups.length > 0 && (
          <div className="legal-facts" data-testid="legal-facts">
            {groups.map((group) => (
              <div key={group.title} className="legal-fact-group">
                <h2>{group.title}</h2>
                <dl>
                  {group.rows.map((row) => (
                    <div key={row.label} className="legal-fact">
                      <dt>{row.label}</dt>
                      <dd><FactValue row={row} /></dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}

        {shown.length > 3 && (
          <nav className="legal-toc" aria-label={copy.legalNote.toc} data-testid="legal-toc">
            <h2>{copy.legalNote.toc}</h2>
            <ol>
              {shown.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}
            </ol>
          </nav>
        )}

        {shown.map((section) => (
          <article key={section.id} id={section.id} className="legal-article">
            <h2>{section.title}</h2>
            {filled(section.body) ? <p>{section.body}</p> : null}
            {section.items && section.items.length > 0 && (
              <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </article>
        ))}

        {source ? <p className="legal-source">{source}</p> : null}
      </div>
    </section>
  );
}
