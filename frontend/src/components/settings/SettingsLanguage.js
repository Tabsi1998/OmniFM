// OmniFM: server dashboard settings: the server's language (#413). Before,
// only /language set it; "automatic" follows each person's Discord language.
import { Languages } from 'lucide-react';

const LABELS = {
  auto: ['Automatisch (Discord-Sprache jeder Person)', 'Automatic (each person’s Discord language)'],
  de: ['Deutsch', 'German'],
  en: ['Englisch', 'English'],
};

export default function SettingsLanguage({ serverLanguage, setServerLanguage, t }) {
  const options = Array.isArray(serverLanguage?.options) && serverLanguage.options.length ? serverLanguage.options : ['auto', 'de', 'en'];
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
          <option key={option} value={option}>{t(...(LABELS[option] || [option, option]))}</option>
        ))}
      </select>
    </div>
  );
}
