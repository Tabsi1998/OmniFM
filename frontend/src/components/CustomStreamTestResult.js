import { AlertTriangle, CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';

// The answer of "Stream testen" (#537) in the reader's words: what is going
// on, then what to do. The server sends only a result code and a few facts
// (HTTP status, format, bitrate); the texts live here, in every language.
const FORMAT_LABELS = { mp3: 'MP3', aac: 'AAC', opus: 'Opus', vorbis: 'Ogg Vorbis', flac: 'FLAC', ogg: 'Ogg' };
const TONES = {
  ok: { Icon: CircleCheck, color: '#4ade80', background: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.3)' },
  wait: { Icon: AlertTriangle, color: '#fbbf24', background: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.3)' },
  bad: { Icon: CircleAlert, color: '#ff8fab', background: 'rgba(255,42,95,0.10)', border: 'rgba(255,42,95,0.3)' },
};

/** { tone, title, hint } for a finished test, a refused one or one that could not run. */
export function describeStreamTest(test, t) {
  if (test.error === 'rate') return { tone: 'wait', title: t('Zu viele Tests in kurzer Zeit.', 'Too many tests in a short time.'), hint: t('Warte eine Minute und versuch es dann noch einmal.', 'Wait a minute and try again.') };
  if (test.error) return { tone: 'bad', title: t('Der Test konnte nicht laufen.', 'The test could not run.'), hint: test.error };
  const { result, httpStatus, format, bitrateKbps } = test.answer || {};
  const direct = t('Nimm die direkte Stream-Adresse des Senders.', "Use the station's direct stream address.");
  switch (result) {
    case 'playable': {
      const label = FORMAT_LABELS[format];
      const hint = label && bitrateKbps
        ? t('Format {format}, {bitrate} kbit/s.', 'Format {format}, {bitrate} kbps.', { format: label, bitrate: bitrateKbps })
        : (label ? t('Format {format}.', 'Format {format}.', { format: label }) : '');
      return { tone: 'ok', title: t('Der Stream läuft: OmniFM kann ihn abspielen.', 'The stream works: OmniFM can play it.'), hint };
    }
    case 'invalid_url':
      return { tone: 'bad', title: t('Das ist keine gültige Stream-URL.', 'That is not a valid stream URL.'), hint: t('Sie beginnt mit http:// oder https:// und enthält weder Benutzernamen noch Passwort.', 'It starts with http:// or https:// and holds no user name or password.') };
    case 'private_target':
      return { tone: 'bad', title: t('Die Adresse führt in ein privates oder lokales Netz.', 'The address leads into a private or local network.'), hint: t('OmniFM spielt nur Streams, die aus dem Internet erreichbar sind, auch nach einer Weiterleitung.', 'OmniFM only plays streams that can be reached from the internet, after a redirect too.') };
    case 'dns_failed':
      return { tone: 'bad', title: t('Der Servername wurde nicht gefunden.', 'The server name was not found.'), hint: t('Prüf die Schreibweise der Adresse.', 'Check how the address is spelled.') };
    case 'too_many_redirects':
      return { tone: 'bad', title: t('Die Adresse leitet zu oft weiter.', 'The address redirects too many times.'), hint: direct };
    case 'bad_redirect':
      return { tone: 'bad', title: t('Die Adresse leitet auf ein ungültiges Ziel weiter.', 'The address redirects to an invalid target.'), hint: direct };
    case 'unauthorized':
      return { tone: 'bad', title: t('Der Stream verlangt eine Anmeldung (HTTP 401).', 'The stream asks for a login (HTTP 401).'), hint: t('Geschützte Streams kann OmniFM nicht abspielen. Nimm eine frei zugängliche Stream-URL.', 'OmniFM cannot play protected streams. Use a freely accessible stream URL.') };
    case 'forbidden':
      return { tone: 'bad', title: t('Der Server verweigert den Zugriff (HTTP 403).', 'The server refuses access (HTTP 403).'), hint: t('Manche Sender sperren Bots oder ganze Länder. Frag beim Sender nach einer offenen Stream-URL.', 'Some stations block bots or whole countries. Ask the station for an open stream URL.') };
    case 'rate_limited':
      return { tone: 'wait', title: t('Der Server bremst gerade (HTTP 429).', 'The server is holding requests back (HTTP 429).'), hint: t('Versuch es in ein paar Minuten noch einmal.', 'Try again in a few minutes.') };
    case 'http_error':
      return Number(httpStatus) >= 500
        ? { tone: 'wait', title: t('Der Server antwortet mit HTTP {status}.', 'The server answers with HTTP {status}.', { status: httpStatus }), hint: t('Der Server hat gerade ein Problem. Versuch es später noch einmal.', 'The server has a problem right now. Try again later.') }
        : { tone: 'bad', title: t('Der Server antwortet mit HTTP {status}.', 'The server answers with HTTP {status}.', { status: httpStatus }), hint: t('Die Adresse stimmt wohl nicht mehr. Hol dir die aktuelle Stream-URL beim Sender.', 'The address is probably out of date. Get the current stream URL from the station.') };
    case 'not_audio':
      return format === 'html'
        ? { tone: 'bad', title: t('Unter der Adresse kommt eine Webseite, kein Audio.', 'The address sends a web page, not audio.'), hint: t('Das ist meist die Seite eines Web-Players. Nimm die direkte Stream-Adresse des Senders.', "That is usually a web player's page. Use the station's direct stream address.") }
        : { tone: 'bad', title: t('Unter der Adresse kommt kein Audio, das OmniFM erkennt.', 'The address sends no audio OmniFM recognises.'), hint: direct };
    case 'playlist':
      return { tone: 'bad', title: t('Das ist eine Playlist, kein direkter Stream.', 'That is a playlist, not a direct stream.'), hint: format === 'hls'
        ? t('HLS-Streams (.m3u8) spielt OmniFM nicht ab. Frag beim Sender nach einer MP3- oder AAC-Adresse.', 'OmniFM does not play HLS streams (.m3u8). Ask the station for an MP3 or AAC address.')
        : t('Öffne die Playlist-Datei (.m3u, .pls) und nimm die Stream-Adresse daraus.', 'Open the playlist file (.m3u, .pls) and use the stream address in it.') };
    case 'timeout':
      return { tone: 'wait', title: t('Der Server hat nicht rechtzeitig geantwortet.', 'The server did not answer in time.'), hint: t('Er ist vielleicht überlastet oder offline. Versuch es später noch einmal.', 'It may be overloaded or offline. Try again later.') };
    default:
      return { tone: 'bad', title: t('Der Server ist nicht erreichbar.', 'The server cannot be reached.'), hint: t('Er ist vielleicht offline, oder die Adresse stimmt nicht.', 'It may be offline, or the address is wrong.') };
  }
}

/** The live region under the form; empty until a test runs. */
export default function CustomStreamTestResult({ test, t }) {
  const content = (() => {
    if (!test) return null;
    if (test.running) {
      return <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#cbd5e1', fontSize: 13.5 }}><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} aria-hidden="true" /> {t('Stream wird getestet …', 'Testing the stream …')}</div>;
    }
    const { tone, title, hint } = describeStreamTest(test, t);
    const { Icon, color, background, border } = TONES[tone];
    return (
      <div className="oa-fade" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 12, border: `1px solid ${border}`, background }} data-testid={`guild-custom-test-${test.answer?.result || 'error'}`}>
        <Icon size={17} color={color} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={{ fontWeight: 700, color }}>{title}</div>
          {hint && <div style={{ marginTop: 3, color: '#cbd5e1', fontSize: 13, lineHeight: 1.5 }}>{hint}</div>}
        </div>
      </div>
    );
  })();
  return <div role="status" aria-live="polite" style={{ marginTop: content ? 14 : 0 }} data-testid="guild-custom-test-result">{content}</div>;
}
