import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radio, LayoutDashboard, ListMusic, ShieldCheck, BarChart3, CreditCard, LogOut,
  Plus, Trash2, Check, Crown, Zap, Music2, Users, Clock, Lock, Server,
  ChevronRight, RefreshCw, AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts';
import { buildApiUrl } from '../lib/api.js';
import { useI18n } from '../i18n.js';

const NAV = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'stations', icon: ListMusic },
  { id: 'roles', icon: ShieldCheck },
  { id: 'stats', icon: BarChart3 },
  { id: 'subscription', icon: CreditCard },
];

const TIER_META = {
  free: { name: 'Free', color: '#64748b', icon: Radio, customLimit: 0, maxBots: 2, bitrate: '64k' },
  pro: { name: 'Pro', color: '#00e5ff', icon: Zap, customLimit: 0, maxBots: 8, bitrate: '128k' },
  ultimate: { name: 'Ultimate', color: '#ff6b00', icon: Crown, customLimit: 50, maxBots: 16, bitrate: '320k' },
};

const COMMANDS = [
  { id: 'play', label: '/play' },
  { id: 'skip', label: '/skip' },
  { id: 'stop', label: '/stop' },
  { id: 'station', label: '/station' },
  { id: 'volume', label: '/volume' },
];

const EMPTY_DATA = Object.freeze({
  stations: [], custom: [], roles: [], trend: [], top: [], listeners: 0,
  uptimePct: null, minutesMonth: 0, activeStreams: 0, currentStation: null,
  license: null, loading: false,
});

function fmtInt(value) { return Number(value || 0).toLocaleString(); }
function fmtMinutes(value) {
  const minutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(minutes / 60);
  return hours >= 1 ? `${fmtInt(hours)} h` : `${fmtInt(minutes)} min`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include', cache: 'no-store', ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function normalizeTrend(detail, advanced) {
  const rows = Array.isArray(detail?.dailyStats) && detail.dailyStats.length
    ? [...detail.dailyStats].reverse().slice(-7)
    : (Array.isArray(advanced?.dailyReport) ? advanced.dailyReport.slice(-7) : []);
  return rows.map((row, index) => ({
    day: String(row?.date || row?.day || index + 1).slice(-5),
    listeners: Number(row?.avgListeners ?? row?.listeners ?? row?.peakListeners ?? 0),
  }));
}

function normalizeTopStations(detail, advanced) {
  const listening = detail?.listeningStats?.stationListeningMs;
  const names = detail?.listeningStats?.stationNames || {};
  if (listening && typeof listening === 'object') {
    return Object.entries(listening)
      .map(([key, value]) => ({ name: names[key] || key, minutes: Math.round(Number(value || 0) / 60000) }))
      .filter((row) => row.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);
  }
  return (Array.isArray(advanced?.stationBreakdown) ? advanced.stationBreakdown : [])
    .map((row) => ({
      name: row?.name || row?.stationName || row?.stationKey || '-',
      minutes: Number(row?.minutes ?? row?.listeningMinutes ?? 0),
    }))
    .filter((row) => row.minutes > 0)
    .slice(0, 8);
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0e111a', border: '1px solid #2a3450', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((item, index) => <div key={index} style={{ color: item.color || '#fff' }}>{item.name}: <b>{item.value}</b></div>)}
    </div>
  );
}

function StatTile({ label, value, foot, icon: Icon, accent }) {
  return (
    <div className="oa-card hoverable oa-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="oa-stat-label">{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${accent}1f`, color: accent }}><Icon size={17} /></div>
      </div>
      <div className="oa-stat-value">{value}</div>
      {foot && <div className="oa-stat-foot">{foot}</div>}
    </div>
  );
}

export default function GuildDashboard() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState({ authenticated: false, user: null, guilds: [] });
  const [guildId, setGuildId] = useState('');
  const [section, setSection] = useState('overview');
  const [store, setStore] = useState({});
  const [perms, setPerms] = useState({});
  const [newStation, setNewStation] = useState({ name: '', url: '' });
  const [msg, setMsg] = useState(null);
  const { locale } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);
  const navLabel = useCallback((id) => ({
    overview: t('Übersicht', 'Overview'), stations: t('Sender', 'Stations'),
    roles: t('Rollen & Rechte', 'Roles & Permissions'), stats: t('Statistiken', 'Statistics'),
    subscription: t('Abo & Lizenz', 'Subscription & License'),
  }[id] || id), [t]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/api/auth/session');
      const guilds = Array.isArray(data.guilds) ? data.guilds : [];
      setSession({ authenticated: data.authenticated === true, user: data.user || null, guilds });
      setGuildId((current) => (guilds.some((guild) => guild.id === current) ? current : (guilds[0]?.id || '')));
    } catch {
      setSession({ authenticated: false, user: null, guilds: [] });
      setGuildId('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  const loadGuild = useCallback(async (selectedGuildId) => {
    if (!selectedGuildId) return;
    setStore((current) => ({ ...current, [selectedGuildId]: { ...(current[selectedGuildId] || EMPTY_DATA), loading: true } }));
    try {
      const license = await apiRequest(`/api/dashboard/license?serverId=${encodeURIComponent(selectedGuildId)}`);
      const tier = TIER_META[license?.tier] ? license.tier : 'free';
      setSession((current) => ({
        ...current,
        guilds: current.guilds.map((guild) => (guild.id === selectedGuildId
          ? { ...guild, tier, dashboardEnabled: license.dashboardEnabled, ultimateEnabled: license.ultimateEnabled }
          : guild)),
      }));

      const safe = (path) => apiRequest(path).catch(() => null);
      const base = `serverId=${encodeURIComponent(selectedGuildId)}`;
      const [catalog, custom, rolesPayload, stats, detail, permsPayload] = await Promise.all([
        safe(`/api/dashboard/stations?${base}`),
        safe(`/api/dashboard/custom-stations?${base}`),
        safe(`/api/dashboard/roles?${base}`),
        tier === 'free' ? null : safe(`/api/dashboard/stats?${base}`),
        tier === 'ultimate' ? safe(`/api/dashboard/stats/detail?${base}&days=30`) : null,
        tier === 'free' ? null : safe(`/api/dashboard/perms?${base}`),
      ]);
      const stations = [...(catalog?.free || []), ...(catalog?.pro || [])];
      const basic = stats?.basic || {};
      const advanced = stats?.advanced || null;
      const listeningMs = Number(detail?.listeningStats?.totalListeningMs || 0);
      const currentStation = Number(basic.activeStreams || 0) > 0 && basic.topStation && basic.topStation.name !== '-'
        ? basic.topStation
        : null;
      const commandRoleMap = permsPayload?.commandRoleMap || {};
      const nextPerms = {};
      Object.entries(commandRoleMap).forEach(([command, roleIds]) => {
        (Array.isArray(roleIds) ? roleIds : []).forEach((roleId) => { nextPerms[`${command}:${roleId}`] = true; });
      });
      setPerms(nextPerms);
      setStore((current) => ({
        ...current,
        [selectedGuildId]: {
          stations,
          custom: custom?.stations || catalog?.custom || [],
          roles: rolesPayload?.roles || [],
          trend: normalizeTrend(detail, advanced),
          top: normalizeTopStations(detail, advanced),
          listeners: Number(basic.listenersNow || 0),
          uptimePct: detail?.connectionHealth?.uptimePct ?? null,
          minutesMonth: Math.round(listeningMs / 60000),
          activeStreams: Number(basic.activeStreams || 0),
          currentStation,
          license,
          loading: false,
        },
      }));
    } catch (error) {
      setStore((current) => ({ ...current, [selectedGuildId]: { ...(current[selectedGuildId] || EMPTY_DATA), loading: false } }));
      setMsg({ ok: false, text: error.message || t('Dashboard-Daten konnten nicht geladen werden.', 'Dashboard data could not be loaded.') });
    }
  }, [t]);

  useEffect(() => {
    if (session.authenticated && guildId) loadGuild(guildId);
  }, [guildId, loadGuild, session.authenticated]);

  const guild = useMemo(() => session.guilds.find((item) => item.id === guildId) || null, [session.guilds, guildId]);
  const gdata = store[guildId] || EMPTY_DATA;
  const tier = gdata.license?.tier || guild?.tier || 'free';
  const tm = TIER_META[tier] || TIER_META.free;

  const addCustom = async () => {
    const name = newStation.name.trim();
    const url = newStation.url.trim();
    if (!name || !url) { setMsg({ ok: false, text: t('Name und URL sind erforderlich.', 'Name and URL are required.') }); return; }
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'station';
    try {
      const payload = await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(guildId)}`, {
        method: 'POST', body: JSON.stringify({ key: `${slug}-${Date.now().toString(36)}`, name, url }),
      });
      setStore((current) => ({ ...current, [guildId]: { ...gdata, custom: [...gdata.custom, payload.station] } }));
      setNewStation({ name: '', url: '' });
      setMsg({ ok: true, text: t('Sender wurde gespeichert.', 'Station saved.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  };

  const removeCustom = async (key) => {
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(guildId)}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      setStore((current) => ({ ...current, [guildId]: { ...gdata, custom: gdata.custom.filter((item) => item.key !== key) } }));
      setMsg({ ok: true, text: t('Sender wurde entfernt.', 'Station removed.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  };

  const togglePerm = (command, roleId) => setPerms((current) => ({ ...current, [`${command}:${roleId}`]: !current[`${command}:${roleId}`] }));
  const savePerms = async () => {
    const commandRoleMap = {};
    COMMANDS.forEach((command) => {
      const roleIds = gdata.roles.filter((role) => perms[`${command.id}:${role.id}`]).map((role) => role.id);
      if (roleIds.length) commandRoleMap[command.id] = roleIds;
    });
    try {
      await apiRequest(`/api/dashboard/perms?serverId=${encodeURIComponent(guildId)}`, { method: 'PUT', body: JSON.stringify({ commandRoleMap }) });
      setMsg({ ok: true, text: t('Berechtigungen wurden gespeichert.', 'Permissions saved.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  };

  const logout = async () => {
    try { await apiRequest('/api/auth/logout', { method: 'POST' }); } catch { /* cookie is cleared best-effort */ }
    window.location.assign('/');
  };

  useEffect(() => {
    if (!msg) return undefined;
    const timer = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [msg]);

  if (loading) return (
    <div className="oa-root" style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', color: '#94a3b8' }}><span className="oa-eq"><span /><span /><span /><span /><span /></span><div className="oa-mono" style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.14em' }}>DASHBOARD LÄDT…</div></div>
    </div>
  );

  if (!session.authenticated) return (
    <div className="oa-root"><div className="oa-login"><div className="oa-login-card oa-fade" data-testid="guild-login-gate">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div className="oa-brand-logo"><Radio size={20} /></div><div><div className="oa-display" style={{ fontSize: 20, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div></div>
      <h1 className="oa-display" style={{ fontSize: 23, marginTop: 22 }}>{t('Verwalte deine Server', 'Manage your servers')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.55 }}>{t('Melde dich mit Discord an. Alle angezeigten Daten stammen live aus OmniFM und deiner Lizenz.', 'Sign in with Discord. All displayed data comes live from OmniFM and your license.')}</p>
      <a href={buildApiUrl('/api/auth/discord/login?redirect=1&nextPage=dashboard')} className="oa-btn primary" style={{ width: '100%', marginTop: 18, background: 'linear-gradient(135deg,#5865f2,#4752c4)', color: '#fff' }} data-testid="guild-discord-login">{t('Mit Discord anmelden', 'Continue with Discord')}</a>
      <div style={{ marginTop: 16, textAlign: 'center' }}><a href="/" className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>← {t('Zurück zur Website', 'Back to website')}</a></div>
    </div></div></div>
  );

  if (!guild) return (
    <div className="oa-root" style={{ display: 'grid', placeItems: 'center' }}><div className="oa-card" style={{ maxWidth: 560, textAlign: 'center' }}>
      <AlertTriangle size={28} color="#ffb020" /><h2>{t('Kein verwaltbarer Discord-Server', 'No manageable Discord server')}</h2>
      <p style={{ color: '#94a3b8' }}>{t('Du benötigst auf dem Server die Berechtigung „Server verwalten“.', 'You need the Manage Server permission on the server.')}</p>
      <button className="oa-btn ghost" onClick={logout}><LogOut size={16} /> {t('Abmelden', 'Sign out')}</button>
    </div></div>
  );

  const trendData = gdata.trend;
  const topData = gdata.top;
  const currentStationName = gdata.currentStation?.name || t('Kein aktiver Stream', 'No active stream');

  return (
    <div className="oa-root" data-testid="guild-dashboard">
      <aside className="oa-sidebar">
        <div className="oa-brand"><div className="oa-brand-logo"><Radio size={20} /></div><div><div className="oa-display" style={{ fontSize: 18, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div></div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {NAV.map((item) => <button key={item.id} className={`oa-nav-btn ${section === item.id ? 'active' : ''}`} onClick={() => setSection(item.id)} data-testid={`guild-nav-${item.id}`}><item.icon size={18} /> {navLabel(item.id)}</button>)}
        </nav>
        <button className="oa-nav-btn" style={{ color: '#ff8fab' }} onClick={logout} data-testid="guild-logout"><LogOut size={18} /> {t('Abmelden', 'Sign out')}</button>
      </aside>

      <main className="oa-main">
        <div className="oa-topbar">
          <div><h1 className="oa-h1 oa-display" data-testid="guild-section-title">{navLabel(section)}</h1><div className="oa-sub">{guild.name}{Number(guild.memberCount || guild.members) > 0 ? ` · ${fmtInt(guild.memberCount || guild.members)} ${t('Mitglieder', 'members')}` : ''} · <span className="oa-mono">Guild-ID {guild.id}</span></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="oa-btn ghost" onClick={() => loadGuild(guildId)} disabled={gdata.loading} title={t('Aktualisieren', 'Refresh')}><RefreshCw size={15} /></button>
            <span className="oa-pill" style={{ background: `${tm.color}22`, color: tm.color, border: `1px solid ${tm.color}55` }} data-testid="guild-active-tier"><tm.icon size={13} /> {tm.name}</span>
            <select className="oa-input" style={{ height: 40, width: 'auto', maxWidth: 360 }} value={guildId} onChange={(event) => setGuildId(event.target.value)} data-testid="guild-switcher">{session.guilds.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>
          </div>
        </div>
        <div className="oa-mobile-nav">{NAV.map((item) => <button key={item.id} className={`oa-nav-btn ${section === item.id ? 'active' : ''}`} style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setSection(item.id)}><item.icon size={16} /> {navLabel(item.id)}</button>)}</div>
        {msg && <div className={`oa-pill ${msg.ok ? 'green' : 'red'}`} style={{ marginBottom: 16 }} data-testid="guild-message">{msg.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}</div>}

        {section === 'overview' && <>
          <div className="oa-grid cols-4">
            <StatTile label={t('Aktive Hörer', 'Active listeners')} value={fmtInt(gdata.listeners)} icon={Users} accent="#ff6b00" foot={t('Echtzeit-Telemetrie', 'Real-time telemetry')} />
            <StatTile label="Uptime" value={gdata.uptimePct == null ? '—' : `${gdata.uptimePct}%`} icon={Clock} accent="#10b981" foot={t('Keine Schätzung', 'No estimate')} />
            <StatTile label={t('Gestreamt', 'Streamed')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#00e5ff" foot={t('erfasste Wiedergabezeit', 'recorded playback time')} />
            <StatTile label={t('Aktive Streams', 'Active streams')} value={fmtInt(gdata.activeStreams)} icon={Server} accent="#5865f2" foot={`${tm.name} · ${tm.maxBots} ${t('Bots max.', 'bots max.')}`} />
          </div>
          <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
            <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }}><div className="oa-stat-label" style={{ marginBottom: 14 }}>{t('Hörer-Trend', 'Listener trend')}</div>
              {trendData.length ? <ResponsiveContainer width="100%" height={200}><AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}><defs><linearGradient id="gdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} /><stop offset="100%" stopColor="#ff6b00" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} /><XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><Tooltip content={<ChartTip />} /><Area type="monotone" dataKey="listeners" name={t('Hörer', 'Listeners')} stroke="#ff6b00" strokeWidth={2.5} fill="url(#gdArea)" /></AreaChart></ResponsiveContainer> : <div className="oa-sub" style={{ padding: '64px 0', textAlign: 'center' }}>{t('Noch keine Messwerte vorhanden.', 'No measurements available yet.')}</div>}
            </div>
            <div className="oa-card oa-fade"><div className="oa-stat-label" style={{ marginBottom: 12 }}>{t('Aktueller Stream', 'Current stream')}</div><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 56, height: 56, borderRadius: 12, background: gdata.currentStation ? 'linear-gradient(135deg,#ff6b00,#ff2a5f)' : '#1c2235', display: 'grid', placeItems: 'center' }}><Radio size={24} color="#fff" /></div><div><div style={{ fontWeight: 700, fontSize: 16 }}>{currentStationName}</div>{gdata.currentStation && <div className="oa-pill orange" style={{ marginTop: 6 }}><span className="oa-dot" /> LIVE</div>}</div></div><button className="oa-btn ghost" style={{ width: '100%', marginTop: 16 }} onClick={() => setSection('stations')}><ListMusic size={15} /> {t('Senderkatalog', 'Station catalog')}</button></div>
          </div>
        </>}

        {section === 'stations' && <>
          <div className="oa-section-title"><Radio size={15} /> {t('Verfügbare Sender', 'Available stations')} ({gdata.stations.length})</div>
          <div className="oa-grid cols-3" data-testid="guild-preset-stations">{gdata.stations.map((station) => <div key={station.key} className="oa-card hoverable"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 38, height: 38, borderRadius: 10, background: '#1c2235', display: 'grid', placeItems: 'center' }}><Music2 size={17} color="#94a3b8" /></div><div><div style={{ fontWeight: 700 }}>{station.name}</div><div className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{station.genre || 'Radio'}</div></div></div></div>)}</div>
          <div className="oa-section-title" style={{ marginTop: 28 }}><ListMusic size={15} /> {t('Eigene Sender', 'Custom stations')} ({gdata.custom.length}/{tm.customLimit || 0})</div>
          {tier !== 'ultimate' ? <div className="oa-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }} data-testid="guild-custom-locked"><Lock size={22} color="#94a3b8" /><div><div style={{ fontWeight: 700 }}>{t('Eigene Stream-URLs sind ein Ultimate-Feature', 'Custom stream URLs are an Ultimate feature')}</div><div style={{ color: '#94a3b8', fontSize: 13 }}>{t('Im offiziellen Senderkatalog stehen dir weiterhin alle Sender deines Plans zur Verfügung.', 'The official catalog remains available according to your plan.')}</div></div><button className="oa-btn primary" style={{ marginLeft: 'auto' }} onClick={() => setSection('subscription')}>Upgrade</button></div> : <>
            <div className="oa-card" style={{ marginBottom: 16 }} data-testid="guild-custom-form"><div className="oa-grid cols-2" style={{ gap: 12 }}><div><label className="oa-stat-label">Name</label><input className="oa-input" style={{ marginTop: 6 }} value={newStation.name} onChange={(event) => setNewStation({ ...newStation, name: event.target.value })} /></div><div><label className="oa-stat-label">Stream-URL</label><input className="oa-input" style={{ marginTop: 6 }} value={newStation.url} placeholder="https://…/stream.mp3" onChange={(event) => setNewStation({ ...newStation, url: event.target.value })} /></div></div><button className="oa-btn primary" style={{ marginTop: 14 }} onClick={addCustom}><Plus size={16} /> {t('Hinzufügen', 'Add')}</button></div>
            <div className="oa-table-wrap"><table className="oa-table"><thead><tr><th>Name</th><th>Stream-URL</th><th /></tr></thead><tbody>{!gdata.custom.length && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#64748b', padding: 22 }}>{t('Noch keine eigenen Sender', 'No custom stations yet')}</td></tr>}{gdata.custom.map((station) => <tr key={station.key}><td style={{ fontWeight: 600 }}>{station.name}</td><td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{station.url}</td><td style={{ textAlign: 'right' }}><button className="oa-btn ghost" style={{ color: '#ff8fab' }} onClick={() => removeCustom(station.key)}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
          </>}
        </>}

        {section === 'roles' && <>{tier === 'free' ? <div className="oa-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Lock size={22} /><div><b>{t('Rollenrechte sind ab Pro verfügbar.', 'Role permissions are available from Pro.')}</b></div><button className="oa-btn primary" style={{ marginLeft: 'auto' }} onClick={() => setSection('subscription')}>Upgrade</button></div> : <><div className="oa-section-title"><ShieldCheck size={15} /> {t('Command-Berechtigungen', 'Command permissions')}</div>{!gdata.roles.length ? <div className="oa-card"><AlertTriangle size={18} color="#ffb020" /> {t('Discord-Rollen sind noch nicht synchronisiert. Aktualisiere die Ansicht, sobald der Commander online ist.', 'Discord roles have not been synchronized yet. Refresh once the commander is online.')}</div> : <><div className="oa-table-wrap" data-testid="guild-perms-matrix"><table className="oa-table"><thead><tr><th>Command</th>{gdata.roles.map((role) => <th key={role.id} style={{ textAlign: 'center', color: role.color || '#cbd5e1' }}>{role.name}</th>)}</tr></thead><tbody>{COMMANDS.map((command) => <tr key={command.id}><td className="oa-mono" style={{ color: '#ffb27a' }}>{command.label}</td>{gdata.roles.map((role) => { const enabled = !!perms[`${command.id}:${role.id}`]; return <td key={role.id} style={{ textAlign: 'center' }}><button onClick={() => togglePerm(command.id, role.id)} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: enabled ? 'linear-gradient(90deg,#ff6b00,#ff2a5f)' : '#2a3450', position: 'relative' }}><span style={{ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff' }} /></button></td>; })}</tr>)}</tbody></table></div><button className="oa-btn primary" style={{ marginTop: 16 }} onClick={savePerms}><Check size={16} /> {t('Speichern', 'Save')}</button></>}</>}</>}

        {section === 'stats' && <>{tier === 'free' ? <div className="oa-card"><Lock size={22} /> <b>{t('Statistiken sind ab Pro verfügbar.', 'Statistics are available from Pro.')}</b></div> : <><div className="oa-grid cols-3"><StatTile label={t('Ø Hörer', 'Avg. listeners')} value={fmtInt(Math.round(trendData.reduce((sum, row) => sum + row.listeners, 0) / Math.max(1, trendData.length)))} icon={Users} accent="#ff6b00" /><StatTile label={t('Peak Hörer', 'Peak listeners')} value={fmtInt(Math.max(0, ...trendData.map((row) => row.listeners)))} icon={BarChart3} accent="#00e5ff" /><StatTile label={t('Gestreamt', 'Streamed')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#10b981" /></div><div className="oa-card oa-fade" style={{ marginTop: 18 }}>{topData.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={topData} layout="vertical" margin={{ right: 16, left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#1b2133" horizontal={false} /><XAxis type="number" stroke="#64748b" fontSize={11} /><YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} width={140} /><Tooltip content={<ChartTip />} /><Bar dataKey="minutes" name={t('Minuten', 'Minutes')} radius={[0, 6, 6, 0]}>{topData.map((_, index) => <Cell key={index} fill={['#ff6b00', '#00e5ff', '#5865f2', '#10b981'][index % 4]} />)}</Bar></BarChart></ResponsiveContainer> : <div className="oa-sub" style={{ padding: 50, textAlign: 'center' }}>{t('Noch keine Wiedergabestatistik vorhanden.', 'No playback statistics available yet.')}</div>}</div></>}</>}

        {section === 'subscription' && <><div className="oa-card" style={{ marginBottom: 18 }} data-testid="guild-license-details"><div className="oa-section-title"><CreditCard size={15} /> {t('Aktive Lizenz', 'Active license')}</div><div className="oa-grid cols-3"><div><div className="oa-stat-label">Plan</div><div className="oa-stat-value" style={{ color: tm.color }}>{tm.name}</div></div><div><div className="oa-stat-label">Seats</div><div className="oa-stat-value">{gdata.license?.license ? `${gdata.license.license.seatsUsed}/${gdata.license.license.seats}` : '—'}</div></div><div><div className="oa-stat-label">{t('Läuft ab', 'Expires')}</div><div style={{ marginTop: 12, fontWeight: 700 }}>{gdata.license?.license?.expiresAt ? new Date(gdata.license.license.expiresAt).toLocaleDateString() : t('Keine aktive Kauf-Lizenz', 'No active paid license')}</div></div></div><div className="oa-mono" style={{ marginTop: 14, color: '#64748b', fontSize: 11 }}>Guild-ID {guild.id}{gdata.license?.license?.resolutionSource ? ` · Quelle: ${gdata.license.license.resolutionSource}` : ' · keine aktive Lizenzzuordnung gefunden'}</div></div><div className="oa-grid cols-3" data-testid="guild-subscription">{Object.entries(TIER_META).map(([key, meta]) => { const current = key === tier; return <div className="oa-card oa-fade" key={key} style={{ borderColor: current ? `${meta.color}66` : undefined, position: 'relative' }}>{current && <span className="oa-pill" style={{ position: 'absolute', top: 16, right: 16, color: meta.color }}>{t('Aktiv', 'Active')}</span>}<div style={{ width: 44, height: 44, borderRadius: 12, background: `${meta.color}1f`, color: meta.color, display: 'grid', placeItems: 'center', marginBottom: 14 }}><meta.icon size={22} /></div><div className="oa-display" style={{ fontSize: 22, fontWeight: 800 }}>{meta.name}</div><div style={{ margin: '12px 0 18px', color: '#cbd5e1', lineHeight: 1.8 }}><div><Check size={14} color={meta.color} /> {meta.maxBots} Bots</div><div><Check size={14} color={meta.color} /> {meta.bitrate} Audio</div><div><Check size={14} color={meta.color} /> {key === 'ultimate' ? t('Eigene Sender & Analytics', 'Custom stations & analytics') : key === 'pro' ? t('Dashboard & Rollenrechte', 'Dashboard & role permissions') : t('Basis-Radio', 'Basic radio')}</div></div>{current ? <button className="oa-btn ghost" style={{ width: '100%' }} disabled>{t('Aktueller Plan', 'Current plan')}</button> : <a className="oa-btn primary" style={{ width: '100%', textDecoration: 'none' }} href="/#pricing"><ChevronRight size={15} /> {key === 'free' ? 'Downgrade' : 'Upgrade'}</a>}</div>; })}</div></>}
      </main>
    </div>
  );
}
