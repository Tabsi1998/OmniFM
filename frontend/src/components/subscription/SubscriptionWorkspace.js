// OmniFM: server dashboard subscription: the servers of the license and which of them use it.
// Split out of components/DashboardSubscription.js (#296); its state stays there.

export default function SubscriptionWorkspace({
  lic,
  setWorkspaceTargetId,
  t,
  updateWorkspace,
  workspace,
  workspaceAvailableServers,
  workspaceBlockedServers,
  workspaceBusyTargetId,
  workspaceCanLink,
  workspaceError,
  workspaceLinkedServers,
  workspaceTargetId,
}) {
  return (
    <div
      data-testid="subscription-license-workspace-card"
      style={{
        background: '#0A0A0A',
        border: '1px solid rgba(139,92,246,0.22)',
        padding: 16,
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#D4D4D8' }}>
            {t('Lizenz-Workspace', 'License workspace')}
          </h4>
          <div style={{ marginTop: 6, color: '#A1A1AA', fontSize: 13, lineHeight: 1.6 }}>
            {t(
              'Verwalte die Server, die aktuell mit dieser Ultimate-Lizenz verknüpft sind, direkt aus dem Dashboard.',
              'Manage the servers currently linked to this Ultimate license directly from the dashboard.'
            )}
          </div>
        </div>
        <div style={{ border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '8px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {lic?.seatsUsed || 0} / {lic?.seats || 1} {t('Seats belegt', 'seats used')}
        </div>
      </div>

      {workspaceError ? (
        <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
          {workspaceError}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Verknüpfte Server', 'Linked servers')}
          </div>
          {workspaceLinkedServers.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {workspaceLinkedServers.map((server) => {
                const isBusy = workspaceBusyTargetId === server.id;
                return (
                  <div
                    key={server.id}
                    style={{
                      border: '1px solid #1A1A2E',
                      background: '#0A0A0A',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ color: '#F4F4F5', fontSize: 13 }}>{server.name}</strong>
                        {server.selected ? (
                          <span style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,78,59,0.16)', color: '#A7F3D0', padding: '3px 8px', fontSize: 11 }}>
                            {t('Aktueller Server', 'Current server')}
                          </span>
                        ) : null}
                        <span style={{ border: '1px solid #1A1A2E', color: '#A1A1AA', padding: '3px 8px', fontSize: 11 }}>
                          {server.tierName}
                        </span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                        {server.accessible
                          ? t(`Server-ID ${server.id}`, `Server ID ${server.id}`)
                          : t(`Kein Dashboard-Zugriff mehr für ${server.id}`, `No dashboard access for ${server.id} anymore`)}
                      </div>
                    </div>
                    {workspace?.canManage && server.accessible ? (
                      <button
                        data-testid={`subscription-workspace-unlink-${server.id}`}
                        onClick={() => updateWorkspace('unlink', server.id)}
                        disabled={Boolean(workspaceBusyTargetId)}
                        style={{
                          border: '1px solid rgba(239,68,68,0.25)',
                          background: 'rgba(127,29,29,0.12)',
                          color: '#FCA5A5',
                          padding: '8px 12px',
                          cursor: workspaceBusyTargetId ? 'wait' : 'pointer',
                          opacity: workspaceBusyTargetId && !isBusy ? 0.7 : 1,
                        }}
                      >
                        {isBusy ? t('Entfernt...', 'Removing...') : t('Entfernen', 'Remove')}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#71717A', lineHeight: 1.6 }}>
              {t('Aktuell sind keine Server mit dieser Lizenz verknüpft.', 'No servers are currently linked to this license.')}
            </div>
          )}
          {workspace.hiddenLinkedServerCount > 0 ? (
            <div style={{ fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
              {t(
                `${workspace.hiddenLinkedServerCount} verknüpfte Server sind in deiner aktuellen Dashboard-Session nicht administrierbar.`,
                `${workspace.hiddenLinkedServerCount} linked servers are not manageable in your current dashboard session.`
              )}
            </div>
          ) : null}
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Server hinzufügen', 'Add server')}
          </div>
          <div style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
            {lic?.seatsAvailable > 0
              ? t(
                `Noch ${lic.seatsAvailable} freier Seat verfügbar. Wähle einen Server aus deiner Session, um ihn dieser Lizenz zuzuweisen.`,
                `${lic.seatsAvailable} free seat${lic.seatsAvailable === 1 ? '' : 's'} remaining. Choose a server from your session to assign it to this license.`
              )
              : t(
                'Alle Seats dieser Lizenz sind bereits belegt. Entferne zuerst einen Server oder buche mehr Seats.',
                'All seats of this license are already occupied. Remove a server first or purchase more seats.'
              )}
          </div>

          {workspaceAvailableServers.length > 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <select
                data-testid="subscription-workspace-target-select"
                value={workspaceTargetId}
                onChange={(event) => setWorkspaceTargetId(event.target.value)}
                disabled={!workspaceCanLink || Boolean(workspaceBusyTargetId)}
                style={{
                  height: 42,
                  border: '1px solid #1A1A2E',
                  background: '#0A0A0A',
                  color: '#F4F4F5',
                  padding: '0 12px',
                  outline: 'none',
                }}
              >
                {workspaceAvailableServers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </select>
              <button
                data-testid="subscription-workspace-link-btn"
                onClick={() => updateWorkspace('link', workspaceTargetId)}
                disabled={!workspaceTargetId || !workspaceCanLink || Boolean(workspaceBusyTargetId)}
                style={{
                  border: '1px solid #8B5CF6',
                  background: 'rgba(139,92,246,0.12)',
                  color: '#fff',
                  padding: '10px 14px',
                  fontWeight: 600,
                  cursor: (!workspaceTargetId || !workspaceCanLink || workspaceBusyTargetId) ? 'not-allowed' : 'pointer',
                  opacity: (!workspaceTargetId || !workspaceCanLink || workspaceBusyTargetId) ? 0.65 : 1,
                }}
              >
                {workspaceBusyTargetId === workspaceTargetId
                  ? t('Verknüpft...', 'Linking...')
                  : t('Server verknüpfen', 'Link server')}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#71717A', lineHeight: 1.6 }}>
              {t(
                'In deiner aktuellen Session ist kein weiterer freier Server für diesen Workspace verfügbar.',
                'There is no additional free server available for this workspace in your current session.'
              )}
            </div>
          )}

          {workspaceBlockedServers.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {t('Nicht direkt verschiebbar', 'Not directly movable')}
              </div>
              {workspaceBlockedServers.map((server) => (
                <div key={`blocked-${server.id}`} style={{ border: '1px solid #1A1A2E', background: '#0A0A0A', padding: '10px 12px' }}>
                  <div style={{ color: '#F4F4F5', fontSize: 13, fontWeight: 600 }}>{server.name}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#71717A', lineHeight: 1.6 }}>
                    {server.reason === 'existing_active_license'
                      ? t('Dieser Server hat bereits eine eigene aktive Lizenz.', 'This server already has its own active license.')
                      : t('Dieser Server kann aktuell nicht direkt übernommen werden.', 'This server cannot be taken over directly right now.')}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
