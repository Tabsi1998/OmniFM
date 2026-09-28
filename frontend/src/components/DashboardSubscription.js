import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, Crown, Mail, ExternalLink, RefreshCw, Users } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { getDashboardBlockedFeatureLabels } from '../lib/dashboardCapabilities.js';
import { buildHomeHref } from '../lib/pageRouting.js';
import {
  formatSubscriptionPriceCents,
  buildSubscriptionLimitCards,
  buildSubscriptionNextAction,
  buildSubscriptionUpgradeSummary,
  buildSubscriptionPromotionNotes,
  buildSubscriptionActivityRows,
} from '../lib/dashboardSubscription.js';
import { DashboardCheckoutModal } from './subscription/SubscriptionCodeModal.js';
import {
  FeatureRow,
  TIER_COLORS,
  TIER_LABELS,
  formatLicenseDate,
} from './subscription/subscriptionShared.js';
import SubscriptionWorkspace from './subscription/SubscriptionWorkspace.js';
import SubscriptionUpgrade from './subscription/SubscriptionUpgrade.js';
import SubscriptionEmail from './subscription/SubscriptionEmail.js';

export default function DashboardSubscription({ apiRequest, selectedGuildId, t, capabilityPayload = null }) {
  const { locale, localeMeta, formatDate } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [workspaceTargetId, setWorkspaceTargetId] = useState('');
  const [workspaceBusyTargetId, setWorkspaceBusyTargetId] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest(`/api/dashboard/license?serverId=${encodeURIComponent(selectedGuildId)}`);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setEmailDraft('');
    setEmailEditing(false);
    setEmailSaving(false);
    setCheckoutNotice('');
    setWorkspaceTargetId('');
    setWorkspaceBusyTargetId('');
    setWorkspaceError('');
    setWorkspaceNotice('');
  }, [selectedGuildId, data?.license?.emailMasked]);

  const lic = data?.license || null;
  const workspace = lic?.workspace || null;
  const workspaceLinkedServers = Array.isArray(workspace?.linkedServers) ? workspace.linkedServers : [];
  const workspaceAvailableServers = useMemo(
    () => (Array.isArray(workspace?.availableServers) ? workspace.availableServers : []),
    [workspace],
  );
  const workspaceBlockedServers = Array.isArray(workspace?.blockedServers) ? workspace.blockedServers : [];
  const workspaceCanLink = Boolean(workspace?.canManage) && Number(lic?.seatsAvailable || 0) > 0;
  const effectiveTier = data?.effectiveTier || lic?.plan || data?.tier || 'free';
  const tierColor = TIER_COLORS[effectiveTier] || '#71717A';
  const isExpired = lic?.expired;
  const isExpiringSoon = !isExpired && lic?.remainingDays != null && lic.remainingDays <= 7;
  const canManagePaidPlan = lic && ['pro', 'ultimate'].includes(String(lic.plan || effectiveTier || '').toLowerCase());
  const canUpgradeToUltimate = String(lic?.plan || effectiveTier || '').toLowerCase() === 'pro';
  const plansHref = buildHomeHref(locale, '#premium');
  const blockedFeatureKeys = useMemo(
    () => data?.upgradeHints?.blockedFeatures || capabilityPayload?.upgradeHints?.blockedFeatures || [],
    [data, capabilityPayload],
  );
  const blockedFeatureLabels = useMemo(
    () => getDashboardBlockedFeatureLabels(blockedFeatureKeys, t, 6),
    [blockedFeatureKeys, t]
  );
  const nextUpgradeTier = String(data?.upgradeHints?.nextTier || capabilityPayload?.upgradeHints?.nextTier || '').trim().toLowerCase();
  const nextUpgradeLabel = nextUpgradeTier ? nextUpgradeTier.toUpperCase() : '';
  const limitCards = useMemo(() => buildSubscriptionLimitCards(data, t), [data, t]);
  const upgradeSummary = useMemo(
    () => buildSubscriptionUpgradeSummary(data, blockedFeatureLabels, t),
    [data, blockedFeatureLabels, t]
  );
  const promotionNotes = useMemo(() => buildSubscriptionPromotionNotes(data, t), [data, t]);
  const activityRows = useMemo(() => buildSubscriptionActivityRows(data?.activity, t), [data?.activity, t]);
  const nextAction = useMemo(() => buildSubscriptionNextAction(data, blockedFeatureLabels, t), [blockedFeatureLabels, data, t]);
  const trialActivity = data?.activity?.trial || null;

  const planFeatures = useMemo(() => {
    if (effectiveTier === 'ultimate') {
      return [
        '320k Bitrate (Ultra HQ)',
        t('Bis zu 16 Bots', 'Up to 16 bots'),
        t('Alle Stationen + Custom-URLs', 'All stations + custom URLs'),
        t('Dashboard + Events + Analytics', 'Dashboard + events + analytics'),
        t('Fallback-Station', 'Fallback station'),
      ];
    }
    if (effectiveTier === 'pro') {
      return [
        '128k Bitrate (HQ Opus)',
        t('Bis zu 8 Bots', 'Up to 8 bots'),
        t('120 Stationen (Free + Pro)', '120 stations (free + pro)'),
        t('Dashboard + Events', 'Dashboard + events'),
        t('Priorisierter Reconnect', 'Priority reconnect'),
      ];
    }
    return [
      '64k Bitrate',
      t('Bis zu 2 Bots', 'Up to 2 bots'),
      t('20 Free-Stationen', '20 free stations'),
      t('Automatischer Reconnect', 'Automatic reconnect'),
      t('Dashboard ab Pro', 'Dashboard from Pro'),
    ];
  }, [effectiveTier, t]);

  const openCheckout = useCallback(() => {
    setCheckoutError('');
    setCheckoutOpen(true);
  }, []);

  const startCheckout = useCallback(async ({ months, tier, email, couponCode }) => {
    if (!selectedGuildId) return;
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const result = await apiRequest(`/api/dashboard/license/checkout?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({
          months,
          tier,
          email,
          couponCode,
          language: locale,
        }),
      });
      if (result?.activated) {
        setCheckoutOpen(false);
        setCheckoutNotice(result.message || t('Code erfolgreich eingelöst.', 'Code redeemed successfully.'));
        await load();
        return;
      }
      setCheckoutError(t('Der Code wurde nicht eingelöst.', 'The code was not redeemed.'));
    } catch (err) {
      setCheckoutError(err.message || t('Der Code konnte nicht eingelöst werden.', 'The code could not be redeemed.'));
    } finally {
      setCheckoutLoading(false);
    }
  }, [apiRequest, load, locale, selectedGuildId, t]);

  const previewCheckout = useCallback(async ({ months, tier, email, couponCode }) => {
    if (!selectedGuildId) return null;
    return apiRequest(`/api/dashboard/license/offer-preview?serverId=${encodeURIComponent(selectedGuildId)}`, {
      method: 'POST',
      body: JSON.stringify({
        months,
        tier,
        email,
        couponCode,
        language: locale,
      }),
    });
  }, [apiRequest, locale, selectedGuildId]);

  const saveLicenseEmail = useCallback(async () => {
    const nextEmail = String(emailDraft || '').trim().toLowerCase();
    if (!nextEmail) {
      setError(t('Bitte eine Lizenz-E-Mail eingeben.', 'Please enter a license email.'));
      return;
    }
    setEmailSaving(true);
    setError('');
    try {
      const result = await apiRequest(`/api/dashboard/license?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          contactEmail: nextEmail,
          language: locale,
        }),
      });
      setData(result);
      setEmailDraft('');
      setEmailEditing(false);
    } catch (err) {
      setError(err.message || t('Lizenz-E-Mail konnte nicht aktualisiert werden.', 'License email could not be updated.'));
    } finally {
      setEmailSaving(false);
    }
  }, [apiRequest, emailDraft, locale, selectedGuildId, t]);

  const updateWorkspace = useCallback(async (action, targetServerId) => {
    if (!selectedGuildId || !targetServerId) return;
    setWorkspaceBusyTargetId(targetServerId);
    setWorkspaceError('');
    setWorkspaceNotice('');
    try {
      const result = await apiRequest(`/api/dashboard/license/workspace?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          targetServerId,
          language: locale,
        }),
      });
      setData(result);
      setWorkspaceNotice(result?.message || (action === 'link'
        ? t('Server wurde dem Lizenz-Workspace hinzugefügt.', 'Server was added to the license workspace.')
        : t('Server wurde aus dem Lizenz-Workspace entfernt.', 'Server was removed from the license workspace.')));
    } catch (err) {
      setWorkspaceError(err.message || (action === 'link'
        ? t('Server konnte nicht zum Lizenz-Workspace hinzugefügt werden.', 'Server could not be added to the license workspace.')
        : t('Server konnte nicht aus dem Lizenz-Workspace entfernt werden.', 'Server could not be removed from the license workspace.')));
    } finally {
      setWorkspaceBusyTargetId('');
    }
  }, [apiRequest, locale, selectedGuildId, t]);

  useEffect(() => {
    if (!workspaceAvailableServers.length) {
      if (workspaceTargetId) setWorkspaceTargetId('');
      return;
    }
    if (!workspaceAvailableServers.some((server) => server.id === workspaceTargetId)) {
      setWorkspaceTargetId(workspaceAvailableServers[0].id);
    }
  }, [workspaceAvailableServers, workspaceTargetId]);

  if (loading) {
    return (
      <div style={{ color: '#52525B', textAlign: 'center', padding: 40 }}>
        {t('Lade...', 'Loading...')}
      </div>
    );
  }

  return (
    <section data-testid="dashboard-subscription-panel" style={{ display: 'grid', gap: 14 }}>
      {error ? (
        <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {checkoutNotice ? (
        <div style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,78,59,0.16)', padding: '10px 12px', color: '#D1FAE5', fontSize: 13 }}>
          {checkoutNotice}
        </div>
      ) : null}

      {workspaceNotice ? (
        <div style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,78,59,0.16)', padding: '10px 12px', color: '#D1FAE5', fontSize: 13 }}>
          {workspaceNotice}
        </div>
      ) : null}

      <div
        data-testid="subscription-plan-card"
        style={{
          background: '#0A0A0A',
          border: `1px solid ${tierColor}33`,
          padding: 24,
          display: 'grid',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Crown size={24} color={tierColor} />
            <div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 700, color: tierColor }}>
                {TIER_LABELS[effectiveTier] || 'Free'}
              </div>
              <div style={{ color: '#71717A', fontSize: 12 }}>{t('Aktueller Lizenzstatus', 'Current license status')}</div>
            </div>
          </div>
          <button
            data-testid="subscription-refresh-btn"
            onClick={load}
            style={{
              border: '1px solid #1A1A2E',
              background: 'transparent',
              color: '#71717A',
              height: 34,
              padding: '0 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <RefreshCw size={13} /> {t('Aktualisieren', 'Refresh')}
          </button>
        </div>

        {effectiveTier === 'free' && !lic ? (
          <div
            data-testid="subscription-free-info"
            style={{
              border: '1px solid #1A1A2E',
              background: '#050505',
              padding: 16,
              display: 'grid',
              gap: 8,
            }}
          >
            <p style={{ color: '#A1A1AA', fontSize: 13, lineHeight: 1.7 }}>
              {t(
                'Für diesen Server ist aktuell kein kostenpflichtiges Abo hinterlegt. Upgrades auf Pro oder Ultimate startest du weiterhin über die Hauptseite.',
                'There is currently no paid subscription stored for this server. Upgrades to Pro or Ultimate are still started from the main website.'
              )}
            </p>
            <a
              href={plansHref}
              data-testid="subscription-upgrade-link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 4,
                border: '1px solid #8B5CF6',
                background: 'rgba(139,92,246,0.12)',
                color: '#fff',
                padding: '10px 16px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 14,
                width: 'fit-content',
              }}
            >
              <ExternalLink size={15} /> {t('Pläne öffnen', 'Open plans')}
            </a>
          </div>
        ) : null}

        {nextAction ? (
          <div
            data-testid="subscription-next-action-card"
            style={{
              border: `1px solid ${nextAction.accent}44`,
              background: `${nextAction.accent}12`,
              padding: 16,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 11, color: nextAction.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {nextAction.eyebrow}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#F4F4F5' }}>
                  {nextAction.title}
                </h4>
                <div style={{ marginTop: 6, fontSize: 13, color: '#D4D4D8', lineHeight: 1.65 }}>
                  {nextAction.body}
                </div>
              </div>
              {nextAction.cta?.kind === 'plans' ? (
                <a
                  href={plansHref}
                  data-testid="subscription-next-action-link"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    border: `1px solid ${nextAction.accent}`,
                    background: `${nextAction.accent}1A`,
                    color: '#fff',
                    padding: '10px 14px',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: 14,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <ExternalLink size={15} /> {nextAction.cta.label}
                </a>
              ) : (
                <button
                  type="button"
                  data-testid="subscription-next-action-button"
                  onClick={() => {
                    if (nextAction.cta?.kind === 'edit-email') {
                      setEmailEditing(true);
                      return;
                    }
                    if (nextAction.cta?.kind === 'checkout') {
                      openCheckout();
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    border: `1px solid ${nextAction.accent}`,
                    background: `${nextAction.accent}1A`,
                    color: '#fff',
                    padding: '10px 14px',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nextAction.cta?.kind === 'edit-email' ? <Mail size={15} /> : <ArrowRight size={15} />}
                  {nextAction.cta?.label}
                </button>
              )}
            </div>
          </div>
        ) : null}

        {lic ? (
          <div
            data-testid="subscription-details"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Clock size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('Gültig bis', 'Valid until')}
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: isExpired ? '#EF4444' : isExpiringSoon ? '#F59E0B' : '#fff' }}>
                {formatLicenseDate(lic.expiresAt, formatDate)}
              </div>
              {lic.remainingDays != null && !isExpired ? (
                <div style={{ fontSize: 12, color: isExpiringSoon ? '#F59E0B' : '#52525B', marginTop: 4 }}>
                  {lic.remainingDays} {t('Tage verbleibend', 'days remaining')}
                </div>
              ) : null}
              {isExpired ? (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{t('Abgelaufen', 'Expired')}</div>
              ) : null}
            </div>

            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Users size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('Server-Slots', 'Server slots')}
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600 }}>
                {lic.seatsUsed || 0} / {lic.seats || 1}
              </div>
              <div style={{ fontSize: 12, color: '#52525B', marginTop: 4 }}>
                {t('verknüpft', 'linked')}
              </div>
            </div>

          <SubscriptionEmail
            emailDraft={emailDraft}
            emailEditing={emailEditing}
            emailSaving={emailSaving}
            lic={lic}
            saveLicenseEmail={saveLicenseEmail}
            setEmailDraft={setEmailDraft}
            setEmailEditing={setEmailEditing}
            t={t}
          />
          </div>
        ) : null}

        <div data-testid="subscription-limits-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {limitCards.map((card) => (
            <div key={card.key} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {card.label}
              </div>
              <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
                {card.value}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                {card.detail}
              </div>
            </div>
          ))}
        </div>

        {isExpired && canManagePaidPlan ? (
          <div
            data-testid="subscription-expired-warning"
            style={{
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(127,29,29,0.12)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <AlertTriangle size={18} color="#EF4444" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FCA5A5' }}>{t('Lizenz abgelaufen', 'License expired')}</div>
              <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>
                {t(
                  'Deine Lizenz ist abgelaufen. Verlängere sie direkt im Dashboard, damit alle Funktionen wieder aktiv sind.',
                  'Your license has expired. Renew it directly in the dashboard to reactivate all features.'
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isExpiringSoon && !isExpired ? (
          <div
            data-testid="subscription-expiring-warning"
            style={{
              border: '1px solid rgba(245,158,11,0.3)',
              background: 'rgba(120,53,15,0.12)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <AlertTriangle size={18} color="#F59E0B" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FDE68A' }}>{t('Läuft bald ab', 'Expiring soon')}</div>
              <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>
                {t(
                  `Deine Lizenz läuft in ${lic.remainingDays} Tagen ab. Du kannst sie direkt hier um 1, 3, 6 oder 12 Monate verlängern.`,
                  `Your license expires in ${lic.remainingDays} days. You can renew it right here for 1, 3, 6 or 12 months.`
                )}
              </div>
            </div>
          </div>
        ) : null}

        {canManagePaidPlan ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              data-testid="subscription-extend-link"
              onClick={openCheckout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${tierColor}`,
                background: `${tierColor}1A`,
                color: '#fff',
                padding: '10px 16px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <ArrowRight size={15} />
              {isExpired ? t('Jetzt verlängern', 'Renew now') : t('Abo verlängern', 'Extend subscription')}
            </button>
            {canUpgradeToUltimate ? (
              <button
                data-testid="subscription-upgrade-ultimate-link"
                onClick={openCheckout}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid #8B5CF6',
                  background: 'rgba(139,92,246,0.12)',
                  color: '#fff',
                  padding: '10px 16px',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <Crown size={15} /> {t('Ultimate prüfen', 'Review Ultimate')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {workspace?.enabled ? (
      <SubscriptionWorkspace
        lic={lic}
        setWorkspaceTargetId={setWorkspaceTargetId}
        t={t}
        updateWorkspace={updateWorkspace}
        workspace={workspace}
        workspaceAvailableServers={workspaceAvailableServers}
        workspaceBlockedServers={workspaceBlockedServers}
        workspaceBusyTargetId={workspaceBusyTargetId}
        workspaceCanLink={workspaceCanLink}
        workspaceError={workspaceError}
        workspaceLinkedServers={workspaceLinkedServers}
        workspaceTargetId={workspaceTargetId}
      />
      ) : null}

      {upgradeSummary ? (
      <SubscriptionUpgrade
        canManagePaidPlan={canManagePaidPlan}
        localeMeta={localeMeta}
        openCheckout={openCheckout}
        t={t}
        upgradeSummary={upgradeSummary}
      />
      ) : null}

      {promotionNotes.length > 0 ? (
        <div
          data-testid="subscription-promotion-notes-card"
          style={{
            background: '#0A0A0A',
            border: '1px solid #1A1A2E',
            padding: 16,
            display: 'grid',
            gap: 10,
          }}
        >
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#D4D4D8' }}>
            {t('Checkout & Hinweise', 'Checkout & notes')}
          </h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {promotionNotes.map((note) => (
              <div key={note.key} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: '#F4F4F5', fontWeight: 700 }}>{note.label}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{note.detail}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(activityRows.length > 0 || trialActivity) ? (
        <div
          data-testid="subscription-activity-card"
          style={{
            background: '#0A0A0A',
            border: '1px solid #1A1A2E',
            padding: 16,
            display: 'grid',
            gap: 12,
          }}
        >
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#D4D4D8' }}>
            {t('Verlauf', 'History')}
          </h4>

          {activityRows.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {activityRows.map((row) => (
                <div key={row.key} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <strong style={{ color: '#F4F4F5', fontSize: 13 }}>{row.title}</strong>
                    <strong style={{ color: '#D4D4D8', fontSize: 13 }}>
                      {formatSubscriptionPriceCents(row.amountCents, localeMeta.intl)}
                    </strong>
                  </div>
                  <div style={{ fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>
                    {row.detail}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#71717A' }}>
                    <span>
                      {row.processedAt
                        ? formatDate(row.processedAt, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </span>
                    <span>
                      {row.discountCents > 0
                        ? t(`Rabatt ${formatSubscriptionPriceCents(row.discountCents, localeMeta.intl)}`, `Discount ${formatSubscriptionPriceCents(row.discountCents, localeMeta.intl)}`)
                        : t('Ohne Rabatt', 'No discount')}
                    </span>
                    <span style={{ color: row.replayProtected ? '#10B981' : '#F59E0B' }}>
                      {row.replayProtected ? t('Replay-geschuetzt', 'Replay protected') : t('Replay offen', 'Replay open')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {trialActivity ? (
            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', display: 'grid', gap: 6 }}>
              <strong style={{ color: '#F4F4F5', fontSize: 13 }}>
                {t('Trial-Verlauf', 'Trial history')}
              </strong>
              <div style={{ fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>
                {t(
                  `Status ${String(trialActivity.status || '').toUpperCase()}${trialActivity.months ? ` • ${trialActivity.months} Monat${trialActivity.months > 1 ? 'e' : ''}` : ''}${trialActivity.seats ? ` • ${trialActivity.seats} Seat${trialActivity.seats > 1 ? 's' : ''}` : ''}`,
                  `Status ${String(trialActivity.status || '').toUpperCase()}${trialActivity.months ? ` • ${trialActivity.months} month${trialActivity.months > 1 ? 's' : ''}` : ''}${trialActivity.seats ? ` • ${trialActivity.seats} seat${trialActivity.seats > 1 ? 's' : ''}` : ''}`
                )}
              </div>
              <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                {trialActivity.claimedAt
                  ? formatDate(trialActivity.claimedAt, { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : trialActivity.createdAt
                    ? formatDate(trialActivity.createdAt, { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : '—'}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {blockedFeatureLabels.length > 0 ? (
        <div
          data-testid="subscription-locked-features-card"
          style={{
            background: '#0A0A0A',
            border: '1px solid rgba(139,92,246,0.25)',
            padding: 16,
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#D4D4D8' }}>
                {t('Aktuell gesperrte Funktionen', 'Currently locked features')}
              </h4>
              <div style={{ marginTop: 6, color: '#A1A1AA', fontSize: 13, lineHeight: 1.6 }}>
                {nextUpgradeLabel
                  ? t(
                    `Nächster sinnvoller Schritt für diesen Server: ${nextUpgradeLabel}.`,
                    `Best next step for this server: ${nextUpgradeLabel}.`
                  )
                  : t(
                    'Diese Funktionen sind auf diesem Server aktuell noch nicht freigeschaltet.',
                    'These features are not unlocked on this server yet.'
                  )}
              </div>
            </div>
            <Crown size={20} color="#C4B5FD" />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {blockedFeatureLabels.map((feature) => (
              <FeatureRow key={feature} label={feature} />
            ))}
          </div>
        </div>
      ) : null}

      <div data-testid="subscription-features-card" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, marginBottom: 14, color: '#D4D4D8' }}>
          {t('Plan-Highlights', 'Plan highlights')}
        </h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {planFeatures.map((feature) => (
            <FeatureRow key={feature} label={feature} />
          ))}
        </div>
      </div>

      <DashboardCheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        loading={checkoutLoading}
        submitError={checkoutError}
        initialTier={String(lic?.plan || effectiveTier || 'pro').toLowerCase() === 'ultimate' ? 'ultimate' : 'pro'}
        seats={Math.max(1, Number(lic?.seats || 1) || 1)}
        t={t}
        locale={localeMeta.intl}
        onSubmit={startCheckout}
        onPreview={previewCheckout}
        hasBillingEmail={lic ? Boolean(lic.hasBillingEmail || lic.emailMasked) : true}
      />
    </section>
  );
}
