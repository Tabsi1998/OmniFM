// OmniFM: server dashboard settings: the voice channel status template.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { Radio } from 'lucide-react';

export default function SettingsVoiceStatus({
  t,
  updateVoiceStatusTemplate,
  voiceStatus,
  voiceStatusPreview,
  voiceStatusPreviewNoSong,
  voiceStatusTemplate,
}) {
  return (
    <div data-testid="settings-voice-status" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Radio size={18} color="#FF6B00" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Sprachkanal-Status', 'Voice channel status')}</h3>
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Der Text, den OmniFM oben im Sprachkanal anzeigt. Platzhalter werden live ersetzt; fehlt ein Wert (etwa zwischen zwei Songs), verschwindet er samt Trennzeichen. Teile in [eckigen Klammern] erscheinen nur, wenn alle Platzhalter darin einen Wert haben. Leer lassen = Standard.',
          'The text OmniFM shows at the top of the voice channel. Placeholders are filled live; a missing value (between two songs, say) disappears together with its separator. Parts in [square brackets] only show when every placeholder in them has a value. Leave empty for the default.'
        )}
      </p>
      <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Vorlage', 'Template')}</label>
      <input
        data-testid="voice-status-template-input"
        value={voiceStatusTemplate}
        maxLength={voiceStatus.maxLength || 120}
        onChange={(e) => updateVoiceStatusTemplate(e.target.value)}
        placeholder={voiceStatus.defaultTemplate}
        style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
      />
      <div data-testid="voice-status-placeholders" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 14px' }}>
        {(voiceStatus.placeholders || []).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => updateVoiceStatusTemplate(`${voiceStatusTemplate}${voiceStatusTemplate && !voiceStatusTemplate.endsWith(' ') ? ' ' : ''}{${name}}`)}
            style={{ height: 28, padding: '0 10px', border: '1px solid rgba(255,107,0,0.3)', background: 'rgba(255,107,0,0.08)', color: '#FDBA74', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace' }}
          >
            {`{${name}}`}
          </button>
        ))}
        {voiceStatusTemplate && (
          <button
            type="button"
            data-testid="voice-status-reset"
            onClick={() => updateVoiceStatusTemplate('')}
            style={{ height: 28, padding: '0 10px', border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', cursor: 'pointer', fontSize: 12 }}
          >
            {t('Standard verwenden', 'Use the default')}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Vorschau mit Song', 'Preview with a song')}</div>
          <div data-testid="voice-status-preview" style={{ marginTop: 6, fontSize: 14, color: '#fff', wordBreak: 'break-word' }}>{voiceStatusPreview}</div>
        </div>
        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Zwischen zwei Songs', 'Between two songs')}</div>
          <div data-testid="voice-status-preview-no-song" style={{ marginTop: 6, fontSize: 14, color: '#D4D4D8', wordBreak: 'break-word' }}>{voiceStatusPreviewNoSong}</div>
        </div>
      </div>
    </div>
  );
}
