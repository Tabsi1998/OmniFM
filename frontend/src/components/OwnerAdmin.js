import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  KeyRound,
  ListMusic,
  LogOut,
  RefreshCw,
  HeartPulse,
  ScrollText,
  Bot,
  Settings2,
} from 'lucide-react';
import { buildApiUrl } from '../lib/api.js';
import BrandKit from './BrandKit.js';
import OwnerConfig from './OwnerConfig.js';
import OwnerCockpit from './OwnerCockpit.js';
import {
  OWNER_AREAS,
  areaOfPage,
  pagesOfArea,
  searchOwnerPages,
  systemPartOf,
} from '../lib/ownerNavigation.js';
import {
  BROWSER_CACHE_TTL,
  Equalizer,
  PLAN_COLORS,
  readBrowserCache,
  writeBrowserCache,
} from './owner/ownerUi.js';
import OwnerOverview from './owner/OwnerOverview.js';
import OwnerMonitoring from './owner/OwnerMonitoring.js';
import OwnerStatusNotices from './owner/OwnerStatusNotices.js';
import OwnerSuggestions from './owner/OwnerSuggestions.js';
import OwnerLicenses from './owner/OwnerLicenses.js';
import OwnerStations from './owner/OwnerStations.js';
import OwnerSignIn from './owner/OwnerSignIn.js';
import OwnerArchive from './owner/OwnerArchive.js';
import OwnerAudit from './owner/OwnerAudit.js';
import OwnerActivity from './owner/OwnerActivity.js';

const TOKEN_KEY = 'omnifm_admin_token';
// Set before the Discord sign-in; on the way back the console turns the
// dashboard sign-in into an owner session (#283).
const DISCORD_PENDING_KEY = 'omnifm_owner_discord_pending';
// Changes through the owner session cookie need this header (#283).
const CSRF_HEADERS = { 'X-OmniFM-CSRF': 'owner-intent' };

// Six areas instead of fifteen tabs (#356); the pages live in lib/ownerNavigation.js.
const AREA_ICONS = {
  cockpit: HeartPulse,
  server: KeyRound,
  stations: ListMusic,
  bots: Bot,
  settings: Settings2,
  logs: ScrollText,
};

export default function OwnerAdmin() {
  const [token, setToken] = useState(() => (typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) || '' : ''));
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  // Who is signed in: { via: 'discord' | 'token', role, roleLabel, user } (#283).
  const [session, setSession] = useState(null);
  const [discordLogin, setDiscordLogin] = useState(false);

  const [section, setSection] = useState('cockpit');
  const [navQuery, setNavQuery] = useState('');
  const openPage = useCallback((pageId) => setSection(areaOfPage(pageId) ? pageId : 'cockpit'), []);
  const [overview, setOverview] = useState(null);
  const [licenses, setLicenses] = useState([]);
  const [knownGuilds, setKnownGuilds] = useState([]);
  const [stations, setStations] = useState(null);
  const [activity, setActivity] = useState([]);
  const [monitoring, setMonitoring] = useState(null);
  const [monitorLogLevel, setMonitorLogLevel] = useState('ALL');
  const [monitorLogQuery, setMonitorLogQuery] = useState('');
  const [stationList, setStationList] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveBusy, setArchiveBusy] = useState('');
  const [archiveMsg, setArchiveMsg] = useState(null);
  const [stForm, setStForm] = useState(null); // {key,name,url,tier,genre, _isNew}
  const [stTest, setStTest] = useState(null);
  const [stBusy, setStBusy] = useState(false);
  const [stMsg, setStMsg] = useState(null);
  const [stHealth, setStHealth] = useState({});
  const [stHealthSummary, setStHealthSummary] = useState(null);
  const [stHealthBusy, setStHealthBusy] = useState(false);
  const [stHealthProg, setStHealthProg] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [licQuery, setLicQuery] = useState('');
  const [licForm, setLicForm] = useState(null);
  const [licBusy, setLicBusy] = useState(false);
  const [licMsg, setLicMsg] = useState(null);

  const apiGet = useCallback(async (path, tk) => {
    const key = tk || token;
    const res = await fetch(buildApiUrl(path), { headers: key ? { 'X-Admin-Token': key } : {}, credentials: 'include', cache: 'no-store' });
    if (res.status === 401) throw new Error('unauthorized');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [token]);

  const apiSend = useCallback(async (path, method, bodyObj) => {
    const res = await fetch(buildApiUrl(path), {
      method,
      headers: { ...(token ? { 'X-Admin-Token': token } : {}), ...CSRF_HEADERS, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [token]);

  const loadStations = useCallback(async () => {
    try {
      const [list, summary] = await Promise.all([
        apiGet('/api/admin/stations/list', token),
        apiGet('/api/admin/stations', token),
      ]);
      const rows = list.stations || [];
      setStationList(rows);
      setStHealth((current) => {
        const next = { ...current };
        rows.forEach((station) => {
          if (station.key && station.health && !next[station.key]?.checking) next[station.key] = station.health;
        });
        return next;
      });
      setStHealthSummary(list.healthSummary || null);
      setStations(summary);
    } catch { /* keep */ }
  }, [apiGet, token]);

  const loadAudit = useCallback(async () => {
    try { const d = await apiGet('/api/admin/audit', token); setAuditLog(d.audit || []); } catch { /* keep */ }
  }, [apiGet, token]);

  const loadArchive = useCallback(async () => {
    try { const d = await apiGet('/api/admin/archive?limit=200', token); setArchiveRows(d.archive || []); } catch { /* keep */ }
  }, [apiGet, token]);

  const loadLicenses = useCallback(async () => {
    try {
      const [licenseData, guildData] = await Promise.all([
        apiGet('/api/admin/licenses?full=1', token),
        apiGet('/api/admin/guilds', token),
      ]);
      setLicenses(licenseData.licenses || []);
      setKnownGuilds(guildData.guilds || []);
    } catch { /* keep */ }
  }, [apiGet, token]);

  const openNewLicense = () => { setLicMsg(null); setLicForm({ _isNew: true, email: '', tier: 'pro', months: 1, seats: 1, note: '', serverId: '' }); };
  const openEditLicense = (l, keepMsg = false) => {
    if (!keepMsg) setLicMsg(null);
    setLicForm({
      _isNew: false,
      licenseKey: l.licenseKey || l.id,
      email: l.email || '',
      tier: l.plan === 'ultimate' ? 'ultimate' : 'pro',
      seats: l.seats || 1,
      note: l.note || '',
      expiresAt: l.expiresAt ? String(l.expiresAt).slice(0, 10) : '',
      linkedServerIds: l.linkedServerIds || [],
      linkedServers: l.linkedServers || [],
      newGuild: '',
      _daysLeft: l.daysLeft,
      _expired: l.expired,
    });
  };
  const closeLicForm = () => { setLicForm(null); setLicMsg(null); };

  const refreshOverview = useCallback(async () => {
    try { setOverview(await apiGet('/api/admin/overview', token)); } catch { /* Übersicht bleibt beim alten Stand */ }
  }, [apiGet, token]);

  const createLicense = async () => {
    setLicBusy(true); setLicMsg(null);
    try {
      await apiSend('/api/admin/licenses', 'POST', { email: licForm.email, tier: licForm.tier, months: Number(licForm.months) || 1, seats: Number(licForm.seats) || 1, note: licForm.note, guildId: licForm.serverId });
      setLicMsg({ ok: true, text: 'Lizenz erstellt.' }); setLicForm(null); await Promise.all([loadLicenses(), refreshOverview()]);
    } catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const patchLicense = async (patch, note) => {
    if (!licForm || !licForm.licenseKey) return;
    setLicBusy(true); setLicMsg(null);
    try {
      const d = await apiSend(`/api/admin/licenses/${encodeURIComponent(licForm.licenseKey)}`, 'PATCH', patch);
      if (d.license) openEditLicense(d.license, true);
      setLicMsg({ ok: true, text: note || 'Gespeichert.' });
      await Promise.all([loadLicenses(), refreshOverview()]);
    } catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const deleteLicense = async (key) => {
    if (typeof window !== 'undefined' && !window.confirm('Diese Lizenz aus dem aktiven Betrieb entfernen? Sie bleibt im Datenarchiv wiederherstellbar.')) return;
    setLicBusy(true); setLicMsg(null);
    try { await apiSend(`/api/admin/licenses/${encodeURIComponent(key)}`, 'DELETE'); setLicMsg({ ok: true, text: 'Lizenz archiviert und aus dem aktiven Betrieb entfernt.' }); setLicForm(null); await Promise.all([loadLicenses(), refreshOverview(), loadArchive()]); }
    catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const loadAll = useCallback(async (tk) => {
    setRefreshing(true);
    try {
      const [ov, lic, guilds, st, act] = await Promise.allSettled([
        apiGet('/api/admin/overview', tk),
        apiGet('/api/admin/licenses?full=1', tk),
        apiGet('/api/admin/guilds', tk),
        apiGet('/api/admin/stations', tk),
        apiGet('/api/admin/activity', tk),
      ]);
      if (ov.status === 'fulfilled') setOverview(ov.value);
      if (lic.status === 'fulfilled') setLicenses(lic.value.licenses || []);
      if (guilds.status === 'fulfilled') setKnownGuilds(guilds.value.guilds || []);
      if (st.status === 'fulfilled') setStations(st.value);
      if (act.status === 'fulfilled') setActivity(act.value.activity || []);
      if (ov.status === 'rejected' && ov.reason?.message === 'unauthorized') throw new Error('unauthorized');
    } finally {
      setRefreshing(false);
    }
  }, [apiGet]);

  // Session bootstrap: a Discord owner session first (#283), then the stored token.
  // A server without /api/admin/session (404) keeps the token login only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let known = null;
      try {
        const res = await fetch(buildApiUrl('/api/admin/session'), { credentials: 'include', cache: 'no-store' });
        if (res.ok) known = await res.json();
      } catch { /* offline: the token path below */ }
      if (!cancelled && known) setDiscordLogin(Boolean(known.discordLogin || known.via === 'discord'));
      // Back from Discord: turn the dashboard sign-in into an owner session.
      if (known && !known.authenticated && window.sessionStorage.getItem(DISCORD_PENDING_KEY)) {
        window.sessionStorage.removeItem(DISCORD_PENDING_KEY);
        try {
          const res = await fetch(buildApiUrl('/api/admin/session'), { method: 'POST', credentials: 'include', headers: CSRF_HEADERS });
          const data = await res.json().catch(() => ({}));
          if (res.ok) known = data;
          else if (!cancelled) setLoginErr(data.error || 'Discord-Anmeldung fehlgeschlagen.');
        } catch {
          if (!cancelled) setLoginErr('Verbindung fehlgeschlagen.');
        }
      }
      if (known?.authenticated && known.via === 'discord') {
        try {
          await loadAll('');
          if (!cancelled) { setSession(known); setAuthed(true); }
        } catch { /* the session ended in between */ }
        finally { if (!cancelled) setChecking(false); }
        return;
      }
      if (!token) { if (!cancelled) setChecking(false); return; }
      try {
        await loadAll(token);
        if (!cancelled) { setSession({ via: 'token', role: 'owner', roleLabel: 'Owner', user: null }); setAuthed(true); }
      } catch {
        if (!cancelled) { setAuthed(false); window.localStorage.removeItem(TOKEN_KEY); setToken(''); }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the saved sign-in is checked once, when the console opens
  }, []);

  // Failover history (#217): loaded when the monitoring tab opens and on demand.
  const [failoverHistory, setFailoverHistory] = useState(null);
  const loadFailoverHistory = useCallback(async () => {
    try {
      const data = await apiGet('/api/admin/failover-history?limit=100', token);
      setFailoverHistory(data.history || []);
    } catch { /* keep the last list */ }
  }, [apiGet, token]);
  useEffect(() => {
    if (authed && section === 'monitoring') loadFailoverHistory();
  }, [authed, section, loadFailoverHistory]);

  // Live monitoring poller — active only while authed AND on the monitoring tab.
  useEffect(() => {
    if (!authed || section !== 'monitoring') return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const data = await apiGet('/api/admin/monitoring', token);
        if (!stop) setMonitoring(data);
      } catch { /* keep last snapshot */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [authed, section, apiGet, token]);

  // Load section-specific data on tab open
  useEffect(() => {
    if (!authed) return;
    if (section === 'stations') loadStations();
    if (section === 'audit') loadAudit();
    if (section === 'archive') loadArchive();
  }, [authed, section, loadStations, loadAudit, loadArchive]);

  const emptyCatalogFields = { country: '', language: '', color: '', logo: '', homepage: '', seasons: [] };
  const openNewStation = () => { setStTest(null); setStMsg(null); setStForm({ key: '', name: '', url: '', tier: 'free', genre: '', ...emptyCatalogFields, _isNew: true }); };
  const openEditStation = (s) => {
    setStTest(null);
    setStMsg(null);
    setStForm({
      key: s.key, name: s.name, url: s.url, tier: s.tier, genre: s.genre || '',
      country: s.country || '', language: s.language || '', color: s.color || '', logo: s.logo || '', homepage: s.homepage || '',
      seasons: Array.isArray(s.seasons) ? s.seasons : [],
      _isNew: false,
    });
  };
  // Proposes the station colour from its logo (#267): the average of the
  // coloured pixels. Needs the logo host to allow it (CORS); otherwise the
  // owner picks the colour by hand.
  const suggestColorFromLogo = () => {
    if (!stForm?.logo) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, 24, 24);
        const { data } = context.getImageData(0, 0, 24, 24);
        let r = 0; let g = 0; let b = 0; let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, alpha] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          const spread = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
          if (alpha < 128 || spread < 40) continue; // transparent, white, black or grey
          r += pr; g += pg; b += pb; count += 1;
        }
        if (!count) { setStMsg({ ok: false, text: 'Im Logo ist keine klare Farbe – bitte selbst wählen.' }); return; }
        const hex = [r, g, b].map((value) => Math.round(value / count).toString(16).padStart(2, '0')).join('');
        setStForm((form) => ({ ...form, color: `#${hex.toUpperCase()}` }));
      } catch {
        setStMsg({ ok: false, text: 'Der Logo-Server erlaubt keinen Farbzugriff – bitte Farbe selbst wählen.' });
      }
    };
    image.onerror = () => setStMsg({ ok: false, text: 'Logo konnte nicht geladen werden.' });
    image.src = stForm.logo;
  };
  const closeStationForm = () => { setStForm(null); setStTest(null); };

  const testStationUrl = async (url) => {
    setStBusy(true); setStTest({ loading: true });
    try {
      const r = await apiSend('/api/admin/stations/test', 'POST', { url });
      setStTest(r);
    } catch (e) { setStTest({ ok: false, message: e.message }); }
    finally { setStBusy(false); }
  };

  const saveStation = async () => {
    if (!stForm) return;
    setStBusy(true); setStMsg(null);
    try {
      await apiSend('/api/admin/stations', 'POST', {
        key: stForm.key, name: stForm.name, url: stForm.url, tier: stForm.tier, genre: stForm.genre,
        country: stForm.country, language: stForm.language, color: stForm.color, logo: stForm.logo, homepage: stForm.homepage,
        seasons: stForm.seasons || [],
      });
      setStMsg({ ok: true, text: stForm._isNew ? 'Station angelegt.' : 'Station gespeichert.' });
      setStForm(null); setStTest(null);
      await loadStations();
    } catch (e) { setStMsg({ ok: false, text: e.message }); }
    finally { setStBusy(false); }
  };

  const deleteStation = async (key) => {
    if (!window.confirm(`Station "${key}" aus dem aktiven Katalog entfernen? Sie bleibt im Datenarchiv wiederherstellbar.`)) return;
    setStBusy(true);
    try { await apiSend(`/api/admin/stations/${encodeURIComponent(key)}`, 'DELETE'); setStMsg({ ok: true, text: `Station ${key} archiviert und entfernt.` }); await Promise.all([loadStations(), loadArchive()]); }
    catch (e) { setStMsg({ ok: false, text: e.message }); }
    finally { setStBusy(false); }
  };

  const restoreArchiveOperation = async (operationId) => {
    if (!window.confirm('Diesen Archivvorgang wiederherstellen? Aktive neuere Datensätze werden niemals überschrieben.')) return;
    setArchiveBusy(operationId); setArchiveMsg(null);
    try {
      const result = await apiSend(`/api/admin/archive/${encodeURIComponent(operationId)}/restore`, 'POST', {});
      setArchiveMsg({ ok: true, text: `${result.restored || 0} Datensätze wiederhergestellt.` });
      await Promise.all([loadArchive(), loadLicenses(), loadStations(), refreshOverview()]);
    } catch (e) {
      setArchiveMsg({ ok: false, text: e.message });
    } finally {
      setArchiveBusy('');
    }
  };

  // Echte Browser-Abspielbarkeit: Audio-Element laden und auf canplay/error hören.
  const probeBrowserPlayable = (url) => new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const a = new Audio();
    a.muted = true;
    a.preload = 'auto';
    let done = false;
    let timer = null;
    const cleanup = () => {
      a.removeEventListener('canplay', onOk);
      a.removeEventListener('loadeddata', onOk);
      a.removeEventListener('error', onErr);
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* noop */ }
      if (timer) clearTimeout(timer);
    };
    const finish = (ok) => { if (done) return; done = true; cleanup(); resolve(ok); };
    const onOk = () => finish(true);
    const onErr = () => finish(false);
    a.addEventListener('canplay', onOk);
    a.addEventListener('loadeddata', onOk);
    a.addEventListener('error', onErr);
    timer = setTimeout(() => finish(false), 6000);
    try { a.src = url; a.load(); } catch { finish(false); }
  });

  const probeBrowserBatch = async (items) => {
    const flags = {};
    const CONCURRENCY = 6;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const group = items.slice(i, i + CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(group.map((it) => probeBrowserPlayable(it.url)));
      group.forEach((it, gi) => { flags[it.key] = results[gi]; });
    }
    return flags;
  };

  const checkStationHealth = async (keys) => {
    // Prüft Live-Status: Discord/erreichbar serverseitig (/health) + echte
    // Browser-Abspielbarkeit per Audio-Probe direkt im Owner-Browser
    // (serverseitige Browser-Simulation ist unzuverlässig, z. B. SomaFM 403).
    const wanted = (keys && keys.length ? keys : stationList.map((s) => s.key)).filter(Boolean);
    if (!wanted.length) return;
    const urlByKey = {};
    stationList.forEach((s) => { if (s.key) urlByKey[s.key] = s.url; });
    setStHealthBusy(true);
    setStHealthProg({ done: 0, total: wanted.length });
    setStHealth((prev) => { const next = { ...prev }; wanted.forEach((k) => { next[k] = { checking: true }; }); return next; });
    try {
      let done = 0;
      for (let i = 0; i < wanted.length; i += 15) {
        const batch = wanted.slice(i, i + 15);
        // 1) Serverseitig: erreichbar + Discord-fähig.
        // eslint-disable-next-line no-await-in-loop
        const r = await apiSend('/api/admin/stations/health', 'POST', { keys: batch });
        const serverResults = r.results || {};
        // 2) Browser-Probe (nur für erreichbare Sender) – mit 24h-Cache.
        const cache = readBrowserCache();
        const nowMs = Date.now();
        const reachableItems = batch.filter((k) => serverResults[k] && serverResults[k].reachable).map((k) => ({ key: k, url: urlByKey[k] }));
        const cachedFlags = {};
        const toProbe = [];
        reachableItems.forEach((it) => {
          const c = cache[it.key];
          if (c && (nowMs - c.at) < BROWSER_CACHE_TTL && c.url === it.url) cachedFlags[it.key] = c.ok;
          else toProbe.push(it);
        });
        // eslint-disable-next-line no-await-in-loop
        const probed = await probeBrowserBatch(toProbe);
        Object.entries(probed).forEach(([k, ok]) => { cache[k] = { ok, at: nowMs, url: urlByKey[k] }; });
        writeBrowserCache(cache);
        const browserFlags = { ...cachedFlags, ...probed };
        const merged = {};
        batch.forEach((k) => {
          const sr = serverResults[k] || { reachable: false, discordOk: false, ok: false };
          merged[k] = { ...sr, browserOk: k in browserFlags ? browserFlags[k] : false };
        });
        setStHealth((prev) => ({ ...prev, ...merged }));
        done += batch.length;
        setStHealthProg({ done, total: wanted.length });
      }
    } catch (e) { setStMsg({ ok: false, text: e.message }); }
    finally { setStHealthBusy(false); setStHealthProg(null); }
  };

  const handleLogin = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setLoginErr('');
    const tk = tokenInput.trim();
    if (!tk) { setLoginErr('Bitte Owner-Token eingeben.'); return; }
    setLoggingIn(true);
    try {
      const res = await fetch(buildApiUrl('/api/admin/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tk }),
      });
      if (!res.ok) { setLoginErr('Ungültiger Owner-Token.'); setLoggingIn(false); return; }
      window.localStorage.setItem(TOKEN_KEY, tk);
      setToken(tk);
      await loadAll(tk);
      setSession({ via: 'token', role: 'owner', roleLabel: 'Owner', user: null });
      setAuthed(true);
    } catch (err) {
      setLoginErr('Verbindung fehlgeschlagen.');
    } finally {
      setLoggingIn(false);
    }
  };

  const startDiscordLogin = () => {
    window.sessionStorage.setItem(DISCORD_PENDING_KEY, '1');
    window.location.href = buildApiUrl('/api/auth/discord/login?redirect=1&nextPage=admin');
  };

  const logout = () => {
    if (session?.via === 'discord') {
      fetch(buildApiUrl('/api/admin/session'), { method: 'DELETE', credentials: 'include', headers: CSRF_HEADERS }).catch(() => {});
    }
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(''); setAuthed(false); setOverview(null); setTokenInput(''); setSession(null);
  };

  if (checking) {
    return (
      <div className="oa-root" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <Equalizer />
          <div className="oa-mono" style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.14em' }}>OWNER ENGINE LÄDT…</div>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <OwnerSignIn
        discordLogin={discordLogin}
        handleLogin={handleLogin}
        loggingIn={loggingIn}
        loginErr={loginErr}
        setTokenInput={setTokenInput}
        startDiscordLogin={startDiscordLogin}
        tokenInput={tokenInput}
      />
    );
  }

  const ov = overview || {};
  const planData = Object.entries(ov?.licenses?.byPlan || {}).map(([plan, count]) => ({
    plan: plan.charAt(0).toUpperCase() + plan.slice(1), count, fill: PLAN_COLORS[plan] || '#94a3b8',
  }));
  const stationPie = stations ? [
    { name: 'Free', value: stations.free, fill: '#64748b' },
    { name: 'Pro', value: stations.pro, fill: '#ff6b00' },
  ] : [];
  // Umsatz-Trend: echte laufende MRR flach über die letzten 6 Monate (keine erfundene Wachstumskurve).
  const mrr = ov?.revenue?.mrr || 0;
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const revenueTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    return { month: monthNames[d.getMonth()], mrr: Math.round(mrr) };
  });

  return (
    <div className="oa-root" data-testid="owner-admin">
      <aside className="oa-sidebar">
        <div className="oa-brand">
          <div className="oa-brand-logo"><img src="/brand/omnifm-mark.svg" alt="" width="28" height="28" /></div>
          <div>
            <div className="oa-display" style={{ fontSize: 18, fontWeight: 800 }}>OmniFM</div>
            <div className="oa-owner-badge">Owner Engine</div>
          </div>
        </div>
        <input
          className="oa-input"
          data-testid="admin-search"
          placeholder="Einstellung suchen …"
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        {navQuery.trim().length >= 2 && (
          <div data-testid="admin-search-results" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
            {searchOwnerPages(navQuery).map((page) => (
              <button key={page.id} className="oa-nav-btn" onClick={() => { openPage(page.id); setNavQuery(''); }} style={{ fontSize: 13 }}>
                {page.areaLabel} › {page.label}
              </button>
            ))}
            {searchOwnerPages(navQuery).length === 0 && <div className="oa-sub" style={{ padding: '4px 10px' }}>Nichts gefunden.</div>}
          </div>
        )}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {OWNER_AREAS.map((area) => {
            const Icon = AREA_ICONS[area.id] || LayoutDashboard;
            return (
              <button
                key={area.id}
                className={`oa-nav-btn ${areaOfPage(section) === area.id ? 'active' : ''}`}
                onClick={() => openPage(area.pages[0].id)}
                data-testid={`admin-nav-${area.id}`}
              >
                <Icon size={18} /> {area.label}
              </button>
            );
          })}
        </nav>
        {session && (
          <div className="oa-sub" data-testid="admin-signed-in-as" style={{ padding: '8px 10px', lineHeight: 1.4 }}>
            Angemeldet als <b>{session.user?.name || 'Owner-Token'}</b>
            <br />Rolle: {session.roleLabel || session.role}
            {session.role === 'support' && <><br />Lesen und prüfen, keine Änderungen.</>}
            {session.role === 'billing' && <><br />Lizenzen, Zahlungen und Preise.</>}
          </div>
        )}
        <button className="oa-nav-btn" onClick={logout} data-testid="admin-logout-button" style={{ color: '#ff8fab' }}>
          <LogOut size={18} /> Abmelden
        </button>
      </aside>

      <main className="oa-main">
        <div className="oa-topbar">
          <div>
            <h1 className="oa-h1 oa-display" data-testid="admin-section-title">{OWNER_AREAS.find((area) => area.id === areaOfPage(section))?.label}</h1>
            <div className="oa-sub">
              Zentrale Steuerung der OmniFM Broadcast-Plattform
              {ov?.release?.version && (
                <span data-testid="admin-release" style={{ marginLeft: 8, color: '#64748b' }}>
                  · Version {ov.release.version}{ov.release.commit && ov.release.commit !== 'unknown' ? ` (${ov.release.commit})` : ''}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="oa-onair" data-testid="admin-live-badge" style={ov?.guilds?.live ? {} : { opacity: 0.75 }}>
              <span className="oa-dot" style={{ background: ov?.guilds?.live ? '#10b981' : '#64748b' }} />
              {ov?.guilds?.live ? 'ON AIR · LIVE' : `${ov?.bots?.online ?? 0}/${ov?.bots?.configured ?? 0} Bots · Standby`}
            </span>
            <button className="oa-btn ghost" onClick={() => loadAll(token)} disabled={refreshing} data-testid="admin-refresh-button">
              <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} /> Aktualisieren
            </button>
          </div>
        </div>

        <div className="oa-mobile-nav">
          {OWNER_AREAS.map((area) => {
            const Icon = AREA_ICONS[area.id] || LayoutDashboard;
            return (
              <button key={area.id} className={`oa-nav-btn ${areaOfPage(section) === area.id ? 'active' : ''}`} style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => openPage(area.pages[0].id)} data-testid={`admin-mobile-nav-${area.id}`}>
                <Icon size={16} /> {area.label}
              </button>
            );
          })}
          <button className="oa-nav-btn" style={{ width: 'auto', whiteSpace: 'nowrap', color: '#ff8fab' }} onClick={logout} data-testid="admin-mobile-logout-button">
            <LogOut size={16} /> Abmelden
          </button>
        </div>

        {pagesOfArea(areaOfPage(section)).length > 1 && (
          <div data-testid="admin-subnav" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {pagesOfArea(areaOfPage(section)).map((page) => (
              <button
                key={page.id}
                className={`oa-btn ${section === page.id ? 'primary' : 'ghost'}`}
                onClick={() => openPage(page.id)}
                data-testid={`admin-page-${page.id}`}
                style={{ height: 32, padding: '0 12px', fontSize: 13 }}
              >
                {page.label}
              </button>
            ))}
          </div>
        )}

        {section === 'cockpit' && (
          <OwnerCockpit apiGet={apiGet} apiSend={apiSend} onOpen={openPage} />
        )}
        {section === 'overview' && (
          <OwnerOverview
            apiGet={apiGet}
            mrr={mrr}
            ov={ov}
            planData={planData}
            revenueTrend={revenueTrend}
            stationPie={stationPie}
            stations={stations}
          />
        )}

        {section === 'monitoring' && (
          <OwnerMonitoring
            failoverHistory={failoverHistory}
            loadFailoverHistory={loadFailoverHistory}
            monitorLogLevel={monitorLogLevel}
            monitorLogQuery={monitorLogQuery}
            monitoring={monitoring}
            setMonitorLogLevel={setMonitorLogLevel}
            setMonitorLogQuery={setMonitorLogQuery}
          />
        )}

        {section === 'suggestions' && <OwnerSuggestions apiGet={apiGet} apiSend={apiSend} />}

        {section === 'statusPage' && (
          <OwnerStatusNotices apiGet={apiGet} apiSend={apiSend} />
        )}

        {section === 'licenses' && (
          <OwnerLicenses
            closeLicForm={closeLicForm}
            createLicense={createLicense}
            deleteLicense={deleteLicense}
            knownGuilds={knownGuilds}
            licBusy={licBusy}
            licForm={licForm}
            licMsg={licMsg}
            licQuery={licQuery}
            licenses={licenses}
            openEditLicense={openEditLicense}
            openNewLicense={openNewLicense}
            patchLicense={patchLicense}
            setLicForm={setLicForm}
            setLicQuery={setLicQuery}
          />
        )}

        {section === 'stations' && stations && (
          <OwnerStations
            checkStationHealth={checkStationHealth}
            closeStationForm={closeStationForm}
            deleteStation={deleteStation}
            openEditStation={openEditStation}
            openNewStation={openNewStation}
            saveStation={saveStation}
            setStForm={setStForm}
            setStMsg={setStMsg}
            setStTest={setStTest}
            stBusy={stBusy}
            stForm={stForm}
            stHealth={stHealth}
            stHealthBusy={stHealthBusy}
            stHealthProg={stHealthProg}
            stHealthSummary={stHealthSummary}
            stMsg={stMsg}
            stTest={stTest}
            stationList={stationList}
            stations={stations}
            suggestColorFromLogo={suggestColorFromLogo}
            testStationUrl={testStationUrl}
          />
        )}

        {section === 'archive' && (
          <OwnerArchive
            archiveBusy={archiveBusy}
            archiveMsg={archiveMsg}
            archiveRows={archiveRows}
            loadArchive={loadArchive}
            restoreArchiveOperation={restoreArchiveOperation}
          />
        )}

        {section === 'audit' && (
          <OwnerAudit auditLog={auditLog} />
        )}

        {section === 'activity' && (
          <OwnerActivity activity={activity} />
        )}
        {(systemPartOf(section) || ['company', 'plans', 'discord', 'marketing', 'access', 'discordShop', 'charts', 'seasons'].includes(section)) && (
          <OwnerConfig section={systemPartOf(section) ? 'system' : section} part={systemPartOf(section)} apiGet={apiGet} apiSend={apiSend} token={token} />
        )}
        {section === 'brand' && (
          <div data-testid="owner-brand-kit"><BrandKit embedded /></div>
        )}
      </main>
    </div>
  );
}
