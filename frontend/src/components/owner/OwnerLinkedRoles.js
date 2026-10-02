// OmniFM: owner console: linked roles (#302). What is set up, the two
// addresses for Discord's developer portal with the clicks there, how many
// people connected and count their hours, and the premium role in the
// support server. No person is listed.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import { Field, SaveBar } from './configFields.js';

const SNOWFLAKE = /^\d{17,22}$/;
const idOf = (value) => (SNOWFLAKE.test(String(value || '').trim()) ? String(value).trim() : '');

function Check({ ok, label, testid }) {
  return (
    <div data-testid={testid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '6px 0', color: ok ? '#10b981' : '#f59e0b' }}>
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span style={{ color: '#e2e8f0' }}>{label}</span>
    </div>
  );
}

function CopyLine({ label, value, testid }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
  };
  return (
    <div style={{ margin: '10px 0' }}>
      <div className="oa-stat-label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code data-testid={testid} style={{ flex: '1 1 260px', minWidth: 0, overflowWrap: 'anywhere', padding: '8px 10px', background: 'var(--oa-bg, #0b1120)', border: '1px solid #1b2133', fontSize: 12.5 }}>{value}</code>
        <button type="button" className="oa-btn ghost" style={{ height: 34 }} onClick={copy}><Copy size={14} /> {copied ? 'Kopiert' : 'Kopieren'}</button>
      </div>
    </div>
  );
}

/** Owner page "Verknüpfte Rollen" (#302). */
export default function OwnerLinkedRoles({ apiGet, linkedRoles, setLinkedRoles, onSave, saving, msg, dirty }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await apiGet('/api/admin/linked-roles'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [apiGet]);

  useEffect(() => { load(); }, [load]);

  if (!linkedRoles) return <div className="oa-sub">Lade Konfiguration…</div>;
  const checks = status?.checks || {};
  const supportGuildId = String(linkedRoles.supportGuildId || '');
  const premiumRoleId = String(linkedRoles.premiumRoleId || '');
  const idProblem = [supportGuildId, premiumRoleId].some((value) => value && !SNOWFLAKE.test(value.trim()));

  return (
    <div className="oa-fade" data-testid="owner-linked-roles">
      <div className="oa-card" style={{ marginBottom: 18 }}>
        <div className="oa-section-title">Verknüpfte Rollen in Discord</div>
        <div style={{ fontSize: 12, color: '#64748b', margin: '8px 0 10px', lineHeight: 1.6 }}>
          Server können Rollen an zwei OmniFM-Werte knüpfen: Hörstunden (nur gezählt, wenn die Person das in /meine-daten einschaltet) und „Premium-Kunde“ (besitzt einen Server mit Pro oder Ultimate). Die Person verbindet OmniFM einmal über Discord; danach gehen ihre Werte einmal am Tag neu an Discord.
        </div>
        {error ? <div className="oa-pill red" style={{ margin: '10px 0' }}>{error}</div> : null}
        {!status && !error ? <div className="oa-sub">Lade Stand…</div> : null}
        {status ? (
          <>
            <Check ok={checks.oauthApp} label="Discord-Login des Dashboards ist eingerichtet (Client ID und Secret)" testid="linked-roles-check-oauth" />
            <Check ok={checks.commanderApp} label={checks.commanderApp ? 'Die Login-App ist die App des Commanders' : `Die Login-App (${status.clientId || '—'}) ist nicht die App des Commanders (${status.commanderId || '—'})`} testid="linked-roles-check-app" />
            <Check ok={checks.tokenKey} label={checks.tokenKey ? 'Schlüssel für die Discord-Zugänge ist da (OMNIFM_TOKEN_KEY)' : 'OMNIFM_TOKEN_KEY fehlt in backend/.env; ./update.sh legt ihn an'} testid="linked-roles-check-key" />
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '12px 0 4px', fontSize: 13 }}>
              <span><b data-testid="linked-roles-linked">{status.linked}</b> Personen verbunden</span>
              <span><b data-testid="linked-roles-counting">{status.counting}</b> zählen ihre Hörstunden</span>
            </div>
            <CopyLine label="Linked Roles Verification URL" value={status.verificationUrl} testid="linked-roles-verification-url" />
            <CopyLine label="Redirect (OAuth2)" value={status.redirectUri} testid="linked-roles-redirect" />
            <ol style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.7, paddingLeft: 18, margin: '10px 0 0' }}>
              <li>discord.com/developers/applications öffnen, die App des Commanders wählen.</li>
              <li>„General Information“: bei „Linked Roles Verification URL“ die erste Adresse eintragen, „Save Changes“.</li>
              <li>„OAuth2“ → „Redirects“ → „Add Redirect“: die zweite Adresse eintragen, „Save Changes“.</li>
              <li>Fertig. Server finden OmniFM dann unter Servereinstellungen → Rollen → Rolle → „Links“ → „Anforderung hinzufügen“.</li>
            </ol>
          </>
        ) : null}
      </div>

      <div className="oa-card" style={{ marginBottom: 18 }} data-testid="config-linked-roles">
        <div className="oa-section-title">Premium-Rolle im Support-Server</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
          Wer einen Server mit Pro oder Ultimate besitzt, bekommt im Support-Server diese Rolle; wer keinen mehr hat, verliert sie. OmniFM nimmt die Rolle nur Leuten wieder weg, denen es sie selbst gegeben hat. Alle sechs Stunden.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px' }}>
          <Field label="Support-Server (ID)" value={supportGuildId} onChange={(value) => setLinkedRoles((current) => ({ ...current, supportGuildId: value.trim() }))} placeholder="123456789012345678" testid="cfg-linked-roles-guild" />
          <Field label="Premium-Rolle (ID)" value={premiumRoleId} onChange={(value) => setLinkedRoles((current) => ({ ...current, premiumRoleId: value.trim() }))} placeholder="123456789012345678" testid="cfg-linked-roles-role" />
        </div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
          IDs findest du in Discord mit eingeschaltetem Entwicklermodus: Rechtsklick auf den Server bzw. die Rolle → „ID kopieren“. Der Commander braucht im Support-Server „Rollen verwalten“, und seine eigene Rolle muss über der Premium-Rolle stehen.
        </div>
        {idProblem ? <div className="oa-pill red" style={{ marginTop: 10 }}>Eine ID sieht nicht richtig aus (nur Ziffern, 17 bis 22 Stellen).</div> : null}
      </div>
      <SaveBar onSave={() => onSave({ supportGuildId: idOf(supportGuildId), premiumRoleId: idOf(premiumRoleId) })} saving={saving} msg={msg} testid="cfg-linked-roles-save" dirty={dirty} />
    </div>
  );
}
