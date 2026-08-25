import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radio, LayoutDashboard, ListMusic, ShieldCheck, BarChart3, CreditCard, LogOut,
  Plus, Trash2, Check, Crown, Zap, Music2, Users, Clock, Lock, Server,
  ChevronRight, RefreshCw, AlertTriangle,
  CalendarDays, Pencil,
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
  { id: 'events', icon: CalendarDays },
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
  { id: 'pause', label: '/pause' },
  { id: 'resume', label: '/resume' },
  { id: 'stop', label: '/stop' },
  { id: 'setvolume', label: '/setvolume' },
  { id: 'stations', label: '/stations' },
  { id: 'list', label: '/list' },
  { id: 'now', label: '/now' },
  { id: 'stats', label: '/stats' },
  { id: 'history', label: '/history' },
  { id: 'status', label: '/status' },
  { id: 'health', label: '/health' },
  { id: 'diag', label: '/diag' },
  { id: 'addstation', label: '/addstation' },
  { id: 'removestation', label: '/removestation' },
  { id: 'mystations', label: '/mystations' },
  { id: 'event', label: '/event' },
];

const EMPTY_DATA = Object.freeze({
  stations: [], custom: [], roles: [], events: [], voiceChannels: [], textChannels: [], trend: [], top: [], listeners: 0,
  uptimeSec: 0, minutesMonth: 0, activeStreams: 0, liveStreams: [],
  license: null, loading: false,
});

function fmtInt(value) { return Number(value || 0).toLocaleString(); }
function fmtMinutes(value) {
  const minutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(minutes / 60);
  return hours >= 1 ? `${fmtInt(hours)} h` : `${fmtInt(minutes)} min`;
}
function fmtDuration(value) {
  const seconds = Math.max(0, Number(value || 0));
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days} d ${hours % 24} h` : `${hours} h ${minutes % 60} min`;
}
function localDateTimeInput(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
function emptyEventForm() {
  return { id: '', title: '', stationKey: '', voiceChannelId: '', textChannelId: '', startsAt: localDateTimeInput(), durationMinutes: 120, repeat: 'none', timezone: 'Europe/Vienna', announceMessage: '', enabled: true };
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
  const [eventForm, setEventForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const { locale } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);
  const navLabel = useCallback((id) => ({
    overview: t('Übersicht', 'Overview'), stations: t('Sender', 'Stations'),
    events: t('Events', 'Events'),
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
      const [catalog, custom, rolesPayload, stats, detail, permsPayload, eventsPayload, channelsPayload] = await Promise.all([
        safe(`/api/dashboard/stations?${base}`),
        safe(`/api/dashboard/custom-stations?${base}`),
        safe(`/api/dashboard/roles?${base}`),
        safe(`/api/dashboard/stats?${base}`),
        tier === 'ultimate' ? safe(`/api/dashboard/stats/detail?${base}&days=30`) : null,
        tier === 'free' ? null : safe(`/api/dashboard/perms?${base}`),
        tier === 'free' ? null : safe(`/api/dashboard/events?${base}`),
        tier === 'free' ? null : safe(`/api/dashboard/channels?${base}`),
      ]);
      const stations = [...(catalog?.free || []), ...(catalog?.pro || [])];
      const basic = stats?.basic || {};
      const advanced = stats?.advanced || null;
      const listeningMs = Number(detail?.listeningStats?.totalListeningMs ?? basic.totalListeningMs ?? 0);
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
          events: eventsPayload?.events || [],
          voiceChannels: channelsPayload?.voiceChannels || [],
          textChannels: channelsPayload?.textChannels || [],
          trend: normalizeTrend(detail, advanced),
          top: normalizeTopStations(detail, advanced),
          listeners: Number(basic.listenersNow || 0),
          uptimeSec: Number(basic.runtimeUptimeSec || 0),
          minutesMonth: Math.round(listeningMs / 60000),
          activeStreams: Number(basic.activeStreams || 0),
          liveStreams: Array.isArray(basic.activeStreamDetails) ? basic.activeStreamDetails : [],
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

  useEffect(() => {
    if (!session.authenticated || !guildId) return undefined;
    let stopped = false;
    const refreshLive = async () => {
      try {
        const stats = await apiRequest(`/api/dashboard/stats?serverId=${encodeURIComponent(guildId)}`);
        if (stopped) return;
        const basic = stats?.basic || {};
        setStore((current) => {
          const previous = current[guildId] || EMPTY_DATA;
          return {
            ...current,
            [guildId]: {
              ...previous,
              listeners: Number(basic.listenersNow || 0),
              activeStreams: Number(basic.activeStreams || 0),
              liveStreams: Array.isArray(basic.activeStreamDetails) ? basic.activeStreamDetails : [],
              uptimeSec: Number(basic.runtimeUptimeSec || 0),
              minutesMonth: Math.round(Number(basic.totalListeningMs ?? previous.minutesMonth * 60000) / 60000),
            },
          };
        });
      } catch { /* keep the latest valid live snapshot */ }
    };
    const timer = setInterval(refreshLive, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [guildId, session.authenticated]);

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

  const openEvent = (event = null) => {
    if (!event) { setEventForm(emptyEventForm()); return; }
    setEventForm({
      id: event.id, title: event.title || event.name || '', stationKey: event.stationKey || '',
      voiceChannelId: event.voiceChannelId || event.channelId || '', textChannelId: event.textChannelId || '',
      startsAt: localDateTimeInput(event.startsAt || event.runAtMs), durationMinutes: Number(event.durationMinutes || Math.round(Number(event.durationMs || 0) / 60000) || 120),
      repeat: event.repeat || 'none', timezone: event.timezone || event.timeZone || 'Europe/Vienna', announceMessage: event.announceMessage || '', enabled: event.enabled !== false,
    });
  };
  const saveEvent = async () => {
    if (!eventForm?.title.trim() || !eventForm.stationKey || !eventForm.voiceChannelId || !eventForm.startsAt) {
      setMsg({ ok: false, text: t('Name, Sender, Voice-Kanal und Startzeit sind erforderlich.', 'Name, station, voice channel and start time are required.') }); return;
    }
    try {
      const payload = { ...eventForm, title: eventForm.title.trim(), runAtMs: 0, durationMs: Math.max(1, Number(eventForm.durationMinutes || 0)) * 60000 };
      const path = eventForm.id ? `/api/dashboard/events/${encodeURIComponent(eventForm.id)}?serverId=${encodeURIComponent(guildId)}` : `/api/dashboard/events?serverId=${encodeURIComponent(guildId)}`;
      const result = await apiRequest(path, { method: eventForm.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setStore((current) => {
        const previous = current[guildId] || EMPTY_DATA;
        const nextEvents = eventForm.id ? previous.events.map((row) => (row.id === eventForm.id ? result.event : row)) : [...previous.events, result.event];
        return { ...current, [guildId]: { ...previous, events: nextEvents.sort((a, b) => Number(a.runAtMs || 0) - Number(b.runAtMs || 0)) } };
      });
      setEventForm(null);
      setMsg({ ok: true, text: t('Event wurde im aktiven Scheduler gespeichert.', 'Event saved to the active scheduler.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  };
  const deleteEvent = async (eventId) => {
    if (typeof window !== 'undefined' && !window.confirm(t('Event wirklich löschen?', 'Delete this event?'))) return;
    try {
      await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(guildId)}`, { method: 'DELETE' });
      setStore((current) => ({ ...current, [guildId]: { ...(current[guildId] || EMPTY_DATA), events: (current[guildId]?.events || []).filter((row) => row.id !== eventId) } }));
      if (eventForm?.id === eventId) setEventForm(null);
      setMsg({ ok: true, text: t('Event wurde gelöscht.', 'Event deleted.') });
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
            <StatTile label="Uptime" value={gdata.uptimeSec > 0 ? fmtDuration(gdata.uptimeSec) : '—'} icon={Clock} accent="#10b981" foot={t('Bot-Prozess seit letztem Start', 'Bot process since last start')} />
            <StatTile label={t('Gestreamt', 'Streamed')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#00e5ff" foot={t('erfasste Wiedergabezeit', 'recorded playback time')} />
            <StatTile label={t('Aktive Streams', 'Active streams')} value={fmtInt(gdata.activeStreams)} icon={Server} accent="#5865f2" foot={`${tm.name} · ${tm.maxBots} ${t('Bots max.', 'bots max.')}`} />
          </div>
          <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
            <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }}><div className="oa-stat-label" style={{ marginBottom: 14 }}>{t('Hörer-Trend', 'Listener trend')}</div>
              {trendData.length ? <ResponsiveContainer width="100%" height={200}><AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}><defs><linearGradient id="gdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} /><stop offset="100%" stopColor="#ff6b00" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} /><XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><Tooltip content={<ChartTip />} /><Area type="monotone" dataKey="listeners" name={t('Hörer', 'Listeners')} stroke="#ff6b00" strokeWidth={2.5} fill="url(#gdArea)" /></AreaChart></ResponsiveContainer> : <div className="oa-sub" style={{ padding: '64px 0', textAlign: 'center' }}>{t('Noch keine Messwerte vorhanden.', 'No measurements available yet.')}</div>}
            </div>
            <div className="oa-card oa-fade">
              <div className="oa-stat-label" style={{ marginBottom: 12 }}>{t('Aktive Streams', 'Active streams')} ({gdata.liveStreams.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto', paddingRight: 3 }}>
                {!gdata.liveStreams.length && <div className="oa-sub" style={{ padding: '22px 0', textAlign: 'center' }}>{t('Kein aktiver Stream', 'No active stream')}</div>}
                {gdata.liveStreams.map((stream, index) => (
                  <div key={`${stream.botId || stream.botName}-${stream.channelId || index}`} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: '1px solid #20283b', background: '#0d111b' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: stream.recovering ? 'rgba(245,158,11,.15)' : 'linear-gradient(135deg,rgba(255,107,0,.22),rgba(255,42,95,.18))', display: 'grid', placeItems: 'center' }}><Radio size={17} color={stream.recovering ? '#fbbf24' : '#ff7a2f'} /></div>
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stream.stationName}</div><div className="oa-mono" style={{ fontSize: 10.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stream.botName} · {stream.channelName}</div></div>
                    <div style={{ textAlign: 'right' }}><span className={`oa-pill ${stream.recovering ? 'amber' : 'orange'}`} style={{ padding: '2px 7px' }}>{stream.recovering ? t('Recovery', 'Recovery') : 'LIVE'}</span><div className="oa-mono" style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{fmtInt(stream.listeners)} {t('Hörer', 'listeners')} · {fmtInt(stream.volume)}%</div></div>
                  </div>
                ))}
              </div>
              <button className="oa-btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setSection('stations')}><ListMusic size={15} /> {t('Senderkatalog', 'Station catalog')}</button>
            </div>
          </div>
        </>}

        {section === 'events' && <>{tier === 'free' ? <div className="oa-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}><Lock size={22} /><div><b>{t('Automatische Radio-Events sind ab Pro verfügbar.', 'Scheduled radio events are available from Pro.')}</b></div><button className="oa-btn primary" style={{ marginLeft: 'auto' }} onClick={() => setSection('subscription')}>Upgrade</button></div> : <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}><div><div className="oa-section-title" style={{ margin: 0 }}><CalendarDays size={15} /> {t('Geplante Radio-Events', 'Scheduled radio events')} ({gdata.events.length})</div><div className="oa-stat-foot" style={{ marginTop: 6 }}>{t('Events werden direkt im aktiven Commander-Scheduler gespeichert und nach Neustarts aus MongoDB wieder geladen.', 'Events are stored directly in the active Commander scheduler and restored from MongoDB after restarts.')}</div></div><button className="oa-btn primary" onClick={() => openEvent()}><Plus size={15} /> {t('Event anlegen', 'Create event')}</button></div>
          {eventForm && <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(255,107,0,.35)' }} data-testid="guild-event-form">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}><div style={{ fontWeight: 800, fontSize: 17 }}>{eventForm.id ? t('Event bearbeiten', 'Edit event') : t('Neues Event', 'New event')}</div><button className="oa-btn ghost" onClick={() => setEventForm(null)}>×</button></div>
            <div className="oa-grid cols-2" style={{ gap: 12 }}>
              <div><label className="oa-stat-label">Name</label><input className="oa-input" style={{ marginTop: 6 }} value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="Friday Night Radio" /></div>
              <div><label className="oa-stat-label">{t('Sender', 'Station')}</label><select className="oa-input" style={{ marginTop: 6 }} value={eventForm.stationKey} onChange={(e) => setEventForm({ ...eventForm, stationKey: e.target.value })}><option value="">— {t('auswählen', 'select')} —</option>{gdata.stations.map((station) => <option key={station.key} value={station.key}>{station.name}</option>)}{gdata.custom.map((station) => <option key={`custom:${station.key}`} value={`custom:${station.key}`}>{station.name} ({t('Eigener Sender', 'Custom')})</option>)}</select></div>
              <div><label className="oa-stat-label">Voice-Kanal</label><select className="oa-input" style={{ marginTop: 6 }} value={eventForm.voiceChannelId} onChange={(e) => setEventForm({ ...eventForm, voiceChannelId: e.target.value })}><option value="">— {t('auswählen', 'select')} —</option>{gdata.voiceChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
              <div><label className="oa-stat-label">{t('Ankündigungs-Kanal (optional)', 'Announcement channel (optional)')}</label><select className="oa-input" style={{ marginTop: 6 }} value={eventForm.textChannelId} onChange={(e) => setEventForm({ ...eventForm, textChannelId: e.target.value })}><option value="">—</option>{gdata.textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></div>
              <div><label className="oa-stat-label">{t('Start', 'Start')}</label><input type="datetime-local" className="oa-input" style={{ marginTop: 6 }} value={eventForm.startsAt} onChange={(e) => setEventForm({ ...eventForm, startsAt: e.target.value })} /></div>
              <div><label className="oa-stat-label">{t('Dauer (Minuten)', 'Duration (minutes)')}</label><input type="number" min="1" max="525600" className="oa-input" style={{ marginTop: 6 }} value={eventForm.durationMinutes} onChange={(e) => setEventForm({ ...eventForm, durationMinutes: e.target.value })} /></div>
              <div><label className="oa-stat-label">{t('Wiederholung', 'Repeat')}</label><select className="oa-input" style={{ marginTop: 6 }} value={eventForm.repeat} onChange={(e) => setEventForm({ ...eventForm, repeat: e.target.value })}><option value="none">{t('Einmalig', 'Once')}</option><option value="daily">{t('Täglich', 'Daily')}</option><option value="weekdays">{t('Werktags', 'Weekdays')}</option><option value="weekly">{t('Wöchentlich', 'Weekly')}</option><option value="biweekly">{t('Alle 2 Wochen', 'Biweekly')}</option><option value="monthly_first_weekday">{t('Monatlich · erster Wochentag', 'Monthly · first weekday')}</option><option value="monthly_last_weekday">{t('Monatlich · letzter Wochentag', 'Monthly · last weekday')}</option><option value="yearly">{t('Jährlich', 'Yearly')}</option></select></div>
              <div><label className="oa-stat-label">{t('Zeitzone', 'Timezone')}</label><input className="oa-input" style={{ marginTop: 6 }} value={eventForm.timezone} onChange={(e) => setEventForm({ ...eventForm, timezone: e.target.value })} placeholder="Europe/Vienna" /></div>
              <div style={{ gridColumn: '1 / -1' }}><label className="oa-stat-label">{t('Ankündigung (optional)', 'Announcement (optional)')}</label><input className="oa-input" style={{ marginTop: 6 }} value={eventForm.announceMessage} onChange={(e) => setEventForm({ ...eventForm, announceMessage: e.target.value })} /></div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14, color: '#cbd5e1', fontSize: 13 }}><input type="checkbox" checked={eventForm.enabled} onChange={(e) => setEventForm({ ...eventForm, enabled: e.target.checked })} /> {t('Event aktiv', 'Event enabled')}</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><button className="oa-btn primary" onClick={saveEvent}><Check size={15} /> {t('Im Scheduler speichern', 'Save to scheduler')}</button><button className="oa-btn ghost" onClick={() => setEventForm(null)}>{t('Abbrechen', 'Cancel')}</button></div>
          </div>}
          <div className="oa-table-wrap"><table className="oa-table"><thead><tr><th>Event</th><th>{t('Sender & Ziel', 'Station & target')}</th><th>{t('Start', 'Start')}</th><th>{t('Wiederholung', 'Repeat')}</th><th>Status</th><th /></tr></thead><tbody>{!gdata.events.length && <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>{t('Noch keine Events geplant.', 'No events scheduled yet.')}</td></tr>}{gdata.events.map((event) => { const voice = gdata.voiceChannels.find((channel) => channel.id === (event.voiceChannelId || event.channelId)); return <tr key={event.id}><td><b>{event.title || event.name}</b><div className="oa-mono" style={{ fontSize: 10, color: '#64748b' }}>{event.id}</div></td><td>{gdata.stations.concat(gdata.custom).find((station) => event.stationKey === station.key || event.stationKey === `custom:${station.key}`)?.name || event.stationKey}<div className="oa-mono" style={{ fontSize: 10, color: '#64748b' }}>{voice?.name || event.voiceChannelId}</div></td><td>{event.startsAt ? new Date(event.startsAt).toLocaleString() : '—'}<div className="oa-mono" style={{ fontSize: 10, color: '#64748b' }}>{event.durationMinutes || 0} min</div></td><td>{event.repeat === 'none' ? t('Einmalig', 'Once') : event.repeat}</td><td><span className={`oa-pill ${event.enabled === false ? 'slate' : 'green'}`}>{event.enabled === false ? t('Pausiert', 'Paused') : t('Aktiv', 'Active')}</span></td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="oa-btn ghost" onClick={() => openEvent(event)}><Pencil size={14} /></button><button className="oa-btn ghost" style={{ color: '#ff8fab', marginLeft: 6 }} onClick={() => deleteEvent(event.id)}><Trash2 size={14} /></button></td></tr>; })}</tbody></table></div>
        </>}</>}

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
