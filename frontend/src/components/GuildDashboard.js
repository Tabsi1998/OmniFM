import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radio, LayoutDashboard, ListMusic, ShieldCheck, BarChart3, CreditCard, LogOut,
  Plus, Trash2, Check, Crown, Zap, Music2, Users, Clock, Lock, Server,
  ChevronRight, RefreshCw, AlertTriangle,
  CalendarDays, Settings, MessageSquareWarning,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell,
} from 'recharts';
import { buildApiUrl } from '../lib/api.js';
import { dashboardApiRequest } from '../lib/dashboardApi.js';
import { isDashboardDemo, isDashboardTour } from '../lib/dashboardDemoMode.js';
import { buildPageHref } from '../lib/pageRouting.js';
import { useI18n } from '../i18n.js';
import DashboardEvents from './DashboardEvents.js';
import DashboardSettings from './DashboardSettings.js';
import GuildLiveView from './GuildLiveView.js';
import DashboardReportDialog from './DashboardReportDialog.js';
import { normalizeDashboardCapabilityPayload } from '../lib/dashboardCapabilities.js';
import { PLAN_LIMITS, PLAN_NAMES } from '../../../src/config/plan-features.js';
import PlanLock from './PlanLock.js';
import GuildStreamControls from './overview/GuildStreamControls.js';
import SeasonBadge from './season/SeasonBadge.js';

const NAV = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'stations', icon: ListMusic },
  { id: 'events', icon: CalendarDays },
  { id: 'roles', icon: ShieldCheck },
  { id: 'stats', icon: BarChart3 },
  { id: 'subscription', icon: CreditCard },
  // Panel designer, bot look, weekly recap, failover, voice guard, exports (#375).
  { id: 'settings', icon: Settings },
];

// Numbers from the bot's plan file (#413).
const planMeta = (plan, color, icon) => ({
  name: PLAN_NAMES[plan], color, icon,
  customLimit: PLAN_LIMITS[plan].customStations, maxBots: PLAN_LIMITS[plan].maxBots, bitrate: PLAN_LIMITS[plan].bitrate,
});
const TIER_META = {
  free: planMeta('free', '#64748b', Radio),
  pro: planMeta('pro', '#00e5ff', Zap),
  ultimate: planMeta('ultimate', '#ff6b00', Crown),
};

const COMMANDS = [
  { id: 'play', label: '/play' },
  { id: 'pause', label: '/pause' },
  { id: 'resume', label: '/resume' },
  { id: 'stop', label: '/stop' },
  { id: 'setvolume', label: '/setvolume' },
  { id: 'sleep', label: '/sleep' },
  { id: 'poll', label: '/poll' },
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
  license: null, setupStatus: null, loading: false,
});

function fmtInt(value) { return Number(value || 0).toLocaleString(); }

const PARKED_REASON_LABELS = {
  permissions: { de: 'dem Bot fehlen Rechte im Voice-Kanal', en: 'the bot lacks permissions in the voice channel' },
  circuit: { de: 'zu viele Fehlversuche beim Verbinden', en: 'too many failed connection attempts' },
  'voice-ready': { de: 'die Voice-Verbindung kommt nicht zustande', en: 'the voice connection does not come up' },
  'voice-confirmation': { de: 'Discord bestätigt die Voice-Verbindung nicht', en: 'Discord does not confirm the voice connection' },
};
const PARKED_REASON_FALLBACK = { de: 'Verbindung scheitert wiederholt', en: 'connection keeps failing' };

// One line under the station name that says what is going on (#216).
function streamStateLine(stream, t) {
  if (stream.parkedReason) {
    const reason = PARKED_REASON_LABELS[stream.parkedReason] || PARKED_REASON_FALLBACK;
    return t('Pausiert: {reason}. Neuer Versuch alle 15 Minuten.', 'Paused: {reason}. Next try every 15 minutes.', { reason: t(reason.de, reason.en) });
  }
  if (stream.serverMuted) {
    return t('Der Bot ist auf dem Server stummgeschaltet.', 'The bot is server-muted.');
  }
  if (stream.failoverActive) {
    const desired = stream.desiredStationName || stream.failoverFromStationName || stream.desiredStationKey;
    const next = Number(stream.failbackNextProbeAt || 0);
    const nextText = next > Date.now()
      ? t(' · nächster Versuch {time}', ' · next try {time}', { time: new Date(next).toLocaleTimeString() })
      : '';
    return t('Ersatz für {station}{next}', 'Backup for {station}{next}', { station: desired, next: nextText });
  }
  return '';
}

// Where the server's license comes from, in words (the API names it by its technical source).
function licenseSource(source, t) {
  if (!source) return t('keine aktive Lizenzzuordnung gefunden', 'no active license assignment found');
  const label = {
    serverEntitlement: t('direkt für diesen Server', 'assigned to this server'),
    linkedServerIds: t('über eine verknüpfte Lizenz', 'through a linked license'),
    legacyServerKey: t('ältere Zuordnung', 'older assignment'),
  }[source] || source;
  return `${t('Quelle', 'Source')}: ${label}`;
}

function streamBadge(stream, t) {
  if (stream.parkedReason) return { label: t('PAUSIERT', 'PAUSED'), tone: 'red' };
  if (stream.serverMuted) return { label: t('STUMM', 'MUTED'), tone: 'amber' };
  if (stream.failoverActive) return { label: t('ERSATZ', 'BACKUP'), tone: 'amber' };
  if (stream.recovering) return { label: t('Recovery', 'Recovery'), tone: 'amber' };
  return { label: 'LIVE', tone: 'orange' };
}
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
  return {
    title: '', stationKey: '', channelId: '', textChannelId: '',
    startsAt: localDateTimeInput(), durationMinutes: '120', repeat: 'none', timezone: 'Europe/Vienna',
    announceMessage: '', description: '', stageTopic: '', createDiscordEvent: false, enabled: true,
  };
}
function eventFormFromRow(event) {
  return {
    title: event?.title || event?.name || '',
    stationKey: event?.stationKey || '',
    channelId: event?.channelId || event?.voiceChannelId || '',
    textChannelId: event?.textChannelId || '',
    startsAt: event?.startsAtLocal || localDateTimeInput(event?.startsAt || event?.runAtMs),
    durationMinutes: Number(event?.durationMs || 0) > 0
      ? String(Math.round(Number(event.durationMs) / 60000))
      : '',
    repeat: event?.repeat || 'none',
    timezone: event?.timezone || event?.timeZone || 'Europe/Vienna',
    announceMessage: event?.announceMessage || '',
    description: event?.description || '',
    stageTopic: event?.stageTopic || '',
    createDiscordEvent: event?.createDiscordEvent === true,
    enabled: event?.enabled !== false,
  };
}

// Every change carries the dashboard's CSRF header; without it the API refuses it (#374).
// In the preview (/dashboard?demo, #432) the answers come from example data in
// the page instead, loaded only there; nothing goes to the server.
let demoRequest = null;
const apiRequest = (path, options = {}) => {
  if (!isDashboardDemo()) return dashboardApiRequest(path, options);
  if (!demoRequest) demoRequest = import('../lib/dashboardDemoApi.js').then((module) => module.createPageDemoApi());
  return demoRequest.then((request) => request(path, options));
};

// Says that this is the preview, with the way to the real dashboard; in the start page's tour without buttons.
function DemoBanner({ t, locale }) {
  const tour = isDashboardTour();
  return (
    <div className="oa-card" data-testid="guild-demo-banner" style={{ marginBottom: 16, padding: tour ? '10px 14px' : undefined, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'rgba(255,107,0,0.45)', background: 'linear-gradient(90deg, rgba(255,107,0,0.12), rgba(255,42,95,0.05))' }}>
      <span className="oa-pill" style={{ color: '#ffb27a', border: '1px solid rgba(255,107,0,0.45)' }}>{t('Vorschau', 'Preview')}</span>
      <div style={{ flex: '1 1 240px', minWidth: 0, color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.5 }}>{t('Beispieldaten zum Anschauen: drei Server, einer pro Plan. Nichts hier wird gespeichert.', 'Example data to look around: three servers, one per plan. Nothing here is saved.')}</div>
      {tour ? null : <>
        <a href={buildApiUrl('/api/auth/discord/login?redirect=1&nextPage=dashboard')} className="oa-btn primary" style={{ background: 'linear-gradient(135deg,#5865f2,#4752c4)', color: '#fff', textDecoration: 'none' }} data-testid="guild-demo-login">{t('Mit Discord anmelden', 'Continue with Discord')}</a>
        <a href={buildPageHref(locale, 'home')} className="oa-btn ghost" style={{ textDecoration: 'none' }} data-testid="guild-demo-website">{t('Zurück zur Website', 'Back to website')}</a>
      </>}
    </div>
  );
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
  const [eventForm, setEventForm] = useState(() => emptyEventForm());
  const [editingEventId, setEditingEventId] = useState('');
  const [msg, setMsg] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const { locale, formatDate, t } = useI18n();
  const navLabel = useCallback((id) => ({
    overview: t('Übersicht', 'Overview'), stations: t('Sender', 'Stations'),
    events: t('Events', 'Events'),
    roles: t('Rollen & Rechte', 'Roles & Permissions'), stats: t('Statistiken', 'Statistics'),
    subscription: t('Abo & Lizenz', 'Subscription & License'),
    settings: t('Einstellungen', 'Settings'),
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
      // #413: what plays where, the stations, one event and the channels on every plan.
      const [catalog, custom, rolesPayload, stats, detail, permsPayload, eventsPayload, channelsPayload, now] = await Promise.all([
        safe(`/api/dashboard/stations?${base}`),
        tier === 'ultimate' ? safe(`/api/dashboard/custom-stations?${base}`) : null,
        tier === 'free' ? null : safe(`/api/dashboard/roles?${base}`),
        tier === 'free' ? null : safe(`/api/dashboard/stats?${base}`),
        tier === 'ultimate' ? safe(`/api/dashboard/stats/detail?${base}&days=30`) : null,
        tier === 'free' ? null : safe(`/api/dashboard/perms?${base}`),
        safe(`/api/dashboard/events?${base}`),
        safe(`/api/dashboard/channels?${base}`),
        safe(`/api/dashboard/playback/now?${base}`),
      ]);
      const nowStreams = Array.isArray(now?.streams) ? now.streams : null;
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
          listeners: nowStreams ? nowStreams.reduce((sum, row) => sum + (Number(row.listeners) || 0), 0) : Number(basic.listenersNow || 0),
          uptimeSec: Number(basic.runtimeUptimeSec || 0) || Math.max(0, ...(nowStreams || []).map((row) => Number(row.uptimeSec) || 0)),
          minutesMonth: Math.round(listeningMs / 60000),
          activeStreams: nowStreams ? nowStreams.length : Number(basic.activeStreams || 0),
          liveStreams: nowStreams || (Array.isArray(basic.activeStreamDetails) ? basic.activeStreamDetails : []),
          setupStatus: basic.setupStatus || null,
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

  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!session.authenticated || !guildId) return undefined;
    let stopped = false;
    const refreshLive = async () => {
      try {
        const free = (sessionRef.current.guilds.find((item) => item.id === guildId)?.tier || 'free') === 'free';
        // #413: Free has no stats, only the list of what plays where.
        const stats = free
          ? { basic: await apiRequest(`/api/dashboard/playback/now?serverId=${encodeURIComponent(guildId)}`).then((now) => {
            const streams = Array.isArray(now?.streams) ? now.streams : [];
            return {
              listenersNow: streams.reduce((sum, row) => sum + (Number(row.listeners) || 0), 0),
              activeStreams: streams.length,
              activeStreamDetails: streams,
              runtimeUptimeSec: Math.max(0, ...streams.map((row) => Number(row.uptimeSec) || 0)),
            };
          }) }
          : await apiRequest(`/api/dashboard/stats?serverId=${encodeURIComponent(guildId)}`);
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
              minutesMonth: basic.totalListeningMs === undefined ? previous.minutesMonth : Math.round(Number(basic.totalListeningMs) / 60000),
              setupStatus: basic.setupStatus || previous.setupStatus || null,
            },
          };
        });
      } catch { /* keep the latest valid live snapshot */ }
    };
    const timer = setInterval(refreshLive, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [guildId, session.authenticated]);

  const guild = useMemo(() => session.guilds.find((item) => item.id === guildId) || null, [session.guilds, guildId]);
  // What this server may use, from the session like the settings expect it (#375).
  const guildCapabilities = useMemo(() => normalizeDashboardCapabilityPayload(guild ? {
    serverId: guild.id, tier: guild.tier, capabilities: guild.capabilities, limits: guild.limits, upgradeHints: guild.upgradeHints,
  } : null).capabilities, [guild]);
  const gdata = store[guildId] || EMPTY_DATA;
  const tier = gdata.license?.tier || guild?.tier || 'free';
  const tm = TIER_META[tier] || TIER_META.free;
  // The stations a bot can switch to: the plan's catalogue, on Ultimate also the server's own (#413).
  const streamStationOptions = useMemo(() => [
    ...(gdata.stations || []).map((station) => ({ key: station.key, name: station.name || station.key })),
    ...(tier === 'ultimate' ? (gdata.custom || []).map((station) => ({ key: `custom:${station.key}`, name: station.name || station.key })) : []),
  ], [gdata.stations, gdata.custom, tier]);
  const eventDependencies = useMemo(() => ({
    voiceChannels: gdata.voiceChannels,
    textChannels: gdata.textChannels,
    stations: {
      free: gdata.stations.filter((station) => String(station?.tier || 'free').toLowerCase() === 'free'),
      pro: gdata.stations.filter((station) => String(station?.tier || 'free').toLowerCase() !== 'free'),
      ultimate: [],
      custom: gdata.custom,
    },
  }), [gdata.custom, gdata.stations, gdata.textChannels, gdata.voiceChannels]);

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

  const resetEventEditor = useCallback(() => {
    setEditingEventId('');
    setEventForm(emptyEventForm());
  }, []);
  const startEditingEvent = useCallback((event) => {
    setEditingEventId(event?.id || '');
    setEventForm(eventFormFromRow(event));
  }, []);
  const saveEvent = useCallback(async () => {
    if (!eventForm?.title.trim() || !eventForm.stationKey || !eventForm.channelId || !eventForm.startsAt) {
      setMsg({ ok: false, text: t('Name, Sender, Voice-Kanal und Startzeit sind erforderlich.', 'Name, station, voice channel and start time are required.') });
      return { ok: false };
    }
    try {
      const durationMinutes = Math.max(0, Math.min(525600, Number(eventForm.durationMinutes || 0) || 0));
      const payload = {
        ...eventForm,
        title: eventForm.title.trim(),
        startsAtLocal: eventForm.startsAt,
        durationMs: durationMinutes * 60000,
      };
      const path = editingEventId ? `/api/dashboard/events/${encodeURIComponent(editingEventId)}?serverId=${encodeURIComponent(guildId)}` : `/api/dashboard/events?serverId=${encodeURIComponent(guildId)}`;
      const result = await apiRequest(path, { method: editingEventId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setStore((current) => {
        const previous = current[guildId] || EMPTY_DATA;
        const nextEvents = [...previous.events.filter((row) => row.id !== result.event?.id), result.event]
          .filter(Boolean)
          .sort((a, b) => Number(a.runAtMs || 0) - Number(b.runAtMs || 0));
        return { ...current, [guildId]: { ...previous, events: nextEvents } };
      });
      resetEventEditor();
      setMsg({ ok: true, text: editingEventId ? t('Event wurde aktualisiert.', 'Event updated.') : t('Event wurde im aktiven Scheduler gespeichert.', 'Event saved to the active scheduler.') });
      return { ok: true, event: result.event };
    } catch (error) {
      setMsg({ ok: false, text: error.message });
      return { ok: false, error };
    }
  }, [editingEventId, eventForm, guildId, resetEventEditor, t]);
  const toggleEvent = useCallback(async (eventId, enabled) => {
    try {
      const result = await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(guildId)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setStore((current) => {
        const previous = current[guildId] || EMPTY_DATA;
        return { ...current, [guildId]: { ...previous, events: previous.events.map((row) => (row.id === eventId ? result.event : row)) } };
      });
      if (editingEventId === eventId && result.event) setEventForm(eventFormFromRow(result.event));
      setMsg({ ok: true, text: enabled ? t('Event aktiviert.', 'Event enabled.') : t('Event pausiert.', 'Event paused.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  }, [editingEventId, guildId, t]);
  const deleteEvent = useCallback(async (eventId) => {
    if (typeof window !== 'undefined' && !window.confirm(t('Event wirklich löschen?', 'Delete this event?'))) return;
    try {
      await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(guildId)}`, { method: 'DELETE' });
      setStore((current) => ({ ...current, [guildId]: { ...(current[guildId] || EMPTY_DATA), events: (current[guildId]?.events || []).filter((row) => row.id !== eventId) } }));
      if (editingEventId === eventId) resetEventEditor();
      setMsg({ ok: true, text: t('Event wurde gelöscht.', 'Event deleted.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  }, [editingEventId, guildId, resetEventEditor, t]);

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
      <div style={{ textAlign: 'center', color: '#94a3b8' }}><span className="oa-eq"><span /><span /><span /><span /><span /></span><div className="oa-mono" style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.14em' }}>{t('DASHBOARD LÄDT…', 'DASHBOARD LOADING…')}</div></div>
    </div>
  );

  if (!session.authenticated) return (
    <div className="oa-root"><div className="oa-login"><div className="oa-login-card oa-fade" data-testid="guild-login-gate">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div className="oa-brand-logo"><img src="/brand/omnifm-mark.svg" alt="" width="28" height="28" /></div><div><div className="oa-display" style={{ fontSize: 20, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div></div>
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
  const demo = isDashboardDemo();
  return (
    <div className="oa-root" data-testid="guild-dashboard">
      <aside className="oa-sidebar">
        <div className="oa-brand"><div className="oa-brand-logo"><img src="/brand/omnifm-mark.svg" alt="" width="28" height="28" /></div><div><div className="oa-display" style={{ fontSize: 18, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div></div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {NAV.map((item) => <button key={item.id} className={`oa-nav-btn ${section === item.id ? 'active' : ''}`} onClick={() => setSection(item.id)} data-testid={`guild-nav-${item.id}`}><item.icon size={18} /> {navLabel(item.id)}</button>)}
        </nav>
        <button className="oa-nav-btn" style={{ color: '#ff8fab' }} onClick={logout} data-testid="guild-logout"><LogOut size={18} /> {t('Abmelden', 'Sign out')}</button>
      </aside>

      <main className="oa-main">
        {demo ? <DemoBanner t={t} locale={locale} /> : null}
        <div className="oa-topbar">
          <div><h1 className="oa-h1 oa-display" data-testid="guild-section-title">{navLabel(section)}</h1><div className="oa-sub">{guild.name}{Number(guild.memberCount || guild.members) > 0 ? ` · ${fmtInt(guild.memberCount || guild.members)} ${t('Mitglieder', 'members')}` : ''} · <span className="oa-mono">Guild-ID {guild.id}</span></div></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
            <button className="oa-btn ghost" onClick={() => loadGuild(guildId)} disabled={gdata.loading} title={t('Aktualisieren', 'Refresh')}><RefreshCw size={15} /></button>
            {/* A problem, an idea or feedback for the OmniFM team (#436). */}
            <button className="oa-btn ghost" onClick={() => setReportOpen(true)} title={t('Problem, Idee oder Feedback ans OmniFM-Team', 'A problem, an idea or feedback for the OmniFM team')} data-testid="guild-report-open"><MessageSquareWarning size={15} /> {t('Melden', 'Report')}</button>
            {/* The season's badge asks the server for the owner's switches; the preview asks nothing. */}
            {demo ? null : <SeasonBadge />}
            <span className="oa-pill" style={{ background: `${tm.color}22`, color: tm.color, border: `1px solid ${tm.color}55` }} data-testid="guild-active-tier"><tm.icon size={13} /> {tm.name}</span>
            <select className="oa-input" style={{ height: 40, width: 'auto', maxWidth: 'min(360px, 100%)', minWidth: 0 }} value={guildId} onChange={(event) => setGuildId(event.target.value)} data-testid="guild-switcher">{session.guilds.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>
          </div>
        </div>
        <div className="oa-mobile-nav">{NAV.map((item) => <button key={item.id} className={`oa-nav-btn ${section === item.id ? 'active' : ''}`} style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => setSection(item.id)} data-testid={`guild-mobile-nav-${item.id}`}><item.icon size={16} /> {navLabel(item.id)}</button>)}</div>
        {reportOpen ? <DashboardReportDialog apiRequest={apiRequest} guildId={guildId} t={t} onClose={() => setReportOpen(false)} /> : null}
        {msg && <div className={`oa-pill ${msg.ok ? 'green' : 'red'}`} style={{ marginBottom: 16 }} data-testid="guild-message">{msg.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}</div>}

        {section === 'overview' && <>
          <div className="oa-grid cols-4">
            <StatTile label={t('Aktive Hörer', 'Active listeners')} value={fmtInt(gdata.listeners)} icon={Users} accent="#ff6b00" foot={t('Echtzeit-Telemetrie', 'Real-time telemetry')} />
            <StatTile label="Uptime" value={gdata.uptimeSec > 0 ? fmtDuration(gdata.uptimeSec) : '—'} icon={Clock} accent="#10b981" foot={t('Bot-Prozess seit letztem Start', 'Bot process since last start')} />
            <StatTile label={t('Gestreamt', 'Streamed')} value={tier === 'free' ? '—' : fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#00e5ff" foot={tier === 'free' ? t('Statistik gibt es ab Pro', 'Statistics come with Pro') : t('erfasste Wiedergabezeit', 'recorded playback time')} />
            <StatTile label={t('Aktive Streams', 'Active streams')} value={fmtInt(gdata.activeStreams)} icon={Server} accent="#5865f2" foot={`${tm.name} · ${tm.maxBots} ${t('Bots max.', 'bots max.')}`} />
          </div>
          <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
            {tier === 'free'
              ? <div style={{ gridColumn: 'span 2' }}><PlanLock plan="pro" title={t('Hörer-Verlauf und Statistik', 'Listener trend and statistics')} t={t} locale={locale} testId="guild-trend-locked" /></div>
              : <>
            <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }}><div className="oa-stat-label" style={{ marginBottom: 14 }}>{t('Hörer-Trend', 'Listener trend')}</div>
              {trendData.length ? <ResponsiveContainer width="100%" height={200}><AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}><defs><linearGradient id="gdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} /><stop offset="100%" stopColor="#ff6b00" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} /><XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} /><Tooltip content={<ChartTip />} /><Area type="monotone" dataKey="listeners" name={t('Hörer', 'Listeners')} stroke="#ff6b00" strokeWidth={2.5} fill="url(#gdArea)" /></AreaChart></ResponsiveContainer> : <div className="oa-sub" style={{ padding: '64px 0', textAlign: 'center' }}>{t('Noch keine Messwerte vorhanden.', 'No measurements available yet.')}</div>}
            </div>
              </>}
            <div className="oa-card oa-fade">
              <div className="oa-stat-label" style={{ marginBottom: 12 }}>{t('Aktive Streams', 'Active streams')} ({gdata.liveStreams.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto', paddingRight: 3 }}>
                {!gdata.liveStreams.length && <div className="oa-sub" style={{ padding: '22px 0', textAlign: 'center' }}>{t('Kein aktiver Stream', 'No active stream')}</div>}
                {gdata.liveStreams.map((stream, index) => (
                  <div key={`${stream.botId || stream.botName}-${stream.channelId || index}`} style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, border: '1px solid #20283b', background: '#0d111b' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: stream.recovering ? 'rgba(245,158,11,.15)' : 'linear-gradient(135deg,rgba(255,107,0,.22),rgba(255,42,95,.18))', display: 'grid', placeItems: 'center' }}><Radio size={17} color={stream.recovering ? '#fbbf24' : '#ff7a2f'} /></div>
                    <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stream.stationName}</div>{streamStateLine(stream, t) && <div title={streamStateLine(stream, t)} style={{ fontSize: 10.5, color: stream.parkedReason ? '#f87171' : '#fbbf24', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{streamStateLine(stream, t)}</div>}<div className="oa-mono" style={{ fontSize: 10.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stream.botName} · {stream.channelName}</div></div>
                    <div style={{ textAlign: 'right' }}><span className={`oa-pill ${streamBadge(stream, t).tone}`} style={{ padding: '2px 7px' }}>{streamBadge(stream, t).label}</span><div className="oa-mono" style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{fmtInt(stream.listeners)} {t('Hörer', 'listeners')} · {fmtInt(stream.volume)}%</div></div>
                    <GuildStreamControls stream={stream} stationOptions={streamStationOptions} apiRequest={apiRequest} guildId={guildId} t={t} onChanged={() => loadGuild(guildId)} />
                  </div>
                ))}
              </div>
              {gdata.liveStreams.some((stream) => stream.failoverActive) && <div className="oa-sub" style={{ marginTop: 10, fontSize: 11.5 }}>{t('Zurück zum Wunschsender: Button „Zurück zu …“ unter der Now-Playing-Nachricht in Discord.', 'Back to the preferred station: the "Back to …" button below the now-playing message in Discord.')}</div>}
              <button className="oa-btn ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setSection('stations')}><ListMusic size={15} /> {t('Senderkatalog', 'Station catalog')}</button>
            </div>
          </div>
          {/* The playback of every bot over the last 24 hours (#304), from Pro on like the health view. */}
          {guildCapabilities?.basicHealth && <GuildLiveView apiRequest={apiRequest} guildId={guildId} t={t} locale={locale} />}
        </>}

        {section === 'events' && <>{tier === 'free' ? <div className="oa-sub" style={{ marginBottom: 12 }} data-testid="guild-events-free-note">{t('Mit Free geht {count} geplantes Event, mit Pro beliebig viele.', 'Free comes with {count} scheduled event, Pro with as many as you like.', { count: PLAN_LIMITS.free.events })}</div> : null}<>
          <DashboardEvents
            events={gdata.events}
            eventForm={eventForm}
            setEventForm={setEventForm}
            editingEventId={editingEventId}
            onSaveEvent={saveEvent}
            onToggleEvent={toggleEvent}
            onDeleteEvent={deleteEvent}
            onStartEditEvent={startEditingEvent}
            onCancelEditEvent={resetEventEditor}
            t={t}
            formatDate={formatDate}
            apiRequest={apiRequest}
            selectedGuildId={guildId}
            setupStatus={gdata.setupStatus}
            prefetchedDependencies={eventDependencies}
          />
        </></>}

        {section === 'stations' && <>
          <div className="oa-section-title"><Radio size={15} /> {t('Verfügbare Sender', 'Available stations')} ({gdata.stations.length})</div>
          <div className="oa-grid cols-3" data-testid="guild-preset-stations">{gdata.stations.map((station) => <div key={station.key} className="oa-card hoverable"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 38, height: 38, borderRadius: 10, background: '#1c2235', display: 'grid', placeItems: 'center' }}><Music2 size={17} color="#94a3b8" /></div><div><div style={{ fontWeight: 700 }}>{station.name}</div><div className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{station.genre || 'Radio'}</div></div></div></div>)}</div>
          <div className="oa-section-title" style={{ marginTop: 28 }}><ListMusic size={15} /> {t('Eigene Sender', 'Custom stations')} ({gdata.custom.length}/{tm.customLimit || 0})</div>
          {tier !== 'ultimate' ? <PlanLock plan="ultimate" title={t('Eigene Sender', 'Your own stations')} t={t} locale={locale} testId="guild-custom-locked" /> : <>
            <div className="oa-card" style={{ marginBottom: 16 }} data-testid="guild-custom-form"><div className="oa-grid cols-2" style={{ gap: 12 }}><div><label className="oa-stat-label">Name</label><input className="oa-input" style={{ marginTop: 6 }} value={newStation.name} onChange={(event) => setNewStation({ ...newStation, name: event.target.value })} /></div><div><label className="oa-stat-label">Stream-URL</label><input className="oa-input" style={{ marginTop: 6 }} value={newStation.url} placeholder="https://…/stream.mp3" onChange={(event) => setNewStation({ ...newStation, url: event.target.value })} /></div></div><button className="oa-btn primary" style={{ marginTop: 14 }} onClick={addCustom}><Plus size={16} /> {t('Hinzufügen', 'Add')}</button></div>
            <div className="oa-table-wrap"><table className="oa-table"><thead><tr><th>Name</th><th>Stream-URL</th><th /></tr></thead><tbody>{!gdata.custom.length && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#64748b', padding: 22 }}>{t('Noch keine eigenen Sender', 'No custom stations yet')}</td></tr>}{gdata.custom.map((station) => <tr key={station.key}><td style={{ fontWeight: 600 }}>{station.name}</td><td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8' }}>{station.url}</td><td style={{ textAlign: 'right' }}><button className="oa-btn ghost" style={{ color: '#ff8fab' }} onClick={() => removeCustom(station.key)}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
          </>}
        </>}

        {section === 'roles' && <>{tier === 'free' ? <PlanLock plan="pro" title={t('Rollenrechte', 'Role permissions')} t={t} locale={locale} testId="guild-roles-locked" /> : <><div className="oa-section-title"><ShieldCheck size={15} /> {t('Command-Berechtigungen', 'Command permissions')}</div>{!gdata.roles.length ? <div className="oa-card"><AlertTriangle size={18} color="#ffb020" /> {t('Discord-Rollen sind noch nicht synchronisiert. Aktualisiere die Ansicht, sobald der Commander online ist.', 'Discord roles have not been synchronized yet. Refresh once the commander is online.')}</div> : <><div className="oa-table-wrap" data-testid="guild-perms-matrix"><table className="oa-table"><thead><tr><th>Command</th>{gdata.roles.map((role) => <th key={role.id} style={{ textAlign: 'center', color: role.color || '#cbd5e1' }}>{role.name}</th>)}</tr></thead><tbody>{COMMANDS.map((command) => <tr key={command.id}><td className="oa-mono" style={{ color: '#ffb27a' }}>{command.label}</td>{gdata.roles.map((role) => { const enabled = !!perms[`${command.id}:${role.id}`]; return <td key={role.id} style={{ textAlign: 'center' }}><button onClick={() => togglePerm(command.id, role.id)} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: enabled ? 'linear-gradient(90deg,#ff6b00,#ff2a5f)' : '#2a3450', position: 'relative' }}><span style={{ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff' }} /></button></td>; })}</tr>)}</tbody></table></div><button className="oa-btn primary" style={{ marginTop: 16 }} onClick={savePerms}><Check size={16} /> {t('Speichern', 'Save')}</button></>}</>}</>}

        {section === 'stats' && <>{tier === 'free' ? <PlanLock plan="pro" title={t('Statistik', 'Statistics')} t={t} locale={locale} testId="guild-stats-locked" /> : <><div className="oa-grid cols-3"><StatTile label={t('Ø Hörer', 'Avg. listeners')} value={fmtInt(Math.round(trendData.reduce((sum, row) => sum + row.listeners, 0) / Math.max(1, trendData.length)))} icon={Users} accent="#ff6b00" /><StatTile label={t('Peak Hörer', 'Peak listeners')} value={fmtInt(Math.max(0, ...trendData.map((row) => row.listeners)))} icon={BarChart3} accent="#00e5ff" /><StatTile label={t('Gestreamt', 'Streamed')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#10b981" /></div><div className="oa-card oa-fade" style={{ marginTop: 18 }}>{topData.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={topData} layout="vertical" margin={{ right: 16, left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#1b2133" horizontal={false} /><XAxis type="number" stroke="#64748b" fontSize={11} /><YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} width={140} /><Tooltip content={<ChartTip />} /><Bar dataKey="minutes" name={t('Minuten', 'Minutes')} radius={[0, 6, 6, 0]}>{topData.map((_, index) => <Cell key={index} fill={['#ff6b00', '#00e5ff', '#5865f2', '#10b981'][index % 4]} />)}</Bar></BarChart></ResponsiveContainer> : <div className="oa-sub" style={{ padding: 50, textAlign: 'center' }}>{t('Noch keine Wiedergabestatistik vorhanden.', 'No playback statistics available yet.')}</div>}</div></>}</>}

        {section === 'settings' && (guildCapabilities.dashboardBasic
          ? <DashboardSettings apiRequest={apiRequest} selectedGuildId={guild.id} t={t} capabilities={guildCapabilities} formatDate={formatDate} />
          : <div className="oa-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }} data-testid="guild-settings-locked"><Lock size={22} /><div><b>{t('Einstellungen sind ab Pro verfügbar.', 'Settings are available from Pro.')}</b></div><button className="oa-btn primary" style={{ marginLeft: 'auto' }} onClick={() => setSection('subscription')}>Upgrade</button></div>)}
        {section === 'subscription' && <><div className="oa-card" style={{ marginBottom: 18 }} data-testid="guild-license-details"><div className="oa-section-title"><CreditCard size={15} /> {t('Aktive Lizenz', 'Active license')}</div><div className="oa-grid cols-3"><div><div className="oa-stat-label">Plan</div><div className="oa-stat-value" style={{ color: tm.color }}>{tm.name}</div></div><div><div className="oa-stat-label">Seats</div><div className="oa-stat-value">{gdata.license?.license ? `${gdata.license.license.seatsUsed}/${gdata.license.license.seats}` : '—'}</div></div><div><div className="oa-stat-label">{t('Läuft ab', 'Expires')}</div><div style={{ marginTop: 12, fontWeight: 700 }}>{gdata.license?.license?.expiresAt ? new Date(gdata.license.license.expiresAt).toLocaleDateString() : t('Keine aktive Kauf-Lizenz', 'No active paid license')}</div></div></div><div className="oa-mono" style={{ marginTop: 14, color: '#64748b', fontSize: 11 }} data-testid="guild-license-source">Guild-ID {guild.id} · {licenseSource(gdata.license?.license?.resolutionSource, t)}</div></div><div className="oa-grid cols-3" data-testid="guild-subscription">{Object.entries(TIER_META).map(([key, meta]) => { const current = key === tier; return <div className="oa-card oa-fade" key={key} style={{ borderColor: current ? `${meta.color}66` : undefined, position: 'relative' }}>{current && <span className="oa-pill" style={{ position: 'absolute', top: 16, right: 16, color: meta.color }}>{t('Aktiv', 'Active')}</span>}<div style={{ width: 44, height: 44, borderRadius: 12, background: `${meta.color}1f`, color: meta.color, display: 'grid', placeItems: 'center', marginBottom: 14 }}><meta.icon size={22} /></div><div className="oa-display" style={{ fontSize: 22, fontWeight: 800 }}>{meta.name}</div><div style={{ margin: '12px 0 18px', color: '#cbd5e1', lineHeight: 1.8 }}><div><Check size={14} color={meta.color} /> {meta.maxBots} Bots</div><div><Check size={14} color={meta.color} /> {meta.bitrate} Audio</div><div><Check size={14} color={meta.color} /> {key === 'ultimate' ? t('Eigene Sender & Analytics', 'Custom stations & analytics') : key === 'pro' ? t('Dashboard & Rollenrechte', 'Dashboard & role permissions') : t('Basis-Radio', 'Basic radio')}</div></div>{current ? <button className="oa-btn ghost" style={{ width: '100%' }} disabled>{t('Aktueller Plan', 'Current plan')}</button> : <a className="oa-btn primary" style={{ width: '100%', textDecoration: 'none' }} href="/#pricing"><ChevronRight size={15} /> {key === 'free' ? 'Downgrade' : 'Upgrade'}</a>}</div>; })}</div></>}
      </main>
    </div>
  );
}
