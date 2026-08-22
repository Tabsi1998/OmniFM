import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, Shield, Save, Plus, ArrowUp, ArrowDown, X } from 'lucide-react';
import { DASHBOARD_CAPABILITY_DEFAULTS } from '../lib/dashboardCapabilities.js';
import {
  FAILOVER_CHAIN_LIMIT,
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
  getConfiguredFailoverChain,
  normalizeFailoverChain,
} from '../lib/dashboardSettings.js';
import {
  DASHBOARD_EXPORT_WEBHOOK_EVENTS,
  normalizeDashboardExportsWebhookConfig,
  buildDashboardExportsWebhookSummary,
  getDashboardExportWebhookEventLabel,
  buildDashboardExportDownloadName,
} from '../lib/dashboardExports.js';
import {
  DASHBOARD_INCIDENT_ALERT_EVENTS,
  normalizeDashboardIncidentAlertsConfig,
  buildDashboardIncidentAlertsSummary,
  getDashboardIncidentAlertEventLabel,
} from '../lib/dashboardIncidentAlerts.js';
import {
  buildDashboardExportsHint,
  buildDashboardFailoverHint,
  buildDashboardWeeklyDigestHint,
} from '../lib/dashboardOnboarding.js';
import {
  buildDashboardVoiceGuardSummary,
  normalizeDashboardVoiceGuardConfig,
} from '../lib/dashboardVoiceGuard.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';

const DAYS = [
  { value: 0, de: 'Sonntag', en: 'Sunday' },
  { value: 1, de: 'Montag', en: 'Monday' },
  { value: 2, de: 'Dienstag', en: 'Tuesday' },
  { value: 3, de: 'Mittwoch', en: 'Wednesday' },
  { value: 4, de: 'Donnerstag', en: 'Thursday' },
  { value: 5, de: 'Freitag', en: 'Friday' },
  { value: 6, de: 'Samstag', en: 'Saturday' },
];

export default function DashboardSettings({
  apiRequest,
  selectedGuildId,
  t,
  capabilities = DASHBOARD_CAPABILITY_DEFAULTS,
  setupStatus = null,
  formatDate = null,
}) {
  const [settings, setSettings] = useState(null);
  const [textChannels, setTextChannels] = useState([]);
  const [stations, setStations] = useState({ free: [], pro: [], ultimate: [], custom: [] });
  const [pendingFailoverStation, setPendingFailoverStation] = useState('');
  const [digestPreview, setDigestPreview] = useState(null);
  const [digestPreviewLoading, setDigestPreviewLoading] = useState(false);
  const [digestTestSending, setDigestTestSending] = useState(false);
  const [webhookTestSending, setWebhookTestSending] = useState(false);
  const [exportLoadingKey, setExportLoadingKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadTokenRef = useRef(0);
  const digestPreviewTokenRef = useRef(0);

  const loadDigestPreview = useCallback(async (nextWeeklyDigest = null, { silent = false } = {}) => {
    const previewToken = ++digestPreviewTokenRef.current;
    if (!selectedGuildId || capabilities.weeklyDigest !== true) {
      setDigestPreview(null);
      setDigestPreviewLoading(false);
      return null;
    }

    if (!silent) {
      setDigestPreviewLoading(true);
    }

    try {
      const result = await apiRequest(`/api/dashboard/settings/digest-preview?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify(nextWeeklyDigest ? { weeklyDigest: nextWeeklyDigest } : {}),
      });
      if (previewToken !== digestPreviewTokenRef.current) return null;
      setDigestPreview(result?.preview || null);
      return result;
    } catch (err) {
      if (previewToken !== digestPreviewTokenRef.current) return null;
      if (!silent) setError(err.message);
      return null;
    } finally {
      if (previewToken !== digestPreviewTokenRef.current) return;
      setDigestPreviewLoading(false);
    }
  }, [selectedGuildId, apiRequest, capabilities.weeklyDigest]);

  const load = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!selectedGuildId) {
      setSettings(null);
      setTextChannels([]);
      setStations({ free: [], pro: [], ultimate: [], custom: [] });
      setError('');
      setMessage('');
      setLoading(false);
      setPendingFailoverStation('');
      setDigestPreview(null);
      setDigestPreviewLoading(false);
      setDigestTestSending(false);
      setWebhookTestSending(false);
      setExportLoadingKey('');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setSettings(null);
    setTextChannels([]);
    setStations({ free: [], pro: [], ultimate: [], custom: [] });
    setPendingFailoverStation('');
    setDigestPreview(null);
    setWebhookTestSending(false);
    setExportLoadingKey('');
    try {
      const [settingsResult, channelsResult, stationsResult] = await Promise.all([
        apiRequest(`/api/dashboard/settings?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/channels?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/stations?serverId=${encodeURIComponent(selectedGuildId)}`),
      ]);
      if (loadToken !== loadTokenRef.current) return;
      const nextSettings = {
        ...(settingsResult || {}),
        incidentAlerts: normalizeDashboardIncidentAlertsConfig(settingsResult?.incidentAlerts),
        exportsWebhook: normalizeDashboardExportsWebhookConfig(settingsResult?.exportsWebhook),
        voiceGuard: normalizeDashboardVoiceGuardConfig(settingsResult?.voiceGuard),
      };
      setSettings(nextSettings);
      setTextChannels(channelsResult.textChannels || []);
      setStations({
        free: stationsResult.free || [],
        pro: stationsResult.pro || [],
        ultimate: stationsResult.ultimate || [],
        custom: stationsResult.custom || [],
      });
      setPendingFailoverStation('');
      if (capabilities.weeklyDigest === true) {
        await loadDigestPreview(nextSettings?.weeklyDigest || {}, { silent: true });
      }
    } catch (err) {
      if (loadToken !== loadTokenRef.current) return;
      setError(err.message);
    } finally {
      if (loadToken !== loadTokenRef.current) return;
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest, capabilities.weeklyDigest, loadDigestPreview]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError('');
    setMessage('');
    try {
      const body = {};
      if (capabilities.weeklyDigest === true && settings?.weeklyDigest) body.weeklyDigest = settings.weeklyDigest;
      if (capabilities.failoverRules === true) body.failoverChain = getConfiguredFailoverChain(settings);
      if (capabilities.exportsWebhooks === true && settings?.incidentAlerts) body.incidentAlerts = settings.incidentAlerts;
      if (capabilities.exportsWebhooks === true && settings?.exportsWebhook) body.exportsWebhook = settings.exportsWebhook;
      if (capabilities.voiceGuard === true && settings?.voiceGuard) body.voiceGuard = settings.voiceGuard;
      const result = await apiRequest(`/api/dashboard/settings?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setSettings((current) => ({
        ...(current || {}),
        ...(result || {}),
        incidentAlerts: normalizeDashboardIncidentAlertsConfig(result?.incidentAlerts || current?.incidentAlerts),
        exportsWebhook: normalizeDashboardExportsWebhookConfig(result?.exportsWebhook || current?.exportsWebhook),
        voiceGuard: normalizeDashboardVoiceGuardConfig(result?.voiceGuard || current?.voiceGuard),
      }));
      if (capabilities.weeklyDigest === true) {
        await loadDigestPreview(result?.weeklyDigest || settings?.weeklyDigest || {}, { silent: true });
      }
      setMessage(t('Einstellungen gespeichert.', 'Settings saved.'));
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div style={{ color: '#52525B', textAlign: 'center', padding: 40 }}>{t('Lade...', 'Loading...')}</div>;

  const wd = settings?.weeklyDigest || { enabled: false, channelId: '', dayOfWeek: 1, hour: 9, language: 'de' };
  const incidentAlerts = normalizeDashboardIncidentAlertsConfig(settings?.incidentAlerts);
  const exportsWebhook = normalizeDashboardExportsWebhookConfig(settings?.exportsWebhook);
  const webhookSecretInput = Object.prototype.hasOwnProperty.call(exportsWebhook, 'secret')
    ? exportsWebhook.secret
    : '';
  const voiceGuard = normalizeDashboardVoiceGuardConfig(settings?.voiceGuard);
  const voiceGuardSummary = buildDashboardVoiceGuardSummary(voiceGuard, t);
  const canManageWeeklyDigest = capabilities.weeklyDigest === true;
  const canManageFallbackStation = capabilities.failoverRules === true;
  const canManageExports = capabilities.exportsWebhooks === true;
  const canManageVoiceGuard = capabilities.voiceGuard === true;
  const configuredFailoverChain = getConfiguredFailoverChain(settings);
  const digestSummary = buildWeeklyDigestSummary(settings, t, formatDate);
  const fallbackSummary = buildFallbackStationSummary(settings, t);
  const incidentAlertChannel = textChannels.find((channel) => channel.id === incidentAlerts.channelId) || null;
  const incidentAlertChannelLabel = incidentAlertChannel?.name
    ? `#${incidentAlertChannel.name}`
    : (incidentAlerts.channelId ? `#${incidentAlerts.channelId}` : '');
  const incidentAlertsSummary = buildDashboardIncidentAlertsSummary(incidentAlerts, incidentAlertChannelLabel, t);
  const exportsSummary = buildDashboardExportsWebhookSummary(exportsWebhook, t);
  const digestHint = buildDashboardWeeklyDigestHint({
    setupStatus,
    weeklyDigest: wd,
    textChannelCount: textChannels.length,
    t,
  });
  const failoverHint = buildDashboardFailoverHint({
    setupStatus,
    failoverChainLength: configuredFailoverChain.length,
    t,
  });
  const exportsHint = buildDashboardExportsHint({
    setupStatus,
    exportsWebhook,
    t,
  });
  const digestPreviewGeneratedLabel = digestPreview?.generatedAt
    ? (typeof formatDate === 'function'
      ? formatDate(digestPreview.generatedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date(digestPreview.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    : t('Noch nicht erstellt', 'Not generated yet');

  const refreshDigestPreview = async () => {
    setError('');
    const result = await loadDigestPreview(wd);
    if (result?.preview) {
      setMessage(t('Digest-Vorschau aktualisiert.', 'Digest preview refreshed.'));
    }
  };

  const sendDigestTest = async () => {
    setError('');
    setMessage('');
    setDigestTestSending(true);
    try {
      const result = await apiRequest(`/api/dashboard/settings/digest-test?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({ weeklyDigest: wd }),
      });
      setDigestPreview(result?.preview || null);
      const channelLabel = result?.channelName ? `#${result.channelName}` : t('dem gewählten Channel', 'the selected channel');
      setMessage(
        t(
          `Test-Digest erfolgreich an ${channelLabel} gesendet.`,
          `Test digest sent successfully to ${channelLabel}.`
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setDigestTestSending(false);
    }
  };

  const updateExportsWebhook = (patch) => {
    setSettings((current) => ({
      ...(current || {}),
      exportsWebhook: normalizeDashboardExportsWebhookConfig({
        ...(current?.exportsWebhook || {}),
        ...(patch || {}),
      }),
    }));
  };

  const updateIncidentAlerts = (patch) => {
    setSettings((current) => ({
      ...(current || {}),
      incidentAlerts: normalizeDashboardIncidentAlertsConfig({
        ...(current?.incidentAlerts || {}),
        ...(patch || {}),
      }),
    }));
  };

  const toggleExportsWebhookEvent = (eventKey) => {
    const normalizedKey = String(eventKey || '').trim().toLowerCase();
    const nextEvents = exportsWebhook.events.includes(normalizedKey)
      ? exportsWebhook.events.filter((entry) => entry !== normalizedKey)
      : [...exportsWebhook.events, normalizedKey];
    updateExportsWebhook({ events: nextEvents });
  };

  const toggleIncidentAlertEvent = (eventKey) => {
    const normalizedKey = String(eventKey || '').trim().toLowerCase();
    const nextEvents = incidentAlerts.events.includes(normalizedKey)
      ? incidentAlerts.events.filter((entry) => entry !== normalizedKey)
      : [...incidentAlerts.events, normalizedKey];
    updateIncidentAlerts({ events: nextEvents });
  };

  const downloadDashboardExport = async (kind, path) => {
    setError('');
    setMessage('');
    setExportLoadingKey(kind);
    try {
      const result = await apiRequest(path);
      const fileName = buildDashboardExportDownloadName(kind, selectedGuildId, result?.exportedAt || new Date());
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);

      const webhookSuffix = result?.webhookDelivery?.attempted
        ? (result.webhookDelivery.delivered
          ? t(' Webhook wurde ebenfalls ausgeloest.', ' Webhook was triggered as well.')
          : t(' Export gespeichert, aber Webhook fehlgeschlagen.', ' Export downloaded, but the webhook failed.'))
        : '';
      setMessage(
        t(
          `Export erfolgreich heruntergeladen.${webhookSuffix}`,
          `Export downloaded successfully.${webhookSuffix}`
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setExportLoadingKey('');
    }
  };

  const sendWebhookTest = async () => {
    setError('');
    setMessage('');
    setWebhookTestSending(true);
    try {
      const result = await apiRequest(`/api/dashboard/exports/webhook-test?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({
          exportsWebhook,
        }),
      });
      setMessage(
        t(
          `Webhook-Test erfolgreich gesendet (Status ${result?.delivery?.status || 200}).`,
          `Webhook test sent successfully (status ${result?.delivery?.status || 200}).`
        )
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setWebhookTestSending(false);
    }
  };

  const allStations = [
    ...stations.custom.map((station) => ({ value: `custom:${station.key}`, label: `${station.name} (Custom)`, name: station.name, tier: 'ultimate', isCustom: true })),
    ...stations.free.map((station) => ({ value: station.key, label: station.name, name: station.name, tier: 'free', isCustom: false })),
    ...stations.pro.map((station) => ({ value: station.key, label: `${station.name} (Pro)`, name: station.name, tier: 'pro', isCustom: false })),
    ...stations.ultimate.map((station) => ({ value: station.key, label: `${station.name} (Ultimate)`, name: station.name, tier: 'ultimate', isCustom: false })),
  ];
  const stationPreviewMap = new Map(allStations.map((station) => [station.value, {
    configured: true,
    valid: true,
    key: station.value,
    name: station.name,
    label: station.label,
    tier: station.tier,
    isCustom: station.isCustom,
  }]));
  const availableFailoverStations = allStations.filter((station) => !configuredFailoverChain.includes(station.value));

  const buildLocalFailoverPreview = (rawValue) => {
    const selectedValue = String(rawValue || '').trim().toLowerCase();
    if (!selectedValue) {
      return {
        configured: false,
        valid: true,
        key: '',
        name: '',
        label: '',
        tier: null,
        isCustom: false,
      };
    }
    return stationPreviewMap.get(selectedValue) || {
      configured: true,
      valid: false,
      key: selectedValue,
      name: '',
      label: selectedValue,
      tier: null,
      isCustom: selectedValue.startsWith('custom:'),
    };
  };

  const applyFailoverChain = (nextChainInput) => {
    const nextChain = normalizeFailoverChain(nextChainInput, FAILOVER_CHAIN_LIMIT);
    const nextPreview = nextChain.map((stationKey) => buildLocalFailoverPreview(stationKey));
    setSettings((current) => ({
      ...(current || {}),
      failoverChain: nextChain,
      failoverChainPreview: nextPreview,
      fallbackStation: nextChain[0] || '',
      fallbackStationPreview: nextPreview[0] || buildLocalFailoverPreview(''),
    }));
    setPendingFailoverStation((currentValue) => (nextChain.includes(currentValue) ? '' : currentValue));
  };

  const addFailoverStation = () => {
    if (!pendingFailoverStation || configuredFailoverChain.length >= FAILOVER_CHAIN_LIMIT) return;
    applyFailoverChain([...configuredFailoverChain, pendingFailoverStation]);
    setPendingFailoverStation('');
  };

  const moveFailoverStation = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= configuredFailoverChain.length) return;
    const nextChain = [...configuredFailoverChain];
    const [selected] = nextChain.splice(index, 1);
    nextChain.splice(targetIndex, 0, selected);
    applyFailoverChain(nextChain);
  };

  const removeFailoverStation = (index) => {
    applyFailoverChain(configuredFailoverChain.filter((_stationKey, position) => position !== index));
  };

  return (
    <section data-testid="dashboard-settings-panel" style={{ display: 'grid', gap: 14 }}>
      {error && <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
      {message && <div style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,95,70,0.12)', padding: '10px 12px', color: '#6EE7B7', fontSize: 13 }}>{message}</div>}

      <div data-testid="settings-weekly-digest" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageWeeklyDigest ? 1 : 0.6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Calendar size={18} color="#5865F2" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Wöchentlicher Stats-Digest', 'Weekly stats digest')}</h3>
          {!canManageWeeklyDigest && <span style={{ fontSize: 11, color: '#10B981', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px' }}>PRO</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {t(
            'Automatisch ein Embed mit der Wochen-Zusammenfassung in einen Text-Channel posten.',
            'Automatically post an embed with the weekly summary to a text channel.'
          )}
        </p>
        {digestHint && (
          <div style={{ marginBottom: 14 }}>
            <DashboardOnboardingHint
              hint={digestHint}
              t={t}
              dataTestId="settings-digest-onboarding-hint"
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="digest-status-card" style={{ border: `1px solid ${digestSummary.statusAccent}33`, background: `${digestSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: digestSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{digestSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{digestSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Naechster Lauf', 'Next run')}
            </div>
            <div data-testid="digest-next-run" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {digestSummary.nextRunLabel}
            </div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Letzte Sendung', 'Last delivery')}
            </div>
            <div data-testid="digest-last-sent" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {digestSummary.lastSentLabel}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {t('Sprache', 'Language')}: {digestSummary.languageLabel}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label data-testid="digest-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
            <input
              type="checkbox"
              disabled={!canManageWeeklyDigest}
              checked={wd.enabled}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, enabled: e.target.checked } }))}
              style={{ width: 16, height: 16, accentColor: '#5865F2' }}
            />
            {t('Aktiviert', 'Enabled')}
          </label>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Channel', 'Channel')}</label>
            <select
              data-testid="digest-channel-select"
              disabled={!canManageWeeklyDigest}
              value={wd.channelId}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, channelId: e.target.value } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              <option value="">{t('Channel wählen...', 'Select channel...')}</option>
              {textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Wochentag', 'Day')}</label>
            <select
              data-testid="digest-day-select"
              disabled={!canManageWeeklyDigest}
              value={wd.dayOfWeek}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, dayOfWeek: Number(e.target.value) } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              {DAYS.map((day) => <option key={day.value} value={day.value}>{t(day.de, day.en)}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Uhrzeit', 'Hour')}</label>
            <select
              data-testid="digest-hour-select"
              disabled={!canManageWeeklyDigest}
              value={wd.hour}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, hour: Number(e.target.value) } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Sprache', 'Language')}</label>
            <select
              data-testid="digest-language-select"
              disabled={!canManageWeeklyDigest}
              value={wd.language || 'de'}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, language: e.target.value } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="digest-preview-btn"
            disabled={!canManageWeeklyDigest || digestPreviewLoading}
            onClick={refreshDigestPreview}
            style={{
              height: 40,
              padding: '0 14px',
              border: '1px solid rgba(88,101,242,0.3)',
              background: 'rgba(37,99,235,0.16)',
              color: canManageWeeklyDigest ? '#DBEAFE' : '#3F3F46',
              cursor: canManageWeeklyDigest && !digestPreviewLoading ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {digestPreviewLoading ? t('Lade Vorschau...', 'Loading preview...') : t('Vorschau aktualisieren', 'Refresh preview')}
          </button>
          <button
            type="button"
            data-testid="digest-test-send-btn"
            disabled={!canManageWeeklyDigest || !wd.channelId || digestTestSending}
            onClick={sendDigestTest}
            style={{
              height: 40,
              padding: '0 14px',
              border: '1px solid rgba(16,185,129,0.3)',
              background: 'rgba(6,95,70,0.16)',
              color: canManageWeeklyDigest && wd.channelId ? '#BBF7D0' : '#3F3F46',
              cursor: canManageWeeklyDigest && wd.channelId && !digestTestSending ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {digestTestSending ? t('Sende Test...', 'Sending test...') : t('Test-Digest senden', 'Send test digest')}
          </button>
        </div>

        <div data-testid="digest-preview-card" style={{ marginTop: 14, border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                {t('Preview', 'Preview')}
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
                {digestPreview?.title || t('Noch keine Vorschau geladen', 'No preview loaded yet')}
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#71717A' }}>
              {t('Erstellt', 'Generated')}: {digestPreviewGeneratedLabel}
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
            {digestPreview?.description || t('Nutze die Vorschau, um den Weekly Digest vor dem Versand zu prüfen.', 'Use the preview to inspect the weekly digest before sending it.')}
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: '#71717A' }}>
            {t('Ziel-Channel', 'Target channel')}: {digestPreview?.channelName ? `#${digestPreview.channelName}` : t('Noch keiner ausgewählt', 'None selected yet')}
          </div>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {(digestPreview?.fields || []).map((field) => (
              <div key={`${field.name}-${field.value}`} style={{ border: '1px solid #1A1A2E', background: '#09090B', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{field.name}</div>
                <div style={{ marginTop: 6, fontSize: 14, color: '#F4F4F5', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{field.value}</div>
              </div>
            ))}
          </div>
        </div>

        {digestSummary.missingChannel && (
          <div data-testid="digest-channel-warning" style={{ marginTop: 12, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
            {t(
              'Der Weekly Digest ist aktiviert, aber es wurde noch kein Text-Channel ausgewählt.',
              'The weekly digest is enabled, but no text channel has been selected yet.'
            )}
          </div>
        )}
      </div>

      <div data-testid="settings-fallback-station" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageFallbackStation ? 1 : 0.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Shield size={18} color="#8B5CF6" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Failover-Kette', 'Failover chain')}</h3>
          {!canManageFallbackStation && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {t(
            'Wird automatisch verwendet, wenn eine Station nicht erreichbar ist. Anstatt dass gar nichts läuft, springt der Bot auf diese Station.',
            'Automatically used when a station is unreachable. Instead of silence, the bot switches to this station.'
          )}
        </p>
        {failoverHint && (
          <div style={{ marginBottom: 14 }}>
            <DashboardOnboardingHint
              hint={failoverHint}
              t={t}
              dataTestId="settings-failover-onboarding-hint"
            />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="fallback-status-card" style={{ border: `1px solid ${fallbackSummary.statusAccent}33`, background: `${fallbackSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: fallbackSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{fallbackSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{fallbackSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Aktuelle Station', 'Current station')}
            </div>
            <div data-testid="fallback-current-station" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {fallbackSummary.stationLabel}
            </div>
            {fallbackSummary.badgeLabel && (
              <div style={{ marginTop: 8, display: 'inline-flex', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '2px 8px', fontSize: 11, letterSpacing: '0.08em' }}>
                {fallbackSummary.badgeLabel}
              </div>
            )}
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Kettenstatus', 'Chain status')}
            </div>
            <div data-testid="failover-chain-status" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {fallbackSummary.chainLabel}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {t('Maximal 5 Stationen', 'Up to 5 stations')}
            </div>
          </div>
        </div>
        <div data-testid="failover-chain-list" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {configuredFailoverChain.length === 0 && (
            <div style={{ border: '1px dashed #27272A', background: '#050505', padding: '12px 14px', color: '#71717A', fontSize: 13 }}>
              {t(
                'Noch keine Failover-Kette hinterlegt. Ohne Eintraege bleibt nur die normale Auto-Reconnect-Logik aktiv.',
                'No failover chain has been configured yet. Without entries only the regular auto-reconnect logic remains active.'
              )}
            </div>
          )}

          {configuredFailoverChain.map((stationKey, index) => {
            const preview = settings?.failoverChainPreview?.[index] || buildLocalFailoverPreview(stationKey);
            const badgeLabel = preview?.isCustom
              ? t('Custom', 'Custom')
              : String(preview?.tier || 'ultimate').toUpperCase();
            return (
              <div
                key={`${stationKey}-${index}`}
                data-testid={`failover-chain-item-${index}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', flexWrap: 'wrap' }}
              >
                <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                    {t('Schritt', 'Step')} {index + 1}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 15, fontWeight: 600, color: '#F4F4F5' }}>
                    {preview?.label || stationKey}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '2px 8px', fontSize: 11, letterSpacing: '0.08em' }}>
                      {badgeLabel}
                    </span>
                    {preview?.valid === false && (
                      <span style={{ color: '#FCA5A5', fontSize: 12 }}>
                        {t('Aktuell nicht verfügbar', 'Currently unavailable')}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    disabled={!canManageFallbackStation || index === 0}
                    onClick={() => moveFailoverStation(index, -1)}
                    style={{ width: 34, height: 34, border: '1px solid #1A1A2E', background: '#09090B', color: canManageFallbackStation && index > 0 ? '#F4F4F5' : '#3F3F46', cursor: canManageFallbackStation && index > 0 ? 'pointer' : 'not-allowed' }}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={!canManageFallbackStation || index === configuredFailoverChain.length - 1}
                    onClick={() => moveFailoverStation(index, 1)}
                    style={{ width: 34, height: 34, border: '1px solid #1A1A2E', background: '#09090B', color: canManageFallbackStation && index < configuredFailoverChain.length - 1 ? '#F4F4F5' : '#3F3F46', cursor: canManageFallbackStation && index < configuredFailoverChain.length - 1 ? 'pointer' : 'not-allowed' }}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={!canManageFallbackStation}
                    onClick={() => removeFailoverStation(index)}
                    style={{ width: 34, height: 34, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(127,29,29,0.12)', color: canManageFallbackStation ? '#FCA5A5' : '#3F3F46', cursor: canManageFallbackStation ? 'pointer' : 'not-allowed' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <select
            data-testid="failover-chain-add-select"
            disabled={!canManageFallbackStation || configuredFailoverChain.length >= FAILOVER_CHAIN_LIMIT}
            value={pendingFailoverStation}
            onChange={(e) => setPendingFailoverStation(e.target.value)}
            style={{
              flex: '1 1 280px',
              minWidth: 220,
              height: 40,
              padding: '0 10px',
              border: '1px solid #1A1A2E',
              background: '#050505',
              color: canManageFallbackStation ? '#fff' : '#3F3F46',
              boxSizing: 'border-box',
              fontSize: 13,
            }}
          >
            <option value="">{t('Station zur Kette hinzufuegen...', 'Add station to chain...')}</option>
            {availableFailoverStations.map((station) => <option key={station.value} value={station.value}>{station.label}</option>)}
          </select>

          <button
            type="button"
            data-testid="failover-chain-add-btn"
            disabled={!canManageFallbackStation || !pendingFailoverStation || configuredFailoverChain.length >= FAILOVER_CHAIN_LIMIT}
            onClick={addFailoverStation}
            style={{ height: 40, padding: '0 14px', border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(91,33,182,0.18)', color: canManageFallbackStation && pendingFailoverStation ? '#DDD6FE' : '#3F3F46', cursor: canManageFallbackStation && pendingFailoverStation ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}
          >
            <Plus size={14} /> {t('Hinzufuegen', 'Add')}
          </button>
        </div>
      </div>

      <div data-testid={canManageVoiceGuard ? 'settings-voice-guard' : 'settings-voice-guard-locked'} style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageVoiceGuard ? 1 : 0.6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Shield size={18} color="#10B981" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Voice Guard', 'Voice guard')}</h3>
          {!canManageVoiceGuard && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>LOCKED</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {canManageVoiceGuard
            ? t(
              'Steuert, wie OmniFM auf Fremdverschiebungen in andere Voice-Channels reagiert. Für bewusstes Umziehen gibt es zusätzlich `/voiceguard unlock`.',
              'Controls how OmniFM reacts to foreign moves into other voice channels. For intentional moves you can additionally use `/voiceguard unlock`.'
            )
            : t(
              'Voice Guard konnte fuer diesen Server gerade nicht freigeschaltet werden. Bitte pruefe den Capability-Status oder lade das Dashboard neu.',
              'Voice guard could not be enabled for this server right now. Please verify the capability status or reload the dashboard.'
            )}
        </p>

        {canManageVoiceGuard && (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="voice-guard-status-card" style={{ border: `1px solid ${voiceGuardSummary.statusAccent}33`, background: `${voiceGuardSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: voiceGuardSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{voiceGuardSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{voiceGuardSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Policy', 'Policy')}
            </div>
            <div data-testid="voice-guard-policy-summary" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {voiceGuardSummary.policyLabel}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {t('Aktiv', 'Active')}: {voiceGuardSummary.effectiveLabel}
            </div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Guard-Regeln', 'Guard rules')}
            </div>
            <div data-testid="voice-guard-thresholds" style={{ marginTop: 6, fontSize: 13, color: '#D4D4D8', lineHeight: 1.7 }}>
              {voiceGuardSummary.thresholdsLabel}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {voiceGuardSummary.escalationLabel}
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 280 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Server-Policy', 'Server policy')}</label>
          <select
            data-testid="voice-guard-policy-select"
            value={voiceGuard.policy}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), voiceGuard: normalizeDashboardVoiceGuardConfig({ ...(current?.voiceGuard || {}), policy: e.target.value }) }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            <option value="default">{t('Standard (globale Env)', 'Default (global env)')}</option>
            <option value="allow">{t('Erlauben', 'Allow')}</option>
            <option value="return">{t('Zurueckspringen', 'Return')}</option>
            <option value="disconnect">Disconnect</option>
          </select>
        </div>
        </>
        )}
      </div>

      <div data-testid="settings-exports-webhooks" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageExports ? 1 : 0.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Shield size={18} color="#F59E0B" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Exporte & Webhooks', 'Exports & webhooks')}</h3>
          {!canManageExports && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {t(
            'Ultimate-Server können Stats und Custom-Stationen als JSON exportieren und zusätzlich Stall-, Recovery- sowie Failover-Ereignisse per Webhook oder Discord-Channel an Automationen und Operatoren melden.',
            'Ultimate servers can export stats and custom stations as JSON and additionally send stall, recovery, and failover events to automations and operators via webhook or Discord channel.'
          )}
        </p>
        {exportsHint && (
          <div style={{ marginBottom: 14 }}>
            <DashboardOnboardingHint
              hint={exportsHint}
              t={t}
              dataTestId="settings-exports-onboarding-hint"
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="exports-status-card" style={{ border: `1px solid ${exportsSummary.statusAccent}33`, background: `${exportsSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: exportsSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{exportsSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{exportsSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Webhook-Ziel', 'Webhook target')}
            </div>
            <div data-testid="exports-webhook-url-label" style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#D4D4D8', wordBreak: 'break-all' }}>
              {exportsWebhook.url || t('Noch keine URL hinterlegt', 'No URL configured yet')}
            </div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Ausloeser', 'Triggers')}
            </div>
            <div data-testid="exports-webhook-events-count" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {exportsWebhook.events.length} / {DASHBOARD_EXPORT_WEBHOOK_EVENTS.length}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {exportsWebhook.secretConfigured ? t('Secret gesetzt', 'Secret configured') : t('Ohne Secret', 'No secret')}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
          <label data-testid="exports-webhook-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
            <input
              type="checkbox"
              disabled={!canManageExports}
              checked={exportsWebhook.enabled}
              onChange={(e) => updateExportsWebhook({ enabled: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: '#F59E0B' }}
            />
            {t('Automatisch bei Exporten und Alerts senden', 'Send automatically on exports and alerts')}
          </label>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Webhook-URL', 'Webhook URL')}</label>
            <input
              data-testid="exports-webhook-url-input"
              disabled={!canManageExports}
              value={exportsWebhook.url}
              onChange={(e) => updateExportsWebhook({ url: e.target.value })}
              placeholder="https://example.com/omnifm"
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Secret', 'Secret')}</label>
            <input
              data-testid="exports-webhook-secret-input"
              disabled={!canManageExports}
              value={webhookSecretInput}
              onChange={(e) => updateExportsWebhook({ secret: e.target.value })}
              placeholder={exportsWebhook.secretConfigured
                ? t('Gespeichert – zum Ersetzen eingeben', 'Configured – enter to replace')
                : t('Optional', 'Optional')}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            />
            {exportsWebhook.secretConfigured && (
              <button
                type="button"
                data-testid="exports-webhook-secret-clear"
                disabled={!canManageExports}
                onClick={() => updateExportsWebhook({ secret: '' })}
                style={{ marginTop: 7, border: 0, padding: 0, background: 'transparent', color: canManageExports ? '#FCA5A5' : '#52525B', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 12 }}
              >
                {t('Secret beim Speichern entfernen', 'Remove secret when saving')}
              </button>
            )}
          </div>
        </div>

        <div data-testid="exports-webhook-event-list" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {DASHBOARD_EXPORT_WEBHOOK_EVENTS.map((event) => (
            <label key={event.key} style={{ display: 'flex', alignItems: 'center', gap: 10, color: canManageExports ? '#D4D4D8' : '#52525B', fontSize: 13 }}>
              <input
                type="checkbox"
                disabled={!canManageExports}
                checked={exportsWebhook.events.includes(event.key)}
                onChange={() => toggleExportsWebhookEvent(event.key)}
                style={{ width: 15, height: 15, accentColor: '#F59E0B' }}
              />
              {getDashboardExportWebhookEventLabel(event.key, t)}
            </label>
          ))}
        </div>

        <div style={{ margin: '18px 0 14px', borderTop: '1px solid #1A1A2E', paddingTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Shield size={15} color="#10B981" />
            <strong style={{ color: '#F4F4F5', fontSize: 14 }}>{t('Discord-Incident-Alerts', 'Discord incident alerts')}</strong>
          </div>
          <p style={{ color: '#71717A', fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
            {t(
              'Diese Alerts posten neue Stream-Stalls, Recoverys und Failover-Vorfaelle direkt in einen Discord-Text-Channel.',
              'These alerts post new stream stalls, recoveries, and failover incidents directly into a Discord text channel.'
            )}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
            <div data-testid="incident-alerts-status-card" style={{ border: `1px solid ${incidentAlertsSummary.statusAccent}33`, background: `${incidentAlertsSummary.statusAccent}14`, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: incidentAlertsSummary.statusAccent }}>
                {t('Status', 'Status')}
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{incidentAlertsSummary.statusLabel}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{incidentAlertsSummary.description}</div>
            </div>

            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                {t('Alert-Channel', 'Alert channel')}
              </div>
              <div data-testid="incident-alert-channel-label" style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#D4D4D8', wordBreak: 'break-word' }}>
                {incidentAlertChannelLabel || t('Noch kein Channel gesetzt', 'No channel configured yet')}
              </div>
            </div>

            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                {t('Ausloeser', 'Triggers')}
              </div>
              <div data-testid="incident-alert-events-count" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
                {incidentAlerts.events.length} / {DASHBOARD_INCIDENT_ALERT_EVENTS.length}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
                {incidentAlerts.enabled ? t('Automatisch aktiv', 'Automatic delivery enabled') : t('Noch nicht aktiviert', 'Not enabled yet')}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
            <label data-testid="incident-alerts-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
              <input
                type="checkbox"
                disabled={!canManageExports}
                checked={incidentAlerts.enabled}
                onChange={(e) => updateIncidentAlerts({ enabled: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: '#10B981' }}
              />
              {t('Neue Incidents automatisch nach Discord senden', 'Send new incidents to Discord automatically')}
            </label>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Text-Channel', 'Text channel')}</label>
              <select
                data-testid="incident-alert-channel-select"
                disabled={!canManageExports}
                value={incidentAlerts.channelId}
                onChange={(e) => updateIncidentAlerts({ channelId: e.target.value })}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: canManageExports ? '#fff' : '#3F3F46', boxSizing: 'border-box', fontSize: 13 }}
              >
                <option value="">{t('Kein Incident-Channel', 'No incident channel')}</option>
                {textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div data-testid="incident-alert-event-list" style={{ display: 'grid', gap: 8, marginBottom: 6 }}>
            {DASHBOARD_INCIDENT_ALERT_EVENTS.map((event) => (
              <label key={event.key} style={{ display: 'flex', alignItems: 'center', gap: 10, color: canManageExports ? '#D4D4D8' : '#52525B', fontSize: 13 }}>
                <input
                  type="checkbox"
                  disabled={!canManageExports}
                  checked={incidentAlerts.events.includes(event.key)}
                  onChange={() => toggleIncidentAlertEvent(event.key)}
                  style={{ width: 15, height: 15, accentColor: '#10B981' }}
                />
                {getDashboardIncidentAlertEventLabel(event.key, t)}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="export-stats-btn"
            disabled={!canManageExports || exportLoadingKey === 'stats'}
            onClick={() => downloadDashboardExport('stats', `/api/dashboard/exports/stats?serverId=${encodeURIComponent(selectedGuildId)}&days=30`)}
            style={{ height: 40, padding: '0 14px', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(120,53,15,0.16)', color: canManageExports ? '#FDE68A' : '#3F3F46', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
          >
            {exportLoadingKey === 'stats' ? t('Exportiere Stats...', 'Exporting stats...') : t('Stats-Export laden', 'Download stats export')}
          </button>
          <button
            type="button"
            data-testid="export-custom-stations-btn"
            disabled={!canManageExports || exportLoadingKey === 'custom-stations'}
            onClick={() => downloadDashboardExport('custom-stations', `/api/dashboard/exports/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`)}
            style={{ height: 40, padding: '0 14px', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(120,53,15,0.16)', color: canManageExports ? '#FDE68A' : '#3F3F46', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
          >
            {exportLoadingKey === 'custom-stations' ? t('Exportiere Stationen...', 'Exporting stations...') : t('Stations-Export laden', 'Download stations export')}
          </button>
          <button
            type="button"
            data-testid="export-webhook-test-btn"
            disabled={!canManageExports || !exportsWebhook.url || webhookTestSending}
            onClick={sendWebhookTest}
            style={{ height: 40, padding: '0 14px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(6,95,70,0.16)', color: canManageExports && exportsWebhook.url ? '#BBF7D0' : '#3F3F46', cursor: canManageExports && exportsWebhook.url && !webhookTestSending ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
          >
            {webhookTestSending ? t('Sende Test...', 'Sending test...') : t('Webhook testen', 'Test webhook')}
          </button>
        </div>
      </div>

      <button
        data-testid="settings-save-btn"
        onClick={save}
        style={{ height: 42, border: 'none', background: '#10B981', color: '#042f2e', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}
      >
        <Save size={16} /> {t('Einstellungen speichern', 'Save settings')}
      </button>
    </section>
  );
}
