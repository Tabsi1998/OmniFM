import React, { useState, useEffect, useCallback } from 'react';
import {
  Save, Plus, Trash2, CheckCircle2, XCircle, Bot, CreditCard, Building2,
  Tag, Terminal, ShieldCheck, Info, Star, Heart, Settings2, Mail, Music2, History, Fingerprint, Globe2,
} from 'lucide-react';

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

function SaveBar({ onSave, saving, msg, testid }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
      <button className="oa-btn primary" onClick={onSave} disabled={saving} data-testid={testid}>
        <Save size={16} /> {saving ? 'Speichert…' : 'Speichern'}
      </button>
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

export default function OwnerConfig({ section, apiGet, apiSend, token }) {
  const [company, setCompany] = useState(null);
  const [plans, setPlans] = useState(null);
  const [discord, setDiscord] = useState(null);
  const [payments, setPayments] = useState(null);
  const [marketing, setMarketing] = useState(null);
  const [system, setSystem] = useState(null);
  const [env, setEnv] = useState({});
  const [logs, setLogs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [systemTest, setSystemTest] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const d = await apiGet('/api/admin/config', token);
      setCompany(d.company); setPlans(d.plans); setDiscord(d.discord); setPayments(d.payments); setMarketing(d.marketing); setSystem(d.system); setEnv(d.env || {});
    } catch (error) { setLoadError(error?.message || 'Konfiguration konnte nicht geladen werden.'); }
  }, [apiGet, token]);

  useEffect(() => { load(); }, [load]);
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
    const directories = system.botDirectories || {};
    const setGroup = (group, key, value) => setSystem((p) => ({ ...p, [group]: { ...(p[group] || {}), [key]: value } }));
    const setDirectory = (directory, key, value) => setSystem((p) => ({
      ...p,
      botDirectories: {
        ...(p.botDirectories || {}),
        [directory]: { ...(p.botDirectories?.[directory] || {}), [key]: value },
      },
    }));
    const secretValue = (group, key) => group?.[`${key}Set`] ? '' : (group?.[key] || '');
    const secretHint = (group, key) => group?.[`${key}Set`] ? 'Bereits gesetzt – leer lassen, um den Wert beizubehalten.' : 'Wird verschlüsselt übertragen und nie wieder angezeigt.';
    const testSystem = async () => {
      setSystemTest({ loading: true });
      try { setSystemTest(await apiSend('/api/admin/integrations/test', 'POST', { integration: 'all' })); }
      catch (error) { setSystemTest({ ok: false, error: error.message }); }
    };
    return (
      <div className="oa-fade" data-testid="config-system">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Settings2 size={15} /> Zentrale System-Konfiguration</div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Diese Werte werden dauerhaft in MongoDB gespeichert. Bot-Runtime-Einstellungen werden beim nächsten Neustart übernommen; Web-Funktionen sofort.</div>
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><Fingerprint size={15} /> Discord OAuth Login</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <Field label="OAuth Client ID" value={oauth.clientId} onChange={(v) => setGroup('discordOAuth', 'clientId', v)} testid="cfg-oauth-client" />
            <Field label="OAuth Client Secret" value={secretValue(oauth, 'clientSecret')} onChange={(v) => setGroup('discordOAuth', 'clientSecret', v)} type="password" hint={secretHint(oauth, 'clientSecret')} testid="cfg-oauth-secret" />
            <Field label="Redirect URI" value={oauth.redirectUri} onChange={(v) => setGroup('discordOAuth', 'redirectUri', v)} placeholder="https://omnifm.xyz/api/auth/discord/callback" testid="cfg-oauth-redirect" />
            <Field label="Scopes" value={oauth.scopes} onChange={(v) => setGroup('discordOAuth', 'scopes', v)} placeholder="identify guilds" testid="cfg-oauth-scopes" />
          </div>
        </div>

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <SaveBar onSave={() => save('system', system)} saving={saving} msg={msg} testid="cfg-system-save" />
          <button className="oa-btn ghost" onClick={testSystem} disabled={systemTest?.loading} data-testid="cfg-system-test">
            <ShieldCheck size={16} /> {systemTest?.loading ? 'Prüft…' : 'Alle Integrationen prüfen'}
          </button>
        </div>
        {systemTest?.results && (
          <div className="oa-grid cols-3" style={{ marginTop: 16 }}>
            {Object.entries(systemTest.results).map(([key, result]) => (
              <div key={key} className="oa-card" style={{ padding: 14, borderColor: result.ok ? '#10b981' : '#ef476f' }}>
                <div style={{ fontWeight: 800, color: result.ok ? '#10b981' : '#ff8fab' }}>{result.ok ? '✓' : '×'} {key}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 5 }}>{result.message}</div>
              </div>
            ))}
          </div>
        )}
        {systemTest?.error && <div style={{ color: '#ff8fab', marginTop: 12 }}>{systemTest.error}</div>}
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
        <SaveBar onSave={() => save('company', company)} saving={saving} msg={msg} testid="cfg-company-save" />
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
        <SaveBar onSave={() => save('plans', plans)} saving={saving} msg={msg} testid="cfg-plans-save" />
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
        <SaveBar onSave={() => save('discord', discord)} saving={saving} msg={msg} testid="cfg-discord-save" />

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
  if (section === 'payments') {
    if (!payments) return <div className="oa-sub">Lade Konfiguration…</div>;
    const stripe = payments.stripe || {};
    const paypal = payments.paypal || {};
    const providers = payments.providers || [];
    const setStripe = (k, v) => setPayments((p) => ({ ...p, stripe: { ...p.stripe, [k]: v } }));
    const setPaypal = (k, v) => setPayments((p) => ({ ...p, paypal: { ...p.paypal, [k]: v } }));
    const setProvider = (i, k, v) => setPayments((p) => ({ ...p, providers: p.providers.map((x, idx) => idx === i ? { ...x, [k]: v } : x) }));
    const addProvider = () => setPayments((p) => ({ ...p, providers: [...(p.providers || []), { name: '', enabled: false, note: '' }] }));
    const removeProvider = (i) => setPayments((p) => ({ ...p, providers: p.providers.filter((_, idx) => idx !== i) }));
    return (
      <div className="oa-fade" data-testid="config-payments">
        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><CreditCard size={15} /> Stripe</div>
          {env.stripeEnvKey && (
            <div style={{ fontSize: 12, color: '#10b981', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
              <CheckCircle2 size={14} /> Ein Stripe-Test-Key ist bereits in der Umgebung hinterlegt und aktiv.
            </div>
          )}
          <Toggle label="Stripe-Checkout aktivieren" checked={!!stripe.enabled} onChange={(v) => setStripe('enabled', v)} testid="cfg-stripe-enabled" />
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
            Stripe Webhook-Ziel: <code className="oa-mono">https://omnifm.xyz/api/premium/webhook</code> · Ereignis: <code className="oa-mono">checkout.session.completed</code>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Modus</label>
              <select className="oa-input" value={stripe.mode || 'test'} onChange={(e) => setStripe('mode', e.target.value)} data-testid="cfg-stripe-mode">
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
            <Field label="Publishable Key" value={stripe.publishableKey} onChange={(v) => setStripe('publishableKey', v)} placeholder="pk_…" testid="cfg-stripe-pk" />
            <Field label="Secret Key" value={stripe.secretKeySet ? '' : stripe.secretKey} onChange={(v) => setStripe('secretKey', v)} placeholder={stripe.secretKeySet ? '•••••••• gesetzt (leer = behalten)' : 'sk_…'} testid="cfg-stripe-sk" />
            <Field label="Webhook Secret" value={stripe.webhookSecretSet ? '' : stripe.webhookSecret} onChange={(v) => setStripe('webhookSecret', v)} placeholder={stripe.webhookSecretSet ? '•••••••• gesetzt' : 'whsec_…'} testid="cfg-stripe-wh" />
          </div>
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div className="oa-section-title"><CreditCard size={15} /> PayPal · vorbereitet, noch nicht live</div>
          <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12 }}>Die FastAPI-Zahlungsstrecke unterstützt derzeit Stripe. PayPal wird erst nach Implementierung der Checkout- und Webhook-Strecke aktivierbar.</div>
          <Toggle label="PayPal-Konfiguration vormerken" checked={!!paypal.enabled} onChange={(v) => setPaypal('enabled', v)} testid="cfg-paypal-enabled" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Modus</label>
              <select className="oa-input" value={paypal.mode || 'sandbox'} onChange={(e) => setPaypal('mode', e.target.value)} data-testid="cfg-paypal-mode">
                <option value="sandbox">Sandbox</option>
                <option value="live">Live</option>
              </select>
            </div>
            <Field label="Client ID" value={paypal.clientId} onChange={(v) => setPaypal('clientId', v)} testid="cfg-paypal-clientid" />
            <Field label="Secret" value={paypal.secretSet ? '' : paypal.secret} onChange={(v) => setPaypal('secret', v)} placeholder={paypal.secretSet ? '•••••••• gesetzt' : 'PayPal Secret'} testid="cfg-paypal-secret" />
          </div>
        </div>

        <div className="oa-card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="oa-section-title" style={{ margin: 0 }}><Plus size={15} /> Weitere Anbieter ({providers.length})</div>
            <button className="oa-btn ghost" onClick={addProvider} data-testid="cfg-payments-add-provider"><Plus size={15} /> Anbieter</button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Platzhalter für zukünftige Zahlungsanbieter (z.B. Klarna, SEPA, Crypto). Erweiterbar.</div>
          {providers.map((pr, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 10 }} data-testid={`cfg-provider-${i}`}>
              <div style={{ flex: 1 }}><Field label="Name" value={pr.name} onChange={(v) => setProvider(i, 'name', v)} testid={`cfg-provider-${i}-name`} /></div>
              <div style={{ flex: 2 }}><Field label="Notiz" value={pr.note} onChange={(v) => setProvider(i, 'note', v)} testid={`cfg-provider-${i}-note`} /></div>
              <button className="oa-btn ghost" style={{ marginBottom: 14, color: '#ff8fab' }} onClick={() => removeProvider(i)} data-testid={`cfg-provider-${i}-remove`}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <SaveBar onSave={() => save('payments', payments)} saving={saving} msg={msg} testid="cfg-payments-save" />
      </div>
    );
  }

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
        <SaveBar onSave={() => save('marketing', marketing)} saving={saving} msg={msg} testid="cfg-marketing-save" />
      </div>
    );
  }

  return null;
}
