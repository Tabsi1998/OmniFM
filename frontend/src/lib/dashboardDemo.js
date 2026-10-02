// OmniFM: the server dashboard with example data (#432), at /dashboard?demo.
// Every answer comes from here: nothing goes to the server and nothing is
// stored. Three example servers, one per plan, so every plan's dashboard can
// be seen. What each plan may do and its numbers come from the plan file;
// the stations are real ones of the catalogue (without their addresses); the
// settings and events look exactly like the server's answers; the panel is
// the bot's own. test/dashboard-demo.test.js holds all of this against the
// server's code.
import { PLAN_CAPABILITIES, PLAN_LIMITS, PLAN_NAMES, PLAN_ORDER, planAtLeast } from '../../../src/config/plan-features.js';
import { normalizeLanguage, translatorFor } from '../i18n/languages.js';
import { DASHBOARD_EVENT_REPEAT_OPTIONS } from './dashboardEvents.js';
import { applyPanelDesign } from './panelDesignDemo.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const DEMO_TIME_ZONE = 'Europe/Vienna';

/** Real stations of the catalogue (stations.json): key, name, genre. */
export const DEMO_STATIONS = Object.freeze({
  free: [
    ['groovesalad', 'Groove Salad', 'Ambient'], ['dronezone', 'Drone Zone', 'Ambient'], ['deepspaceone', 'Deep Space One', 'Ambient'],
    ['spacestation', 'Space Station', 'Electronic'], ['beatblender', 'Beat Blender', 'Electronic'], ['poptron', 'PopTron', 'Indie & Alternative'],
    ['u80s', 'Underground 80s', '80s & Synthpop'], ['metal', 'Metal Detector', 'Metal'], ['lush', 'Lush', 'Electronic'],
    ['thetrip', 'The Trip', 'Electronic'], ['classicalradio', 'Classical Radio', 'Classical'], ['bluesradio', 'Blues Radio', 'Blues'],
    ['jazzradio', 'Jazz Radio', 'Jazz'], ['reggaeradio', 'Reggae Radio', 'Reggae & Dancehall'], ['chartsradio', 'Charts Radio', 'Pop & Charts'],
    ['technoradio', 'Dance Radio', 'EDM & Festival'], ['rockradio', 'Rock Radio', 'Rock'], ['chilloutradio', 'Chillout Radio', 'Chillout'],
    ['hiphopradio', 'Hip Hop Radio', 'Hip Hop & Rap'], ['loungebot', 'Lounge Radio', 'Lounge'],
  ],
  pro: [
    ['pro_urban_09', 'LoFi Beats', 'Lo-Fi'], ['pro_house_01', 'Deep House Lounge', 'House'], ['pro_charts_01', 'bigFM Charts', 'Pop & Charts'],
    ['pro_sl_01', 'Sunshine Live', 'Electronic'], ['pro_tml_01', 'Tomorrowland - One World Radio', 'EDM & Festival'], ['pro_tech_04', 'Melodic Techno', 'Techno'],
    ['pro_trance_01', 'Uplifting Trance', 'Trance'], ['pro_hard_01', 'Hardstyle Arena', 'Hardstyle & Hardcore'], ['pro_house_06', 'Soulful House', 'House'],
    ['pro_urban_05', 'R&B Smooth', 'R&B'], ['pro_urban_02', 'Deutschrap', 'Hip Hop & Rap'], ['pro_rock_01', 'Classic Rock', 'Rock'],
    ['pro_rock_03', 'Indie Rock', 'Indie & Alternative'], ['pro_schlager_01', 'Schlager', 'Schlager & Party'], ['pro_urban_14', '2000er Hits', 'Pop & Charts'],
    ['pro_house_05', 'Ibiza Sunset', 'House'],
  ],
});

const STATION_NAMES = Object.fromEntries([...DEMO_STATIONS.free, ...DEMO_STATIONS.pro].map(([key, name]) => [key, name]));
const stationList = (rows) => rows
  .map(([key, name, genre]) => ({ key, name, url: '', genre, country: '' }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The three example servers: the first one (Ultimate) opens first, as the server list is sorted by name. */
export const DEMO_GUILDS = Object.freeze([
  { id: '900000000000000101', name: 'Lofi Lounge', plan: 'ultimate' },
  { id: '900000000000000102', name: 'Night Owls', plan: 'pro' },
  { id: '900000000000000103', name: 'Study Corner', plan: 'free' },
]);

const channel = (id, name, position, type) => ({ id, name, position, parentName: 'Radio', ...(type ? { type } : {}) });
const role = (id, name, color, position) => ({ id, name, color, position });
const ROLES = [
  role('900000000000000301', 'Admin', '#e74c3c', 5), role('900000000000000302', 'Moderator', '#3498db', 4),
  role('900000000000000303', 'DJ', '#9b59b6', 3), role('900000000000000304', 'Regulars', '#2ecc71', 2),
  role('900000000000000305', 'Members', '#95a5a6', 1),
];
const [ADMIN, MOD, DJ, REGULARS, MEMBERS] = ROLES.map((entry) => entry.id);

// What each example server has: channels, roles, what plays, events, own stations, settings.
const SERVERS = {
  '900000000000000101': {
    voice: [channel('900000000000000201', 'Lounge', 0, 'voice'), channel('900000000000000202', 'Study', 1, 'voice'), channel('900000000000000203', 'Gaming', 2, 'voice'), channel('900000000000000204', 'Stage', 3, 'stage')],
    text: [channel('900000000000000211', 'general', 0), channel('900000000000000212', 'now-playing', 1), channel('900000000000000213', 'announcements', 2), channel('900000000000000214', 'radio-log', 3)],
    roles: ROLES,
    perms: {
      play: [DJ, MOD, ADMIN], pause: [DJ, MOD, ADMIN], resume: [DJ, MOD, ADMIN], stop: [DJ, MOD, ADMIN], setvolume: [DJ, MOD, ADMIN],
      sleep: [DJ, MOD], poll: [REGULARS, DJ, MOD], stations: [MEMBERS, REGULARS, DJ, MOD, ADMIN], now: [MEMBERS, REGULARS, DJ, MOD, ADMIN],
      history: [REGULARS, DJ, MOD, ADMIN], event: [MOD, ADMIN], addstation: [ADMIN], removestation: [ADMIN], mystations: [MOD, ADMIN],
    },
    streams: [
      { bot: 1, voice: 0, station: 'pro_urban_09', listeners: 23, volume: 70, uptimeMin: 312 },
      { bot: 2, voice: 1, station: 'groovesalad', listeners: 9, volume: 55, uptimeMin: 160 },
      { bot: 3, voice: 2, station: 'pro_tech_04', listeners: 14, volume: 80, uptimeMin: 65 },
    ],
    // The last 24 hours of each bot, in minutes before now: [from, to, phase, station, backup?]
    history: {
      1: [[1320, 314, 'playing', 'pro_urban_09'], [314, 312, 'recovering', 'pro_urban_09'], [312, 0, 'playing', 'pro_urban_09']],
      2: [[540, 360, 'playing', 'groovesalad'], [160, 0, 'playing', 'groovesalad']],
      3: [[720, 510, 'playing', 'pro_tech_04'], [510, 490, 'playing', 'technoradio', true], [490, 300, 'playing', 'pro_tech_04'], [65, 0, 'playing', 'pro_tech_04']],
    },
    events: [
      { id: 'demo-lofi-night', title: 'Lofi Night', station: 'pro_urban_09', voice: 0, text: 2, repeat: 'weekly', weekday: 4, hour: 20, minutes: 120, announce: '🎧 Lofi Night starts now in the Lounge. Grab a tea!', discord: true },
      { id: 'demo-techno-friday', title: 'Techno Friday', station: 'pro_tech_04', voice: 2, text: 1, repeat: 'weekly', weekday: 5, hour: 22, minutes: 180, announce: '🔊 Techno Friday is on: Melodic Techno in Gaming.', discord: true },
      { id: 'demo-study-session', title: 'Study Session', station: 'groovesalad', voice: 1, text: -1, repeat: 'daily', hour: 16, minutes: 90, announce: '', enabled: false },
    ],
    custom: [
      { key: 'cafe-beats', name: 'Café Beats', url: 'https://stream.example.com/cafe-beats.mp3', genre: 'Lo-Fi' },
      { key: 'community-radio', name: 'Community Radio', url: 'https://radio.example.org/live', genre: 'Talk' },
    ],
    stored: {
      favoriteStations: ['pro_urban_09', 'groovesalad', 'chilloutradio', 'pro_house_01'],
      weeklyDigest: { enabled: true, channelId: '900000000000000212', dayOfWeek: 1, hour: 9 },
      failoverChain: ['chilloutradio', 'groovesalad'],
      incidentAlerts: { enabled: true, channelId: '900000000000000214', events: ['stream_healthcheck_stalled', 'stream_failover_activated', 'stream_failback_completed'] },
      timeZone: DEMO_TIME_ZONE,
    },
    listening: { pro_urban_09: 140, groovesalad: 71, pro_tech_04: 52, chilloutradio: 24, lush: 18, pro_house_01: 7 },
  },
  '900000000000000102': {
    voice: [channel('900000000000000221', 'Chill', 0, 'voice'), channel('900000000000000222', 'Gaming', 1, 'voice')],
    text: [channel('900000000000000231', 'general', 0), channel('900000000000000232', 'now-playing', 1)],
    roles: ROLES.slice(0, 4),
    perms: { play: [DJ, MOD, ADMIN], stop: [DJ, MOD, ADMIN], setvolume: [DJ, MOD], poll: [REGULARS, DJ, MOD], event: [MOD, ADMIN] },
    streams: [{ bot: 1, voice: 0, station: 'lush', listeners: 6, volume: 60, uptimeMin: 185 }],
    history: { 1: [[185, 0, 'playing', 'lush']] },
    events: [
      { id: 'demo-chill-sunday', title: 'Chill Sunday', station: 'lush', voice: 0, text: 1, repeat: 'weekly', weekday: 0, hour: 18, minutes: 120, announce: '☕ Chill Sunday: Lush in the Chill channel.' },
    ],
    custom: [],
    stored: {
      favoriteStations: ['lush', 'pro_house_06', 'pro_trance_01'],
      weeklyDigest: { enabled: true, channelId: '900000000000000232', dayOfWeek: 1, hour: 9 },
      timeZone: DEMO_TIME_ZONE,
    },
    listening: { lush: 61, pro_house_06: 22, pro_trance_01: 13 },
  },
  '900000000000000103': {
    voice: [channel('900000000000000241', 'Study room', 0, 'voice')],
    text: [channel('900000000000000251', 'general', 0)],
    roles: [],
    perms: {},
    streams: [{ bot: 1, voice: 0, station: 'groovesalad', listeners: 3, volume: 50, uptimeMin: 45 }],
    history: { 1: [[45, 0, 'playing', 'groovesalad']] },
    events: [
      { id: 'demo-study-night', title: 'Study Night', station: 'groovesalad', voice: 0, text: 0, repeat: 'weekly', weekday: 1, hour: 19, minutes: 120, announce: '📚 Study Night: Groove Salad in the study room.' },
    ],
    custom: [],
    stored: { favoriteStations: ['groovesalad', 'jazzradio'], timeZone: DEMO_TIME_ZONE },
    listening: {},
  },
};

/** What a plan may do, in the API's words; src/config/plans.js builds it the same way. */
export function demoCapabilities(plan) {
  return Object.fromEntries(Object.values(PLAN_CAPABILITIES).map((entry) => [entry.apiKey, planAtLeast(plan, entry.minPlan)]));
}

function demoEntitlement(plan) {
  return {
    capabilities: demoCapabilities(plan),
    limits: { ...PLAN_LIMITS[plan], seats: plan === 'free' ? 0 : 1 },
    upgradeHints: { nextTier: PLAN_ORDER[PLAN_ORDER.indexOf(plan) + 1] || null, blockedFeatures: [] },
  };
}

function zoneParts(ms, timeZone = DEMO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

/** "2026-10-02T20:00" in the server's time zone, like the server writes it. */
export function localDateTime(ms, timeZone = DEMO_TIME_ZONE) {
  const p = zoneParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The next moment it is hour:00 in the server's time zone, on the weekday (0 = Sunday) when given. */
export function nextLocalTime(now, hour, weekday = null) {
  for (let add = 0; add <= 8; add += 1) {
    const p = zoneParts(now + add * DAY);
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, 0);
    const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - Math.floor((now + add * DAY) / MINUTE) * MINUTE;
    const at = wall - offset;
    const day = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
    if (at > now && (weekday === null || day === weekday)) return at;
  }
  return now + DAY;
}

function weekdayName(ms, language) {
  return new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-US', { timeZone: DEMO_TIME_ZONE, weekday: 'long' }).format(new Date(ms));
}

/** Like the server's getRepeatLabel for the repeats the examples use. */
export function repeatLabel(repeat, language, runAtMs) {
  if (repeat === 'daily') return language === 'de' ? 'Jeden Tag' : 'Every day';
  if (repeat === 'weekly') return language === 'de' ? `Jeden ${weekdayName(runAtMs, 'de')}` : `Every ${weekdayName(runAtMs, 'en')}`;
  const option = DASHBOARD_EVENT_REPEAT_OPTIONS.find((entry) => entry.value === repeat);
  if (option && repeat !== 'none') return language === 'de' ? option.de : option.en;
  return language === 'de' ? 'Einmalig' : 'Once';
}

function eventAnswer(server, row, now) {
  const runAtMs = row.runAtMs || nextLocalTime(now, row.hour, row.repeat === 'weekly' ? row.weekday : null);
  const created = new Date(now - 12 * DAY).toISOString();
  const discordScheduledEventId = row.discord ? `demo-${row.id}` : null;
  return {
    id: row.id,
    title: row.title,
    stationKey: row.station,
    startsAt: new Date(runAtMs).toISOString(),
    startsAtLocal: localDateTime(runAtMs),
    timezone: DEMO_TIME_ZONE,
    channelId: server.voice[row.voice]?.id || '',
    textChannelId: row.text >= 0 ? server.text[row.text]?.id || '' : '',
    enabled: row.enabled !== false,
    repeat: row.repeat,
    repeatLabelDe: repeatLabel(row.repeat, 'de', runAtMs),
    repeatLabelEn: repeatLabel(row.repeat, 'en', runAtMs),
    durationMs: row.minutes * MINUTE,
    announceMessage: row.announce || '',
    description: '',
    stageTopic: '',
    createDiscordEvent: row.discord === true,
    discordScheduledEventId,
    discordEventSynced: Boolean(row.discord),
    discordSyncError: null,
    createdByUserId: DEMO_USER.id,
    createdAt: created,
    updatedAt: created,
    runAtMs,
    stationName: STATION_NAMES[row.station] || row.station,
  };
}

export const DEMO_USER = Object.freeze({ id: '900000000000000001', username: 'alex', globalName: 'Alex', avatar: null });

function streamRows(server, now) {
  return server.streams.map((row, index) => ({
    botId: `worker-${row.bot}`,
    botName: `OmniFM ${row.bot}`,
    stationKey: row.station,
    stationName: STATION_NAMES[row.station] || row.station,
    channelId: server.voice[row.voice].id,
    channelName: server.voice[row.voice].name,
    // A little life in the numbers: they move a bit from one refresh to the next.
    listeners: Math.max(1, row.listeners + Math.round(1.5 * Math.sin(now / 23_000 + index * 2))),
    volume: row.volume,
    recovering: false,
    failoverActive: false,
    desiredStationKey: null,
    desiredStationName: null,
    failbackNextProbeAt: 0,
    parkedReason: null,
    serverMuted: false,
    uptimeSec: row.uptimeMin * 60,
  }));
}

function liveView(server, now) {
  const at = (minutesAgo) => new Date(now - minutesAgo * MINUTE).toISOString();
  const bots = Object.entries(server.history).map(([bot, rows]) => {
    const segments = rows.map(([from, to, phase, station, failover]) => ({ from: at(from), to: at(to), phase, station: STATION_NAMES[station] || station, failover: failover === true }));
    const last = rows[rows.length - 1];
    const events = rows.slice(1).map(([from, , phase, station], index) => ({
      at: at(from),
      from: rows[index][1] === from ? rows[index][2] : 'idle',
      phase,
      station: STATION_NAMES[station] || station,
      reason: phase === 'recovering' ? 'stream ended' : null,
      unexpected: phase === 'recovering',
    }));
    return {
      botId: `worker-${bot}`,
      botName: `OmniFM ${bot}`,
      current: { phase: last[1] === 0 ? last[2] : 'idle', station: STATION_NAMES[last[3]] || last[3], since: at(last[0]), failover: last[4] === true },
      segments,
      events,
    };
  });
  return { windowStart: at(24 * 60), windowEnd: at(0), bots };
}

function statsAnswer(guild, server, now) {
  const streams = streamRows(server, now);
  const totalListeningMs = Object.values(server.listening).reduce((sum, hours) => sum + hours * HOUR, 0);
  const basic = {
    listenersNow: streams.reduce((sum, row) => sum + row.listeners, 0),
    activeStreams: streams.length,
    activeStreamDetails: streams,
    runtimeUptimeSec: Math.max(0, ...streams.map((row) => row.uptimeSec)),
    totalListeningMs,
    setupStatus: null,
  };
  return { serverId: guild.id, tier: guild.plan, basic, advanced: guild.plan === 'ultimate' ? { dailyReport: dailyStats(now).slice(0, 7).reverse(), stationBreakdown: [] } : null };
}

// Thirty days of listeners, newest first, with livelier weekends.
function dailyStats(now) {
  return Array.from({ length: 30 }, (_, index) => {
    const day = new Date(now - index * DAY);
    const weekend = [0, 6].includes(day.getUTCDay());
    const avg = Math.round(26 + 7 * Math.sin(index / 2.3) + (weekend ? 8 : 0));
    return { date: day.toISOString().slice(0, 10), avgListeners: avg, peakListeners: avg + 9 + (index % 4) };
  });
}

function detailAnswer(guild, server, now) {
  const stationListeningMs = Object.fromEntries(Object.entries(server.listening).map(([key, hours]) => [key, hours * HOUR]));
  return {
    serverId: guild.id,
    dailyStats: dailyStats(now),
    listeningStats: {
      stationListeningMs,
      stationNames: Object.fromEntries(Object.keys(stationListeningMs).map((key) => [key, STATION_NAMES[key] || key])),
      totalListeningMs: Object.values(stationListeningMs).reduce((sum, ms) => sum + ms, 0),
    },
  };
}

const FAVORITES_MAX = 10;
const ALL_ON = (keys) => Object.fromEntries(keys.map((key) => [key, true]));
const SEASONS = ['easter', 'halloween', 'advent', 'christmas', 'newyear'];
const SEASON_PARTS = ['panel', 'voiceStatus', 'adventCalendar', 'eggHunt', 'countdown', 'newYearGreeting', 'seasonStations'];

function stationPreview(key) {
  if (!key) return { configured: false, valid: true, key: '', name: '', label: '', tier: null, isCustom: false };
  const tier = DEMO_STATIONS.free.some(([freeKey]) => freeKey === key) ? 'free' : 'pro';
  return { configured: true, valid: true, key, name: STATION_NAMES[key], label: STATION_NAMES[key], tier, isCustom: false };
}

/** The settings answer: what the server sends for these example settings (the test compares). */
export function demoSettingsAnswer(guildId, { language = 'en', now = Date.now() } = {}) {
  const guild = DEMO_GUILDS.find((entry) => entry.id === guildId);
  const { stored } = SERVERS[guildId];
  const digest = { enabled: false, channelId: '', dayOfWeek: 1, hour: 9, ...(stored.weeklyDigest || {}), language, audience: 'team' };
  const nextRunAt = nextLocalTime(now, digest.hour, digest.dayOfWeek);
  const chain = stored.failoverChain || [];
  const alerts = stored.incidentAlerts || { enabled: false, channelId: '', events: [] };
  return {
    guildId,
    tier: guild.plan,
    capabilities: demoCapabilities(guild.plan),
    weeklyDigest: digest,
    weeklyDigestMeta: {
      ready: digest.enabled && Boolean(digest.channelId),
      channelConfigured: Boolean(digest.channelId),
      nextRunAt: new Date(nextRunAt).toISOString(),
      lastSentAt: digest.enabled ? new Date(nextRunAt - 7 * DAY).toISOString() : null,
    },
    failoverChain: chain,
    failoverChainPreview: chain.map((key, index) => ({ order: index + 1, ...stationPreview(key) })),
    fallbackStation: chain[0] || '',
    fallbackStationPreview: stationPreview(chain[0] || ''),
    incidentAlerts: { enabled: alerts.enabled === true, channelId: alerts.channelId || '', events: [...(alerts.events || [])] },
    exportsWebhook: { enabled: false, url: '', events: [], secretConfigured: false },
    voiceGuard: {
      available: demoCapabilities(guild.plan).voiceGuard,
      policy: 'default',
      effectivePolicy: 'return',
      defaults: { policy: 'return', moveConfirmations: 2, returnCooldownMs: 15000, moveWindowMs: 120000, maxMovesPerWindow: 4, escalation: 'disconnect', escalationCooldownMs: 600000 },
    },
    voiceStatus: { template: '', defaultTemplate: '🔊 | 24/7 {station}', placeholders: ['station', 'title', 'artist', 'listeners', 'emoji', 'bot', 'season'], maxLength: 120 },
    favorites: { stations: [...stored.favoriteStations], limit: PLAN_LIMITS[guild.plan].favorites, max: FAVORITES_MAX },
    serverLanguage: { current: 'auto', options: ['auto', 'de', 'en'] },
    serverTimeZone: { current: stored.timeZone || DEMO_TIME_ZONE, default: DEMO_TIME_ZONE },
    seasonDecor: { seasons: ALL_ON(SEASONS), parts: ALL_ON(SEASON_PARTS), ownerEnabled: ALL_ON(SEASONS), current: null },
  };
}

/** The server's example-data sources for the test: stored settings as the database would hold them. */
export function demoStoredSettings(guildId) {
  return SERVERS[guildId]?.stored || null;
}

function pageLanguage() {
  if (typeof window === 'undefined') return 'en';
  const requested = new URLSearchParams(window.location.search).get('lang');
  const nav = (window.navigator?.languages && window.navigator.languages[0]) || window.navigator?.language || 'en';
  return normalizeLanguage(requested || nav, 'en');
}

// Changes and anything the example data do not hold get a plain answer instead.
function refuse(t, method) {
  const error = new Error(method === 'GET'
    ? t('Das gibt es in der Vorschau nicht. Melde dich mit Discord an, um es mit deinem Server zu nutzen.', 'This is not part of the preview. Sign in with Discord to use it with your server.')
    : t('In der Vorschau wird nichts gespeichert. Melde dich mit Discord an, um deinen eigenen Server einzurichten.', 'Nothing is saved in the preview. Sign in with Discord to set up your own server.'));
  error.status = 403;
  error.demo = true;
  return error;
}

/**
 * The dashboard's requests, answered from the example data.
 * @param {{ panels?: Record<string, any>, now?: () => number, language?: () => string }} [options]
 *   panels: the bot's example panels by language ({ de, en }), from the live demos (#431)
 */
export function createDemoApi({ panels = {}, now = () => Date.now(), language = pageLanguage } = {}) {
  return async function demoApiRequest(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = new URL(String(path), 'https://demo.omnifm.local');
    const route = url.pathname;
    const guildId = url.searchParams.get('serverId') || '';
    const guild = DEMO_GUILDS.find((entry) => entry.id === guildId) || null;
    const server = guild ? SERVERS[guild.id] : null;
    const lang = normalizeLanguage(language(), 'en');
    const t = translatorFor(lang);
    const botLanguage = lang === 'de' ? 'de' : 'en';
    const at = now();
    const body = (() => { try { return JSON.parse(options.body || '{}'); } catch { return {}; } })();

    if (route === '/api/auth/session') {
      return {
        authenticated: true,
        oauthConfigured: true,
        user: DEMO_USER,
        guilds: DEMO_GUILDS.map((entry) => {
          const entitlement = demoEntitlement(entry.plan);
          return {
            id: entry.id, name: entry.name, icon: '', owner: true, permissions: '8', tier: entry.plan, ...entitlement,
            dashboardEnabled: entitlement.capabilities.dashboardAccess === true,
            ultimateEnabled: entitlement.capabilities.advancedAnalytics === true || entitlement.capabilities.customStationUrls === true,
          };
        }),
        expiresAt: new Date(at + DAY).toISOString(),
      };
    }
    // Leaving the preview needs nothing from the server either.
    if (route === '/api/auth/logout') return { success: true };

    // Previews show a result and keep nothing.
    if (method === 'POST' && route === '/api/dashboard/panel-design/preview') {
      return { preview: applyPanelDesign(panels[botLanguage] || panels.en || { components: [] }, body?.design || {}) };
    }
    if (method === 'POST' && route === '/api/dashboard/events/preview' && server) {
      const runAtMs = Date.parse(body?.startsAt || '') || at + DAY;
      const preview = eventAnswer(server, { id: body?.eventId || 'preview', title: body?.title || '', station: body?.stationKey || '', voice: 0, text: -1, repeat: body?.repeat || 'none', minutes: Math.round(Number(body?.durationMs || 0) / MINUTE), runAtMs }, at);
      return {
        success: true,
        serverId: guild.id,
        event: { ...preview, channelId: body?.channelId || preview.channelId, textChannelId: body?.textChannelId || '' },
        schedule: { nextRuns: [{ runAtMs, durationMs: preview.durationMs, startsAt: preview.startsAt, startsAtLocal: preview.startsAtLocal, endsAt: '', endsAtLocal: '' }], repeatLabelDe: preview.repeatLabelDe, repeatLabelEn: preview.repeatLabelEn, hasConflicts: false },
        conflicts: [],
      };
    }
    if (method === 'POST' && route === '/api/dashboard/settings/digest-preview') return { success: true, serverId: guildId, preview: null };
    if (method !== 'GET' || !guild) throw refuse(t, method);

    const entitlement = demoEntitlement(guild.plan);
    switch (route) {
      case '/api/dashboard/license':
        return {
          serverId: guild.id,
          tier: guild.plan,
          effectiveTier: guild.plan,
          tierName: PLAN_NAMES[guild.plan],
          ...entitlement,
          dashboardEnabled: entitlement.capabilities.dashboardAccess === true,
          ultimateEnabled: entitlement.capabilities.advancedAnalytics === true || entitlement.capabilities.customStationUrls === true,
          license: guild.plan === 'free' ? null : { seats: guild.plan === 'ultimate' ? 2 : 1, seatsUsed: 1, expiresAt: new Date(at + 23 * DAY).toISOString(), resolutionSource: 'serverEntitlement' },
        };
      case '/api/dashboard/stations':
        return {
          free: stationList(DEMO_STATIONS.free),
          pro: planAtLeast(guild.plan, 'pro') ? stationList(DEMO_STATIONS.pro) : [],
          ultimate: [],
          custom: guild.plan === 'ultimate' ? server.custom.map((row) => ({ ...row, folder: '', tags: [], logoUrl: null, custom: true })) : [],
          tier: guild.plan,
        };
      case '/api/dashboard/custom-stations':
        return { stations: server.custom.map((row) => ({ ...row, folder: '', tags: [], logoUrl: null, custom: true })), limit: PLAN_LIMITS[guild.plan].customStations };
      case '/api/dashboard/roles':
        return { roles: server.roles };
      case '/api/dashboard/perms':
        return { rules: [], commandRoleMap: server.perms };
      case '/api/dashboard/channels':
        return { voiceChannels: server.voice, textChannels: server.text };
      case '/api/dashboard/events':
        return { serverId: guild.id, events: server.events.map((row) => eventAnswer(server, row, at)).sort((a, b) => a.runAtMs - b.runAtMs) };
      case '/api/dashboard/playback/now':
        return { streams: streamRows(server, at) };
      case '/api/dashboard/playback':
        return liveView(server, at);
      case '/api/dashboard/stats':
        return statsAnswer(guild, server, at);
      case '/api/dashboard/stats/detail':
        return detailAnswer(guild, server, at);
      case '/api/dashboard/settings':
        return demoSettingsAnswer(guild.id, { language: botLanguage, now: at });
      case '/api/dashboard/emojis':
        return { emojis: [] };
      case '/api/dashboard/panel-design':
        return {
          serverId: guild.id,
          canSave: planAtLeast(guild.plan, 'pro'),
          design: { accentColor: null, showRecent: true, buttons: { volume: true, stations: true, favorites: true, save: true, links: true, share: true, report: true } },
          buttons: [
            ['volume', 'Lautstärke − / +', 'Volume − / +'], ['stations', 'Sender', 'Stations'], ['favorites', 'Favoriten-Leiste', 'Favourites bar'],
            ['save', 'Merken', 'Save'], ['links', 'Spotify und YouTube', 'Spotify and YouTube'], ['share', 'Teilen', 'Share'], ['report', 'Problem melden', 'Report a problem'],
          ].map(([key, de, en]) => ({ key, label: botLanguage === 'de' ? de : en })),
          preview: panels[botLanguage] || panels.en || null,
        };
      case '/api/dashboard/bot-profile':
        return {
          serverId: guild.id,
          available: guild.plan === 'ultimate',
          limits: { avatarBytes: 2 * 1024 * 1024, bannerBytes: 4 * 1024 * 1024, bioLength: 190 },
          workers: server.streams.map((row) => ({ slot: row.bot, name: `OmniFM ${row.bot}`, avatarUrl: null, custom: { avatar: false, banner: false, bio: '' }, updatedAt: null })),
        };
      case '/api/dashboard/jingle':
        return {
          serverId: guild.id,
          available: guild.plan === 'ultimate',
          limits: { maxMs: 10_000, fileBytes: 6 * 1024 * 1024 },
          jingle: null,
          settings: { onSwitch: true, onHour: false },
        };
      default:
        throw refuse(t, method);
    }
  };
}
