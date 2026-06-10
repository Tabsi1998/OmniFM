import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Crown, Globe, Lock, LogOut, ShieldCheck, TrendingUp, Radio, Settings, ListMusic, CreditCard, ArrowLeft } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';
import { buildHomeHref } from '../lib/pageRouting.js';
import DashboardOverview from './DashboardOverview.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';
import DashboardStatsPanel from './DashboardStats.js';
import DashboardEvents from './DashboardEvents.js';
import DashboardCustomStations from './DashboardCustomStations.js';
import DashboardSettings from './DashboardSettings.js';
import DashboardSubscription from './DashboardSubscription.js';
import {
  getDashboardBlockedFeatureLabels,
  getDashboardCapabilityRequiredTier,
  normalizeDashboardCapabilityPayload,
} from '../lib/dashboardCapabilities.js';
import {
  resolveDashboardApiErrorMessage,
  resolveDashboardClientErrorMessage,
} from '../lib/dashboardErrors.js';
import { buildDashboardPermissionsHint as buildPermissionsOnboardingHint } from '../lib/dashboardOnboarding.js';

const PERMISSION_COMMANDS = [
  'play', 'pause', 'resume', 'stop', 'setvolume', 'stations', 'list', 'now', 'stats', 'history', 'status', 'health', 'diag', 'addstation', 'removestation', 'mystations', 'event',
];
const EMPTY_SESSION = { authenticated: false, oauthConfigured: null, user: null, guilds: [] };
const EMPTY_EVENT_FORM = Object.freeze({
  title: '',
  stationKey: '',
  startsAt: '',
  timezone: 'Europe/Vienna',
  channelId: '',
  textChannelId: '',
  repeat: 'none',
  durationMinutes: '',
  announceMessage: '',
  description: '',
  stageTopic: '',
  createDiscordEvent: false,
  enabled: true,
});
const DASHBOARD_CSRF_HEADER = 'X-OmniFM-CSRF';
const DASHBOARD_CSRF_INTENT = 'dashboard-intent';
const DASHBOARD_MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requiresDashboardIntentHeader(path, method) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!DASHBOARD_MUTATION_METHODS.has(normalizedMethod)) return false;

  const normalizedPath = String(path || '');
  if (normalizedPath === '/api/auth/logout') return true;
  return normalizedPath.startsWith('/api/dashboard/') && !normalizedPath.startsWith('/api/dashboard/telemetry');
}

function buildEmptyPermissionsDraft() {
  const base = {};
  PERMISSION_COMMANDS.forEach((command) => { base[command] = []; });
  return base;
}

function buildPermissionsDraftFromPayload(permsPayload) {
  const draft = buildEmptyPermissionsDraft();
  const rules = Array.isArray(permsPayload?.rules) ? permsPayload.rules : [];
  rules.forEach((rule) => {
    const command = String(rule?.command || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(draft, command)) return;
    draft[command] = Array.isArray(rule?.allowRoleIds) ? [...new Set(rule.allowRoleIds.filter(Boolean))] : [];
  });
  return draft;
}

function buildEmptyEventForm() {
  return { ...EMPTY_EVENT_FORM };
}

function areDashboardValuesEqual(current, next) {
  if (Object.is(current, next)) return true;
  if (current == null || next == null) return false;
  try {
    return JSON.stringify(current) === JSON.stringify(next);
  } catch {
    return false;
  }
}

function sortDashboardEvents(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const aMs = Date.parse(a?.startsAt || '') || 0;
    const bMs = Date.parse(b?.startsAt || '') || 0;
    return aMs - bMs || String(a?.title || '').localeCompare(String(b?.title || ''));
  });
}

function upsertDashboardEvent(rows, nextEvent) {
  const list = Array.isArray(rows) ? rows : [];
  const filtered = list.filter((entry) => entry.id !== nextEvent?.id);
  return sortDashboardEvents([...filtered, nextEvent].filter(Boolean));
}

function toEventFormState(event) {
  return {
    title: event?.title || '',
    stationKey: event?.stationKey || '',
    startsAt: event?.startsAtLocal || '',
    timezone: event?.timezone || 'Europe/Vienna',
    channelId: event?.channelId || '',
    textChannelId: event?.textChannelId || '',
    repeat: event?.repeat || 'none',
    durationMinutes: Number(event?.durationMs || 0) > 0 ? String(Math.round(Number(event.durationMs) / 60000)) : '',
    announceMessage: event?.announceMessage || '',
    description: event?.description || '',
    stageTopic: event?.stageTopic || '',
    createDiscordEvent: event?.createDiscordEvent === true,
    enabled: event?.enabled !== false,
  };
}

async function apiRequestWithLanguage(path, language, options = {}) {
  let response;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    'X-OmniFM-Language': language,
    ...(requiresDashboardIntentHeader(path, method) ? { [DASHBOARD_CSRF_HEADER]: DASHBOARD_CSRF_INTENT } : {}),
    ...(options.headers || {}),
  };
  try {
    response = await fetch(buildApiUrl(path), {
      ...options,
      method,
      credentials: 'include',
      headers,
    });
  } catch (error) {
    throw new Error(resolveDashboardClientErrorMessage(error, language));
  }

  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    throw new Error(resolveDashboardApiErrorMessage(response.status, payload?.error, language));
  }
  return payload;
}

function resolveAuthError() {
  try {
    return String(new URL(window.location.href).searchParams.get('authError') || '').trim();
  } catch { return ''; }
}

function resolveAuthErrorMessage(authError, t) {
  switch (String(authError || '').trim()) {
    case 'oauth_not_configured': return t('Discord OAuth ist noch nicht vollständig konfiguriert.', 'Discord OAuth is not configured yet.');
    case 'invalid_state': return t('Der Discord-Login ist abgelaufen oder ungültig.', 'The Discord login expired or is invalid.');
    case 'missing_code': return t('Discord hat keinen gültigen Login-Code geliefert.', 'Discord did not return a valid login code.');
    case 'oauth_exchange_failed': return t('Discord-Login konnte nicht abgeschlossen werden.', 'Discord login could not be completed.');
    default: return String(authError || '').trim();
  }
}

function normalizeOauthConfigured(v) { return v === true ? true : v === false ? false : null; }

function resolveSessionLoadErrorMessage(err, language, t) {
  return resolveDashboardClientErrorMessage(err, language, {
    fallback: t('Session konnte nicht geladen werden.', 'Session could not be loaded.'),
  });
}

function DashboardShell({ children, sidebar, topbar }) {
  return (
    <div data-testid="dashboard-shell" style={{ minHeight: '100vh', background: '#050505', color: '#fff', display: 'grid', gridTemplateColumns: '260px 1fr' }}>
      <aside data-testid="dashboard-sidebar" style={{
        borderRight: '1px solid #1A1A2E', background: '#080808', padding: '20px 16px',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        {sidebar}
      </aside>
      <main data-testid="dashboard-main" style={{ minWidth: 0 }}>
        <div data-testid="dashboard-topbar" style={{
          height: 56, borderBottom: '1px solid #1A1A2E', background: 'rgba(8,8,8,0.95)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px',
          position: 'sticky', top: 0, zIndex: 20,
        }}>
          {topbar}
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
      </main>
      <style>{`
        @media (max-width: 1024px) {
          [data-testid='dashboard-shell'] { grid-template-columns: 1fr !important; }
          [data-testid='dashboard-sidebar'] { position: static !important; height: auto !important; border-right: none !important; border-bottom: 1px solid #1A1A2E; }
        }
      `}</style>
    </div>
  );
}

export default function DashboardPortal() {
  const { locale, localeMeta, toggleLocale, formatDate } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);
  const apiRequest = useCallback((path, options = {}) => apiRequestWithLanguage(path, locale, options), [locale]);
  const authError = resolveAuthError();
  const authErrorMessage = useMemo(() => resolveAuthErrorMessage(authError, t), [authError, t]);
  const mainSiteHref = useMemo(() => buildHomeHref(locale || 'de'), [locale]);
  const premiumHref = useMemo(() => `${mainSiteHref}#premium`, [mainSiteHref]);

  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [selectedGuildId, setSelectedGuildId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [loadingData, setLoadingData] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(authErrorMessage);
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState(() => buildEmptyEventForm());
  const [editingEventId, setEditingEventId] = useState('');
  const [permsDraft, setPermsDraft] = useState(() => buildEmptyPermissionsDraft());
  const [availableRoles, setAvailableRoles] = useState([]);
  const [capabilityPayload, setCapabilityPayload] = useState(null);
  const [stats, setStats] = useState({ basic: null, advanced: null, tier: 'free' });
  const [detailStats, setDetailStats] = useState(null);
  const [detailDays, setDetailDays] = useState(30);
  const [inviteLinks, setInviteLinks] = useState({ serverId: '', serverTier: 'free', bots: [] });

  const selectedGuild = useMemo(() => (session.guilds || []).find((g) => g.id === selectedGuildId) || null, [session.guilds, selectedGuildId]);
  const sessionCapabilityPayload = useMemo(() => normalizeDashboardCapabilityPayload(selectedGuild ? {
    serverId: selectedGuild.id,
    tier: selectedGuild.tier,
    capabilities: selectedGuild.capabilities,
    limits: selectedGuild.limits,
    upgradeHints: selectedGuild.upgradeHints,
  } : null), [selectedGuild]);
  const effectiveCapabilityPayload = useMemo(() => {
    if (capabilityPayload?.serverId && capabilityPayload.serverId === selectedGuildId) {
      return normalizeDashboardCapabilityPayload(capabilityPayload);
    }
    return sessionCapabilityPayload;
  }, [capabilityPayload, selectedGuildId, sessionCapabilityPayload]);
  const capabilities = effectiveCapabilityPayload.capabilities;
  const dashboardEnabled = capabilities.dashboardAccess === true;
  const canManageEvents = capabilities.eventScheduler === true;
  const canManagePermissions = capabilities.rolePermissions === true;
  const canManageCustomStations = capabilities.customStationUrls === true;
  const canViewAdvancedStats = capabilities.advancedAnalytics === true;
  const blockedFeatureLabels = useMemo(
    () => getDashboardBlockedFeatureLabels(effectiveCapabilityPayload.upgradeHints.blockedFeatures, t, 4),
    [effectiveCapabilityPayload.upgradeHints.blockedFeatures, t]
  );
  const nextUpgradeTier = String(effectiveCapabilityPayload.upgradeHints.nextTier || '').trim().toLowerCase();
  const nextUpgradeLabel = nextUpgradeTier ? nextUpgradeTier.toUpperCase() : '';
  const setupStatus = stats?.basic?.setupStatus || null;
  const hasRestrictedCommands = useMemo(
    () => PERMISSION_COMMANDS.some((command) => Array.isArray(permsDraft[command]) && permsDraft[command].length > 0),
    [permsDraft]
  );
  const permissionsHint = useMemo(
    () => buildPermissionsOnboardingHint({
      setupStatus,
      availableRoleCount: availableRoles.length,
      hasRestrictedCommands,
      t,
    }),
    [availableRoles.length, hasRestrictedCommands, setupStatus, t]
  );
  const tabs = useMemo(() => ([
    { key: 'overview', label: t('Übersicht', 'Overview'), icon: BarChart3, requiredCapability: 'dashboardAccess' },
    { key: 'events', label: t('Events', 'Events'), icon: CalendarDays, requiredCapability: 'eventScheduler' },
    { key: 'stations', label: t('Custom-Stationen', 'Custom stations'), icon: ListMusic, requiredCapability: 'customStationUrls' },
    { key: 'perms', label: t('Berechtigungen', 'Permissions'), icon: ShieldCheck, requiredCapability: 'rolePermissions' },
    { key: 'stats', label: t('Statistiken', 'Statistics'), icon: TrendingUp, requiredCapability: 'advancedAnalytics' },
    { key: 'subscription', label: t('Abo', 'Subscription'), icon: CreditCard },
    { key: 'settings', label: t('Einstellungen', 'Settings'), icon: Settings, requiredCapability: 'dashboardAccess' },
  ]), [t]);

  const refreshSession = useCallback(async () => {
    setLoadingSession(true);
    try {
      const payload = await apiRequest('/api/auth/session', { method: 'GET' });
      setSession({
        authenticated: payload.authenticated === true,
        oauthConfigured: normalizeOauthConfigured(payload.oauthConfigured),
        user: payload.user || null,
        guilds: Array.isArray(payload.guilds) ? payload.guilds : [],
      });
      const savedGuildId = window.localStorage.getItem('omnifm.dashboard.guildId') || '';
      const guilds = Array.isArray(payload.guilds) ? payload.guilds : [];
      const fallback = guilds.find((g) => g.dashboardEnabled) || guilds[0] || null;
      const selected = guilds.find((g) => g.id === savedGuildId) || fallback;
      setSelectedGuildId(selected?.id || '');
      setError(payload.authenticated === true ? '' : authErrorMessage);
    } catch (err) {
      setError(resolveSessionLoadErrorMessage(err, locale, t));
      setSession(EMPTY_SESSION);
    } finally {
      setLoadingSession(false);
    }
  }, [apiRequest, authErrorMessage, locale, t]);

  useEffect(() => { if (!session.authenticated) setError((c) => c || authErrorMessage); }, [authErrorMessage, session.authenticated]);

  useEffect(() => {
    let cancelled = false;
    if (!session.authenticated || !selectedGuildId) {
      setCapabilityPayload(null);
      return () => { cancelled = true; };
    }
    apiRequest(`/api/dashboard/capabilities?serverId=${encodeURIComponent(selectedGuildId)}`)
      .then((payload) => {
        if (!cancelled) setCapabilityPayload(payload);
      })
      .catch(() => {
        if (!cancelled) setCapabilityPayload(null);
      });
    return () => { cancelled = true; };
  }, [apiRequest, selectedGuildId, session.authenticated]);

  const refreshDashboardData = useCallback(async ({ silent = false } = {}) => {
    if (!selectedGuildId || !dashboardEnabled) return;
    if (!silent) {
      setLoadingData(true);
      setMessage('');
    }
    setError('');
    try {
      const [
        statsPayload,
        eventsPayload,
        permsPayload,
        rolesPayload,
        detailPayload,
        inviteLinksPayload,
      ] = await Promise.all([
        apiRequest(`/api/dashboard/stats?serverId=${encodeURIComponent(selectedGuildId)}`),
        canManageEvents
          ? apiRequest(`/api/dashboard/events?serverId=${encodeURIComponent(selectedGuildId)}`)
          : Promise.resolve({ events: [] }),
        canManagePermissions
          ? apiRequest(`/api/dashboard/perms?serverId=${encodeURIComponent(selectedGuildId)}`)
          : Promise.resolve({ rules: [] }),
        canManagePermissions
          ? apiRequest(`/api/dashboard/roles?serverId=${encodeURIComponent(selectedGuildId)}`)
          : Promise.resolve({ roles: [] }),
        canViewAdvancedStats
          ? apiRequest(`/api/dashboard/stats/detail?serverId=${encodeURIComponent(selectedGuildId)}&days=${encodeURIComponent(String(detailDays))}`).catch(() => null)
          : Promise.resolve(null),
        apiRequest(`/api/premium/invite-links?serverId=${encodeURIComponent(selectedGuildId)}`).catch(() => ({
          serverId: selectedGuildId,
          serverTier: selectedGuild?.tier || 'free',
          bots: [],
        })),
      ]);

      const nextStats = { tier: statsPayload.tier || selectedGuild?.tier || 'free', basic: statsPayload.basic || null, advanced: statsPayload.advanced || null };
      const nextDetailStats = detailPayload;
      const nextInviteLinks = inviteLinksPayload && Array.isArray(inviteLinksPayload.bots)
        ? inviteLinksPayload
        : { serverId: selectedGuildId, serverTier: selectedGuild?.tier || 'free', bots: [] };
      const nextEvents = sortDashboardEvents(Array.isArray(eventsPayload?.events) ? eventsPayload.events : []);
      const nextRoles = Array.isArray(rolesPayload?.roles) ? rolesPayload.roles : [];
      const nextPermsDraft = buildPermissionsDraftFromPayload(permsPayload);

      setStats((current) => (areDashboardValuesEqual(current, nextStats) ? current : nextStats));
      setDetailStats((current) => (areDashboardValuesEqual(current, nextDetailStats) ? current : nextDetailStats));
      setInviteLinks((current) => (areDashboardValuesEqual(current, nextInviteLinks) ? current : nextInviteLinks));
      setEvents((current) => (areDashboardValuesEqual(current, nextEvents) ? current : nextEvents));
      setAvailableRoles((current) => (areDashboardValuesEqual(current, nextRoles) ? current : nextRoles));
      setPermsDraft((current) => (areDashboardValuesEqual(current, nextPermsDraft) ? current : nextPermsDraft));
    } catch (err) {
      setError(err.message || t('Dashboard-Daten konnten nicht geladen werden.', 'Dashboard data could not be loaded.'));
    } finally {
      if (!silent) {
        setLoadingData(false);
      }
    }
  }, [apiRequest, canManageEvents, canManagePermissions, canViewAdvancedStats, dashboardEnabled, detailDays, selectedGuild?.tier, selectedGuildId, t]);

  useEffect(() => { refreshSession(); }, [refreshSession]);
  useEffect(() => { if (selectedGuildId) window.localStorage.setItem('omnifm.dashboard.guildId', selectedGuildId); }, [selectedGuildId]);
  useEffect(() => { if (session.authenticated && selectedGuildId && dashboardEnabled) refreshDashboardData(); }, [session.authenticated, selectedGuildId, dashboardEnabled, refreshDashboardData]);
  useEffect(() => {
    if (!session.authenticated || !selectedGuildId || !dashboardEnabled) return undefined;
    const timer = window.setInterval(() => {
      refreshDashboardData({ silent: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [session.authenticated, selectedGuildId, dashboardEnabled, refreshDashboardData]);
  useEffect(() => {
    setEditingEventId('');
    setEventForm(buildEmptyEventForm());
    setInviteLinks({ serverId: selectedGuildId || '', serverTier: selectedGuild?.tier || 'free', bots: [] });
  }, [selectedGuild?.tier, selectedGuildId]);
  useEffect(() => {
    const activeTabConfig = tabs.find((entry) => entry.key === activeTab);
    if (activeTabConfig?.requiredCapability && capabilities[activeTabConfig.requiredCapability] !== true) {
      setActiveTab(dashboardEnabled ? 'overview' : 'subscription');
    }
  }, [activeTab, capabilities, dashboardEnabled, tabs]);

  const resetEventEditor = useCallback(() => {
    setEditingEventId('');
    setEventForm(buildEmptyEventForm());
  }, []);

  const startDiscordLogin = async () => {
    setError('');
    try {
      const payload = await apiRequest(`/api/auth/discord/login?nextPage=dashboard&lang=${encodeURIComponent(locale)}`, { method: 'GET' });
      if (payload?.authUrl) window.location.href = payload.authUrl;
    } catch (err) { setError(err.message || t('Discord-Login fehlgeschlagen.', 'Discord login failed.')); }
  };

  const logout = async () => {
    setError('');
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      await refreshSession();
      setMessage(t('Erfolgreich ausgeloggt.', 'Logged out.'));
    } catch (err) { setError(err.message || t('Logout fehlgeschlagen.', 'Logout failed.')); }
  };

  const saveEvent = useCallback(async () => {
    if (!selectedGuildId) return;
    setError(''); setMessage('');
    try {
      const durationMs = eventForm.durationMinutes ? Number(eventForm.durationMinutes) * 60000 : 0;
      const requestPath = editingEventId
        ? `/api/dashboard/events/${encodeURIComponent(editingEventId)}?serverId=${encodeURIComponent(selectedGuildId)}`
        : `/api/dashboard/events?serverId=${encodeURIComponent(selectedGuildId)}`;
      const payload = await apiRequest(requestPath, {
        method: editingEventId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...eventForm,
          startsAtLocal: eventForm.startsAt,
          durationMs,
        }),
      });
      setEvents((current) => upsertDashboardEvent(current, payload.event));
      resetEventEditor();
      setMessage(editingEventId ? t('Event aktualisiert.', 'Event updated.') : t('Event gespeichert.', 'Event saved.'));
      return { ok: true, event: payload.event };
    } catch (err) {
      setError(err.message);
      return { ok: false, error: err };
    }
  }, [apiRequest, editingEventId, eventForm, resetEventEditor, selectedGuildId, t]);

  const toggleEvent = useCallback(async (eventId, enabled) => {
    if (!selectedGuildId) return;
    setError('');
    try {
      const payload = await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled }),
      });
      setEvents((current) => upsertDashboardEvent(current, payload.event));
      if (editingEventId === eventId && payload.event) {
        setEventForm(toEventFormState(payload.event));
      }
    } catch (err) { setError(err.message); }
  }, [apiRequest, editingEventId, selectedGuildId]);

  const deleteEvent = useCallback(async (eventId) => {
    if (!selectedGuildId) return;
    setError('');
    try {
      await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(selectedGuildId)}`, { method: 'DELETE' });
      setEvents((c) => c.filter((e) => e.id !== eventId));
      if (editingEventId === eventId) {
        resetEventEditor();
      }
    } catch (err) { setError(err.message); }
  }, [apiRequest, editingEventId, resetEventEditor, selectedGuildId]);

  const startEditingEvent = useCallback((event) => {
    setEditingEventId(event?.id || '');
    setEventForm(toEventFormState(event));
    setError('');
    setMessage('');
  }, []);

  const savePerms = async () => {
    if (!selectedGuildId) return;
    setError(''); setMessage('');
    try {
      const payload = await apiRequest(`/api/dashboard/perms?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          rules: PERMISSION_COMMANDS.map((command) => ({
            command,
            allowRoleIds: Array.isArray(permsDraft[command]) ? [...new Set(permsDraft[command].filter(Boolean))] : [],
          })),
        }),
      });
      setPermsDraft(buildPermissionsDraftFromPayload(payload));
      setMessage(t('Berechtigungen gespeichert.', 'Permissions saved.'));
    } catch (err) { setError(err.message); }
  };

  const resetStatsForSelectedGuild = useCallback(async () => {
    if (!selectedGuildId) return;
    setError('');
    await apiRequest(`/api/dashboard/stats/reset?serverId=${encodeURIComponent(selectedGuildId)}`, { method: 'DELETE' });
    await refreshDashboardData({ silent: true });
    setMessage(t('Statistiken wurden zurückgesetzt.', 'Statistics have been reset.'));
  }, [apiRequest, refreshDashboardData, selectedGuildId, t]);

  const acknowledgeIncidentForSelectedGuild = useCallback(async (incidentId) => {
    if (!selectedGuildId || !incidentId) return;
    setError('');
    try {
      await apiRequest(`/api/dashboard/stats/incidents?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ incidentId }),
      });
      await refreshDashboardData({ silent: true });
      setMessage(t('Vorfall quittiert.', 'Incident acknowledged.'));
    } catch (err) {
      setError(err.message || t('Vorfall konnte nicht quittiert werden.', 'Incident could not be acknowledged.'));
      throw err;
    }
  }, [apiRequest, refreshDashboardData, selectedGuildId, t]);

  // Loading state
  if (loadingSession) {
    return (
      <section data-testid="dashboard-loading-view" style={{ minHeight: '100vh', background: '#050505', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Radio size={40} color="#5865F2" style={{ animation: 'pulse 1.5s infinite' }} />
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, marginTop: 16 }}>{t('Dashboard lädt...', 'Loading dashboard...')}</h1>
          <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      </section>
    );
  }

  // Login state
  if (!session.authenticated) {
    return (
      <section data-testid="dashboard-login-view" style={{ minHeight: '100vh', background: '#050505', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div data-testid="dashboard-login-card" style={{
          width: 'min(680px, 100%)', background: '#080808', border: '1px solid #1A1A2E', padding: '32px 28px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={24} color="#5865F2" />
            <span style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#71717A' }}>OmniFM Dashboard</span>
            <button
              type="button"
              data-testid="dashboard-login-language-toggle"
              onClick={toggleLocale}
              title={localeMeta.switchTitle}
              style={{
                marginLeft: 'auto',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: '#fff',
                height: 30,
                padding: '0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <Globe size={12} color="#00F0FF" />
              {localeMeta.label} / {localeMeta.switchLabel}
            </button>
          </div>
          <h1 data-testid="dashboard-login-title" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 40, lineHeight: 1.05, marginTop: 14 }}>
            {t('Discord-SSO-Login', 'Discord SSO login')}
          </h1>
          <p data-testid="dashboard-login-description" style={{ color: '#71717A', marginTop: 12, lineHeight: 1.7 }}>
            {t(
              'Melde dich mit deinem Discord-Account an. Das Dashboard ist ab Pro freigeschaltet.',
              'Sign in with your Discord account. Dashboard access is unlocked from Pro.',
            )}
          </p>
          {error && <div data-testid="dashboard-login-error" style={{ marginTop: 14, color: '#FCA5A5', border: '1px solid rgba(252,165,165,0.25)', padding: '10px 12px', background: 'rgba(127,29,29,0.15)' }}>{error}</div>}
          {session.oauthConfigured === false && (
            <div data-testid="dashboard-oauth-not-configured" style={{ marginTop: 14, color: '#FDE68A', border: '1px solid rgba(253,230,138,0.25)', padding: '10px 12px', background: 'rgba(120,53,15,0.12)' }}>
              {t('Discord OAuth ist noch nicht vollständig konfiguriert.', 'Discord OAuth is not fully configured yet.')}
            </div>
          )}
          <button data-testid="dashboard-discord-login-button" onClick={startDiscordLogin} disabled={session.oauthConfigured === false} style={{
            marginTop: 20, height: 48, width: '100%', border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: session.oauthConfigured === false ? 'not-allowed' : 'pointer', opacity: session.oauthConfigured === false ? 0.5 : 1, letterSpacing: '0.03em', fontSize: 15,
          }}>
            {t('Mit Discord einloggen', 'Continue with Discord')}
          </button>
        </div>
      </section>
    );
  }

  // Sidebar
  const sidebar = (
    <>
      <div data-testid="dashboard-brand" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Radio size={22} color="#5865F2" />
        <div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 700 }}>OmniFM</div>
          <div style={{ color: '#52525B', fontSize: 11 }}>{t('Server-Steuerung', 'Server control')}</div>
        </div>
      </div>

      <label htmlFor="dashboard-guild-select" style={{ display: 'block', color: '#52525B', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {t('Server', 'Server')}
      </label>
      <select
        id="dashboard-guild-select" data-testid="dashboard-guild-select" value={selectedGuildId}
        onChange={(e) => setSelectedGuildId(e.target.value)}
        style={{ width: '100%', background: '#050505', color: '#fff', border: '1px solid #1A1A2E', height: 40, padding: '0 10px', marginBottom: 16, fontSize: 13 }}
      >
        {(session.guilds || []).map((g) => (
          <option key={g.id} value={g.id}>{g.name} | {String(g.tier || 'free').toUpperCase()}</option>
        ))}
      </select>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tabs.map((entry) => {
          const Icon = entry.icon;
          const active = activeTab === entry.key;
          const locked = entry.requiredCapability ? capabilities[entry.requiredCapability] !== true : false;
          const requiredTier = entry.requiredCapability ? getDashboardCapabilityRequiredTier(entry.requiredCapability) : null;
          const requiredTierLabel = requiredTier ? String(requiredTier).toUpperCase() : '';
          return (
            <button
              key={entry.key} data-testid={`dashboard-tab-${entry.key}`}
              onClick={() => setActiveTab(locked ? 'subscription' : entry.key)}
              style={{
                border: '1px solid', borderColor: active ? '#5865F2' : locked ? 'rgba(139,92,246,0.24)' : '#1A1A2E',
                background: active ? 'rgba(88,101,242,0.1)' : 'transparent',
                color: locked ? '#A1A1AA' : '#fff', height: 40, display: 'flex', alignItems: 'center', gap: 10,
                padding: '0 12px', cursor: 'pointer', fontSize: 13, transition: 'all 0.15s',
              }}
            >
              <Icon size={15} color={active ? '#5865F2' : locked ? '#C4B5FD' : '#71717A'} />
              {entry.label}
              {locked && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {requiredTierLabel && (
                    <span style={{
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: requiredTier === 'ultimate' ? '#C4B5FD' : '#86EFAC',
                    }}>
                      {requiredTierLabel}
                    </span>
                  )}
                  <Lock size={12} color="#A78BFA" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedGuild && (
        <button
          data-testid="sidebar-plan-box"
          onClick={() => setActiveTab('subscription')}
          style={{
            marginTop: 20, padding: '12px', border: '1px solid #1A1A2E', background: '#050505',
            width: '100%', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = '#5865F2'}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = '#1A1A2E'}
        >
          <div style={{ fontSize: 10, color: '#52525B', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t('Aktueller Plan', 'Current plan')}</div>
          <div style={{ marginTop: 4, fontFamily: "'Outfit', sans-serif", fontSize: 18, color: selectedGuild.tier === 'ultimate' ? '#8B5CF6' : selectedGuild.tier === 'pro' ? '#10B981' : '#71717A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {String(selectedGuild.tier || 'free').toUpperCase()}
            <CreditCard size={14} color="#52525B" />
          </div>
        </button>
      )}

      {selectedGuild && blockedFeatureLabels.length > 0 && (
        <button
          type="button"
          data-testid="sidebar-upgrade-hint"
          onClick={() => setActiveTab('subscription')}
          style={{
            marginTop: 12,
            width: '100%',
            border: '1px solid rgba(139,92,246,0.35)',
            background: 'rgba(88,28,135,0.16)',
            color: '#fff',
            padding: '12px 14px',
            textAlign: 'left',
            display: 'grid',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {nextUpgradeLabel
                ? t(`Nächster Schritt: ${nextUpgradeLabel}`, `Next step: ${nextUpgradeLabel}`)
                : t('Upgrade-Pfad', 'Upgrade path')}
            </span>
            <Crown size={14} color="#C4B5FD" />
          </div>
          <div style={{ fontSize: 13, color: '#E9D5FF', lineHeight: 1.5 }}>
            {t('Aktuell gesperrt auf diesem Server', 'Currently locked on this server')}
          </div>
          <div style={{ fontSize: 12, color: '#D4D4D8', lineHeight: 1.5 }}>
            {blockedFeatureLabels.join(' • ')}
          </div>
        </button>
      )}

      <a
        href={mainSiteHref}
        data-testid="sidebar-back-to-main"
        style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
          border: '1px solid rgba(88,101,242,0.45)', background: 'rgba(88,101,242,0.12)', color: '#fff', textDecoration: 'none',
          fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#818CF8'; e.currentTarget.style.background = 'rgba(88,101,242,0.18)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(88,101,242,0.45)'; e.currentTarget.style.background = 'rgba(88,101,242,0.12)'; }}
      >
        <ArrowLeft size={14} />
        {t('Zurück zur Hauptseite', 'Back to main site')}
      </a>
    </>
  );

  const topbar = (
    <>
      <div data-testid="dashboard-current-guild-name" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {selectedGuild?.name || t('Kein Server', 'No server')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {loadingData && <span data-testid="dashboard-loading-indicator" style={{ fontSize: 12, color: '#52525B' }}>{t('Lade...', 'Loading...')}</span>}
        {activeTab === 'stats' && canViewAdvancedStats && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#A1A1AA', fontSize: 12 }}>
            <span>{t('Zeitraum', 'Range')}</span>
            <select
              data-testid="dashboard-stats-range-select"
              value={detailDays}
              onChange={(e) => setDetailDays(Math.max(1, Math.min(90, Number.parseInt(String(e.target.value || '30'), 10) || 30)))}
              style={{
                height: 34,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.04)',
                color: '#fff',
                padding: '0 8px',
                fontSize: 12,
              }}
            >
              <option value={7}>{t('7 Tage', '7 days')}</option>
              <option value={30}>{t('30 Tage', '30 days')}</option>
              <option value={90}>{t('90 Tage', '90 days')}</option>
            </select>
          </label>
        )}
        <button
          type="button"
          data-testid="dashboard-language-toggle"
          onClick={toggleLocale}
          title={localeMeta.switchTitle}
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.04)',
            color: '#fff',
            height: 34,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Globe size={13} color="#00F0FF" />
          {localeMeta.label} / {localeMeta.switchLabel}
        </button>
        <a
          href={mainSiteHref}
          data-testid="dashboard-topbar-home-link"
          style={{
            border: '1px solid rgba(88,101,242,0.45)',
            background: 'rgba(88,101,242,0.12)',
            color: '#fff',
            height: 34,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <ArrowLeft size={13} /> {t('Hauptseite', 'Main site')}
        </a>
        <div data-testid="dashboard-user-chip" style={{ color: '#71717A', fontSize: 13 }}>{session.user?.username || t('Nutzer', 'User')}</div>
        <button data-testid="dashboard-logout-button" onClick={logout} style={{
          border: '1px solid #1A1A2E', background: 'transparent', color: '#71717A', height: 34, padding: '0 10px',
          display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
        }}>
          <LogOut size={13} /> {t('Abmelden', 'Log out')}
        </button>
      </div>
    </>
  );

  return (
    <DashboardShell sidebar={sidebar} topbar={topbar}>
      {error && <div data-testid="dashboard-global-error" style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
      {message && <div data-testid="dashboard-global-message" style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,95,70,0.12)', padding: '10px 12px', color: '#6EE7B7', fontSize: 13 }}>{message}</div>}

      {!dashboardEnabled && activeTab !== 'subscription' && (
        <div data-testid="dashboard-pro-gate" style={{ border: '1px solid #1A1A2E', background: '#080808', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lock size={22} color="#F59E0B" />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26 }}>{t('Dashboard ab Pro', 'Dashboard from Pro')}</h2>
          </div>
          <p style={{ marginTop: 10, color: '#71717A', lineHeight: 1.7 }}>
            {t('Upgrade auf Pro für Events, Rechte und Statistiken.', 'Upgrade to Pro for events, permissions and statistics.')}
          </p>
          <a href={premiumHref} data-testid="dashboard-upgrade-link" style={{
            marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8,
            border: '1px solid #8B5CF6', background: 'rgba(139,92,246,0.12)', color: '#fff', padding: '10px 14px', textDecoration: 'none',
          }}>
            <Crown size={14} /> {t('Zu Pro / Ultimate', 'Upgrade to Pro / Ultimate')}
          </a>
        </div>
      )}

      {activeTab === 'subscription' && (
        <DashboardSubscription
          apiRequest={apiRequest}
          selectedGuildId={selectedGuildId}
          t={t}
          capabilityPayload={effectiveCapabilityPayload}
        />
      )}

      {dashboardEnabled && (
        <>
          {activeTab === 'overview' && (
            <DashboardOverview
              stats={stats}
              detailStats={detailStats}
              inviteLinks={inviteLinks}
              t={t}
              isUltimate={canViewAdvancedStats}
              onResetStats={resetStatsForSelectedGuild}
              onAcknowledgeIncident={acknowledgeIncidentForSelectedGuild}
              onOpenSubscription={() => setActiveTab('subscription')}
              showBasicHealth={capabilities.basicHealth === true}
              formatDate={formatDate}
            />
          )}

          {activeTab === 'events' && canManageEvents && (
            <DashboardEvents
              events={events} eventForm={eventForm} setEventForm={setEventForm}
              editingEventId={editingEventId}
              onSaveEvent={saveEvent}
              onToggleEvent={toggleEvent}
              onDeleteEvent={deleteEvent}
              onStartEditEvent={startEditingEvent}
              onCancelEditEvent={resetEventEditor}
              t={t} formatDate={formatDate} apiRequest={apiRequest} selectedGuildId={selectedGuildId}
              setupStatus={setupStatus}
              inviteLinks={inviteLinks}
            />
          )}

          {activeTab === 'stations' && canManageCustomStations && (
            <DashboardCustomStations
              apiRequest={apiRequest}
              selectedGuildId={selectedGuildId}
              t={t}
              setupStatus={setupStatus}
              inviteLinks={inviteLinks}
            />
          )}

          {activeTab === 'stations' && !canManageCustomStations && (
            <div data-testid="stations-ultimate-gate" style={{ border: '1px solid #1A1A2E', background: '#080808', padding: 24, textAlign: 'center' }}>
              <Crown size={32} color="#8B5CF6" style={{ margin: '0 auto' }} />
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, marginTop: 12 }}>
                {t('Custom-Stationen nur mit Ultimate', 'Custom stations are Ultimate-only')}
              </h3>
              <p style={{ color: '#52525B', marginTop: 8, maxWidth: 440, margin: '8px auto 0' }}>
                {t('Eigene Stream-URLs und die Verwaltung von Custom-Stationen sind mit Ultimate verfügbar.', 'Custom stream URLs and station management are available with Ultimate.')}
              </p>
            </div>
          )}

          {activeTab === 'perms' && canManagePermissions && (
            <section data-testid="dashboard-perms-panel" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Rollenrechte pro Command', 'Role permissions by command')}</h3>
              <p style={{ color: '#52525B', marginTop: 6, fontSize: 13, lineHeight: 1.6 }}>
                {t('Mehrfachauswahl mit echten Discord-Rollen.', 'Multi-select with real Discord roles.')}
              </p>
              {permissionsHint && (
                <div style={{ marginTop: 14 }}>
                  <DashboardOnboardingHint
                    hint={permissionsHint}
                    t={t}
                    dataTestId="dashboard-perms-onboarding-hint"
                  />
                </div>
              )}
              {!availableRoles.length && (
                <div style={{ marginTop: 12, color: '#A1A1AA', fontSize: 13 }}>
                  {t('Keine Rollen gefunden oder Bot ist gerade nicht auf diesem Server verbunden.', 'No roles found or the bot is currently not connected to this server.')}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                {PERMISSION_COMMANDS.map((cmd) => (
                  <label key={cmd} data-testid={`perm-row-${cmd}`} style={{ display: 'grid', gap: 4 }}>
                    <span style={{ color: '#52525B', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>/{cmd}</span>
                    <select
                      multiple
                      size={Math.min(6, Math.max(3, availableRoles.length || 3))}
                      data-testid={`perm-input-${cmd}`}
                      value={Array.isArray(permsDraft[cmd]) ? permsDraft[cmd] : []}
                      onChange={(e) => {
                        const selectedRoleIds = Array.from(e.target.selectedOptions, (option) => option.value);
                        setPermsDraft((current) => ({ ...current, [cmd]: selectedRoleIds }));
                      }}
                      style={{ minHeight: 96, border: '1px solid #1A1A2E', background: '#050505', color: '#fff', padding: '8px 10px', fontSize: 13 }}
                    >
                      {availableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <span style={{ color: '#71717A', fontSize: 11 }}>
                      {(permsDraft[cmd] || []).length
                        ? (availableRoles.filter((role) => (permsDraft[cmd] || []).includes(role.id)).map((role) => role.name).join(', ') || `${(permsDraft[cmd] || []).length} ${t('Rollen ausgewählt', 'roles selected')}`)
                        : t('Keine Rollen ausgewählt.', 'No roles selected.')}
                    </span>
                  </label>
                ))}
              </div>
              <button data-testid="perms-save-btn" onClick={savePerms} style={{
                marginTop: 14, height: 40, border: 'none', background: '#10B981', color: '#042f2e', fontWeight: 700, padding: '0 16px', cursor: 'pointer',
              }}>
                {t('Berechtigungen speichern', 'Save permissions')}
              </button>
            </section>
          )}

          {activeTab === 'stats' && canViewAdvancedStats && (
            <DashboardStatsPanel
              stats={stats}
              detailStats={detailStats}
              inviteLinks={inviteLinks}
              t={t}
              formatDate={formatDate}
            />
          )}

          {activeTab === 'stats' && !canViewAdvancedStats && (
            <div data-testid="stats-ultimate-gate" style={{ border: '1px solid #1A1A2E', background: '#080808', padding: 24, textAlign: 'center' }}>
              <Crown size={32} color="#8B5CF6" style={{ margin: '0 auto' }} />
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, marginTop: 12 }}>
                {t('Ultimate Analytics', 'Ultimate analytics')}
              </h3>
              <p style={{ color: '#52525B', marginTop: 8, maxWidth: 400, margin: '8px auto 0' }}>
                {t('Detaillierte Statistiken mit Charts, Session-Verlauf und Verbindungsanalyse sind mit Ultimate verfügbar.', 'Detailed statistics with charts, session history, and connection analysis are available with Ultimate.')}
              </p>
            </div>
          )}

          {activeTab === 'settings' && (
            <DashboardSettings
              apiRequest={apiRequest}
              selectedGuildId={selectedGuildId}
              t={t}
              capabilities={capabilities}
              setupStatus={setupStatus}
              formatDate={formatDate}
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}
