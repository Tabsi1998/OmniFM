// OmniFM: owner console: the license manager.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { CheckCircle2, Globe, AlertTriangle, Plus, Pencil, Trash2, Save, X as CloseIcon } from 'lucide-react';
import { fmtDate } from './ownerUi.js';

export default function OwnerLicenses({
  closeLicForm,
  createLicense,
  deleteLicense,
  knownGuilds,
  licBusy,
  licForm,
  licMsg,
  licQuery,
  licenses,
  openEditLicense,
  openNewLicense,
  patchLicense,
  setLicForm,
  setLicQuery,
}) {
  return (
    <div className="oa-fade" data-testid="license-manager">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 420 }}>
          <input
            className="oa-input"
            placeholder="Suche: Lizenz-ID (GUID), E-Mail oder Server-ID…"
            value={licQuery}
            onChange={(e) => setLicQuery(e.target.value)}
            data-testid="license-search"
          />
        </div>
        <button className="oa-btn primary" style={{ height: 42 }} onClick={openNewLicense} data-testid="license-create-button"><Plus size={16} /> Lizenz erstellen</button>
      </div>

      {licMsg && (
        <div className={`oa-pill ${licMsg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="license-message">
          {licMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {licMsg.text}
        </div>
      )}

      <datalist id="owner-known-guilds">
        {knownGuilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name} · {guild.id}</option>)}
      </datalist>

      {licForm && (
        <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(0,229,255,0.35)' }} data-testid="license-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontFamily: "'Syne','Outfit',sans-serif", fontSize: 17 }}>
              {licForm._isNew ? 'Neue Lizenz' : <>Lizenz bearbeiten · <span className="oa-mono" style={{ fontSize: 13, color: '#00e5ff' }}>{licForm.licenseKey}</span></>}
            </div>
            <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px' }} onClick={closeLicForm} data-testid="license-form-close"><CloseIcon size={15} /></button>
          </div>

          <div className="oa-grid cols-2" style={{ gap: 14 }}>
            <div>
              <label className="oa-stat-label">E-Mail (Kontakt)</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={licForm.email} placeholder="kunde@example.com" onChange={(e) => setLicForm({ ...licForm, email: e.target.value })} data-testid="license-input-email" />
            </div>
            <div>
              <label className="oa-stat-label">Plan / Tier</label>
              <select className="oa-input" style={{ marginTop: 6 }} value={licForm.tier} onChange={(e) => setLicForm({ ...licForm, tier: e.target.value })} data-testid="license-input-tier">
                <option value="pro">Pro</option>
                <option value="ultimate">Ultimate</option>
              </select>
            </div>
            <div>
              <label className="oa-stat-label">Seats (1–5)</label>
              <input className="oa-input" type="number" min={1} max={5} style={{ marginTop: 6 }} value={licForm.seats} onChange={(e) => setLicForm({ ...licForm, seats: e.target.value })} data-testid="license-input-seats" />
            </div>
            {licForm._isNew ? (
              <div>
                <label className="oa-stat-label">Laufzeit (Monate)</label>
                <input className="oa-input" type="number" min={1} max={60} style={{ marginTop: 6 }} value={licForm.months} onChange={(e) => setLicForm({ ...licForm, months: e.target.value })} data-testid="license-input-months" />
              </div>
            ) : (
              <div>
                <label className="oa-stat-label">Läuft ab (Datum)</label>
                <input className="oa-input" type="date" style={{ marginTop: 6 }} value={licForm.expiresAt} onChange={(e) => setLicForm({ ...licForm, expiresAt: e.target.value })} data-testid="license-input-expiry" />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="oa-stat-label">Notiz</label>
              <input className="oa-input" style={{ marginTop: 6 }} value={licForm.note} placeholder="interne Notiz" onChange={(e) => setLicForm({ ...licForm, note: e.target.value })} data-testid="license-input-note" />
            </div>
            {licForm._isNew && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="oa-stat-label">Server-ID verknüpfen (optional)</label>
                <input className="oa-input oa-mono" list="owner-known-guilds" style={{ marginTop: 6 }} value={licForm.serverId} placeholder="Discord Guild-ID (17–22 Ziffern)" onChange={(e) => setLicForm({ ...licForm, serverId: e.target.value.trim() })} data-testid="license-input-guild" />
                <div className="oa-stat-foot" style={{ marginTop: 6 }}>Bekannte Server werden vorgeschlagen. Werte wie „1“ sind keine gültige Discord-Guild-ID.</div>
              </div>
            )}
          </div>

          {licForm._isNew ? (
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button className="oa-btn primary" style={{ height: 40 }} disabled={licBusy || Boolean(licForm.serverId) && !/^\d{17,22}$/.test(licForm.serverId)} onClick={createLicense} data-testid="license-save-new"><Save size={15} /> Lizenz erstellen</button>
            </div>
          ) : (
            <>
              <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="oa-btn primary" style={{ height: 40 }} disabled={licBusy} onClick={() => patchLicense({ email: licForm.email, tier: licForm.tier, seats: Number(licForm.seats) || 1, note: licForm.note, expiresAt: licForm.expiresAt || undefined }, 'Änderungen gespeichert.')} data-testid="license-save-edit"><Save size={15} /> Speichern</button>
              </div>

              <div style={{ marginTop: 18 }}>
                <label className="oa-stat-label">Schnell verlängern / verkürzen</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 1 }, '+1 Monat')} data-testid="license-extend-1m">+1 Monat</button>
                  <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 3 }, '+3 Monate')} data-testid="license-extend-3m">+3 Monate</button>
                  <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: 12 }, '+12 Monate')} data-testid="license-extend-12m">+12 Monate</button>
                  <button className="oa-btn ghost" style={{ height: 36 }} disabled={licBusy} onClick={() => patchLicense({ extendMonths: -1 }, '−1 Monat')} data-testid="license-shorten-1m">−1 Monat</button>
                  <button className="oa-btn ghost" style={{ height: 36, color: '#ff8fab', borderColor: 'rgba(255,42,95,0.4)' }} disabled={licBusy} onClick={() => patchLicense({ expireNow: true }, 'Sofort deaktiviert (abgelaufen)')} data-testid="license-expire-now">Sofort deaktivieren</button>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <label className="oa-stat-label">Verknüpfte Server ({(licForm.linkedServerIds || []).length})</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
                  {(licForm.linkedServerIds || []).length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>Keine Server verknüpft</span>}
                  {(licForm.linkedServerIds || []).map((sid) => {
                    const server = (licForm.linkedServers || []).find((item) => item.id === sid) || knownGuilds.find((item) => item.id === sid) || { id: sid, name: sid, valid: /^\d{17,22}$/.test(sid) };
                    return (
                      <span key={sid} className={`oa-pill ${server.valid === false ? 'red' : server.known === false ? 'amber' : 'slate'}`} style={{ padding: '6px 9px', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span><strong>{server.name}</strong> <span className="oa-mono" style={{ opacity: 0.75 }}>{sid}</span></span>
                        {server.discordUrl && <a href={server.discordUrl} target="_blank" rel="noreferrer" style={{ color: '#00e5ff' }} title="Server in Discord öffnen"><Globe size={13} /></a>}
                        <button style={{ background: 'none', border: 'none', color: '#ff8fab', cursor: 'pointer', padding: 0, lineHeight: 0 }} disabled={licBusy} onClick={() => patchLicense({ removeServerId: sid }, 'Server entfernt')} data-testid={`license-guild-remove-${sid}`}><CloseIcon size={13} /></button>
                      </span>
                    );
                  })}
                </div>
                {(licForm.linkedServers || []).map((server) => (
                  <div key={`status-${server.id}`} style={{ fontSize: 11.5, margin: '5px 0', color: server.licenseResolved ? '#4ade80' : '#ff8fab' }} data-testid={`license-guild-status-${server.id}`}>
                    {server.licenseResolved ? `✓ Lizenzauflösung: ${String(server.effectivePlan || 'free').toUpperCase()}` : '✕ Keine aktive Lizenzauflösung'} · {server.known ? `Live erkannt als ${server.name}` : 'nicht im Live-Guild-Verzeichnis – Guild-ID prüfen oder Commander-Telemetrie abwarten'}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="oa-input oa-mono" list="owner-known-guilds" style={{ maxWidth: 320 }} placeholder="Discord Guild-ID hinzufügen" value={licForm.newGuild} onChange={(e) => setLicForm({ ...licForm, newGuild: e.target.value.trim() })} data-testid="license-guild-input" />
                  <button className="oa-btn ghost" style={{ height: 42 }} disabled={licBusy || !/^\d{17,22}$/.test(licForm.newGuild || '')} onClick={() => patchLicense({ addServerId: licForm.newGuild }, 'Server verknüpft')} data-testid="license-guild-add"><Plus size={15} /> Verknüpfen</button>
                </div>
              </div>

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1a1f2e' }}>
                <button className="oa-btn ghost" style={{ height: 40, color: '#ff8fab', borderColor: 'rgba(255,42,95,0.4)' }} disabled={licBusy} onClick={() => deleteLicense(licForm.licenseKey)} data-testid="license-delete"><Trash2 size={15} /> Lizenz löschen</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="oa-table-wrap" data-testid="licenses-table">
        <table className="oa-table">
          <thead>
            <tr>
              <th>Lizenz-ID (GUID)</th><th>Plan</th><th>Seats</th><th>Kontakt</th><th>Server</th><th>Läuft ab</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const q = licQuery.trim().toLowerCase();
              const rows = (licenses || []).filter((l) => {
                if (!q) return true;
                const key = String(l.licenseKey || l.id || '').toLowerCase();
                const email = String(l.email || l.contactEmail || '').toLowerCase();
                const guilds = [...(l.linkedServerIds || []), ...(l.linkedServers || []).map((server) => server.name)].join(' ').toLowerCase();
                return key.includes(q) || email.includes(q) || guilds.includes(q);
              });
              if (rows.length === 0) {
                return <tr><td colSpan={8} style={{ textAlign: 'center', color: '#64748b', padding: 28 }}>{licQuery ? 'Keine Treffer' : 'Keine Lizenzen vorhanden'}</td></tr>;
              }
              return rows.map((l) => {
                const key = l.licenseKey || l.id;
                return (
                  <tr key={key} data-testid={`license-row-${key}`}>
                    <td className="oa-mono" style={{ fontSize: 12 }}>{key}</td>
                    <td><span className={`oa-pill ${l.plan === 'ultimate' ? 'orange' : l.plan === 'pro' ? 'cyan' : 'slate'}`}>{l.planName}</span></td>
                    <td>{l.seatsUsed}/{l.seats}</td>
                    <td style={{ color: '#94a3b8' }}>{l.email || l.contactEmail || '—'}</td>
                    <td style={{ color: '#94a3b8' }}>
                      {(l.linkedServers || []).length ? (l.linkedServers || []).map((server) => (
                        <div key={server.id} style={{ marginBottom: 3 }}>
                          {server.discordUrl ? <a href={server.discordUrl} target="_blank" rel="noreferrer" style={{ color: server.valid === false ? '#ff8fab' : '#00e5ff' }}>{server.name}</a> : server.name}
                          <span className="oa-mono" style={{ display: 'block', fontSize: 10, color: '#64748b' }}>{server.id}</span>
                        </div>
                      )) : '—'}
                    </td>
                    <td style={{ color: '#94a3b8' }}>{fmtDate(l.expiresAt)}{typeof l.daysLeft === 'number' && !l.expired && <span style={{ color: l.daysLeft <= 7 ? '#fbbf24' : '#64748b', marginLeft: 6, fontSize: 11 }}>({l.daysLeft}d)</span>}</td>
                    <td><span className={`oa-pill ${l.expired ? 'red' : l.active ? 'green' : 'slate'}`}>{l.expired ? 'Abgelaufen' : l.active ? 'Aktiv' : 'Inaktiv'}</span></td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px' }} onClick={() => openEditLicense(l)} data-testid={`license-edit-${key}`}><Pencil size={13} /></button>
                      <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', color: '#ff8fab' }} onClick={() => deleteLicense(key)} data-testid={`license-delete-${key}`}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
