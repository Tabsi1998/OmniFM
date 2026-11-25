// OmniFM: server dashboard settings: the live announcement of OmniFM Radio (#593).
// When a show goes live, OmniFM 1 posts here with a "Listen now" button and
// edits the same message when it ends. Every plan; shown only where the server
// sees OmniFM Radio. The state stays in DashboardSettings.js.
import { AlertTriangle, Radio } from 'lucide-react';

const LIVE = '#FF2A5F';
const labelStyle = { display: 'block', fontSize: 11, color: '#8e8e97', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' };
const selectStyle = (enabled) => ({
  width: '100%',
  minWidth: 0,
  height: 40,
  padding: '0 10px',
  border: '1px solid #1A1A2E',
  background: '#050505',
  color: enabled ? '#fff' : '#3F3F46',
  boxSizing: 'border-box',
  fontSize: 13,
  textOverflow: 'ellipsis',
});

export default function SettingsRadioAnnounce({ radioAnnounce, setRadioAnnounce, t, textChannels }) {
  const { enabled, channelId, roleId, systemChannel } = radioAnnounce;
  const roles = Array.isArray(radioAnnounce.roles) ? radioAnnounce.roles : [];
  const chosenRole = roles.find((role) => role.id === roleId) || null;
  // A channel or role deleted in Discord stays chosen until someone picks another; say so.
  const channelKnown = !channelId || textChannels.some((channel) => channel.id === channelId);
  const roleKnown = !roleId || roles.some((role) => role.id === roleId);
  const missingChannel = enabled && ((!channelId && !systemChannel) || (!channelKnown && textChannels.length > 0));
  const systemLabel = systemChannel?.name
    ? t('Systemkanal (#{channel})', 'System channel (#{channel})', { channel: systemChannel.name })
    : t('Systemkanal (nicht gesetzt)', 'System channel (not set)');

  return (
    <div data-testid="radio-announce-card" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Radio size={15} color={LIVE} aria-hidden="true" />
        <strong style={{ color: '#F4F4F5', fontSize: 14 }}>{t('Live-Sendungen von OmniFM Radio ankündigen', 'Announce OmniFM Radio live shows')}</strong>
      </div>
      <p style={{ color: '#8e8e97', fontSize: 12, marginBottom: 14, lineHeight: 1.6, maxWidth: '72ch' }}>
        {t(
          'Geht eine Sendung live, schreibt OmniFM 1 eine Nachricht mit „Jetzt hören“ in diesen Kanal. Höchstens eine in zwei Stunden; wenn die Sendung endet, wird dieselbe Nachricht bearbeitet.',
          'When a show goes live, OmniFM 1 posts a message with “Listen now” in this channel. At most one in two hours; when the show ends, the same message is edited.'
        )}
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#D4D4D8', marginBottom: 12 }}>
        <input
          type="checkbox"
          data-testid="radio-announce-enabled"
          checked={enabled}
          onChange={(event) => setRadioAnnounce({ enabled: event.target.checked })}
          style={{ width: 16, height: 16, accentColor: '#10B981' }}
        />
        {t('Ankündigungen auf diesem Server', 'Announcements on this server')}
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="radio-announce-channel" style={labelStyle}>{t('Text-Channel', 'Text channel')}</label>
          <select
            id="radio-announce-channel"
            data-testid="radio-announce-channel"
            disabled={!enabled}
            value={channelId}
            onChange={(event) => setRadioAnnounce({ channelId: event.target.value })}
            style={selectStyle(enabled)}
          >
            <option value="">{systemLabel}</option>
            {!channelKnown && <option value={channelId}>{t('Gewählter Kanal (nicht gefunden)', 'Chosen channel (not found)')}</option>}
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>#{channel.name}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <label htmlFor="radio-announce-role" style={labelStyle}>{t('Rolle erwähnen', 'Mention a role')}</label>
          <select
            id="radio-announce-role"
            data-testid="radio-announce-role"
            disabled={!enabled}
            value={roleId}
            onChange={(event) => setRadioAnnounce({ roleId: event.target.value })}
            style={selectStyle(enabled)}
          >
            <option value="">{t('Keine Rolle', 'No role')}</option>
            {!roleKnown && <option value={roleId}>{t('Gewählte Rolle (nicht gefunden)', 'Chosen role (not found)')}</option>}
            {roles.map((role) => (
              <option key={role.id} value={role.id}>@{role.name}</option>
            ))}
          </select>
        </div>
      </div>

      {missingChannel && (
        <div data-testid="radio-announce-warning" role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#FBBF24', fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 3 }} aria-hidden="true" />
          {channelId
            ? t('Den gewählten Kanal gibt es nicht mehr. Wähle einen anderen, sonst kommt keine Ankündigung.', 'The chosen channel no longer exists. Choose another one, or no announcement arrives.')
            : t('Dieser Server hat keinen Systemkanal. Wähle einen Kanal, sonst kommt keine Ankündigung.', 'This server has no system channel. Choose a channel, or no announcement arrives.')}
        </div>
      )}
      {enabled && chosenRole && !chosenRole.mentionable && (
        <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#FBBF24', fontSize: 12, lineHeight: 1.6, marginBottom: 8, overflowWrap: 'anywhere' }}>
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 3 }} aria-hidden="true" />
          {t(
            '@{role} ist in Discord nicht erwähnbar. Schalte in den Rolleneinstellungen „Erlaube jedem, diese Rolle zu @erwähnen“ ein, sonst bekommt niemand einen Ping.',
            '@{role} is not mentionable in Discord. Turn on “Allow anyone to @mention this role” in its settings, or nobody gets a ping.',
            { role: chosenRole.name }
          )}
        </div>
      )}
      <p style={{ color: '#8e8e97', fontSize: 12, lineHeight: 1.6, margin: 0, maxWidth: '72ch' }}>
        {t(
          'OmniFM 1 braucht dort: Kanal ansehen, Nachrichten senden, Links einbetten. Fehlt etwas, kommt auf diesem Server keine Ankündigung.',
          'OmniFM 1 needs there: View Channel, Send Messages, Embed Links. If one is missing, this server gets no announcement.'
        )}
      </p>
    </div>
  );
}
