// The same renderer the bot uses, so the preview is exactly the status (#277).
import { useState, useEffect, useCallback, useRef } from 'react';
import { Save } from 'lucide-react';
import { DASHBOARD_CAPABILITY_DEFAULTS } from '../lib/dashboardCapabilities.js';
import {
  FAILOVER_CHAIN_LIMIT,
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
  getConfiguredFailoverChain,
  normalizeFailoverChain,
} from '../lib/dashboardSettings.js';
import {
  normalizeDashboardExportsWebhookConfig,
  buildDashboardExportsWebhookSummary,
  buildDashboardExportDownloadName,
} from '../lib/dashboardExports.js';
import {
  normalizeDashboardIncidentAlertsConfig,
  buildDashboardIncidentAlertsSummary,
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
import DashboardBotProfile from './DashboardBotProfile.js';
import DashboardPanelDesigner from './DashboardPanelDesigner.js';
import { renderVoiceStatusTemplate } from '../../../src/lib/voice-status-template.js';
import { VOICE_STATUS_SAMPLE } from './settings/settingsShared.js';
import SettingsWeeklyDigest from './settings/SettingsWeeklyDigest.js';
import SettingsFailover from './settings/SettingsFailover.js';
import SettingsVoiceStatus from './settings/SettingsVoiceStatus.js';
import SettingsFavorites from './settings/SettingsFavorites.js';
import SettingsExports from './settings/SettingsExports.js';
import SettingsIncidentAlerts from './settings/SettingsIncidentAlerts.js';
import SettingsLanguage from './settings/SettingsLanguage.js';
import SettingsVoiceGuard from './settings/SettingsVoiceGuard.js';

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
      // No return in finally: it would replace the result of the try block.
      if (previewToken === digestPreviewTokenRef.current) setDigestPreviewLoading(false);
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
      if (loadToken === loadTokenRef.current) setLoading(false);
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
      if (capabilities.incidentAlerts === true && settings?.incidentAlerts) body.incidentAlerts = settings.incidentAlerts;
      if (capabilities.exportsWebhooks === true && settings?.exportsWebhook) body.exportsWebhook = settings.exportsWebhook;
      if (capabilities.voiceGuard === true && settings?.voiceGuard) body.voiceGuard = settings.voiceGuard;
      // The channel status is Pro (#413); Free saves language, voice guard and favourites.
      if (capabilities.dashboardAccess === true && settings?.voiceStatus) body.voiceStatus = { template: settings.voiceStatus.template || '' };
      if (settings?.serverLanguage?.current) body.serverLanguage = settings.serverLanguage.current;
      if (settings?.favorites) body.favorites = { stations: settings.favorites.stations || [] };
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
  const voiceStatus = settings?.voiceStatus || null;
  const voiceStatusTemplate = voiceStatus?.template || '';
  const voiceStatusRenderOptions = { fallbackTemplate: voiceStatus?.defaultTemplate || '' };
  const voiceStatusPreview = renderVoiceStatusTemplate(voiceStatusTemplate, VOICE_STATUS_SAMPLE, voiceStatusRenderOptions);
  const voiceStatusPreviewNoSong = renderVoiceStatusTemplate(
    voiceStatusTemplate,
    { ...VOICE_STATUS_SAMPLE, title: '', artist: '', listeners: 0 },
    voiceStatusRenderOptions
  );
  const updateVoiceStatusTemplate = (template) => setSettings((current) => ({
    ...(current || {}),
    voiceStatus: { ...(current?.voiceStatus || {}), template },
  }));
  const voiceGuard = normalizeDashboardVoiceGuardConfig(settings?.voiceGuard);
  const voiceGuardSummary = buildDashboardVoiceGuardSummary(voiceGuard, t);
  const canManageWeeklyDigest = capabilities.weeklyDigest === true;
  const canManageFallbackStation = capabilities.failoverRules === true;
  const canManageExports = capabilities.exportsWebhooks === true;
  // #413: outage alerts in Discord come with Pro, webhooks and exports with Ultimate.
  const canManageIncidentAlerts = capabilities.incidentAlerts === true;
  const canManageVoiceGuard = capabilities.voiceGuard === true;
  const canManageVoiceStatus = capabilities.dashboardAccess === true;
  const setServerLanguage = (value) => setSettings((current) => ({
    ...(current || {}),
    serverLanguage: { ...(current?.serverLanguage || {}), current: value },
  }));
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
        t('Test-Digest erfolgreich an {channel} gesendet.', 'Test digest sent successfully to {channel}.', { channel: channelLabel })
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
          'Export erfolgreich heruntergeladen.{suffix}',
          'Export downloaded successfully.{suffix}',
          { suffix: webhookSuffix }
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
          'Webhook-Test erfolgreich gesendet (Status {status}).',
          'Webhook test sent successfully (status {status}).',
          { status: result?.delivery?.status || 200 }
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
  const favorites = settings?.favorites || null;
  const favoriteStations = Array.isArray(favorites?.stations) ? favorites.stations : [];
  const favoriteLimit = Number(favorites?.limit) || 3;
  const availableFavoriteStations = allStations.filter((station) => !favoriteStations.includes(station.value));
  const setFavoriteStations = (nextList) => setSettings((current) => ({
    ...(current || {}),
    favorites: { ...(current?.favorites || {}), stations: nextList },
  }));
  const moveFavorite = (index, delta) => {
    const next = [...favoriteStations];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFavoriteStations(next);
  };

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

      {settings?.serverLanguage && (
    <SettingsLanguage serverLanguage={settings.serverLanguage} setServerLanguage={setServerLanguage} t={t} />
      )}

    <SettingsWeeklyDigest
      canManageWeeklyDigest={canManageWeeklyDigest}
      digestHint={digestHint}
      digestPreview={digestPreview}
      digestPreviewGeneratedLabel={digestPreviewGeneratedLabel}
      digestPreviewLoading={digestPreviewLoading}
      digestSummary={digestSummary}
      digestTestSending={digestTestSending}
      refreshDigestPreview={refreshDigestPreview}
      sendDigestTest={sendDigestTest}
      setSettings={setSettings}
      t={t}
      textChannels={textChannels}
      wd={wd}
    />

    <SettingsFailover
      addFailoverStation={addFailoverStation}
      availableFailoverStations={availableFailoverStations}
      buildLocalFailoverPreview={buildLocalFailoverPreview}
      canManageFallbackStation={canManageFallbackStation}
      configuredFailoverChain={configuredFailoverChain}
      failoverHint={failoverHint}
      fallbackSummary={fallbackSummary}
      moveFailoverStation={moveFailoverStation}
      pendingFailoverStation={pendingFailoverStation}
      removeFailoverStation={removeFailoverStation}
      setPendingFailoverStation={setPendingFailoverStation}
      settings={settings}
      t={t}
    />

    <SettingsVoiceGuard
      canManageVoiceGuard={canManageVoiceGuard}
      setSettings={setSettings}
      t={t}
      voiceGuard={voiceGuard}
      voiceGuardSummary={voiceGuardSummary}
    />

      {voiceStatus && (
    <SettingsVoiceStatus
      canManage={canManageVoiceStatus}
      t={t}
      updateVoiceStatusTemplate={updateVoiceStatusTemplate}
      voiceStatus={voiceStatus}
      voiceStatusPreview={voiceStatusPreview}
      voiceStatusPreviewNoSong={voiceStatusPreviewNoSong}
      voiceStatusTemplate={voiceStatusTemplate}
    />
      )}

      {favorites && (
    <SettingsFavorites
      availableFavoriteStations={availableFavoriteStations}
      favoriteLimit={favoriteLimit}
      favoriteStations={favoriteStations}
      moveFavorite={moveFavorite}
      setFavoriteStations={setFavoriteStations}
      stationPreviewMap={stationPreviewMap}
      t={t}
    />
      )}

      <DashboardPanelDesigner apiRequest={apiRequest} selectedGuildId={selectedGuildId} t={t} />

      <DashboardBotProfile apiRequest={apiRequest} selectedGuildId={selectedGuildId} t={t} />

    <SettingsIncidentAlerts
      canManageIncidentAlerts={canManageIncidentAlerts}
      incidentAlertChannelLabel={incidentAlertChannelLabel}
      incidentAlerts={incidentAlerts}
      incidentAlertsSummary={incidentAlertsSummary}
      t={t}
      textChannels={textChannels}
      toggleIncidentAlertEvent={toggleIncidentAlertEvent}
      updateIncidentAlerts={updateIncidentAlerts}
    />

    <SettingsExports
      canManageExports={canManageExports}
      downloadDashboardExport={downloadDashboardExport}
      exportLoadingKey={exportLoadingKey}
      exportsHint={exportsHint}
      exportsSummary={exportsSummary}
      exportsWebhook={exportsWebhook}
      selectedGuildId={selectedGuildId}
      sendWebhookTest={sendWebhookTest}
      t={t}
      toggleExportsWebhookEvent={toggleExportsWebhookEvent}
      updateExportsWebhook={updateExportsWebhook}
      webhookSecretInput={webhookSecretInput}
      webhookTestSending={webhookTestSending}
    />

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
