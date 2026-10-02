// OmniFM: an address the website does not have (#487). The server answers
// it with 404 (build/404.html); here the visitor learns why and finds the way
// back, instead of a copy of the start page that search engines would index.
import { useI18n } from '../i18n.js';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section data-testid="not-found-page" style={{ padding: '140px 24px 100px', textAlign: 'center' }}>
      <div className="section-container" style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: '0.2em', color: '#ff8fab', marginBottom: 12 }}>404</div>
        <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 'clamp(28px,5vw,44px)', marginBottom: 16 }}>{t('Seite nicht gefunden', 'Page not found')}</h1>
        <p style={{ color: '#cbd5e1', fontSize: 16, lineHeight: 1.7, marginBottom: 28 }}>
          {t('Diese Adresse gibt es auf OmniFM nicht. Vielleicht hat sich ein Tippfehler eingeschlichen, oder die Seite ist umgezogen.', 'This address does not exist on OmniFM. Maybe a typo slipped in, or the page has moved.')}
        </p>
        <a
          href="/"
          data-testid="not-found-home"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '15px 30px', borderRadius: 14, background: 'linear-gradient(135deg, #ff6b00, #ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 15 }}
        >
          {t('Zur Startseite', 'To the start page')}
        </a>
      </div>
    </section>
  );
}
