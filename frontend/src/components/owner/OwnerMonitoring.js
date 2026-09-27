// OmniFM: owner console: live status of the bots, incidents, logs and failover history.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { Server, TrendingUp, Cpu, AlertTriangle, Radar, Terminal, Gauge, HeartPulse } from 'lucide-react';
import { Equalizer, StatTile, fmtUptime, relTime } from './ownerUi.js';

export default function OwnerMonitoring({
  failoverHistory,
  loadFailoverHistory,
  monitorLogLevel,
  monitorLogQuery,
  monitoring,
  setMonitorLogLevel,
  setMonitorLogQuery,
}) {
  return (
    <>
      {!monitoring ? (
        <div className="oa-card" style={{ textAlign: 'center', color: '#64748b', padding: 40 }} data-testid="monitoring-loading">
          <Equalizer /> <div className="oa-mono" style={{ marginTop: 12, fontSize: 12 }}>TELEMETRIE WIRD GELADEN…</div>
        </div>
      ) : monitoring.waiting ? (
        <div className="oa-card oa-fade" style={{ textAlign: 'center', padding: 48 }} data-testid="monitoring-waiting">
          <div style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 18px', display: 'grid', placeItems: 'center', background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}><Radar size={26} /></div>
          <div style={{ fontWeight: 800, fontSize: 18, fontFamily: "'Syne','Outfit',sans-serif", marginBottom: 10 }}>Warte auf Live-Daten vom Bot</div>
          <div style={{ color: '#94a3b8', fontSize: 14, maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>{monitoring.message}</div>
          <div className="oa-mono" style={{ marginTop: 18, fontSize: 11, color: '#94a3b8' }}>MongoDB: {monitoring.health?.mongo ? 'verbunden' : 'nicht verbunden'} · keine Fake-Werte</div>
        </div>
      ) : (
        <div data-testid="monitoring-panel">
          {(() => {
            const live = monitoring.live;
            const sim = monitoring.simulated;
            const bg = live ? 'rgba(16,185,129,0.12)' : sim ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.12)';
            const bd = live ? 'rgba(16,185,129,0.4)' : sim ? 'rgba(245,158,11,0.4)' : '#2a3450';
            const col = live ? '#4ade80' : sim ? '#fbbf24' : '#94a3b8';
            const label = live ? 'LIVE · echte Node-Telemetrie' : sim ? 'DEMO · simulierte Werte (SEED_DEMO_DATA)' : 'KEINE LIVE-DATEN';
            return (
              <div data-testid="monitoring-banner" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: bg, border: `1px solid ${bd}`, color: col, fontSize: 12.5, fontWeight: 700, marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>
                <span className="oa-dot" style={{ background: col }} /> {label}
                {monitoring.process && <span style={{ marginLeft: 'auto', color: '#64748b', fontWeight: 500 }}>
                  {monitoring.process.resourceModel === 'split-processes'
                    ? `${monitoring.process.processCount || 0} getrennte Bot-Prozesse · echte Werte je Node`
                    : 'Prozess: 1 Node · CPU/RAM geteilt'}
                  {' · '}{monitoring.process.cores} Cores · Node {monitoring.process.nodeVersion || ''}
                </span>}
              </div>
            );
          })()}
          <div className="oa-grid cols-4">
            <StatTile testid="mon-nodes" label="Healthy Nodes" value={`${monitoring.health.healthyNodes}/${monitoring.health.totalNodes}`} icon={HeartPulse} accent="#10b981"
              foot={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="oa-dot" style={{ background: '#10b981' }} /> Echtzeit · alle 5s</span>} />
            <StatTile testid="mon-uptime" label={monitoring.live ? 'Prozess-Uptime' : 'Uptime'} value={monitoring.live ? fmtUptime(monitoring.health.uptimeSec) : (monitoring.simulated ? `${monitoring.health.uptimePct}%` : '—')} icon={TrendingUp} accent="#00e5ff" foot={<span>{monitoring.live ? 'seit letztem Start' : '30-Tage rollierend'}</span>} />
            <StatTile testid="mon-latency" label={monitoring.live ? (monitoring.process?.resourceModel === 'split-processes' ? 'RAM (alle Bots)' : 'RAM (Prozess)') : 'API-Latenz'} value={monitoring.live ? `${monitoring.process?.totalRamMb ?? monitoring.process?.ramMb ?? 0} MB` : (monitoring.simulated ? `${monitoring.health.apiLatencyMs} ms` : '—')} icon={Gauge} accent="#ff6b00" foot={<span>{monitoring.live ? (monitoring.process?.resourceModel === 'split-processes' ? `${monitoring.process?.processCount || 0} getrennte Prozesse` : 'geteilt für alle Bots') : 'Commander → API'}</span>} />
            <StatTile testid="mon-incidents" label="Offene Incidents" value={monitoring.health.openIncidents} icon={AlertTriangle} accent={monitoring.health.openIncidents ? '#ff2a5f' : '#10b981'} foot={<span>{monitoring.incidents.length} in Historie</span>} />
          </div>

          {monitoring.live && monitoring.process && (
            <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="monitoring-process-model">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div className="oa-section-title" style={{ margin: 0 }}><Cpu size={15} /> {monitoring.process.resourceModel === 'split-processes' ? 'Getrennte Bot-Prozesse' : 'Gemeinsamer Node.js-Prozess'}</div>
                  <div className="oa-stat-foot" style={{ marginTop: 7 }}>{monitoring.process.resourceModel === 'split-processes' ? 'Commander und Worker laufen getrennt. CPU, RAM, PID und Uptime stammen direkt vom jeweiligen Bot-Prozess.' : 'Commander und Worker laufen im expliziten Legacy-Modus in einem Prozess. Diese Ressourcen sind deshalb gemeinsam.'}</div>
                </div>
                <div className="oa-mono" style={{ color: '#94a3b8', fontSize: 11 }}>CPU {monitoring.process.cpuPct ?? '—'}% · RAM {monitoring.process.ramMb ?? '—'} MB · {monitoring.process.cores ?? '—'} Cores · {monitoring.process.nodeVersion || 'Node'}</div>
              </div>
            </div>
          )}

          <div className="oa-section-title"><Server size={15} /> Node-Health (live)</div>
          <div className="oa-grid cols-3">
            {monitoring.nodes.map((n) => {
              const cpuColor = n.cpuPct > 80 ? '#ff2a5f' : n.cpuPct > 55 ? '#f59e0b' : '#10b981';
              const nodeMetrics = monitoring.live && n.resourceScope === 'shared-process'
                ? [
                  { label: 'PING', val: n.pingMs == null ? '—' : `${n.pingMs} ms`, pct: Math.min(100, n.pingMs || 0), color: '#ff6b00' },
                  { label: 'VOICE-AUSLASTUNG', val: `${n.voiceConnections || 0} Streams`, pct: Math.min(100, (n.voiceConnections || 0) * 10), color: '#00e5ff' },
                  { label: 'SERVER-AUSLASTUNG', val: `${n.guilds || 0} Guilds`, pct: Math.min(100, (n.guilds || 0) * 2), color: '#10b981' },
                ]
                : [
                  { label: 'CPU', val: n.cpuPct == null ? '—' : `${n.cpuPct}%`, pct: n.cpuPct || 0, color: cpuColor },
                  { label: 'RAM', val: n.ramMb == null ? '—' : `${n.ramMb} MB`, pct: Math.min(100, (n.ramMb || 0) / 6), color: '#00e5ff' },
                  { label: 'PING', val: n.pingMs == null ? '—' : `${n.pingMs} ms`, pct: Math.min(100, n.pingMs || 0), color: '#ff6b00' },
                ];
              return (
                <div className="oa-card oa-fade" key={n.botId} data-testid={`mon-node-${n.index}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: n.role === 'commander' ? 'rgba(255,107,0,0.15)' : 'rgba(0,229,255,0.12)', color: n.role === 'commander' ? '#ff6b00' : '#00e5ff', display: 'grid', placeItems: 'center' }}>
                        {n.role === 'commander' ? <Cpu size={16} /> : <Server size={16} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{n.name}</div>
                        <div className="oa-mono" style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{n.role} · {String(n.requiredTier || 'free').toUpperCase()}</div>
                      </div>
                    </div>
                    <span className={`oa-pill ${n.status === 'online' ? 'green' : n.status === 'offline' ? 'red' : 'amber'}`}>{n.status === 'online' ? 'Online' : n.status === 'offline' ? 'Offline' : 'Degraded'}</span>
                  </div>
                  {nodeMetrics.map((m) => (
                    <div key={m.label} style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 5 }} className="oa-mono">
                        <span>{m.label}</span><span>{m.val}</span>
                      </div>
                      <div className="oa-progress"><i style={{ width: `${m.pct}%`, background: m.color }} /></div>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }} className="oa-mono">
                    <span>{n.voiceConnections} VOICE · {n.listeners || 0} LISTENERS</span><span>{n.guilds} GUILDS</span>
                  </div>
                  {(n.guildDetails || []).filter((detail) => detail.playing || detail.voiceConnected).length > 0 && <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid #1b2133', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {(n.guildDetails || []).filter((detail) => detail.playing || detail.voiceConnected).slice(0, 4).map((detail) => <div key={`${detail.guildId}-${detail.channelId || ''}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5 }}><span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.stationName || detail.stationKey || detail.channelName || detail.guildName}</span><span className="oa-mono" style={{ color: detail.recovering ? '#fbbf24' : '#4ade80', flexShrink: 0 }}>{detail.recovering ? 'RECOVERY' : `${detail.listenerCount || 0} HÖRER`}</span></div>)}
                    {(n.guildDetails || []).filter((detail) => detail.playing || detail.voiceConnected).length > 4 && <div className="oa-mono" style={{ color: '#64748b', fontSize: 10 }}>+{(n.guildDetails || []).filter((detail) => detail.playing || detail.voiceConnected).length - 4} weitere Streams</div>}
                  </div>}
                  {monitoring.live && n.resourceScope === 'shared-process' && <div style={{ marginTop: 8, fontSize: 10.5, color: '#64748b' }}>CPU/RAM werden oben einmal für den gemeinsamen Node-Prozess angezeigt.</div>}
                </div>
              );
            })}
          </div>

          {(monitoring.affectedServers || []).length > 0 && (
            <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="mon-affected-servers">
              <div className="oa-stat-label" style={{ marginBottom: 10 }}>Betroffene Server ({monitoring.affectedServers.length})</div>
              <div className="oa-table-wrap">
                <table className="oa-table">
                  <thead>
                    <tr><th>Server</th><th>Bot</th><th>Zustand</th><th>Seit</th><th>Details</th></tr>
                  </thead>
                  <tbody>
                    {monitoring.affectedServers.map((row) => (
                      <tr key={`${row.guildId}-${row.botName}`}>
                        <td>{row.guildName || row.guildId}</td>
                        <td className="oa-mono">{row.botName}</td>
                        <td><span className={`oa-pill ${row.state === 'parked' ? 'red' : 'amber'}`}>{{ parked: 'Pausiert', failover: 'Ersatzsender', muted: 'Stumm', recovering: 'Recovery' }[row.state] || row.state}</span></td>
                        <td className="oa-mono">{row.durationSec != null ? fmtUptime(row.durationSec) : '—'}</td>
                        <td style={{ fontSize: 12, color: '#94a3b8' }}>{row.state === 'failover' ? `${row.stationName} statt ${row.desiredStationName}` : (row.detail || '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="mon-failover-history">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="oa-stat-label">Failover-Historie (letzte 100 Umschaltungen)</div>
              <button className="oa-btn ghost" style={{ padding: '4px 10px' }} onClick={loadFailoverHistory}>Aktualisieren</button>
            </div>
            {failoverHistory === null && <div className="oa-sub">Lade…</div>}
            {failoverHistory && failoverHistory.length === 0 && <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>Noch keine Umschaltung aufgezeichnet.</div>}
            {failoverHistory && failoverHistory.length > 0 && (
              <div className="oa-table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="oa-table">
                  <thead>
                    <tr><th>Wann</th><th>Server</th><th>Was</th><th>Von → Nach</th><th>Dauer</th><th>Grund</th></tr>
                  </thead>
                  <tbody>
                    {failoverHistory.map((row, i) => (
                      <tr key={`${row.at}-${row.guildId}-${i}`}>
                        <td className="oa-mono" title={row.at}>{relTime(row.at)}</td>
                        <td>{row.guildName || row.guildId}</td>
                        <td><span className={`oa-pill ${row.kind === 'back' ? 'green' : row.kind === 'exhausted' ? 'red' : 'amber'}`}>{{ switch: 'Ersatzsender', back: 'Zurück', stay: 'Ersatz bleibt', exhausted: 'Kein Sender' }[row.kind] || row.kind}</span></td>
                        <td style={{ fontSize: 12 }}>{row.from || '—'}{row.to ? ` → ${row.to}` : ''}</td>
                        <td className="oa-mono">{row.durationSec != null ? fmtUptime(row.durationSec) : '—'}</td>
                        <td style={{ fontSize: 12, color: '#94a3b8', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.reason}>{row.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="oa-grid cols-2" style={{ marginTop: 18 }}>
            <div className="oa-card oa-fade" data-testid="mon-incidents-list">
              <div className="oa-stat-label" style={{ marginBottom: 6 }}>Incidents</div>
              {monitoring.incidents.length === 0 && <div style={{ color: '#64748b', fontSize: 13, padding: 16 }}>Keine Incidents</div>}
              {monitoring.incidents.map((inc, i) => {
                const sev = inc.severity === 'critical' ? 'red' : inc.severity === 'warning' ? 'amber' : 'cyan';
                return (
                  <div className="oa-integration" key={i} data-testid={`mon-incident-${i}`}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                      <span className={`oa-pill ${sev}`} style={{ textTransform: 'uppercase' }}>{inc.severity}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.message}</span>
                        <span className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{inc.source} · {relTime(inc.at)}</span>
                      </span>
                    </span>
                    <span className={`oa-pill ${inc.resolved ? 'green' : 'slate'}`}>{inc.resolved ? 'behoben' : 'offen'}</span>
                  </div>
                );
              })}
            </div>

            <div className="oa-card oa-fade" data-testid="mon-log-stream" style={{ background: '#0a0c12' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div className="oa-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={14} /> Live-Log</div>
                <span className="oa-pill red" style={{ padding: '3px 9px' }}><span className="oa-dot" /> LIVE</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(160px, 1fr)', gap: 8, marginBottom: 10 }}>
                <select className="oa-input" value={monitorLogLevel} onChange={(event) => setMonitorLogLevel(event.target.value)} aria-label="Log-Level filtern" style={{ height: 36, padding: '0 9px' }}>
                  <option value="ALL">Alle Level</option>
                  <option value="INFO">Info</option>
                  <option value="WARN">Warnungen</option>
                  <option value="ERROR">Fehler</option>
                </select>
                <input className="oa-input" value={monitorLogQuery} onChange={(event) => setMonitorLogQuery(event.target.value)} placeholder="Quelle oder Meldung filtern…" aria-label="Logs durchsuchen" style={{ height: 36 }} />
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {monitoring.logs.filter((entry) => monitorLogLevel === 'ALL' || entry.level === monitorLogLevel).filter((entry) => {
                  const query = monitorLogQuery.trim().toLowerCase();
                  return !query || `${entry.source || ''} ${entry.message || ''}`.toLowerCase().includes(query);
                }).map((l, i) => {
                  const c = l.level === 'WARN' ? '#fbbf24' : l.level === 'ERROR' ? '#ff8fab' : '#4ade80';
                  return (
                    <div key={i} className="oa-mono" style={{ fontSize: 11.5, padding: '5px 0', borderBottom: '1px solid #12151f', display: 'flex', gap: 8, lineHeight: 1.4 }} data-testid={`mon-log-${i}`}>
                      <span style={{ color: '#475569', flexShrink: 0 }}>{new Date(l.at).toLocaleTimeString('de-DE')}</span>
                      <span style={{ color: c, flexShrink: 0, fontWeight: 700 }}>{l.level}</span>
                      <span style={{ color: '#64748b', flexShrink: 0 }}>[{l.source}]</span>
                      <span style={{ color: '#cbd5e1', minWidth: 0 }}>{l.message}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 11 }} className="oa-mono">
            {monitoring.simulated ? 'SIMULIERTE TELEMETRIE · echte Node-Runtime-Daten überschreiben diese Werte automatisch' : 'LIVE NODE TELEMETRY'} · Stand {new Date(monitoring.generatedAt).toLocaleTimeString('de-DE')}
          </div>
        </div>
      )}
    </>
  );
}
