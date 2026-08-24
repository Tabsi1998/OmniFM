import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';

const PlayerCtx = createContext(null);
export const usePlayer = () => useContext(PlayerCtx) || {};

// Übersetzt HTML5-Media-Fehlercodes in eine verständliche Meldung.
// Wichtigster Fall: Code 4 (SRC_NOT_SUPPORTED) = Stream lehnt Browser-Zugriff
// ab (z. B. 403/Hotlink-Schutz). Läuft im Discord-Bot trotzdem.
// Sprache folgt dem Browser (wie die restliche Website – kein Umschalter).
function isGermanLocale() {
  if (typeof navigator === 'undefined') return false;
  const lang = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return String(lang).toLowerCase().startsWith('de');
}

function describeAudioError(mediaError) {
  const code = mediaError && mediaError.code;
  const de = isGermanLocale();
  if (code === 4) return { code, browserBlocked: true, message: de ? 'Dieser Sender lässt sich im Browser nicht abspielen (im Discord-Bot funktioniert er weiterhin).' : "This station can't be played in the browser (it still works in the Discord bot)." };
  if (code === 2) return { code, browserBlocked: false, message: de ? 'Netzwerkfehler beim Laden des Streams.' : 'Network error while loading the stream.' };
  if (code === 3) return { code, browserBlocked: false, message: de ? 'Stream konnte nicht dekodiert werden.' : 'The stream could not be decoded.' };
  return { code: code || 0, browserBlocked: false, message: de ? 'Wiedergabe fehlgeschlagen.' : 'Playback failed.' };
}

// Globaler Radio-Player: EIN Audio-Element für die ganze Seite, damit
// StationBrowser, NowPlayingBar und Hero denselben Live-Stream steuern/anzeigen.
export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const [current, setCurrent] = useState(null); // {key,name,url,tier}
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null); // {code,message,browserBlocked} | null
  const [volume, setVolumeState] = useState(80);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'none';
    a.crossOrigin = 'anonymous';
    a.addEventListener('playing', () => { setPlaying(true); setLoading(false); setError(null); });
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('waiting', () => setLoading(true));
    a.addEventListener('error', () => { setPlaying(false); setLoading(false); setError(describeAudioError(a.error)); });
    audioRef.current = a;
    return () => { try { a.pause(); a.src = ''; } catch { /* noop */ } };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume / 100;
  }, [volume, muted]);

  const play = useCallback((station) => {
    const a = audioRef.current;
    if (!a || !station || !station.url) return;
    if (current && current.key === station.key && playing) { a.pause(); return; }
    setError(null);
    setCurrent(station);
    setLoading(true);
    a.src = station.url;
    a.volume = muted ? 0 : volume / 100;
    a.play().then(() => { setPlaying(true); setLoading(false); }).catch(() => { setPlaying(false); setLoading(false); });
  }, [current, playing, muted, volume]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (playing) { a.pause(); return; }
    setError(null);
    setLoading(true);
    a.play().then(() => { setPlaying(true); setLoading(false); }).catch(() => { setLoading(false); });
  }, [playing, current]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); try { a.src = ''; } catch { /* noop */ } }
    setPlaying(false);
    setLoading(false);
    setError(null);
    setCurrent(null);
  }, []);

  const setVolume = useCallback((v) => { setVolumeState(v); if (Number(v) > 0 && muted) setMuted(false); }, [muted]);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return (
    <PlayerCtx.Provider value={{ current, playing, loading, error, volume, muted, play, toggle, stop, setVolume, toggleMute }}>
      {children}
    </PlayerCtx.Provider>
  );
}
