import { useEffect, useState } from 'react';

// The OmniFM Activity in a Discord voice channel (#308, prototype): what
// plays in this channel, the station's logo, the song, and who listens.
// Discord opens it as https://<app>.discordsays.com/ and passes every
// request on to omnifm.xyz (URL mappings /api, /assets and / -> /activity),
// so all addresses here are relative. German or English, like the bot.

const german = /^de\b/i.test(typeof navigator === 'undefined' ? '' : navigator.language || '');
const say = (de, en) => (german ? de : en);

/** Discord starts an Activity with these parameters; without them this is a normal browser. */
export function insideDiscord(search = typeof window === 'undefined' ? '' : window.location.search) {
  const params = new URLSearchParams(search);
  return params.has('frame_id') && params.has('instance_id');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data?.error || `http_${response.status}`), { status: response.status });
  return data;
}

const MESSAGES = {
  not_in_channel: () => say('Du bist gerade nicht in diesem Sprachkanal.', 'You are not in this voice channel right now.'),
  no_guild: () => say('OmniFM ist auf diesem Server nicht.', 'OmniFM is not on this server.'),
  not_configured: () => say('Die Activity ist bei OmniFM noch nicht eingerichtet.', 'The Activity is not set up at OmniFM yet.'),
  discord_refused: () => say('Discord hat die Anmeldung nicht bestätigt. Bitte die Activity neu starten.', 'Discord did not confirm the sign-in. Please restart the Activity.'),
};
const messageFor = (error) => (MESSAGES[error?.message] || (() => say('Das hat nicht geklappt. Bitte die Activity neu starten.', 'That did not work. Please restart the Activity.')))();

function Initial({ name }) {
  return <div className="act-logo act-logo-initial" aria-hidden="true">{String(name || '?').trim().charAt(0).toUpperCase()}</div>;
}

function Stream({ stream }) {
  const [broken, setBroken] = useState(false);
  return (
    <section className="act-stream" data-testid="activity-stream">
      {stream.logoUrl && !broken
        ? <img className="act-logo" src={stream.logoUrl} alt="" onError={() => setBroken(true)} />
        : <Initial name={stream.stationName} />}
      <div className="act-stream-text">
        <div className="act-label">{stream.recovering ? say('Verbindet neu …', 'Reconnecting …') : say('Läuft gerade', 'Now playing')}</div>
        <h1 className="act-station">{stream.stationName || say('Unbekannter Sender', 'Unknown station')}</h1>
        <p className="act-song" data-testid="activity-song">{stream.song || say('Kein Songtitel vom Sender', 'No song title from the station')}</p>
        <p className="act-bot">{stream.botName}</p>
      </div>
    </section>
  );
}

function Listeners({ listeners }) {
  if (!listeners.length) return null;
  return (
    <section className="act-listeners" aria-label={say('Hört gerade zu', 'Listening now')}>
      <div className="act-label">{say('Hört gerade zu', 'Listening now')} · {listeners.length}</div>
      <ul>
        {listeners.map((listener) => (
          <li key={listener.id} data-testid="activity-listener">
            {listener.avatarUrl ? <img src={listener.avatarUrl} alt="" /> : <span className="act-avatar-initial" aria-hidden="true">{listener.name.charAt(0)}</span>}
            <span>{listener.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// One loader for the whole page: a new function every render would restart the connection.
const loadDiscordSdk = () => import('@discord/embedded-app-sdk');

/**
 * loadSdk: the Embedded App SDK, loaded only inside Discord; tests pass a stand-in.
 * @param {{ loadSdk?: () => Promise<any> }} props
 */
export default function ActivityApp({ loadSdk = loadDiscordSdk }) {
  const [phase, setPhase] = useState(() => (insideDiscord() ? 'connecting' : 'outside'));
  const [problem, setProblem] = useState('');
  const [now, setNow] = useState(null);

  useEffect(() => {
    if (phase !== 'connecting') return undefined;
    let stopped = false;
    let timer = null;
    (async () => {
      const config = await api('/api/activity/config');
      const { DiscordSDK } = await loadSdk();
      const sdk = new DiscordSDK(config.clientId);
      await sdk.ready();
      const { code } = await sdk.commands.authorize({
        client_id: config.clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify'],
      });
      const token = await api('/api/activity/token', { method: 'POST', body: JSON.stringify({ code }) });
      await sdk.commands.authenticate({ access_token: token.access_token });
      if (!sdk.guildId || !sdk.channelId) {
        if (!stopped) setPhase('no-channel');
        return;
      }
      const load = async () => {
        if (stopped) return;
        try {
          const data = await api(`/api/activity/now?guildId=${encodeURIComponent(sdk.guildId)}&channelId=${encodeURIComponent(sdk.channelId)}`, {
            headers: { Authorization: `Bearer ${token.session}` },
          });
          if (stopped) return;
          setNow(data);
          setProblem('');
          setPhase('ready');
          timer = setTimeout(load, Number(data.refreshMs) || 10_000);
        } catch (err) {
          if (stopped) return;
          setProblem(messageFor(err));
          // The session lasts an hour; after that the Activity starts over.
          if (err.status === 401) setPhase('connecting');
          else timer = setTimeout(load, 15_000);
        }
      };
      await load();
    })().catch((err) => {
      if (stopped) return;
      setProblem(messageFor(err));
      setPhase('failed');
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, loadSdk]);

  if (phase === 'outside') {
    return (
      <main className="act-page act-outside" data-testid="activity-outside">
        <h1>OmniFM</h1>
        <p>{say('Das ist die OmniFM-Activity. Sie läuft in Discord: in einem Sprachkanal auf das Raketen-Symbol tippen und OmniFM wählen.', 'This is the OmniFM Activity. It runs in Discord: tap the rocket icon in a voice channel and choose OmniFM.')}</p>
        <p><a href="https://omnifm.xyz/">omnifm.xyz</a></p>
      </main>
    );
  }

  return (
    <main className="act-page" data-testid="activity-page">
      <header className="act-header">
        <span className="act-brand">OmniFM</span>
        {now?.channelName ? <span className="act-channel">🔊 {now.channelName}</span> : null}
      </header>
      {phase === 'connecting' && !now ? <p className="act-note" data-testid="activity-connecting">{say('Verbinde mit Discord …', 'Connecting to Discord …')}</p> : null}
      {phase === 'no-channel' ? <p className="act-note">{say('Die Activity läuft nur in einem Sprachkanal.', 'The Activity only runs in a voice channel.')}</p> : null}
      {problem ? <p className="act-problem" data-testid="activity-problem">{problem}</p> : null}
      {now ? (
        <>
          {now.streams.length
            ? now.streams.map((stream) => <Stream key={`${stream.botName}-${stream.stationKey}`} stream={stream} />)
            : <p className="act-note" data-testid="activity-silent">{say('In diesem Kanal spielt OmniFM gerade nichts. Starte einen Sender mit /play.', 'OmniFM is not playing in this channel right now. Start a station with /play.')}</p>}
          <Listeners listeners={now.listeners || []} />
        </>
      ) : null}
    </main>
  );
}
