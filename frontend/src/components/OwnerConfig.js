import React, { useState, useEffect, useCallback } from 'react';
import {
  Save, Plus, Trash2, CheckCircle2, XCircle, Bot, Building2,
  Tag, Terminal, ShieldCheck, Info, Star, Heart, Mail, Music2, History, Fingerprint, Globe2, BellRing, Users, KeyRound,
} from 'lucide-react';
import { discordRedirectUriFor, secretInputValue } from '../lib/ownerConfigSecrets.js';

const labelStyle = {
  fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: 6, display: 'block',
};

function Field({ label, value, onChange, placeholder, type = 'text', textarea, testid, hint, width }) {
  return (
    <div style={{ marginBottom: 14, gridColumn: width === 'full' ? '1 / -1' : 'auto' }}>
      <label style={labelStyle}>{label}</label>
      {textarea ? (
        <textarea
          className="oa-input" data-testid={testid} value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ height: 96, padding: '12px 14px', resize: 'vertical', lineHeight: 1.5 }}
        />
      ) : (
        <input
          className="oa-input" data-testid={testid} type={type} value={value || ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Toggle({ label, checked, onChange, testid }) {
  return (
    <button
      type="button" data-testid={testid} onClick={() => onChange(!checked)}
      className="oa-card" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        cursor: 'pointer', padding: '12px 16px', marginBottom: 14, width: '100%', textAlign: 'left',
        border: checked ? '1px solid #10b981' : '1px solid var(--oa-border-active)',
      }}
    >
      <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{label}</span>
      <span style={{
        width: 46, height: 26, borderRadius: 999, background: checked ? '#10b981' : '#2a3450',
        position: 'relative', transition: 'background 0.2s ease', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease',
        }} />
      </span>
    </button>
  );
}

// Stays at the bottom of the page and says when something is not saved yet (#356).
function SaveBar({ onSave, saving, msg, testid, dirty = false }) {
  return (
    <div data-testid={`${testid}-bar`} style={{ position: 'sticky', bottom: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, padding: '10px 0', background: 'var(--oa-bg, #0b1120)', borderTop: dirty ? '1px solid #fab219' : '1px solid transparent' }}>
      <button className="oa-btn primary" onClick={onSave} disabled={saving || !dirty} data-testid={testid}>
        <Save size={16} /> {saving ? 'Speichert…' : 'Speichern'}
      </button>
      {dirty && !saving && (
        <span data-testid={`${testid}-dirty`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#fab219' }}>
          ! Ungespeicherte Änderungen
        </span>
      )}
      {msg && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: msg.ok ? '#10b981' : '#ff8fab' }}>
          {msg.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {msg.text}
        </span>
      )}
    </div>
  );
}

const eur = (cents) => (Number(cents || 0) / 100).toString().replace('.', ',');
const toCents = (v) => Math.max(0, Math.round(parseFloat(String(v).replace(',', '.')) * 100) || 0);
const featuresText = (arr) => (Array.isArray(arr) ? arr.join('\n') : '');
const textToFeatures = (t) => String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);

export default function OwnerConfig({ section, part = null, apiGet, apiSend, token }) {
  const [company, setCompany] = useState(null);
  const [plans, setPlans] = useState(null);
  const [discord, setDiscord] = useState(null);
  const [marketing, setMarketing] = useState(null);
  const [discordShop, setDiscordShop] = useState(null);
  const [system, setSystem] = useState(null);
  const [access, setAccess] = useState(null);
  const [recoverySettings, setRecoverySettings] = useState([]);
  const [logs, setLogs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [alertTest, setAlertTest] = useState(null);
  const [loadError, setLoadError] = useState('');
  // What the server sent, per section: a difference means unsaved changes.
  const [loaded, setLoaded] = useState({});

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const d = await apiGet('/api/admin/config', token);
      setCompany(d.company); setPlans(d.plans); setDiscord(d.discord); setMarketing(d.marketing); setDiscordShop(d.discordShop || { enabled: false, skus: { pro: '', ultimate: '' } }); setSystem(d.system); setAccess(d.access || { accounts: [], tokenEnabled: true }); setRecoverySettings(Array.isArray(d.recoverySettings) ? d.recoverySettings : []);
      setLoaded({ company: JSON.stringify(d.company), plans: JSON.stringify(d.plans), discord: JSON.stringify(d.discord), marketing: JSON.stringify(d.marketing), discordShop: JSON.stringify(d.discordShop || { enabled: false, skus: { pro: '', ultimate: '' } }), system: JSON.stringify(d.system), access: JSON.stringify(d.access || { accounts: [], tokenEnabled: true }) });
    } catch (error) { setLoadError(error?.message || 'Konfiguration konnte nicht geladen werden.'); }
  }, [apiGet, token]);

  useEffect(() => { load(); }, [load]);

  const current = { company, plans, discord, marketing, system, access, discordShop };
  const isDirty = (sec) => current[sec] != null && loaded[sec] !== undefined && JSON.stringify(current[sec]) !== loaded[sec];
  const anyDirty = Object.keys(current).some(isDirty);
  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!anyDirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);
  useEffect(() => { setMsg(null); }, [section]);
  useEffect(() => {
    if (section === 'discord') apiGet('/api/admin/discord/logs', token).then(setLogs).catch(() => {});
  }, [section, apiGet, token]);

  const save = async (sec, data) => {
    setSaving(true); setMsg(null);
    try {
      await apiSend('/api/admin/config', 'PUT', { section: sec, data });
      setMsg({ ok: true, text: 'Gespeichert' });
      await load();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setSaving(false); }
  };

  const setC = (k, v) => setCompany((p) => ({ ...p, [k]: v }));
  const setPlan = (tier, k, v) => setPlans((p) => ({ ...p, [tier]: { ...p[tier], [k]: v } }));

  if (loadError) {
    return (
      <div className="oa-card oa-fade" style={{ borderColor: '#ef476f' }} data-testid="config-load-error">
        <div className="oa-section-title"><XCircle size={16} /> Konfiguration nicht erreichbar</div>
        <div style={{ color: '#ff8fab', marginBottom: 14 }}>{loadError}</div>
        <button className="oa-btn ghost" onClick={load}>Erneut laden</button>
      </div>
    );
  }

  // ---------------- SYSTEM / INTEGRATIONS ----------------
  if (section === 'system') {
    if (!system) return <div className="oa-sub">Lade Konfiguration…</div>;
    const oauth = system.discordOAuth || {};
    const smtp = system.smtp || {};
    const recognition = system.audioRecognition || {};
    const history = system.songHistory || {};
    const stationHealth = system.stationHealth || {};
    const streamRecovery = system.streamRecovery || {};
    const directories = system.botDirectories || {};
    const alerts = system.operatorAlerts || {};
    const setGroup = (group, key, value) => setSystem((p) => ({ ...p, [group]: { ...(p[group] || {}), [key]: value } }));
    const setDirectory = (directory, key, value) => setSystem((p) => ({
      ...p,
      botDirectories: {
        ...(p.botDirectories || {}),
        [directory]: { ...(p.botDirectories?.[directory] || {}), [key]: value },
      },
    }));
    // Typed text shows; a stored secret (sent as a mask) stays hidden (see ownerConfigSecrets.js).
    const secretValue = secretInputValue;
    const secretHint = (group, key) => group?.[`${key}Set`] ? 'Bereits gesetzt – leer lassen, um den Wert beizubehalten.' : 'Wird verschlüsselt übertragen und nie wieder angezeigt.';
    // #356: the system settings are spread over the pages where they are looked for.
    const show = (name) => !part || part === name;
    return (
      <div className="oa-fade" data-testid="config-system">
        {show('login') && (
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Fingerprint size={15} /> Discord OAuth Login</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="OAuth Client ID" value={oauth.clientId} onChange={(v) => setGroup('discordOAuth', 'clientId', v)} testid="cfg-oauth-client" />
            <Field label="OAuth Client Secret" value={secretValue(oauth, 'clientSecret')} onChange={(v) => setGroup('discordOAuth', 'clientSecret', v)} type="password" hint={secretHint(oauth, 'clientSecret')} testid="cfg-oauth-secret" />
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Redirect URI (automatisch)</label>
              <input className="oa-input" data-testid="cfg-oauth-redirect" readOnly value={discordRedirectUriFor(window.location.origin)} onFocus={(e) => e.target.select()} />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>Wird von OmniFM gebildet. Im Discord Developer Portal unter OAuth2 → Redirects genau so eintragen.</div>
            </div>
            <Field label="Scopes" value={oauth.scopes} onChange={(v) => setGroup('discordOAuth', 'scopes', v)} placeholder="identify guilds" testid="cfg-oauth-scopes" />
          </div>
        </div>
        )}

        {show('email') && (
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Mail size={15} /> E-Mail Versand (SMTP)</div>
          <Toggle label="SMTP aktivieren" checked={!!smtp.enabled} onChange={(v) => setGroup('smtp', 'enabled', v)} testid="cfg-smtp-enabled" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px' }}>
            <Field label="SMTP Host" value={smtp.host} onChange={(v) => setGroup('smtp', 'host', v)} testid="cfg-smtp-host" />
            <Field label="Port" value={smtp.port} onChange={(v) => setGroup('smtp', 'port', parseInt(v, 10) || 587)} type="number" testid="cfg-smtp-port" />
            <Field label="Benutzer" value={smtp.user} onChange={(v) => setGroup('smtp', 'user', v)} testid="cfg-smtp-user" />
            <Field label="Passwort" value={secretValue(smtp, 'password')} onChange={(v) => setGroup('smtp', 'password', v)} type="password" hint={secretHint(smtp, 'password')} testid="cfg-smtp-password" />
            <Field label="Absender" value={smtp.from} onChange={(v) => setGroup('smtp', 'from', v)} placeholder="OmniFM <noreply@omnifm.xyz>" testid="cfg-smtp-from" />
          </div>
          <Toggle label="TLS-Verbindung (SMTPS)" checked={!!smtp.secure} onChange={(v) => setGroup('smtp', 'secure', v)} testid="cfg-smtp-secure" />
        </div>
        )}

        {show('recognition') && (
        <div className="oa-grid cols-2" style={{ marginBottom: 18 }}>
          <div className="oa-card">
            <div className="oa-section-title"><Music2 size={15} /> Audio Song-Erkennung</div>
            <Toggle label="Song-Erkennung aktivieren" checked={!!recognition.enabled} onChange={(v) => setGroup('audioRecognition', 'enabled', v)} testid="cfg-recognition-enabled" />
            <Field label="AcoustID API Key" value={secretValue(recognition, 'apiKey')} onChange={(v) => setGroup('audioRecognition', 'apiKey', v)} type="password" hint={secretHint(recognition, 'apiKey')} testid="cfg-recognition-key" />
          </div>
          <div className="oa-card">
            <div className="oa-section-title"><History size={15} /> Song-Verlauf</div>
            <Toggle label="Song-Verlauf aktivieren" checked={history.enabled !== false} onChange={(v) => setGroup('songHistory', 'enabled', v)} testid="cfg-history-enabled" />
            <Field label="Max. Einträge pro Server" value={history.maxPerGuild} onChange={(v) => setGroup('songHistory', 'maxPerGuild', Math.max(10, parseInt(v, 10) || 100))} type="number" testid="cfg-history-max" />
          </div>
        </div>
        )}

        {show('alerts') && (
        <div className="oa-card" style={{ marginBottom: 18 }} data-testid="cfg-operator-alerts">
          <div className="oa-section-title"><BellRing size={15} /> Betreiber-Alarme (Discord)</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
            OmniFM meldet Probleme per Webhook in einen Discord-Kanal, den nur du siehst: Abstürze, Worker ohne Lebenszeichen, erschöpfte Failover-Ketten, Wiedergabe im Kreis, Autoheal-Neustarts, wenig Speicherplatz und fehlgeschlagene Backups. Änderungen gelten nach dem nächsten Bot-Neustart.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="Webhook-URL" value={secretValue(alerts, 'webhookUrl')} onChange={(v) => setGroup('operatorAlerts', 'webhookUrl', v)} type="password" placeholder="https://discord.com/api/webhooks/…" hint={secretHint(alerts, 'webhookUrl')} testid="cfg-alerts-webhook" />
            <Field label="Erwähnung (optional)" value={alerts.mention} onChange={(v) => setGroup('operatorAlerts', 'mention', v)} placeholder="<@123456789012345678>" hint="Wen der Alarm anpingen soll." testid="cfg-alerts-mention" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Toggle label="Worker ohne Lebenszeichen" checked={alerts.workerOffline !== false} onChange={(v) => setGroup('operatorAlerts', 'workerOffline', v)} testid="cfg-alerts-worker-offline" />
            <Toggle label="Failover-Kette erschöpft" checked={alerts.failoverExhausted !== false} onChange={(v) => setGroup('operatorAlerts', 'failoverExhausted', v)} testid="cfg-alerts-failover" />
            <Toggle label="Wiedergabe dreht sich im Kreis" checked={alerts.playbackLoops !== false} onChange={(v) => setGroup('operatorAlerts', 'playbackLoops', v)} testid="cfg-alerts-loops" />
            <Toggle label="Autoheal-Neustart eines Workers" checked={alerts.workerAutoheal !== false} onChange={(v) => setGroup('operatorAlerts', 'workerAutoheal', v)} testid="cfg-alerts-autoheal" />
            <Toggle label="Wenig Speicherplatz" checked={alerts.diskSpace !== false} onChange={(v) => setGroup('operatorAlerts', 'diskSpace', v)} testid="cfg-alerts-disk" />
            <Toggle label="Nächtliches Backup fehlgeschlagen" checked={alerts.backupFailed !== false} onChange={(v) => setGroup('operatorAlerts', 'backupFailed', v)} testid="cfg-alerts-backup" />
            <Toggle label="Update erfolgreich oder fehlgeschlagen" checked={alerts.updates !== false} onChange={(v) => setGroup('operatorAlerts', 'updates', v)} testid="cfg-alerts-updates" />
          </div>
          <button
            className="oa-btn ghost"
            style={{ marginTop: 8 }}
            disabled={alertTest?.loading}
            data-testid="cfg-alerts-test"
            onClick={async () => {
              setAlertTest({ loading: true });
              try {
                const result = await apiSend('/api/admin/integrations/test', 'POST', { integration: 'operatoralerts' });
                setAlertTest(result?.results?.operatorAlerts || { ok: false, message: 'Keine Antwort.' });
              } catch (error) {
                setAlertTest({ ok: false, message: error.message });
              }
            }}
          >
            <BellRing size={16} /> {alertTest?.loading ? 'Sendet…' : 'Testalarm senden'}
          </button>
          {alertTest && !alertTest.loading && (
            <div style={{ marginTop: 10, fontSize: 13, color: alertTest.ok ? '#86efac' : '#ff8fab' }} data-testid="cfg-alerts-test-result">
              {alertTest.message}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Der Testalarm nutzt die gespeicherte URL: erst speichern, dann testen.</div>
        </div>
        )}

        {show('streams') && (
          <>
        <div className="oa-card" style={{ marginBottom: 18 }} data-testid="cfg-station-health">
          <div className="oa-section-title"><Globe2 size={15} /> Automatische Sender-Überwachung</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>Die Sender werden in kleinen Round-Robin-Batches geprüft. Zwei aufeinanderfolgende Fehler erzeugen einen Incident; eine Erholung wird ebenfalls protokolliert. Änderungen werden beim nächsten Bot-Neustart aktiv.</div>
          <Toggle label="Automatische Senderprüfung aktiv" checked={stationHealth.enabled !== false} onChange={(v) => setGroup('stationHealth', 'enabled', v)} testid="cfg-station-health-enabled" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0 18px' }}>
            <Field label="Batch-Intervall (ms)" value={stationHealth.intervalMs || 5000} onChange={(v) => setGroup('stationHealth', 'intervalMs', Math.max(2000, parseInt(v, 10) || 5000))} type="number" testid="cfg-station-health-interval" hint="Standard: 5000" />
            <Field label="Sender pro Batch" value={stationHealth.batchSize || 2} onChange={(v) => setGroup('stationHealth', 'batchSize', Math.max(1, Math.min(10, parseInt(v, 10) || 2)))} type="number" testid="cfg-station-health-batch" hint="Standard: 2" />
            <Field label="Parallelität" value={stationHealth.concurrency || 2} onChange={(v) => setGroup('stationHealth', 'concurrency', Math.max(1, Math.min(10, parseInt(v, 10) || 2)))} type="number" testid="cfg-station-health-concurrency" hint="Nie höher als Batch-Größe" />
            <Field label="Timeout (ms)" value={stationHealth.timeoutMs || 8000} onChange={(v) => setGroup('stationHealth', 'timeoutMs', Math.max(3000, parseInt(v, 10) || 8000))} type="number" testid="cfg-station-health-timeout" hint="Standard: 8000" />
          </div>
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }} data-testid="cfg-stream-recovery">
          <div className="oa-section-title"><ShieldCheck size={15} /> Recovery &amp; Stabilität</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
            Ein Ersatzsender kommt nur aus der Failover-Kette, die im Server-Dashboard hinterlegt ist. Zeiten stehen in Sekunden. Änderungen gelten nach dem nächsten Bot-Neustart, zum Beispiel über <code>./update.sh</code>.
          </div>
          {(() => {
            const value = (entry) => {
              const raw = Number(streamRecovery[entry.key]);
              return Number.isFinite(raw) && raw > 0 ? raw : entry.default;
            };
            const byKey = Object.fromEntries(recoverySettings.map((entry) => [entry.key, value(entry)]));
            const sec = (ms) => Math.round(Number(ms || 0) / 1000);
            const minutes = (ms) => Math.round(Number(ms || 0) / 60000);
            return recoverySettings.length > 0 && (
              <div className="oa-sub" style={{ marginBottom: 14, fontSize: 12.5, color: '#cbd5e1' }} data-testid="cfg-recovery-preview">
                Bei {byKey.failoverMinFailures} Fehlern in Folge und {sec(byKey.failoverMinUnstableMs)} s ohne Ton wechselt der Bot auf den Ersatzsender.
                {' '}Den Wunschsender prüft er dann alle {minutes(byKey.failbackCheckMs)} min und wechselt nach {byKey.failbackConfirmations} erfolgreichen Prüfungen zurück.
              </div>
            );
          })()}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px' }}>
            {recoverySettings.map((entry) => {
              const isMs = entry.unit === 'ms';
              const stored = Number(streamRecovery[entry.key]);
              const current = Number.isFinite(stored) && stored > 0 ? stored : entry.default;
              const shown = isMs ? Math.round(current / 1000) : current;
              const toStored = (raw) => {
                const parsed = parseInt(raw, 10);
                if (!Number.isFinite(parsed)) return entry.default;
                const next = isMs ? parsed * 1000 : parsed;
                return Math.max(entry.min, Math.min(entry.max, next));
              };
              const fmt = (ms) => (isMs ? `${Math.round(ms / 1000)} s` : ms);
              return (
                <Field
                  key={entry.key}
                  label={`${entry.label}${isMs ? ' (s)' : ''}`}
                  value={shown}
                  onChange={(v) => setGroup('streamRecovery', entry.key, toStored(v))}
                  type="number"
                  testid={`cfg-recovery-${entry.key}`}
                  hint={`${entry.help} Standard: ${fmt(entry.default)}, erlaubt ${fmt(entry.min)} bis ${fmt(entry.max)}.`}
                />
              );
            })}
          </div>
          {recoverySettings.length > 0 && (
            <button
              className="oa-btn ghost"
              style={{ marginTop: 8 }}
              data-testid="cfg-recovery-defaults"
              onClick={() => setSystem((p) => ({ ...p, streamRecovery: Object.fromEntries(recoverySettings.map((entry) => [entry.key, entry.default])) }))}
            >
              Standardwerte einsetzen
            </button>
          )}
        </div>
          </>
        )}

        {show('directories') && (
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Globe2 size={15} /> Technische Bot-Verzeichnis-Integrationen</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>Private API-Tokens, Webhook-Secrets, Bot-IDs und Statistik-Sync. Diese Daten steuern die technische Anbindung und werden nicht öffentlich angezeigt. Öffentliche Profil-Links pflegst du separat unter „Marketing & Listings“.</div>
          <div className="oa-grid cols-3">
            {[
              ['discordBotList', 'Discord Bot List', true, true],
              ['botsGG', 'Bots.gg', false, false],
              ['topGG', 'Top.gg', false, true],
            ].map(([key, label, hasSlug, hasWebhook]) => {
              const directory = directories[key] || {};
              return (
                <div key={key} className="oa-card" style={{ background: 'var(--oa-bg)' }}>
                  <div style={{ fontWeight: 800, color: '#fff', marginBottom: 12 }}>{label}</div>
                  <Toggle label="Integration aktiv" checked={!!directory.enabled} onChange={(v) => setDirectory(key, 'enabled', v)} />
                  <Field label="Bot ID" value={directory.botId} onChange={(v) => setDirectory(key, 'botId', v)} placeholder="Discord Application ID" />
                  {hasSlug && <Field label="Slug" value={directory.slug} onChange={(v) => setDirectory(key, 'slug', v)} placeholder="omnifm-dj" />}
                  <Field label="API Token" value={secretValue(directory, 'token')} onChange={(v) => setDirectory(key, 'token', v)} type="password" hint={secretHint(directory, 'token')} />
                  {hasWebhook && <Field label="Webhook Secret" value={secretValue(directory, 'webhookSecret')} onChange={(v) => setDirectory(key, 'webhookSecret', v)} type="password" hint={secretHint(directory, 'webhookSecret')} />}
                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Statistik-Umfang</label>
                    <select className="oa-input" value={directory.statsScope || 'aggregate'} onChange={(e) => setDirectory(key, 'statsScope', e.target.value)}>
                      <option value="aggregate">Alle Bots zusammen</option>
                      <option value="commander">Nur Commander</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        <SaveBar onSave={() => save('system', system)} saving={saving} msg={msg} testid="cfg-system-save" dirty={isDirty('system')} />
      </div>
    );
  }

  // ---------------- COMPANY / LEGAL ----------------
  if (section === 'company') {
    if (!company) return <div className="oa-sub">Lade Konfiguration…</div>;
    return (
      <div className="oa-fade" data-testid="config-company">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Building2 size={15} /> Unternehmensdaten (Österreich)</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
            Diese Angaben erzeugen automatisch Impressum, Datenschutzerklärung und Nutzungsbedingungen der Website.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="Firma / Name" value={company.providerName} onChange={(v) => setC('providerName', v)} placeholder="z.B. Max Mustermann e.U." testid="cfg-company-name" />
            <Field label="Rechtsform" value={company.legalForm} onChange={(v) => setC('legalForm', v)} placeholder="Einzelunternehmen (Kleinunternehmer)" testid="cfg-company-form" />
            <Field label="Vertretungsbefugte Person" value={company.representative} onChange={(v) => setC('representative', v)} placeholder="Vor- und Nachname" testid="cfg-company-rep" />
            <Field label="Unternehmensgegenstand" value={company.businessPurpose} onChange={(v) => setC('businessPurpose', v)} testid="cfg-company-purpose" />
            <Field label="Straße / Hausnummer" value={company.streetAddress} onChange={(v) => setC('streetAddress', v)} placeholder="Musterstraße 1" testid="cfg-company-street" />
            <Field label="PLZ" value={company.postalCode} onChange={(v) => setC('postalCode', v)} placeholder="1010" testid="cfg-company-zip" />
            <Field label="Ort" value={company.city} onChange={(v) => setC('city', v)} placeholder="Wien" testid="cfg-company-city" />
            <Field label="Land" value={company.country} onChange={(v) => setC('country', v)} testid="cfg-company-country" />
            <Field label="E-Mail" value={company.email} onChange={(v) => setC('email', v)} type="email" placeholder="kontakt@deine-domain.at" testid="cfg-company-email" />
            <Field label="Telefon (optional)" value={company.phone} onChange={(v) => setC('phone', v)} testid="cfg-company-phone" />
            <Field label="Webseite" value={company.website} onChange={(v) => setC('website', v)} placeholder="https://…" testid="cfg-company-website" />
            <Field label="UID-Nummer (falls vorhanden)" value={company.vatId} onChange={(v) => setC('vatId', v)} placeholder="ATU00000000" testid="cfg-company-vat" />
          </div>
          <Toggle label="Kleinunternehmer (umsatzsteuerbefreit gem. § 6 Abs. 1 Z 27 UStG)" checked={!!company.kleinunternehmer} onChange={(v) => setC('kleinunternehmer', v)} testid="cfg-company-klein" />
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><ShieldCheck size={15} /> Datenschutz & Hosting</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="Datenschutzkontakt / DSB (optional)" value={company.dpoName} onChange={(v) => setC('dpoName', v)} testid="cfg-company-dpo" />
            <Field label="Datenschutz-E-Mail (optional)" value={company.dpoEmail} onChange={(v) => setC('dpoEmail', v)} type="email" testid="cfg-company-dpo-email" />
            <Field label="Hosting-Anbieter" value={company.hostingProvider} onChange={(v) => setC('hostingProvider', v)} placeholder="z.B. Hetzner" testid="cfg-company-hosting" />
            <Field label="Hosting-Standort" value={company.hostingLocation} onChange={(v) => setC('hostingLocation', v)} placeholder="z.B. Deutschland / EU" testid="cfg-company-hosting-loc" />
            <Field label="Terms gültig ab" value={company.effectiveDate} onChange={(v) => setC('effectiveDate', v)} placeholder="TT.MM.JJJJ" testid="cfg-company-effective" />
            <Field label="Anwendbares Recht" value={company.governingLaw} onChange={(v) => setC('governingLaw', v)} testid="cfg-company-law" />
          </div>
        </div>
        <SaveBar onSave={() => save('company', company)} saving={saving} msg={msg} testid="cfg-company-save" dirty={isDirty('company')} />
      </div>
    );
  }

  // ---------------- PLANS / PRICING ----------------
  if (section === 'plans') {
    if (!plans) return <div className="oa-sub">Lade Konfiguration…</div>;
    const order = ['free', 'pro', 'ultimate'];
    return (
      <div className="oa-fade" data-testid="config-plans">
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
          Preise, Bot-Anzahl und Features je Plan. Änderungen erscheinen sofort auf der Website (Preise & Pläne).
        </div>
        <div className="oa-grid cols-3">
          {order.map((tier) => {
            const p = plans[tier] || {};
            return (
              <div key={tier} className="oa-card" data-testid={`cfg-plan-${tier}`}>
                <div className="oa-section-title" style={{ textTransform: 'capitalize' }}><Tag size={15} /> {tier}</div>
                <Field label="Anzeigename" value={p.name} onChange={(v) => setPlan(tier, 'name', v)} testid={`cfg-plan-${tier}-name`} />
                <Field label="Preis pro Monat (EUR)" value={eur(p.pricePerMonth)} onChange={(v) => setPlan(tier, 'pricePerMonth', toCents(v))} type="text" testid={`cfg-plan-${tier}-price`} hint={tier === 'free' ? 'Free = 0' : 'z.B. 2,99'} />
                <Field label="Max. Bots" value={p.maxBots} onChange={(v) => setPlan(tier, 'maxBots', parseInt(v, 10) || 0)} type="number" testid={`cfg-plan-${tier}-bots`} />
                <Field label="Stationen" value={p.stations} onChange={(v) => setPlan(tier, 'stations', v)} testid={`cfg-plan-${tier}-stations`} />
                <Field label="Audio-Bitrate" value={p.bitrate} onChange={(v) => setPlan(tier, 'bitrate', v)} testid={`cfg-plan-${tier}-bitrate`} />
                <Field label="Features (eine pro Zeile)" value={featuresText(p.features)} onChange={(v) => setPlan(tier, 'features', textToFeatures(v))} textarea testid={`cfg-plan-${tier}-features`} />
              </div>
            );
          })}
        </div>
        <SaveBar onSave={() => save('plans', plans)} saving={saving} msg={msg} testid="cfg-plans-save" dirty={isDirty('plans')} />
      </div>
    );
  }

  // ---------------- DISCORD & BOTS ----------------
  if (section === 'discord') {
    if (!discord) return <div className="oa-sub">Lade Konfiguration…</div>;
    const cmd = discord.commander || {};
    const workers = discord.workers || [];
    const setCmd = (k, v) => setDiscord((p) => ({ ...p, commander: { ...p.commander, [k]: v } }));
    const setWorker = (i, k, v) => setDiscord((p) => ({ ...p, workers: p.workers.map((w, idx) => idx === i ? { ...w, [k]: v } : w) }));
    const addWorker = () => setDiscord((p) => ({ ...p, workers: [...(p.workers || []), { name: `OmniFM Worker ${(p.workers?.length || 0) + 1}`, token: '', clientId: '', tier: 'free', inviteUrl: '' }] }));
    const removeWorker = (i) => setDiscord((p) => ({ ...p, workers: p.workers.filter((_, idx) => idx !== i) }));
    const secretPlaceholder = (isSet) => (isSet ? '•••••••• gesetzt (leer lassen = behalten)' : 'Bot-Token einfügen');
    return (
      <div className="oa-fade" data-testid="config-discord">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Bot size={15} /> Commander-Bot</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>Der Commander nimmt Slash-Commands an und verwaltet die Worker.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="Name" value={cmd.name} onChange={(v) => setCmd('name', v)} testid="cfg-discord-cmd-name" />
            <Field label="Client ID" value={cmd.clientId} onChange={(v) => setCmd('clientId', v)} placeholder="Discord Application ID" testid="cfg-discord-cmd-clientid" />
            <Field label="Bot-Token" value={cmd.tokenSet ? '' : cmd.token} onChange={(v) => setCmd('token', v)} placeholder={secretPlaceholder(cmd.tokenSet)} testid="cfg-discord-cmd-token" width="full" />
            <Field label="Invite-URL (optional)" value={cmd.inviteUrl} onChange={(v) => setCmd('inviteUrl', v)} placeholder="Automatisch aus Client ID, wenn leer" testid="cfg-discord-cmd-invite" width="full" />
          </div>
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="oa-section-title" style={{ margin: 0 }}><Bot size={15} /> Worker-Bots ({workers.length})</div>
            <button className="oa-btn ghost" onClick={addWorker} data-testid="cfg-discord-add-worker"><Plus size={15} /> Bot hinzufügen</button>
          </div>
          {workers.length === 0 && <div className="oa-sub">Noch keine Worker konfiguriert. Füge mit „Bot hinzufügen“ deinen ersten Worker hinzu.</div>}
          {workers.map((w, i) => (
            <div key={i} className="oa-card" style={{ marginBottom: 12, background: 'var(--oa-bg)' }} data-testid={`cfg-discord-worker-${i}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, color: '#fff' }}>Worker #{i + 1}</span>
                <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px', color: '#ff8fab' }} onClick={() => removeWorker(i)} data-testid={`cfg-discord-worker-${i}-remove`}><Trash2 size={14} /> Entfernen</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 18px' }}>
                <Field label="Name" value={w.name} onChange={(v) => setWorker(i, 'name', v)} testid={`cfg-discord-worker-${i}-name`} />
                <Field label="Client ID" value={w.clientId} onChange={(v) => setWorker(i, 'clientId', v)} testid={`cfg-discord-worker-${i}-clientid`} />
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Min. Tier</label>
                  <select className="oa-input" value={w.tier || 'free'} onChange={(e) => setWorker(i, 'tier', e.target.value)} data-testid={`cfg-discord-worker-${i}-tier`}>
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="ultimate">Ultimate</option>
                  </select>
                </div>
                <Field label="Bot-Token" value={w.tokenSet ? '' : w.token} onChange={(v) => setWorker(i, 'token', v)} placeholder={secretPlaceholder(w.tokenSet)} testid={`cfg-discord-worker-${i}-token`} width="full" />
              </div>
            </div>
          ))}
        </div>
        <SaveBar onSave={() => save('discord', discord)} saving={saving} msg={msg} testid="cfg-discord-save" dirty={isDirty('discord')} />

        <div className="oa-card" style={{ marginTop: 22 }}>
          <div className="oa-section-title"><Terminal size={15} /> Bot-Logs</div>
          {logs && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, color: logs.connected ? '#10b981' : '#f59e0b' }}>
              <Info size={14} /> {logs.note}
            </div>
          )}
          <div style={{ background: '#0b0e16', borderRadius: 10, padding: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, maxHeight: 280, overflowY: 'auto' }} data-testid="cfg-discord-logs">
            {(logs?.logs || []).length === 0 && <div style={{ color: '#64748b' }}>Keine Log-Einträge.</div>}
            {(logs?.logs || []).map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0', borderBottom: '1px solid #161b28' }}>
                <span style={{ color: '#475569', minWidth: 132 }}>{new Date(l.at).toLocaleString('de-DE')}</span>
                <span style={{ color: l.status === 'error' ? '#ff8fab' : l.status === 'warn' ? '#f59e0b' : '#00e5ff', minWidth: 110 }}>{l.action}</span>
                <span style={{ color: '#cbd5e1' }}>{l.target || ''} {l.detail ? `· ${l.detail}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------------- PAYMENTS ----------------
  // ---------------- MARKETING (bot listings + sponsors) ----------------
  if (section === 'marketing') {
    if (!marketing) return <div className="oa-sub">Lade Konfiguration…</div>;
    const listings = marketing.botListings || [];
    const sponsors = marketing.sponsors || [];
    const setListing = (i, k, v) => setMarketing((p) => ({ ...p, botListings: p.botListings.map((x, idx) => idx === i ? { ...x, [k]: v } : x) }));
    const addListing = () => setMarketing((p) => ({ ...p, botListings: [...(p.botListings || []), { name: '', url: '', enabled: true, note: '' }] }));
    const removeListing = (i) => setMarketing((p) => ({ ...p, botListings: p.botListings.filter((_, idx) => idx !== i) }));
    const setSponsor = (i, k, v) => setMarketing((p) => ({ ...p, sponsors: p.sponsors.map((x, idx) => idx === i ? { ...x, [k]: v } : x) }));
    const addSponsor = () => setMarketing((p) => ({ ...p, sponsors: [...(p.sponsors || []), { name: '', logoUrl: '', url: '' }] }));
    const removeSponsor = (i) => setMarketing((p) => ({ ...p, sponsors: p.sponsors.filter((_, idx) => idx !== i) }));
    return (
      <div className="oa-fade" data-testid="config-marketing">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="oa-section-title" style={{ margin: 0 }}><Star size={15} /> Öffentliche Bot-Profilseiten ({listings.length})</div>
            <button className="oa-btn ghost" onClick={addListing} data-testid="cfg-listing-add"><Plus size={15} /> Seite</button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Nur öffentliche Profil- und Werbelinks für Website und Marketing. API-Tokens, Webhooks und Statistik-Sync gehören in die System-Konfiguration unter „Technische Bot-Verzeichnis-Integrationen“.</div>
          {listings.map((b, i) => (
            <div key={i} style={{ background: 'var(--oa-bg)', border: '1px solid var(--oa-border-active)', borderRadius: 12, padding: 14, marginBottom: 12 }} data-testid={`cfg-listing-${i}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Toggle label={b.name || `Listing #${i + 1}`} checked={!!b.enabled} onChange={(v) => setListing(i, 'enabled', v)} testid={`cfg-listing-${i}-enabled`} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px' }}>
                <Field label="Name" value={b.name} onChange={(v) => setListing(i, 'name', v)} testid={`cfg-listing-${i}-name`} />
                <Field label="Profil-URL" value={b.url} onChange={(v) => setListing(i, 'url', v)} placeholder="https://top.gg/bot/…" testid={`cfg-listing-${i}-url`} />
                <Field label="Notiz / Anleitung" value={b.note} onChange={(v) => setListing(i, 'note', v)} testid={`cfg-listing-${i}-note`} width="full" />
              </div>
              <button className="oa-btn ghost" style={{ color: '#ff8fab', height: 34 }} onClick={() => removeListing(i)} data-testid={`cfg-listing-${i}-remove`}><Trash2 size={14} /> Entfernen</button>
            </div>
          ))}
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="oa-section-title" style={{ margin: 0 }}><Heart size={15} /> Sponsoren / Partner ({sponsors.length})</div>
            <button className="oa-btn ghost" onClick={addSponsor} data-testid="cfg-sponsor-add"><Plus size={15} /> Sponsor</button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Erscheinen als Logo-Wand auf der Startseite („Unterstützt von“). Ohne Logo-URL wird der Name als Text angezeigt.</div>
          {sponsors.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 44px', gap: '0 14px', alignItems: 'end', marginBottom: 6 }} data-testid={`cfg-sponsor-${i}`}>
              <Field label="Name" value={s.name} onChange={(v) => setSponsor(i, 'name', v)} testid={`cfg-sponsor-${i}-name`} />
              <Field label="Logo-URL" value={s.logoUrl} onChange={(v) => setSponsor(i, 'logoUrl', v)} placeholder="https://…/logo.png" testid={`cfg-sponsor-${i}-logo`} />
              <Field label="Link" value={s.url} onChange={(v) => setSponsor(i, 'url', v)} placeholder="https://…" testid={`cfg-sponsor-${i}-url`} />
              <button className="oa-btn ghost" style={{ color: '#ff8fab', marginBottom: 14 }} onClick={() => removeSponsor(i)} data-testid={`cfg-sponsor-${i}-remove`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <SaveBar onSave={() => save('marketing', marketing)} saving={saving} msg={msg} testid="cfg-marketing-save" dirty={isDirty('marketing')} />
      </div>
    );
  }

  // ---------------- PREMIUM IN DISCORD (#320) ----------------
  if (section === 'discordShop') {
    if (!discordShop) return <div className="oa-sub">Lade Konfiguration…</div>;
    const skus = discordShop.skus || {};
    const setSku = (tier, value) => setDiscordShop((p) => ({ ...p, skus: { ...(p.skus || {}), [tier]: value.trim() } }));
    const validSku = (value) => !value || /^\d{17,22}$/.test(String(value));
    const ready = validSku(skus.pro) && validSku(skus.ultimate) && Boolean(skus.pro || skus.ultimate);
    return (
      <div className="oa-fade" data-testid="config-discord-shop">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title">Premium in Discord</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
            Premium wird direkt in Discord verkauft: als Abo pro Server, monatlich. Discord ist der Verkäufer, kassiert, führt die Umsatzsteuer ab und behält 15 %; du bekommst Auszahlungen.
            Einschalten geht erst, wenn Discord die App freigibt: verifizierte App (ab 75 Servern) und Monetarisierung im Developer Portal eingerichtet.
            Solange der Schalter aus ist, zeigt die Website „Kaufen bald direkt in Discord“ und <span className="oa-mono">/premium</span> hat keine Kaufknöpfe.
          </div>
          <Toggle label="Verkauf über Discord aktiv" checked={!!discordShop.enabled} onChange={(v) => setDiscordShop((p) => ({ ...p, enabled: v && ready }))} testid="cfg-shop-enabled" />
          {!ready && <div className="oa-sub" style={{ marginTop: 8 }}>Erst mindestens eine gültige SKU-ID eintragen, dann lässt sich der Verkauf einschalten.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px', marginTop: 14 }}>
            <Field label="SKU-ID Pro" value={skus.pro || ''} onChange={(v) => setSku('pro', v)} placeholder="123456789012345678" testid="cfg-shop-sku-pro" />
            <Field label="SKU-ID Ultimate" value={skus.ultimate || ''} onChange={(v) => setSku('ultimate', v)} placeholder="123456789012345678" testid="cfg-shop-sku-ultimate" />
          </div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            Die SKUs legst du im Developer Portal unter Monetization → Manage SKUs an: je ein Server-Abo (Guild Subscription) für Pro und Ultimate. Die ID kopierst du von dort.
            Wer kauft, bekommt die Lizenz für seinen Server sofort; endet das Abo, bekommt der Server eine Lizenz von vorher zurück, solange sie noch gilt.
          </div>
        </div>
        <SaveBar onSave={() => save('discordShop', discordShop)} saving={saving} msg={msg} testid="cfg-shop-save" dirty={isDirty('discordShop')} />
      </div>
    );
  }

  // ---------------- ACCESS: who may use the owner console (#283) ----------------
  if (section === 'access') {
    if (!access) return <div className="oa-sub">Lade Konfiguration…</div>;
    const accounts = access.accounts || [];
    const setAccount = (i, k, v) => setAccess((p) => ({ ...p, accounts: p.accounts.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)) }));
    const addAccount = () => setAccess((p) => ({ ...p, accounts: [...(p.accounts || []), { discordId: '', name: '', role: 'support' }] }));
    const removeAccount = (i) => setAccess((p) => ({ ...p, accounts: p.accounts.filter((_, idx) => idx !== i) }));
    const hasOwner = accounts.some((a) => a.role === 'owner' && /^\d{17,22}$/.test(String(a.discordId || '').trim()));
    return (
      <div className="oa-fade" data-testid="config-access">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="oa-section-title" style={{ margin: 0 }}><Users size={15} /> Discord-Konten mit Zugang ({accounts.length})</div>
            <button className="oa-btn ghost" onClick={addAccount} data-testid="cfg-access-add"><Plus size={15} /> Konto</button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
            Diese Konten melden sich mit „Mit Discord anmelden“ an. <b>Owner</b> darf alles. <b>Support</b> sieht alles und darf prüfen (Cockpit, Sender-Test), aber nichts ändern. <b>Abrechnung</b> sieht alles und darf Lizenzen, Zahlungen und Preise ändern.
            Die Discord-ID findest du in Discord unter Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick auf das Profil → „ID kopieren“.
          </div>
          {accounts.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) 44px', gap: '0 14px', alignItems: 'end', marginBottom: 6 }} data-testid={`cfg-access-${i}`}>
              <Field label="Discord-ID" value={a.discordId} onChange={(v) => setAccount(i, 'discordId', v.trim())} placeholder="123456789012345678" testid={`cfg-access-${i}-id`} />
              <Field label="Name" value={a.name} onChange={(v) => setAccount(i, 'name', v)} placeholder="Wer ist das?" testid={`cfg-access-${i}-name`} />
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Rolle</label>
                <select className="oa-input" value={a.role || 'support'} onChange={(e) => setAccount(i, 'role', e.target.value)} data-testid={`cfg-access-${i}-role`}>
                  <option value="owner">Owner</option>
                  <option value="support">Support</option>
                  <option value="billing">Abrechnung</option>
                </select>
              </div>
              <button className="oa-btn ghost" style={{ color: '#ff8fab', marginBottom: 14 }} onClick={() => removeAccount(i)} data-testid={`cfg-access-${i}-remove`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><KeyRound size={15} /> Owner-Token für Skripte</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
            Der Token aus <span className="oa-mono">API_ADMIN_TOKEN</span> (backend/.env) ist für Skripte wie den Live-Check gedacht. Ausschalten geht erst, wenn mindestens ein Discord-Konto die Rolle Owner hat. Neuen Token: Wert in backend/.env ändern und <span className="oa-mono">./update.sh</span> ausführen.
          </div>
          <Toggle label="Token erlaubt" checked={access.tokenEnabled !== false} onChange={(v) => setAccess((p) => ({ ...p, tokenEnabled: v || !hasOwner }))} testid="cfg-access-token" />
          {!hasOwner && access.tokenEnabled !== false && <div className="oa-sub" style={{ marginTop: 8 }}>Erst ein Owner-Konto eintragen, dann kann der Token aus.</div>}
        </div>
        <SaveBar onSave={() => save('access', access)} saving={saving} msg={msg} testid="cfg-access-save" dirty={isDirty('access')} />
      </div>
    );
  }

  return null;
}
