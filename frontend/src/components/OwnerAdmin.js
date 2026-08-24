import React, { useState, useEffect, useCallback } from 'react';
import {
  Radio, LayoutDashboard, Server, KeyRound, ListMusic, PlugZap, Activity as ActivityIcon,
  LogOut, ShieldCheck, TrendingUp, Users, Cpu, RefreshCw, CheckCircle2, XCircle,
  Music2, Globe, CreditCard, Mail, Database, Fingerprint, AlertTriangle,
  Radar, Terminal, Gauge, HeartPulse, Plus, Pencil, Trash2, Save, ScrollText, SignalHigh, X as CloseIcon, Palette,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid,
} from 'recharts';
import { buildApiUrl } from '../lib/api.js';
import BrandKit from './BrandKit.js';

const TOKEN_KEY = 'omnifm_admin_token';

const NAV = [
  { id: 'overview', label: 'Global Overview', icon: LayoutDashboard },
  { id: 'monitoring', label: 'Live-Monitoring', icon: Radar },
  { id: 'workers', label: 'Worker Nodes', icon: Server },
  { id: 'licenses', label: 'License Manager', icon: KeyRound },
  { id: 'stations', label: 'Radio Catalog', icon: ListMusic },
  { id: 'integrations', label: 'Integrations', icon: PlugZap },
  { id: 'activity', label: 'Activity Log', icon: ActivityIcon },
  { id: 'audit', label: 'Audit-Log', icon: ScrollText },
  { id: 'brand', label: 'Brand Kit', icon: Palette },
];

const PLAN_COLORS = { free: '#64748b', pro: '#00e5ff', ultimate: '#ff6b00' };

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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const loadAll = useCallback(async (tk) => {
    setRefreshing(true);
    try {
      const [ov, wk, lic, st, integ, act] = await Promise.allSettled([
        apiGet('/api/admin/overview', tk),
        apiGet('/api/admin/workers', tk),
        apiGet('/api/admin/licenses', tk),
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
  // Deterministic revenue trend for the sparkline area chart (last 6 months, ramping to current MRR)
  const mrr = ov?.revenue?.mrr || 0;
  const revenueTrend = Array.from({ length: 6 }, (_, i) => {
    const m = ['Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug'][i];
    return { month: m, mrr: Math.round(mrr * (0.55 + i * 0.09)) };
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
            <span className="oa-onair"><span className="oa-dot" /> ON AIR 24/7</span>
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
              <StatTile testid="stat-guilds" label="Verwaltete Server" value={ov?.guilds?.managed ?? '—'} icon={Users} accent="#5865f2"
                foot={<span>{ov?.bots?.configured ?? 0} Bots konfiguriert</span>} />
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
            ) : (
              <div data-testid="monitoring-panel">
                <div className="oa-grid cols-4">
                  <StatTile testid="mon-nodes" label="Healthy Nodes" value={`${monitoring.health.healthyNodes}/${monitoring.health.totalNodes}`} icon={HeartPulse} accent="#10b981"
                    foot={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="oa-dot" style={{ background: '#10b981' }} /> Echtzeit · alle 4s</span>} />
                  <StatTile testid="mon-uptime" label="Uptime" value={`${monitoring.health.uptimePct}%`} icon={TrendingUp} accent="#00e5ff" foot={<span>30-Tage rollierend</span>} />
                  <StatTile testid="mon-latency" label="API-Latenz" value={`${monitoring.health.apiLatencyMs} ms`} icon={Gauge} accent="#ff6b00" foot={<span>Commander → API</span>} />
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
                          <span className={`oa-pill ${n.status === 'online' ? 'green' : 'amber'}`}>{n.status === 'online' ? 'Online' : 'Degraded'}</span>
                        </div>
                        {[
                          { label: 'CPU', val: `${n.cpuPct}%`, pct: n.cpuPct, color: cpuColor },
                          { label: 'RAM', val: `${n.ramMb} MB`, pct: Math.min(100, n.ramMb / 6), color: '#00e5ff' },
                          { label: 'PING', val: `${n.pingMs} ms`, pct: Math.min(100, n.pingMs), color: '#ff6b00' },
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
          <div className="oa-table-wrap oa-fade" data-testid="licenses-table">
            <table className="oa-table">
              <thead>
                <tr>
                  <th>Lizenz-ID</th><th>Plan</th><th>Seats</th><th>Kontakt</th><th>Quelle</th><th>Läuft ab</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {licenses.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#64748b', padding: 28 }}>Keine Lizenzen vorhanden</td></tr>
                )}
                {licenses.map((l) => (
                  <tr key={l.id} data-testid={`license-row-${l.id}`}>
                    <td className="oa-mono" style={{ fontSize: 12 }}>{l.id}</td>
                    <td><span className={`oa-pill ${l.plan === 'ultimate' ? 'orange' : l.plan === 'pro' ? 'cyan' : 'slate'}`}>{l.planName}</span></td>
                    <td>{l.seatsUsed}/{l.seats}</td>
                    <td style={{ color: '#94a3b8' }}>{l.contactEmail || '—'}</td>
                    <td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{l.source}</td>
                    <td style={{ color: '#94a3b8' }}>{fmtDate(l.expiresAt)}{typeof l.daysLeft === 'number' && !l.expired && <span style={{ color: l.daysLeft <= 7 ? '#fbbf24' : '#64748b', marginLeft: 6, fontSize: 11 }}>({l.daysLeft}d)</span>}</td>
                    <td><span className={`oa-pill ${l.expired ? 'red' : l.active ? 'green' : 'slate'}`}>{l.expired ? 'Abgelaufen' : l.active ? 'Aktiv' : 'Inaktiv'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              <button className="oa-btn primary" style={{ height: 40 }} onClick={openNewStation} data-testid="station-add-button"><Plus size={16} /> Station hinzufügen</button>
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
                <thead><tr><th>Key</th><th>Name</th><th>Genre</th><th>Tier</th><th style={{ textAlign: 'right' }}>Aktionen</th></tr></thead>
                <tbody>
                  {stationList.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>Lade Katalog…</td></tr>}
                  {stationList.map((s, i) => (
                    <tr key={s.key || i} data-testid={`station-row-${s.key}`}>
                      <td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{s.key}{s.isDefault && <span className="oa-pill orange" style={{ marginLeft: 8, padding: '2px 7px' }}>default</span>}</td>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td style={{ color: '#94a3b8' }}>{s.genre || '—'}</td>
                      <td><span className={`oa-pill ${s.tier === 'ultimate' ? 'orange' : s.tier === 'pro' ? 'cyan' : 'slate'}`}>{String(s.tier || 'free').toUpperCase()}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button title="Test" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} disabled={stBusy} onClick={() => { setStForm(null); testStationUrl(s.url); setStMsg(null); openEditStation(s); }} data-testid={`station-row-test-${s.key}`}><SignalHigh size={14} /></button>
                        <button title="Bearbeiten" className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6 }} onClick={() => openEditStation(s)} data-testid={`station-row-edit-${s.key}`}><Pencil size={14} /></button>
                        <button title={s.isDefault ? 'Standard-Station' : 'Löschen'} className="oa-btn ghost" style={{ height: 32, padding: '0 9px', marginLeft: 6, color: '#ff8fab', opacity: s.isDefault ? 0.4 : 1 }} disabled={stBusy || s.isDefault} onClick={() => deleteStation(s.key)} data-testid={`station-row-delete-${s.key}`}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
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
        {section === 'brand' && (
          <div data-testid="owner-brand-kit"><BrandKit embedded /></div>
        )}
      </main>
    </div>
  );
}
