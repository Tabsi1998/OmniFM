import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio, LayoutDashboard, Server, KeyRound, ListMusic, PlugZap, Activity as ActivityIcon,
  LogOut, ShieldCheck, TrendingUp, Users, Cpu, RefreshCw, CheckCircle2, XCircle,
  Music2, Globe, CreditCard, Mail, Database, Fingerprint, AlertTriangle,
  Radar, Terminal, Gauge, HeartPulse, Plus, Pencil, Trash2, Save, ScrollText, SignalHigh, X as CloseIcon, Palette,
  Building2, Tag, Bot, Megaphone,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { buildApiUrl } from '../lib/api.js';
import BrandKit from './BrandKit.js';
import OwnerConfig from './OwnerConfig.js';

const TOKEN_KEY = 'omnifm_admin_token';

const NAV = [
  { id: 'overview', label: 'Global Overview', icon: LayoutDashboard },
  { id: 'monitoring', label: 'Live-Monitoring', icon: Radar },
  { id: 'company', label: 'Unternehmen & Recht', icon: Building2 },
  { id: 'plans', label: 'Pläne & Preise', icon: Tag },
  { id: 'discord', label: 'Discord & Bots', icon: Bot },
  { id: 'payments', label: 'Zahlungen', icon: CreditCard },
  { id: 'marketing', label: 'Marketing & Listings', icon: Megaphone },
  { id: 'workers', label: 'Worker Nodes', icon: Server },
  { id: 'licenses', label: 'License Manager', icon: KeyRound },
  { id: 'stations', label: 'Radio Catalog', icon: ListMusic },
  { id: 'integrations', label: 'Integrations', icon: PlugZap },
  { id: 'activity', label: 'Activity Log', icon: ActivityIcon },
  { id: 'audit', label: 'Audit-Log', icon: ScrollText },
  { id: 'brand', label: 'Brand Kit', icon: Palette },
];

const PLAN_COLORS = { free: '#64748b', pro: '#00e5ff', ultimate: '#ff6b00' };

// Browser-Abspielbarkeit pro Sender cachen, damit der 120-Sender-Check nicht
// jedes Mal alles neu ~2 Min probt. Key + URL + Zeitstempel; 24h gültig.
const BROWSER_CACHE_KEY = 'omnifm_browser_playable_v1';
const BROWSER_CACHE_TTL = 24 * 3600 * 1000;
function readBrowserCache() {
  try { return JSON.parse(window.localStorage.getItem(BROWSER_CACHE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeBrowserCache(cache) {
  try { window.localStorage.setItem(BROWSER_CACHE_KEY, JSON.stringify(cache)); } catch { /* noop */ }
}

function Equalizer() {
  return (
    <span className="oa-eq" aria-hidden="true">
      <span /><span /><span /><span /><span />
    </span>
  );
}

function fmtMoney(v, cur = 'EUR') {
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `${Math.round(v || 0)} ${cur}`; }
}
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return '—'; }
}
function relTime(v) {
  if (!v) return '';
  const d = (Date.now() - new Date(v).getTime()) / 1000;
  if (d < 60) return 'gerade eben';
  if (d < 3600) return `vor ${Math.floor(d / 60)} Min`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} Std`;
  return `vor ${Math.floor(d / 86400)} Tagen`;
}

function fmtUptime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatTile({ label, value, foot, icon: Icon, accent = '#ff6b00', testid }) {
  return (
    <div className="oa-card hoverable oa-fade" data-testid={testid}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="oa-stat-label">{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${accent}1f`, color: accent }}>
          <Icon size={17} />
        </div>
      </div>
      <div className="oa-stat-value">{value}</div>
      {foot && <div className="oa-stat-foot">{foot}</div>}
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#0e111a', border: '1px solid #2a3450', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <b>{p.value}</b></div>
      ))}
    </div>
  );
}

export default function OwnerAdmin() {
  const [token, setToken] = useState(() => (typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) || '' : ''));
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tokenInput, setTokenInput] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [section, setSection] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [stations, setStations] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [activity, setActivity] = useState([]);
  const [monitoring, setMonitoring] = useState(null);
  const [stationList, setStationList] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [stForm, setStForm] = useState(null); // {key,name,url,tier,genre, _isNew}
  const [stTest, setStTest] = useState(null);
  const [stBusy, setStBusy] = useState(false);
  const [stMsg, setStMsg] = useState(null);
  const [stHealth, setStHealth] = useState({});
  const [stHealthBusy, setStHealthBusy] = useState(false);
  const [stHealthProg, setStHealthProg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [licQuery, setLicQuery] = useState('');
  const [licForm, setLicForm] = useState(null);
  const [licBusy, setLicBusy] = useState(false);
  const [licMsg, setLicMsg] = useState(null);

  const apiGet = useCallback(async (path, tk) => {
    const res = await fetch(buildApiUrl(path), { headers: { 'X-Admin-Token': tk || token }, cache: 'no-store' });
    if (res.status === 401) throw new Error('unauthorized');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [token]);

  const apiSend = useCallback(async (path, method, bodyObj) => {
    const res = await fetch(buildApiUrl(path), {
      method,
      headers: { 'X-Admin-Token': token, 'Content-Type': 'application/json' },
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
      setStationList(list.stations || []);
      setStations(summary);
    } catch { /* keep */ }
  }, [apiGet, token]);

  const loadAudit = useCallback(async () => {
    try { const d = await apiGet('/api/admin/audit', token); setAuditLog(d.audit || []); } catch { /* keep */ }
  }, [apiGet, token]);

  const loadLicenses = useCallback(async () => {
    try { const d = await apiGet('/api/admin/licenses?full=1', token); setLicenses(d.licenses || []); } catch { /* keep */ }
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
      newGuild: '',
      _daysLeft: l.daysLeft,
      _expired: l.expired,
    });
  };
  const closeLicForm = () => { setLicForm(null); setLicMsg(null); };

  const createLicense = async () => {
    setLicBusy(true); setLicMsg(null);
    try {
      await apiSend('/api/admin/licenses', 'POST', { email: licForm.email, tier: licForm.tier, months: Number(licForm.months) || 1, seats: Number(licForm.seats) || 1, note: licForm.note, guildId: licForm.serverId });
      setLicMsg({ ok: true, text: 'Lizenz erstellt.' }); setLicForm(null); await loadLicenses();
    } catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const patchLicense = async (patch, note) => {
    if (!licForm || !licForm.licenseKey) return;
    setLicBusy(true); setLicMsg(null);
    try {
      const d = await apiSend(`/api/admin/licenses/${encodeURIComponent(licForm.licenseKey)}`, 'PATCH', patch);
      if (d.license) openEditLicense(d.license, true);
      setLicMsg({ ok: true, text: note || 'Gespeichert.' });
      await loadLicenses();
    } catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const deleteLicense = async (key) => {
    if (typeof window !== 'undefined' && !window.confirm('Diese Lizenz wirklich unwiderruflich löschen?')) return;
    setLicBusy(true); setLicMsg(null);
    try { await apiSend(`/api/admin/licenses/${encodeURIComponent(key)}`, 'DELETE'); setLicMsg({ ok: true, text: 'Lizenz gelöscht.' }); setLicForm(null); await loadLicenses(); }
    catch (e) { setLicMsg({ ok: false, text: e.message }); } finally { setLicBusy(false); }
  };

  const loadAll = useCallback(async (tk) => {
    setRefreshing(true);
    try {
      const [ov, wk, lic, st, integ, act] = await Promise.allSettled([
        apiGet('/api/admin/overview', tk),
        apiGet('/api/admin/workers', tk),
        apiGet('/api/admin/licenses?full=1', tk),
        apiGet('/api/admin/stations', tk),
        apiGet('/api/admin/integrations', tk),
        apiGet('/api/admin/activity', tk),
      ]);
      if (ov.status === 'fulfilled') setOverview(ov.value);
      if (wk.status === 'fulfilled') setWorkers(wk.value.workers || []);
      if (lic.status === 'fulfilled') setLicenses(lic.value.licenses || []);
      if (st.status === 'fulfilled') setStations(st.value);
      if (integ.status === 'fulfilled') setIntegrations(integ.value);
      if (act.status === 'fulfilled') setActivity(act.value.activity || []);
      if (ov.status === 'rejected' && ov.reason?.message === 'unauthorized') throw new Error('unauthorized');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [apiGet]);

  // Session bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setChecking(false); return; }
      try {
        setLoading(true);
        await loadAll(token);
        if (!cancelled) { setAuthed(true); }
      } catch {
        if (!cancelled) { setAuthed(false); window.localStorage.removeItem(TOKEN_KEY); setToken(''); }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
  }, [authed, section, loadStations, loadAudit]);

  const openNewStation = () => { setStTest(null); setStMsg(null); setStForm({ key: '', name: '', url: '', tier: 'free', genre: '', _isNew: true }); };
  const openEditStation = (s) => { setStTest(null); setStMsg(null); setStForm({ key: s.key, name: s.name, url: s.url, tier: s.tier, genre: s.genre || '', _isNew: false }); };
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
      await apiSend('/api/admin/stations', 'POST', { key: stForm.key, name: stForm.name, url: stForm.url, tier: stForm.tier, genre: stForm.genre });
      setStMsg({ ok: true, text: stForm._isNew ? 'Station angelegt.' : 'Station gespeichert.' });
      setStForm(null); setStTest(null);
      await loadStations();
    } catch (e) { setStMsg({ ok: false, text: e.message }); }
    finally { setStBusy(false); }
  };

  const deleteStation = async (key) => {
    if (!window.confirm(`Station "${key}" wirklich löschen?`)) return;
    setStBusy(true);
    try { await apiSend(`/api/admin/stations/${encodeURIComponent(key)}`, 'DELETE'); setStMsg({ ok: true, text: `Station ${key} gelöscht.` }); await loadStations(); }
    catch (e) { setStMsg({ ok: false, text: e.message }); }
    finally { setStBusy(false); }
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
      setLoading(true);
      await loadAll(tk);
      setAuthed(true);
    } catch (err) {
      setLoginErr('Verbindung fehlgeschlagen.');
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(''); setAuthed(false); setOverview(null); setTokenInput('');
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
      <div className="oa-root">
        <div className="oa-login">
          <form className="oa-login-card oa-fade" onSubmit={handleLogin} data-testid="admin-login-form">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <div className="oa-brand-logo"><Radio size={20} /></div>
              <div>
                <div className="oa-display" style={{ fontSize: 20, fontWeight: 800 }}>OmniFM</div>
                <div className="oa-owner-badge">Super-Admin / Owner Engine</div>
              </div>
            </div>
            <h1 className="oa-display" style={{ fontSize: 22, marginTop: 18 }}>Owner Console</h1>
            <p style={{ color: '#94a3b8', fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
              Zugriff nur mit dem Owner-Token (<span className="oa-mono">API_ADMIN_TOKEN</span>).
            </p>
            <div style={{ marginTop: 20 }}>
              <label className="oa-stat-label" htmlFor="oa-token">Owner Token</label>
              <input
                id="oa-token" type="password" className="oa-input" style={{ marginTop: 8 }}
                placeholder="••••••••••••••••" value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                data-testid="admin-token-input" autoFocus
              />
            </div>
            {loginErr && (
              <div className="oa-pill red" style={{ marginTop: 14 }} data-testid="admin-login-error">
                <AlertTriangle size={13} /> {loginErr}
              </div>
            )}
            <button type="button" onClick={handleLogin} className="oa-btn primary" style={{ width: '100%', marginTop: 20 }} disabled={loggingIn} data-testid="admin-login-button">
              {loggingIn ? 'Verbinde…' : <><ShieldCheck size={16} /> Anmelden</>}
            </button>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <a href="/" className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>← Zurück zur Website</a>
            </div>
          </form>
        </div>
      </div>
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
          <div className="oa-brand-logo"><Radio size={20} /></div>
          <div>
            <div className="oa-display" style={{ fontSize: 18, fontWeight: 800 }}>OmniFM</div>
            <div className="oa-owner-badge">Owner Engine</div>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`oa-nav-btn ${section === n.id ? 'active' : ''}`}
              onClick={() => setSection(n.id)}
              data-testid={`admin-nav-${n.id}`}
            >
              <n.icon size={18} /> {n.label}
            </button>
          ))}
        </nav>
        <button className="oa-nav-btn" onClick={logout} data-testid="admin-logout-button" style={{ color: '#ff8fab' }}>
          <LogOut size={18} /> Abmelden
        </button>
      </aside>

      <main className="oa-main">
        <div className="oa-topbar">
          <div>
            <h1 className="oa-h1 oa-display" data-testid="admin-section-title">{NAV.find((n) => n.id === section)?.label}</h1>
            <div className="oa-sub">Zentrale Steuerung der OmniFM Broadcast-Plattform</div>
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
          {NAV.map((n) => (
            <button key={n.id} className={`oa-nav-btn ${section === n.id ? 'active' : ''}`} style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setSection(n.id)} data-testid={`admin-mobile-nav-${n.id}`}>
              <n.icon size={16} /> {n.label}
            </button>
          ))}
          <button className="oa-nav-btn" style={{ width: 'auto', whiteSpace: 'nowrap', color: '#ff8fab' }} onClick={logout} data-testid="admin-mobile-logout-button">
            <LogOut size={16} /> Abmelden
          </button>
        </div>

        {section === 'overview' && (
          <>
            <div className="oa-grid cols-4">
              <StatTile testid="stat-licenses" label="Aktive Lizenzen" value={ov?.licenses?.active ?? '—'} icon={KeyRound} accent="#00e5ff"
                foot={<span><b>{ov?.licenses?.seatsSold ?? 0}</b> Seats verkauft · {ov?.licenses?.expired ?? 0} abgelaufen</span>} />
              <StatTile testid="stat-mrr" label="MRR" value={fmtMoney(mrr)} icon={TrendingUp} accent="#10b981"
                foot={<span className="oa-trend-up"><TrendingUp size={13} /> {fmtMoney(ov?.revenue?.arr)} ARR</span>} />
              <StatTile testid="stat-guilds" label="Verwaltete Server" value={ov?.guilds?.managed ?? '—'} icon={Users} accent="#00e5ff"
                foot={<span>{ov?.bots?.online ?? 0}/{ov?.bots?.configured ?? 0} Bots online{ov?.guilds?.live === false ? ' · Bot offline' : ''}</span>} />
              <StatTile testid="stat-stations" label="Radio-Stationen" value={ov?.stations?.total ?? '—'} icon={Music2} accent="#ff6b00"
                foot={<span>{ov?.stations?.free ?? 0} Free · {ov?.stations?.pro ?? 0} Pro</span>} />
            </div>

            <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
              <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }} data-testid="chart-revenue">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div><div className="oa-stat-label">Umsatz-Trend</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{fmtMoney(mrr)} <span style={{ fontSize: 12, color: '#64748b' }}>/ Monat</span></div></div>
                  <Equalizer />
                </div>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={revenueTrend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="oaRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#ff6b00" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} />
                    <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="mrr" name="MRR" stroke="#ff6b00" strokeWidth={2.5} fill="url(#oaRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="oa-card oa-fade" data-testid="chart-stations">
                <div className="oa-stat-label" style={{ marginBottom: 10 }}>Stationen nach Tier</div>
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie data={stationPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3} stroke="none">
                      {stationPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4 }}>
                  <span className="oa-mono" style={{ fontSize: 11, color: '#94a3b8' }}><span style={{ color: '#64748b' }}>●</span> Free {stations?.free ?? 0}</span>
                  <span className="oa-mono" style={{ fontSize: 11, color: '#94a3b8' }}><span style={{ color: '#ff6b00' }}>●</span> Pro {stations?.pro ?? 0}</span>
                </div>
              </div>
            </div>

            <div className="oa-grid cols-2" style={{ marginTop: 18 }}>
              <div className="oa-card oa-fade" data-testid="chart-plans">
                <div className="oa-stat-label" style={{ marginBottom: 14 }}>Aktive Lizenzen nach Plan</div>
                {planData.length ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={planData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} />
                      <XAxis dataKey="plan" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                      <Bar dataKey="count" name="Lizenzen" radius={[6, 6, 0, 0]}>
                        {planData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div style={{ color: '#64748b', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>Keine aktiven Lizenzen</div>}
              </div>
              <div className="oa-card oa-fade" data-testid="overview-integrations">
                <div className="oa-stat-label" style={{ marginBottom: 6 }}>System-Integrationen</div>
                {[
                  { k: 'mongo', label: 'MongoDB', icon: Database },
                  { k: 'stripe', label: 'Stripe Billing', icon: CreditCard },
                  { k: 'discordOAuth', label: 'Discord OAuth', icon: Fingerprint },
                  { k: 'smtp', label: 'E-Mail (SMTP)', icon: Mail },
                  { k: 'recognition', label: 'Song-Erkennung', icon: Music2 },
                ].map(({ k, label, icon: Icon }) => {
                  const on = ov?.integrations?.[k];
                  return (
                    <div className="oa-integration" key={k} data-testid={`integration-${k}`}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}><Icon size={16} style={{ color: '#94a3b8' }} /> {label}</span>
                      <span className={`oa-pill ${on ? 'green' : 'slate'}`}>{on ? <><CheckCircle2 size={12} /> Aktiv</> : <><XCircle size={12} /> Aus</>}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {section === 'monitoring' && (
          <>
            {!monitoring ? (
              <div className="oa-card" style={{ textAlign: 'center', color: '#64748b', padding: 40 }} data-testid="monitoring-loading">
                <Equalizer /> <div className="oa-mono" style={{ marginTop: 12, fontSize: 12 }}>TELEMETRIE WIRD GELADEN…</div>
              </div>
            ) : monitoring.waiting ? (
              <div className="oa-card oa-fade" style={{ textAlign: 'center', padding: 48 }} data-testid="monitoring-waiting">
                <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 18px', display: 'grid', placeItems: 'center', background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}><Radar size={26} /></div>
                <div style={{ fontWeight: 800, fontSize: 18, fontFamily: "'Syne','Outfit',sans-serif", marginBottom: 10 }}>Warte auf Live-Daten vom Bot</div>
                <div style={{ color: '#94a3b8', fontSize: 14, maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>{monitoring.message}</div>
                <div className="oa-mono" style={{ marginTop: 18, fontSize: 11, color: '#475569' }}>MongoDB: {monitoring.health?.mongo ? 'verbunden' : 'nicht verbunden'} · keine Fake-Werte</div>
              </div>
            ) : (
              <div data-testid="monitoring-panel">
                {(() => {
                  const live = monitoring.live;
                  const sim = monitoring.simulated;
                  const bg = live ? 'rgba(16,185,129,0.12)' : sim ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.12)';
                  const bd = live ? 'rgba(16,185,129,0.4)' : sim ? 'rgba(245,158,11,0.4)' : '#2a3450';
                  const col = live ? '#4ade80' : sim ? '#fbbf24' : '#94a3b8';
                  const label = live ? 'LIVE · echte Node-Telemetrie' : sim ? 'DEMO · simulierte Werte (SEED_DEMO_DATA)' : 'KEINE LIVE-DATEN';
                  return (
                    <div data-testid="monitoring-banner" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: bg, border: `1px solid ${bd}`, color: col, fontSize: 12.5, fontWeight: 700, marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>
                      <span className="oa-dot" style={{ background: col }} /> {label}
                      {monitoring.process && <span style={{ marginLeft: 'auto', color: '#64748b', fontWeight: 500 }}>Prozess: 1 Node · CPU/RAM geteilt · {monitoring.process.cores} Cores · Node {monitoring.process.nodeVersion || ''}</span>}
                    </div>
                  );
                })()}
                <div className="oa-grid cols-4">
                  <StatTile testid="mon-nodes" label="Healthy Nodes" value={`${monitoring.health.healthyNodes}/${monitoring.health.totalNodes}`} icon={HeartPulse} accent="#10b981"
                    foot={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="oa-dot" style={{ background: '#10b981' }} /> Echtzeit · alle 5s</span>} />
                  <StatTile testid="mon-uptime" label={monitoring.live ? 'Prozess-Uptime' : 'Uptime'} value={monitoring.live ? fmtUptime(monitoring.health.uptimeSec) : `${monitoring.health.uptimePct}%`} icon={TrendingUp} accent="#00e5ff" foot={<span>{monitoring.live ? 'seit letztem Start' : '30-Tage rollierend'}</span>} />
                  <StatTile testid="mon-latency" label={monitoring.live ? 'RAM (Prozess)' : 'API-Latenz'} value={monitoring.live ? `${monitoring.process?.ramMb || 0} MB` : `${monitoring.health.apiLatencyMs} ms`} icon={Gauge} accent="#ff6b00" foot={<span>{monitoring.live ? 'geteilt für alle Bots' : 'Commander → API'}</span>} />
                  <StatTile testid="mon-incidents" label="Offene Incidents" value={monitoring.health.openIncidents} icon={AlertTriangle} accent={monitoring.health.openIncidents ? '#ff2a5f' : '#10b981'} foot={<span>{monitoring.incidents.length} in Historie</span>} />
                </div>

                <div className="oa-section-title"><Server size={15} /> Node-Health (live)</div>
                <div className="oa-grid cols-3">
                  {monitoring.nodes.map((n) => {
                    const cpuColor = n.cpuPct > 80 ? '#ff2a5f' : n.cpuPct > 55 ? '#f59e0b' : '#10b981';
                    return (
                      <div className="oa-card oa-fade" key={n.botId} data-testid={`mon-node-${n.index}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 9, background: n.role === 'commander' ? 'rgba(255,107,0,0.15)' : 'rgba(0,229,255,0.12)', color: n.role === 'commander' ? '#ff6b00' : '#00e5ff', display: 'grid', placeItems: 'center' }}>
                              {n.role === 'commander' ? <Cpu size={16} /> : <Server size={16} />}
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{n.name}</div>
                              <div className="oa-mono" style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{n.role}</div>
                            </div>
                          </div>
                          <span className={`oa-pill ${n.status === 'online' ? 'green' : n.status === 'offline' ? 'red' : 'amber'}`}>{n.status === 'online' ? 'Online' : n.status === 'offline' ? 'Offline' : 'Degraded'}</span>
                        </div>
                        {[
                          { label: 'CPU', val: `${n.cpuPct || 0}%`, pct: n.cpuPct || 0, color: cpuColor },
                          { label: 'RAM', val: `${n.ramMb || 0} MB`, pct: Math.min(100, (n.ramMb || 0) / 6), color: '#00e5ff' },
                          { label: 'PING', val: n.pingMs == null ? '—' : `${n.pingMs} ms`, pct: Math.min(100, n.pingMs || 0), color: '#ff6b00' },
                        ].map((m) => (
                          <div key={m.label} style={{ marginTop: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 5 }} className="oa-mono">
                              <span>{m.label}</span><span>{m.val}</span>
                            </div>
                            <div className="oa-progress"><i style={{ width: `${m.pct}%`, background: m.color }} /></div>
                          </div>
                        ))}
                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }} className="oa-mono">
                          <span>{n.voiceConnections} VOICE</span><span>{n.guilds} GUILDS</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="oa-grid cols-2" style={{ marginTop: 18 }}>
                  <div className="oa-card oa-fade" data-testid="mon-incidents-list">
                    <div className="oa-stat-label" style={{ marginBottom: 6 }}>Incidents</div>
                    {monitoring.incidents.length === 0 && <div style={{ color: '#64748b', fontSize: 13, padding: 16 }}>Keine Incidents</div>}
                    {monitoring.incidents.map((inc, i) => {
                      const sev = inc.severity === 'critical' ? 'red' : inc.severity === 'warning' ? 'amber' : 'cyan';
                      return (
                        <div className="oa-integration" key={i} data-testid={`mon-incident-${i}`}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                            <span className={`oa-pill ${sev}`} style={{ textTransform: 'uppercase' }}>{inc.severity}</span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.message}</span>
                              <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{inc.source} · {relTime(inc.at)}</span>
                            </span>
                          </span>
                          <span className={`oa-pill ${inc.resolved ? 'green' : 'slate'}`}>{inc.resolved ? 'behoben' : 'offen'}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="oa-card oa-fade" data-testid="mon-log-stream" style={{ background: '#0a0c12' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div className="oa-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={14} /> Live-Log</div>
                      <span className="oa-pill red" style={{ padding: '3px 9px' }}><span className="oa-dot" /> LIVE</span>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {monitoring.logs.map((l, i) => {
                        const c = l.level === 'WARN' ? '#fbbf24' : l.level === 'ERROR' ? '#ff8fab' : '#4ade80';
                        return (
                          <div key={i} className="oa-mono" style={{ fontSize: 11.5, padding: '5px 0', borderBottom: '1px solid #12151f', display: 'flex', gap: 8, lineHeight: 1.4 }} data-testid={`mon-log-${i}`}>
                            <span style={{ color: '#475569', flexShrink: 0 }}>{new Date(l.at).toLocaleTimeString('de-DE')}</span>
                            <span style={{ color: c, flexShrink: 0, fontWeight: 700 }}>{l.level}</span>
                            <span style={{ color: '#64748b', flexShrink: 0 }}>[{l.source}]</span>
                            <span style={{ color: '#cbd5e1', minWidth: 0 }}>{l.message}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 12, color: '#475569', fontSize: 11 }} className="oa-mono">
                  {monitoring.simulated ? 'SIMULIERTE TELEMETRIE · echte Node-Runtime-Daten überschreiben diese Werte automatisch' : 'LIVE NODE TELEMETRY'} · Stand {new Date(monitoring.generatedAt).toLocaleTimeString('de-DE')}
                </div>
              </div>
            )}
          </>
        )}

        {section === 'workers' && (
          <>
            <div className="oa-grid cols-3">
              {workers.map((w) => (
                <div className="oa-card hoverable oa-fade" key={w.botId} data-testid={`worker-node-${w.index}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: w.role === 'commander' ? 'rgba(255,107,0,0.15)' : 'rgba(0,229,255,0.12)', color: w.role === 'commander' ? '#ff6b00' : '#00e5ff', display: 'grid', placeItems: 'center' }}>
                        {w.role === 'commander' ? <Cpu size={18} /> : <Server size={18} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{w.name}</div>
                        <div className="oa-mono" style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{w.role}</div>
                      </div>
                    </div>
                    <span className={`oa-pill ${w.ready ? 'green' : 'amber'}`}>{w.ready ? 'Online' : 'Standby'}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                    <div><div className="oa-stat-label">Server</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{w.servers}</div></div>
                    <div><div className="oa-stat-label">Listeners</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{w.listeners}</div></div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 6 }} className="oa-mono">
                      <span>TIER: {String(w.requiredTier || 'free').toUpperCase()}</span>
                      <span>{w.connections} VOICE</span>
                    </div>
                    <div className="oa-progress"><i style={{ width: `${Math.min(100, (w.servers || 0) * 8 + (w.ready ? 12 : 4))}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'licenses' && (
          <div className="oa-fade" data-testid="license-manager">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
                <input
                  className="oa-input"
                  placeholder="Suche: Lizenz-ID (GUID), E-Mail oder Server-ID…"
                  value={licQuery}
                  onChange={(e) => setLicQuery(e.target.value)}
                  data-testid="license-search"
                />
              </div>
              <button className="oa-btn primary" style={{ height: 42 }} onClick={openNewLicense} data-testid="license-create-button"><Plus size={16} /> Lizenz erstellen</button>
            </div>

            {licMsg && (
              <div className={`oa-pill ${licMsg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="license-message">
                {licMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {licMsg.text}
              </div>
            )}

            {licForm && (
              <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(0,229,255,0.35)' }} data-testid="license-form">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontFamily: "'Syne','Outfit',sans-serif", fontSize: 17 }}>
                    {licForm._isNew ? 'Neue Lizenz' : <>Lizenz bearbeiten · <span className="oa-mono" style={{ fontSize: 13, color: '#00e5ff' }}>{licForm.licenseKey}</span></>}
                  </div>
                  <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px' }} onClick={closeLicForm} data-testid="license-form-close"><CloseIcon size={15} /></button>
                </div>

                <div className="oa-grid cols-2" style={{ gap: 14 }}>
                  <div>
                    <label className="oa-stat-label">E-Mail (Kontakt)</label>
                    <input className="oa-input" style={{ marginTop: 6 }} value={licForm.email} placeholder="kunde@example.com" onChange={(e) => setLicForm({ ...licForm, email: e.target.value })} data-testid="license-input-email" />
                  </div>
                  <div>
                    <label className="oa-stat-label">Plan / Tier</label>
                    <select className="oa-input" style={{ marginTop: 6 }} value={licForm.tier} onChange={(e) => setLicForm({ ...licForm, tier: e.target.value })} data-testid="license-input-tier">
                      <option value="pro">Pro</option>
                      <option value="ultimate">Ultimate</option>
                    </select>
                  </div>
                  <div>
                    <label className="oa-stat-label">Seats (1–5)</label>
                    <input className="oa-input" type="number" min={1} max={5} style={{ marginTop: 6 }} value={licForm.seats} onChange={(e) => setLicForm({ ...licForm, seats: e.target.value })} data-testid="license-input-seats" />
                  </div>
                  {licForm._isNew ? (
                    <div>
                      <label className="oa-stat-label">Laufzeit (Monate)</label>
                      <input className="oa-input" type="number" min={1} max={60} style={{ marginTop: 6 }} value={licForm.months} onChange={(e) => setLicForm({ ...licForm, months: e.target.value })} data-testid="license-input-months" />
                    </div>
                  ) : (
                    <div>
                      <label className="oa-stat-label">Läuft ab (Datum)</label>
                      <input className="oa-input" type="date" style={{ marginTop: 6 }} value={licForm.expiresAt} onChange={(e) => setLicForm({ ...licForm, expiresAt: e.target.value })} data-testid="license-input-expiry" />
                    </div>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="oa-stat-label">Notiz</label>
                    <input className="oa-input" style={{ marginTop: 6 }} value={licForm.note} placeholder="interne Notiz" onChange={(e) => setLicForm({ ...licForm, note: e.target.value })} data-testid="license-input-note" />
                  </div>
                  {licForm._isNew && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label className="oa-stat-label">Server-ID verknüpfen (optional)</label>
                      <input className="oa-input oa-mono" style={{ marginTop: 6 }} value={licForm.serverId} placeholder="Discord Guild-ID" onChange={(e) => setLicForm({ ...licForm, serverId: e.target.value })} data-testid="license-input-guild" />
                    </div>
                  )}
                </div>

                {licForm._isNew ? (
                  <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                    <button className="oa-btn primary" style={{ height: 40 }} disabled={licBusy} onClick={createLicense} data-testid="license-save-new"><Save size={15} /> Lizenz erstellen</button>
                  </div>
                ) : (
                  <>
                    <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button className="oa-btn primary" style={{ height: 40 }} disabled={licBusy} onClick={() => patchLicense({ email: licForm.email, tier: licForm.tier, seats: Number(licForm.seats) || 1, note: licForm.note, expiresAt: licForm.expiresAt || undefined }, 'Änderungen gespeichert.')} data-testid="license-save-edit"><Save size={15} /> Speichern</button>
                    </div>

                    <div style={{ marginTop: 18 }}>
                      <label className="oa-stat-label">Schnell verlängern / verkürzen</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                        <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 1 }, '+1 Monat')} data-testid="license-extend-1m">+1 Monat</button>
                        <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 3 }, '+3 Monate')} data-testid="license-extend-3m">+3 Monate</button>
                        <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 12 }, '+12 Monate')} data-testid="license-extend-12m">+12 Monate</button>
                        <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: -1 }, '−1 Monat')} data-testid="license-shorten-1m">−1 Monat</button>
                        <button className="oa-btn ghost" style={{ height: 36, color: '#ff8fab', borderColor: 'rgba(255,42,95,0.4)' }} disabled={licBusy} onClick={() => patchLicense({ expireNow: true }, 'Sofort deaktiviert (abgelaufen)')} data-testid="license-expire-now">Sofort deaktivieren</button>
                      </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                      <label className="oa-stat-label">Verknüpfte Server ({(licForm.linkedServerIds || []).length})</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
                        {(licForm.linkedServerIds || []).length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>Keine Server verknüpft</span>}
                        {(licForm.linkedServerIds || []).map((sid) => (
                          <span key={sid} className="oa-pill slate oa-mono" style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {sid}
                            <button style={{ background: 'none', border: 'none', color: '#ff8fab', cursor: 'pointer', padding: 0, lineHeight: 0 }} disabled={licBusy} onClick={() => patchLicense({ removeServerId: sid }, 'Server entfernt')} data-testid={`license-guild-remove-${sid}`}><CloseIcon size={13} /></button>
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input className="oa-input oa-mono" style={{ maxWidth: 260 }} placeholder="Discord Guild-ID hinzufügen" value={licForm.newGuild} onChange={(e) => setLicForm({ ...licForm, newGuild: e.target.value })} data-testid="license-guild-input" />
                        <button className="oa-btn ghost" style={{ height: 42 }} disabled={licBusy || !licForm.newGuild} onClick={() => patchLicense({ addServerId: licForm.newGuild }, 'Server verknüpft')} data-testid="license-guild-add"><Plus size={15} /> Verknüpfen</button>
                      </div>
                    </div>

                    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1a1f2e' }}>
                      <button className="oa-btn ghost" style={{ height: 40, color: '#ff8fab', borderColor: 'rgba(255,42,95,0.4)' }} disabled={licBusy} onClick={() => deleteLicense(licForm.licenseKey)} data-testid="license-delete"><Trash2 size={15} /> Lizenz löschen</button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="oa-table-wrap" data-testid="licenses-table">
              <table className="oa-table">
                <thead>
                  <tr>
                    <th>Lizenz-ID (GUID)</th><th>Plan</th><th>Seats</th><th>Kontakt</th><th>Server</th><th>Läuft ab</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const q = licQuery.trim().toLowerCase();
                    const rows = (licenses || []).filter((l) => {
                      if (!q) return true;
                      const key = String(l.licenseKey || l.id || '').toLowerCase();
                      const email = String(l.email || l.contactEmail || '').toLowerCase();
                      const guilds = (l.linkedServerIds || []).join(' ').toLowerCase();
                      return key.includes(q) || email.includes(q) || guilds.includes(q);
                    });
                    if (rows.length === 0) {
                      return <tr><td colSpan={8} style={{ textAlign: 'center', color: '#64748b', padding: 28 }}>{licQuery ? 'Keine Treffer' : 'Keine Lizenzen vorhanden'}</td></tr>;
                    }
                    return rows.map((l) => {
                      const key = l.licenseKey || l.id;
                      return (
                        <tr key={key} data-testid={`license-row-${key}`}>
                          <td className="oa-mono" style={{ fontSize: 12 }}>{key}</td>
                          <td><span className={`oa-pill ${l.plan === 'ultimate' ? 'orange' : l.plan === 'pro' ? 'cyan' : 'slate'}`}>{l.planName}</span></td>
                          <td>{l.seatsUsed}/{l.seats}</td>
                          <td style={{ color: '#94a3b8' }}>{l.email || l.contactEmail || '—'}</td>
                          <td style={{ color: '#94a3b8' }}>{(l.linkedServerIds || []).length}</td>
                          <td style={{ color: '#94a3b8' }}>{fmtDate(l.expiresAt)}{typeof l.daysLeft === 'number' && !l.expired && <span style={{ color: l.daysLeft <= 7 ? '#fbbf24' : '#64748b', marginLeft: 6, fontSize: 11 }}>({l.daysLeft}d)</span>}</td>
                          <td><span className={`oa-pill ${l.expired ? 'red' : l.active ? 'green' : 'slate'}`}>{l.expired ? 'Abgelaufen' : l.active ? 'Aktiv' : 'Inaktiv'}</span></td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px' }} onClick={() => openEditLicense(l)} data-testid={`license-edit-${key}`}><Pencil size={13} /></button>
                            <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', color: '#ff8fab' }} onClick={() => deleteLicense(key)} data-testid={`license-delete-${key}`}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {section === 'stations' && stations && (
          <>
            <div className="oa-grid cols-3">
              <StatTile testid="station-stat-total" label="Stationen gesamt" value={stations.total} icon={ListMusic} accent="#ff6b00" />
              <StatTile testid="station-stat-free" label="Free Stationen" value={stations.free} icon={Radio} accent="#64748b" />
              <StatTile testid="station-stat-pro" label="Pro Stationen" value={stations.pro} icon={Music2} accent="#00e5ff" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '28px 0 14px' }}>
              <div className="oa-section-title" style={{ margin: 0 }}><ListMusic size={15} /> Katalog verwalten ({stationList.length})</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="oa-btn ghost" style={{ height: 40 }} disabled={stHealthBusy || !stationList.length} onClick={() => checkStationHealth()} data-testid="station-check-all-button"><SignalHigh size={16} /> {stHealthBusy ? `Prüfe… ${stHealthProg ? `${stHealthProg.done}/${stHealthProg.total}` : ''}` : 'Live-Status prüfen'}</button>
                <button className="oa-btn ghost" style={{ height: 40 }} disabled={stHealthBusy} title="Browser-Playability-Cache leeren (erzwingt neue Prüfung)" onClick={() => { writeBrowserCache({}); setStMsg({ ok: true, text: 'Browser-Cache geleert – nächste Prüfung testet alle Sender neu.' }); }} data-testid="station-cache-clear-button"><RefreshCw size={15} /></button>
                <button className="oa-btn primary" style={{ height: 40 }} onClick={openNewStation} data-testid="station-add-button"><Plus size={16} /> Station hinzufügen</button>
              </div>
            </div>

            <div data-testid="station-status-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 6px', fontSize: 12, color: '#94a3b8' }}>
              <span style={{ marginRight: 4 }}>Status:</span>
              <span className="oa-pill green" style={{ padding: '2px 8px' }}>Discord = Bot kann streamen</span>
              <span className="oa-pill cyan" style={{ padding: '2px 8px' }}>Browser = Website-Player spielbar</span>
              <span className="oa-pill amber" style={{ padding: '2px 8px' }}>Nur Discord = Browser blockiert</span>
              <span className="oa-pill red" style={{ padding: '2px 8px' }}>Offline = nicht erreichbar</span>
            </div>

            {stMsg && (
              <div className={`oa-pill ${stMsg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="station-message">
                {stMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {stMsg.text}
              </div>
            )}

            {stForm && (
              <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(255,107,0,0.35)' }} data-testid="station-form">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontFamily: "'Syne','Outfit',sans-serif", fontSize: 17 }}>{stForm._isNew ? 'Neue Station' : `Station bearbeiten: ${stForm.key}`}</div>
                  <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px' }} onClick={closeStationForm} data-testid="station-form-close"><CloseIcon size={15} /></button>
                </div>
                <div className="oa-grid cols-2" style={{ gap: 14 }}>
                  <div>
                    <label className="oa-stat-label">Key</label>
                    <input className="oa-input" style={{ marginTop: 6 }} value={stForm.key} disabled={!stForm._isNew} placeholder="z.B. synthwave" onChange={(e) => setStForm({ ...stForm, key: e.target.value })} data-testid="station-input-key" />
                  </div>
                  <div>
                    <label className="oa-stat-label">Name</label>
                    <input className="oa-input" style={{ marginTop: 6, fontFamily: 'DM Sans' }} value={stForm.name} placeholder="Anzeigename" onChange={(e) => setStForm({ ...stForm, name: e.target.value })} data-testid="station-input-name" />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="oa-stat-label">Stream-URL</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <input className="oa-input" value={stForm.url} placeholder="https://…/stream.mp3" onChange={(e) => { setStForm({ ...stForm, url: e.target.value }); setStTest(null); }} data-testid="station-input-url" />
                      <button className="oa-btn ghost" style={{ height: 46, whiteSpace: 'nowrap' }} disabled={stBusy || !stForm.url} onClick={() => testStationUrl(stForm.url)} data-testid="station-test-button"><SignalHigh size={15} /> Test</button>
                    </div>
                    {stTest && (
                      <div className={`oa-pill ${stTest.loading ? 'slate' : stTest.ok ? 'green' : 'amber'}`} style={{ marginTop: 10 }} data-testid="station-test-result">
                        {stTest.loading ? <><Equalizer /> Teste Stream…</> : (
                          <>{stTest.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {stTest.message}{stTest.bitrate ? ` · ${stTest.bitrate} kbps` : ''}{typeof stTest.latencyMs === 'number' ? ` · ${stTest.latencyMs}ms` : ''}</>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="oa-stat-label">Tier</label>
                    <select className="oa-input" style={{ marginTop: 6 }} value={stForm.tier} onChange={(e) => setStForm({ ...stForm, tier: e.target.value })} data-testid="station-input-tier">
                      <option value="free">Free</option><option value="pro">Pro</option><option value="ultimate">Ultimate</option>
                    </select>
                  </div>
                  <div>
                    <label className="oa-stat-label">Genre</label>
                    <input className="oa-input" style={{ marginTop: 6, fontFamily: 'DM Sans' }} value={stForm.genre} placeholder="z.B. Lo-Fi / Chill" onChange={(e) => setStForm({ ...stForm, genre: e.target.value })} data-testid="station-input-genre" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                  <button className="oa-btn primary" disabled={stBusy} onClick={saveStation} data-testid="station-save-button"><Save size={16} /> {stForm._isNew ? 'Anlegen' : 'Speichern'}</button>
                  <button className="oa-btn ghost" onClick={closeStationForm}>Abbrechen</button>
                </div>
              </div>
            )}

            <div className="oa-table-wrap oa-fade" data-testid="stations-table">
              <table className="oa-table">
                <thead><tr><th>Key</th><th>Name</th><th>Genre</th><th>Tier</th><th>Live-Status</th><th style={{ textAlign: 'right' }}>Aktionen</th></tr></thead>
                <tbody>
                  {stationList.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>Lade Katalog…</td></tr>}
                  {stationList.map((s, i) => {
                    const h = stHealth[s.key];
                    return (
                    <tr key={s.key || i} data-testid={`station-row-${s.key}`}>
                      <td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{s.key}{s.isDefault && <span className="oa-pill orange" style={{ marginLeft: 8, padding: '2px 7px' }}>default</span>}</td>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td style={{ color: '#94a3b8' }}>{s.genre || '—'}</td>
                      <td><span className={`oa-pill ${s.tier === 'ultimate' ? 'orange' : s.tier === 'pro' ? 'cyan' : 'slate'}`}>{String(s.tier || 'free').toUpperCase()}</span></td>
                      <td data-testid={`station-status-${s.key}`}>
                        {!h && <span className="oa-pill slate" style={{ padding: '2px 8px' }}>—</span>}
                        {h && h.checking && <span className="oa-pill slate" style={{ padding: '2px 8px' }}>Prüfe…</span>}
                        {h && !h.checking && !h.reachable && <span className="oa-pill red" style={{ padding: '2px 8px' }}><XCircle size={11} /> Offline</span>}
                        {h && !h.checking && h.reachable && !h.discordOk && !h.ok && <span className="oa-pill amber" style={{ padding: '2px 8px' }}><AlertTriangle size={11} /> Kein Audio</span>}
                        {h && !h.checking && (h.discordOk || h.ok) && (
                          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            <span className="oa-pill green" style={{ padding: '2px 8px' }} title="Server-seitig streambar – Discord-Bot kann diesen Sender abspielen"><CheckCircle2 size={11} /> Discord{typeof h.latencyMs === 'number' ? ` · ${h.latencyMs}ms` : ''}</span>
                            {h.browserOk
                              ? <span className="oa-pill cyan" style={{ padding: '2px 8px' }} title="Direkt im Website-Player abspielbar"><CheckCircle2 size={11} /> Browser</span>
                              : <span className="oa-pill amber" style={{ padding: '2px 8px' }} title="Browser-Direktzugriff blockiert (z. B. 403/Hotlink). Im Discord-Bot funktioniert der Sender."><AlertTriangle size={11} /> Nur Discord</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button title="Einzeln prüfen" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} disabled={stHealthBusy} onClick={() => checkStationHealth([s.key])} data-testid={`station-row-test-${s.key}`}><SignalHigh size={14} /></button>
                        <button title="Bearbeiten" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} onClick={() => openEditStation(s)} data-testid={`station-row-edit-${s.key}`}><Pencil size={14} /></button>
                        <button title={s.isDefault ? 'Standard-Station' : 'Löschen'} className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6, color: '#ff8fab', opacity: s.isDefault ? 0.4 : 1 }} disabled={stBusy || s.isDefault} onClick={() => deleteStation(s.key)} data-testid={`station-row-delete-${s.key}`}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {section === 'audit' && (
          <div className="oa-card oa-fade" data-testid="audit-log">
            <div className="oa-stat-label" style={{ marginBottom: 8 }}>Owner Audit-Log — jede Konfigurationsänderung wird protokolliert</div>
            {auditLog.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Noch keine Einträge</div>}
            {auditLog.map((a, i) => {
              const st = a.status === 'error' ? 'red' : a.status === 'warn' ? 'amber' : 'green';
              return (
                <div key={i} className="oa-integration" data-testid={`audit-row-${i}`}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span className="oa-pill orange" style={{ fontFamily: 'JetBrains Mono' }}>{a.action}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, display: 'block' }}>{a.target || '—'}</span>
                      <span className="oa-mono" style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: 520 }}>{a.detail || ''} · {a.actor} · {a.ip}</span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className={`oa-pill ${st}`}>{a.status}</span>
                    <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{relTime(a.at)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {section === 'integrations' && integrations && (
          <div className="oa-grid cols-2">
            <div className="oa-card oa-fade" data-testid="integrations-config">
              <div className="oa-stat-label" style={{ marginBottom: 6 }}>Konfiguration</div>
              {[
                { k: 'mongo', label: 'MongoDB Datenspeicher', icon: Database },
                { k: 'stripe', label: 'Stripe Zahlungen', icon: CreditCard },
                { k: 'discordOAuth', label: 'Discord OAuth Login', icon: Fingerprint },
                { k: 'smtp', label: 'E-Mail Versand (SMTP)', icon: Mail },
                { k: 'recognition', label: 'Audio Song-Erkennung', icon: Music2 },
                { k: 'songHistory', label: 'Song-Verlauf', icon: ActivityIcon },
              ].map(({ k, label, icon: Icon }) => {
                const on = integrations?.config?.[k];
                return (
                  <div className="oa-integration" key={k} data-testid={`integ-config-${k}`}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}><Icon size={16} style={{ color: '#94a3b8' }} /> {label}</span>
                    <span className={`oa-pill ${on ? 'green' : 'slate'}`}>{on ? 'Aktiv' : 'Nicht konfiguriert'}</span>
                  </div>
                );
              })}
            </div>
            <div className="oa-card oa-fade" data-testid="integrations-directory">
              <div className="oa-stat-label" style={{ marginBottom: 12 }}>Bot-Verzeichnisse</div>
              <div className="oa-integration">
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}><Globe size={16} style={{ color: '#94a3b8' }} /> DiscordBotList</span>
                <span className={`oa-pill ${integrations?.discordBotList?.enabled ? 'green' : 'slate'}`}>{integrations?.discordBotList?.enabled ? 'Verbunden' : 'Aus'}</span>
              </div>
              <p style={{ color: '#64748b', fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
                Top.gg, discord.bots.gg und weitere Verzeichnisse werden vom Node-Commander synchronisiert. Aktivierung über die entsprechenden ENV-Variablen.
              </p>
            </div>
          </div>
        )}

        {section === 'activity' && (
          <div className="oa-card oa-fade" data-testid="activity-log">
            {activity.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Keine Aktivität</div>}
            {activity.map((a, i) => (
              <div key={i} className="oa-integration" data-testid={`activity-row-${i}`}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,107,0,0.14)', color: '#ff6b00', display: 'grid', placeItems: 'center' }}><KeyRound size={15} /></span>
                  <span>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#64748b' }} className="oa-mono">{a.detail}{a.meta?.seats ? ` · ${a.meta.seats} Seats` : ''}</span>
                  </span>
                </span>
                <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{relTime(a.at)}</span>
              </div>
            ))}
          </div>
        )}
        {(section === 'company' || section === 'plans' || section === 'discord' || section === 'payments' || section === 'marketing') && (
          <OwnerConfig section={section} apiGet={apiGet} apiSend={apiSend} token={token} />
        )}
        {section === 'brand' && (
          <div data-testid="owner-brand-kit"><BrandKit embedded /></div>
        )}
      </main>
    </div>
  );
}
