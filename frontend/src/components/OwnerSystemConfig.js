import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Save, Settings2, XCircle } from 'lucide-react';
import OwnerConfig from './OwnerConfig.js';

function inputType(type) {
  if (type === 'integer') return 'number';
  if (type === 'email') return 'email';
  if (type === 'url') return 'url';
  if (type === 'date') return 'date';
  return 'text';
}

export default function OwnerSystemConfig({ apiGet, apiSend, token, legacySection = 'company' }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [changes, setChanges] = useState({});
  const [secrets, setSecrets] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSnapshot(await apiGet('/api/admin/config', token));
    } catch (error) {
      setSnapshot(null);
      setLoadError(error.message || 'Die Systemkonfiguration konnte nicht geladen werden.');
    }
  }, [apiGet, token]);
  useEffect(() => { load(); }, [load]);

  const saveValues = async () => {
    if (!Object.keys(changes).length) return;
    setBusy(true); setMessage(null);
    try {
      const result = await apiSend('/api/admin/config', 'POST', { values: changes });
      setChanges({}); setSnapshot(result); setMessage({ ok: true, text: 'Einstellungen gespeichert. Neustart für alle Dienste erforderlich.' });
    } catch (error) { setMessage({ ok: false, text: error.message }); } finally { setBusy(false); }
  };
  const saveSecrets = async () => {
    const values = Object.fromEntries(Object.entries(secrets).filter(([, value]) => String(value).trim()));
    if (!Object.keys(values).length) return;
    setBusy(true); setMessage(null);
    try {
      const result = await apiSend('/api/admin/config/secrets', 'POST', { values });
      setSecrets({}); setSnapshot(result); setMessage({ ok: true, text: 'Secrets gespeichert. Neustart für alle Dienste erforderlich.' });
    } catch (error) { setMessage({ ok: false, text: error.message }); } finally { setBusy(false); }
  };

  if (!snapshot) {
    return (
      <div className="oa-card" style={{ color: loadError ? '#ff8fab' : '#94a3b8', padding: 28 }} data-testid="owner-system-config-loading">
        {loadError || 'Systemkonfiguration wird geladen…'}
        {loadError && <button className="oa-btn ghost" style={{ marginLeft: 14 }} onClick={load}>Erneut versuchen</button>}
      </div>
    );
  }

  const hasSchema = snapshot.schemaVersion === 'owner-config-v1'
    && Array.isArray(snapshot.groups)
    && snapshot.groups.some((group) => Array.isArray(group?.fields) && group.fields.length > 0);
  if (!hasSchema) {
    const hasLegacySchema = ['company', 'plans', 'discord', 'payments', 'marketing']
      .some((key) => snapshot[key] && typeof snapshot[key] === 'object');
    if (hasLegacySchema) {
      return <OwnerConfig section={legacySection} apiGet={apiGet} apiSend={apiSend} token={token} />;
    }
    return (
      <div className="oa-card" style={{ padding: 28 }} data-testid="owner-system-config-schema-error">
        <div className="oa-section-title"><XCircle size={16} /> Konfigurationsdaten nicht lesbar</div>
        <p style={{ color: '#ffb4c7', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
          Die API hat keine verwendbaren Konfigurationsfelder geliefert. Die Owner-Konsole bleibt absichtlich gesperrt, damit keine leeren oder falschen Einstellungen gespeichert werden.
        </p>
        <button className="oa-btn ghost" onClick={load}>Erneut laden</button>
      </div>
    );
  }
  return (
    <div className="oa-fade" data-testid="owner-system-config">
      <div className="oa-card" style={{ marginBottom: 18 }}>
        <div className="oa-section-title"><Settings2 size={16} /> Gesamte Systemkonfiguration</div>
        <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>
          Alle unterstützten OmniFM-Einstellungen sind hier zentral bearbeitbar. Werte werden validiert, Secrets nie wieder angezeigt und Änderungen im Audit-Log festgehalten.
        </p>
        <div className={`oa-pill ${snapshot.envFile?.writable ? 'green' : 'red'}`}>
          {snapshot.envFile?.writable ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {snapshot.envFile?.storage === 'owner-store' ? 'Owner-Speicher' : '.env'} {snapshot.envFile?.writable ? 'schreibbar' : 'nicht schreibbar'}
        </div>
      </div>

      {(snapshot.groups || []).map((group) => (
        <div className="oa-card" key={group.id} style={{ marginBottom: 18 }}>
          <div className="oa-section-title">{group.title}</div>
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 16px' }}>{group.description}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0 16px' }}>
            {(group.fields || []).map((field) => {
              const value = Object.prototype.hasOwnProperty.call(changes, field.key) ? changes[field.key] : (field.value || '');
              return <div key={field.key} style={{ marginBottom: 14 }}>
                <label className="oa-stat-label">{field.label} <span style={{ color: '#64748b', textTransform: 'none' }}>({field.key})</span></label>
                {field.type === 'boolean' || field.type === 'enum' ? (
                  <select className="oa-input" value={value} onChange={(e) => setChanges((old) => ({ ...old, [field.key]: e.target.value }))}>
                    {field.type === 'boolean' && <><option value="">Nicht gesetzt</option><option value="1">Aktiv</option><option value="0">Aus</option></>}
                    {field.type === 'enum' && (field.values || []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : <input className="oa-input" type={inputType(field.type)} min={field.min} max={field.max} value={value} placeholder={field.example || ''} onChange={(e) => setChanges((old) => ({ ...old, [field.key]: e.target.value }))} />}
                <div className="oa-mono" style={{ marginTop: 4, color: '#64748b', fontSize: 10 }}>{field.source === 'process' ? 'aus Prozessumgebung' : field.source === 'owner-store' ? 'aus Owner-Speicher' : field.source === 'env-file' ? 'aus .env' : 'nicht gesetzt'}</div>
              </div>;
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 22 }}>
        <button className="oa-btn primary" disabled={busy || !Object.keys(changes).length} onClick={saveValues}><Save size={16} /> Einstellungen speichern</button>
        {message && <span style={{ color: message.ok ? '#4ade80' : '#ff8fab', fontSize: 13 }}>{message.text}</span>}
      </div>

      <div className="oa-card">
        <div className="oa-section-title"><KeyRound size={16} /> Secrets (write-only)</div>
        <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 16px' }}>Leere Felder bleiben unverändert. Bereits gesetzte Geheimnisse werden aus Sicherheitsgründen nie angezeigt.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0 16px' }}>
          {(snapshot.secrets || []).filter((secret) => secret.writeOnly).map((secret) => <div key={secret.key} style={{ marginBottom: 14 }}>
            <label className="oa-stat-label">{secret.label} <span className={`oa-pill ${secret.configured ? 'green' : 'slate'}`} style={{ marginLeft: 6 }}>{secret.configured ? 'gesetzt' : 'fehlt'}</span></label>
            <input className="oa-input" type="password" autoComplete="new-password" value={secrets[secret.key] || ''} placeholder="Neuen Wert setzen…" onChange={(e) => setSecrets((old) => ({ ...old, [secret.key]: e.target.value }))} />
          </div>)}
        </div>
        <button className="oa-btn primary" disabled={busy || !Object.values(secrets).some((value) => String(value).trim())} onClick={saveSecrets}><Save size={16} /> Secrets speichern</button>
      </div>
    </div>
  );
}
