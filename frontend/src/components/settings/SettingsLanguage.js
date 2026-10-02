// OmniFM: server dashboard settings: the server's language (#413). Before,
// only /language set it; "automatic" follows the server's language in
// Discord. The bot speaks the website's nine languages (#477).
import { Languages } from 'lucide-react';

// Each language by its own name, readable whatever the dashboard's language.
const NAMES = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pl: 'Polski',
  tr: 'Türkçe',
  pt: 'Português',
  nl: 'Nederlands',
};
const FALLBACK_OPTIONS = ['auto', 'de', 'en', 'fr', 'es', 'it', 'pl', 'tr', 'pt', 'nl'];

export default function SettingsLanguage({ serverLanguage, setServerLanguage, t }) {
  const options = Array.isArray(serverLanguage?.options) && serverLanguage.options.length ? serverLanguage.options : FALLBACK_OPTIONS;
  return (
    <div data-testid="settings-language" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Languages size={18} color="#00E5FF" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Sprache des Bots', 'Bot language')}</h3>
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'In dieser Sprache antwortet OmniFM auf dem Server und schreibt seine Panels. Dasselbe wie /language in Discord.',
          'The language OmniFM answers in on the server and writes its panels in. The same as /language in Discord.'
        )}
      </p>
      <select
        className="oa-input"
        data-testid="settings-language-select"
        value={serverLanguage?.current || 'auto'}
        onChange={(e) => setServerLanguage(e.target.value)}
        style={{ width: '100%', height: 40 }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === 'auto' ? t('Automatisch (die Sprache des Servers in Discord)', 'Automatic (the server’s language in Discord)') : (NAMES[option] || option)}
          </option>
        ))}
      </select>
    </div>
  );
}
