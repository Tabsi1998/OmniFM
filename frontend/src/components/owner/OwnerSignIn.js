// OmniFM: owner console: the sign-in with Discord or the owner token.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { ShieldCheck, Users, AlertTriangle } from 'lucide-react';

export default function OwnerSignIn({
  discordLogin,
  handleLogin,
  loggingIn,
  loginErr,
  setTokenInput,
  startDiscordLogin,
  tokenInput,
}) {
  return (
    <div className="oa-root">
      <div className="oa-login">
        <form className="oa-login-card oa-fade" onSubmit={handleLogin} data-testid="admin-login-form">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div className="oa-brand-logo"><img src="/brand/omnifm-mark.svg" alt="" width="28" height="28" /></div>
            <div>
              <div className="oa-display" style={{ fontSize: 20, fontWeight: 800 }}>OmniFM</div>
              <div className="oa-owner-badge">Super-Admin / Owner Engine</div>
            </div>
          </div>
          <h1 className="oa-display" style={{ fontSize: 22, marginTop: 18 }}>Owner Console</h1>
          <p style={{ color: '#94a3b8', fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
            {discordLogin
              ? <>Mit einem freigeschalteten Discord-Konto anmelden. Der Owner-Token (<span className="oa-mono">API_ADMIN_TOKEN</span>) geht weiterhin.</>
              : <>Zugriff nur mit dem Owner-Token (<span className="oa-mono">API_ADMIN_TOKEN</span>).</>}
          </p>
          {discordLogin && (
            <button type="button" onClick={startDiscordLogin} className="oa-btn primary" style={{ width: '100%', marginTop: 18 }} data-testid="admin-discord-login-button">
              <Users size={16} /> Mit Discord anmelden
            </button>
          )}
          <div style={{ marginTop: 20 }}>
            <label className="oa-stat-label" htmlFor="oa-token">Owner Token</label>
            <input
              id="oa-token" type="password" className="oa-input" style={{ marginTop: 8 }}
              placeholder="••••••••••••••••" value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              data-testid="admin-token-input" autoFocus
            />
          </div>
          {loginErr && (
            <div className="oa-pill red" style={{ marginTop: 14 }} data-testid="admin-login-error">
              <AlertTriangle size={13} /> {loginErr}
            </div>
          )}
          <button type="button" onClick={handleLogin} className="oa-btn primary" style={{ width: '100%', marginTop: 20 }} disabled={loggingIn} data-testid="admin-login-button">
            {loggingIn ? 'Verbinde…' : <><ShieldCheck size={16} /> Anmelden</>}
          </button>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <a href="/" className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>← Zurück zur Website</a>
          </div>
        </form>
      </div>
    </div>
  );
}
