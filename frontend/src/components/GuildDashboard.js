import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Radio, LayoutDashboard, ListMusic, ShieldCheck, BarChart3, CreditCard, LogOut,
  Plus, Trash2, Check, Crown, Zap, Music2, Users, Clock, Play, Lock, Server, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { buildApiUrl } from '../lib/api.js';
import { useI18n } from '../i18n.js';

const NAV = [
  { id: 'overview', label: 'Übersicht', icon: LayoutDashboard },
  { id: 'stations', label: 'My Stations', icon: ListMusic },
  { id: 'roles', label: 'Rollen & Rechte', icon: ShieldCheck },
  { id: 'stats', label: 'Statistiken', icon: BarChart3 },
  { id: 'subscription', label: 'Abo', icon: CreditCard },
];

const TIER_META = {
  free: { name: 'Free', color: '#64748b', icon: Radio, customLimit: 0 },
  pro: { name: 'Pro', color: '#00e5ff', icon: Zap, customLimit: 5 },
  ultimate: { name: 'Ultimate', color: '#ff6b00', icon: Crown, customLimit: 999 },
};

const PRESET_STATIONS = [
  { key: 'synthwave', name: 'Synthwave Nights', genre: 'Retrowave' },
  { key: 'lofi', name: 'Lofi Lounge', genre: 'Lo-Fi' },
  { key: 'dnb', name: 'BassDrop Network', genre: 'Drum & Bass' },
  { key: 'chillhop', name: 'Chillhop Café', genre: 'Chillhop' },
  { key: 'trance', name: 'Trance Nation', genre: 'Trance' },
  { key: 'jazz', name: 'Midnight Jazz', genre: 'Jazz' },
];

const DEMO = {
  user: { name: 'DemoAdmin', tag: '#0001' },
  guilds: [
    { id: 'g1', name: 'NightWave HQ', tier: 'ultimate', members: 4820 },
    { id: 'g2', name: 'Lofi Lounge', tier: 'pro', members: 1290 },
    { id: 'g3', name: 'Indie Corner', tier: 'free', members: 340 },
  ],
  perServer: {
    g1: {
      defaultStation: 'synthwave', listeners: 42, uptimePct: 99.8, minutesMonth: 18240, activeWorkers: 2,
      custom: [{ key: 'c1', name: 'HQ House Party', url: 'https://ice.example.com/house' }, { key: 'c2', name: 'Focus Beats', url: 'https://ice.example.com/focus' }],
      roles: [{ id: 'r1', name: 'DJ', color: '#ff6b00' }, { id: 'r2', name: 'Moderator', color: '#00e5ff' }, { id: 'r3', name: '@everyone', color: '#64748b' }],
      trend: [58, 72, 65, 90, 84, 102, 96],
      top: [['Synthwave Nights', 8200], ['Lofi Lounge', 5100], ['BassDrop', 3400], ['Trance Nation', 1540]],
    },
    g2: {
      defaultStation: 'lofi', listeners: 18, uptimePct: 99.4, minutesMonth: 9600, activeWorkers: 1,
      custom: [{ key: 'c3', name: 'Study Session', url: 'https://ice.example.com/study' }],
      roles: [{ id: 'r1', name: 'DJ', color: '#ff6b00' }, { id: 'r3', name: '@everyone', color: '#64748b' }],
      trend: [22, 28, 25, 31, 27, 35, 33],
      top: [['Lofi Lounge', 6100], ['Chillhop Café', 2200], ['Midnight Jazz', 900]],
    },
    g3: {
      defaultStation: 'chillhop', listeners: 4, uptimePct: 98.9, minutesMonth: 1200, activeWorkers: 1,
      custom: [],
      roles: [{ id: 'r3', name: '@everyone', color: '#64748b' }],
      trend: [3, 5, 4, 6, 5, 7, 6],
      top: [['Chillhop Café', 700], ['Lofi Lounge', 410]],
    },
  },
};

const COMMANDS = [
  { id: 'play', label: '/play' },
  { id: 'skip', label: '/skip' },
  { id: 'stop', label: '/stop' },
  { id: 'station', label: '/station' },
  { id: 'volume', label: '/volume' },
];

function fmtInt(n) { return Number(n || 0).toLocaleString(); }
function fmtMinutes(m) { const h = Math.floor((m || 0) / 60); return h >= 1 ? `${fmtInt(h)} h` : `${fmtInt(m)} min`; }

function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#0e111a', border: '1px solid #2a3450', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <b>{p.value}</b></div>)}
    </div>
  );
}

function StatTile({ label, value, foot, icon: Icon, accent }) {
  return (
    <div className="oa-card hoverable oa-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="oa-stat-label">{label}</div>
        <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: `${accent}1f`, color: accent }}><Icon size={17} /></div>
      </div>
      <div className="oa-stat-value">{value}</div>
      {foot && <div className="oa-stat-foot">{foot}</div>}
    </div>
  );
}

export default function GuildDashboard() {
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [session, setSession] = useState({ authenticated: false, user: null, guilds: [] });
  const [guildId, setGuildId] = useState('');
  const [section, setSection] = useState('overview');
  // per-guild working state (demo/local)
  const [store, setStore] = useState({}); // guildId -> data
  const [perms, setPerms] = useState({}); // `${cmd}:${roleId}` -> bool
  const [newStation, setNewStation] = useState({ name: '', url: '' });
  const [msg, setMsg] = useState(null);
  const { locale } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);
  const en = !String(locale || 'de').startsWith('de');
  const navLabel = (id) => ({
    overview: t('Übersicht', 'Overview'),
    stations: t('Meine Sender', 'My Stations'),
    roles: t('Rollen & Rechte', 'Roles & Permissions'),
    stats: t('Statistiken', 'Statistics'),
    subscription: t('Abo', 'Subscription'),
  }[id] || id);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await fetch(buildApiUrl('/api/auth/session'), { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (stop) return;
        if (data && data.authenticated && Array.isArray(data.guilds) && data.guilds.length) {
          setSession({ authenticated: true, user: data.user, guilds: data.guilds });
          setGuildId(data.guilds[0].id);
        }
      } catch { /* gate */ }
      finally { if (!stop) setLoading(false); }
    })();
    return () => { stop = true; };
  }, []);

  const startDemo = () => {
    setDemo(true);
    setSession({ authenticated: true, user: DEMO.user, guilds: DEMO.guilds });
    setGuildId(DEMO.guilds[0].id);
    setStore(JSON.parse(JSON.stringify(DEMO.perServer)));
    // seed permission matrix
    const seed = {};
    ['r1', 'r2'].forEach((r) => COMMANDS.forEach((c) => { seed[`${c.id}:${r}`] = true; }));
    COMMANDS.forEach((c) => { seed[`${c.id}:r3`] = c.id === 'play' || c.id === 'station'; });
    setPerms(seed);
  };

  const guild = useMemo(() => session.guilds.find((g) => g.id === guildId) || null, [session.guilds, guildId]);
  const tier = (guild?.tier || 'free');
  const tm = TIER_META[tier] || TIER_META.free;
  const gdata = store[guildId] || DEMO.perServer[guildId] || { custom: [], roles: [], trend: [], top: [], listeners: 0, uptimePct: 0, minutesMonth: 0, activeWorkers: 0, defaultStation: 'lofi' };

  const setDefaultStation = (key) => {
    setStore((s) => ({ ...s, [guildId]: { ...(s[guildId] || gdata), defaultStation: key } }));
    setMsg({ ok: true, text: t('Standard-Sender aktualisiert.', 'Default station updated.') });
  };
  const addCustom = () => {
    if (!newStation.name.trim() || !newStation.url.trim()) { setMsg({ ok: false, text: t('Name und URL erforderlich.', 'Name and URL required.') }); return; }
    if (gdata.custom.length >= tm.customLimit) { setMsg({ ok: false, text: t(`Limit erreicht (${tm.name}: ${tm.customLimit === 0 ? 'keine' : tm.customLimit} eigene Sender).`, `Limit reached (${tm.name}: ${tm.customLimit === 0 ? 'no' : tm.customLimit} custom stations).`) }); return; }
    const item = { key: `c${Date.now()}`, name: newStation.name.trim(), url: newStation.url.trim() };
    setStore((s) => { const cur = s[guildId] || gdata; return { ...s, [guildId]: { ...cur, custom: [...cur.custom, item] } }; });
    setNewStation({ name: '', url: '' });
    setMsg({ ok: true, text: t('Eigener Sender hinzugefügt.', 'Custom station added.') });
  };
  const removeCustom = (key) => {
    setStore((s) => { const cur = s[guildId] || gdata; return { ...s, [guildId]: { ...cur, custom: cur.custom.filter((c) => c.key !== key) } }; });
    setMsg({ ok: true, text: t('Sender entfernt.', 'Station removed.') });
  };
  const togglePerm = (cmd, roleId) => setPerms((p) => ({ ...p, [`${cmd}:${roleId}`]: !p[`${cmd}:${roleId}`] }));

  // Real mode: seed permission matrix from the backend for the selected guild.
  useEffect(() => {
    if (demo || !session.authenticated || !guildId) return undefined;
    let stop = false;
    fetch(buildApiUrl(`/api/dashboard/perms?serverId=${encodeURIComponent(guildId)}`), { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json()).then((d) => {
        if (stop || !d || !d.commandRoleMap) return;
        const seed = {};
        Object.entries(d.commandRoleMap).forEach(([cmd, roles]) => (Array.isArray(roles) ? roles : []).forEach((rid) => { seed[`${cmd}:${rid}`] = true; }));
        setPerms(seed);
      }).catch(() => {});
    return () => { stop = true; };
  }, [demo, session.authenticated, guildId]);

  const savePerms = async () => {
    if (demo) { setMsg({ ok: true, text: t('Berechtigungen gespeichert (Demo).', 'Permissions saved (demo).') }); return; }
    const commandRoleMap = {};
    COMMANDS.forEach((c) => {
      const roles = gdata.roles.filter((r) => perms[`${c.id}:${r.id}`]).map((r) => r.id);
      if (roles.length) commandRoleMap[c.id] = roles;
    });
    try {
      const res = await fetch(buildApiUrl(`/api/dashboard/perms?serverId=${encodeURIComponent(guildId)}`), {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandRoleMap }),
      });
      if (!res.ok) throw new Error('save failed');
      setMsg({ ok: true, text: t('Berechtigungen gespeichert.', 'Permissions saved.') });
    } catch { setMsg({ ok: false, text: t('Speichern fehlgeschlagen.', 'Saving failed.') }); }
  };

  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);

  if (loading) {
    return <div className="oa-root" style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', color: '#94a3b8' }}><span className="oa-eq"><span /><span /><span /><span /><span /></span>
        <div className="oa-mono" style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.14em' }}>DASHBOARD LÄDT…</div></div>
    </div>;
  }

  // Gate
  if (!session.authenticated) {
    return (
      <div className="oa-root">
        <div className="oa-login">
          <div className="oa-login-card oa-fade" data-testid="guild-login-gate">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div className="oa-brand-logo"><Radio size={20} /></div>
              <div><div className="oa-display" style={{ fontSize: 20, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div>
            </div>
            <h1 className="oa-display" style={{ fontSize: 23, marginTop: 16 }}>{t('Verwalte deine Server', 'Manage your servers')}</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>{t('Melde dich mit Discord an, um Sender, Rollen, Statistiken und dein Abo pro Server zu verwalten.', 'Sign in with Discord to manage stations, roles, statistics and your subscription per server.')}</p>
            <a href={buildApiUrl('/api/auth/discord/login')} className="oa-btn primary" style={{ width: '100%', marginTop: 20, background: 'linear-gradient(135deg,#5865f2,#4752c4)', color: '#fff' }} data-testid="guild-discord-login">
              <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z" /></svg>
              {t('Mit Discord anmelden', 'Continue with Discord')}
            </a>
            <button onClick={startDemo} className="oa-btn ghost" style={{ width: '100%', marginTop: 12 }} data-testid="guild-demo-button"><Play size={15} /> {t('Live-Demo ansehen', 'View live demo')}</button>
            <div style={{ marginTop: 16, textAlign: 'center' }}><a href="/" className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>← {t('Zurück zur Website', 'Back to website')}</a></div>
          </div>
        </div>
      </div>
    );
  }

  const trendData = (gdata.trend || []).map((v, i) => ({ day: (en ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])[i] || `T${i}`, listeners: v }));
  const topData = (gdata.top || []).map(([name, min]) => ({ name, minutes: min }));

  return (
    <div className="oa-root" data-testid="guild-dashboard">
      <aside className="oa-sidebar">
        <div className="oa-brand">
          <div className="oa-brand-logo"><Radio size={20} /></div>
          <div><div className="oa-display" style={{ fontSize: 18, fontWeight: 800 }}>OmniFM</div><div className="oa-owner-badge">Server Dashboard</div></div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {NAV.map((n) => (
            <button key={n.id} className={`oa-nav-btn ${section === n.id ? 'active' : ''}`} onClick={() => { setSection(n.id); setMsg(null); }} data-testid={`guild-nav-${n.id}`}>
              <n.icon size={18} /> {navLabel(n.id)}
            </button>
          ))}
        </nav>
        <a href={demo ? '#' : '/dashboard/classic'} onClick={demo ? (e) => e.preventDefault() : undefined} className="oa-nav-btn" style={{ opacity: demo ? 0.5 : 1, fontSize: 12.5 }}><Server size={16} /> {t('Klassische Ansicht', 'Classic view')}</a>
        <a href="/" className="oa-nav-btn" style={{ color: '#ff8fab' }} data-testid="guild-logout"><LogOut size={18} /> {t('Verlassen', 'Leave')}</a>
      </aside>

      <main className="oa-main">
        <div className="oa-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <h1 className="oa-h1 oa-display" data-testid="guild-section-title">{navLabel(section)}</h1>
              <div className="oa-sub">{guild?.name} · {fmtInt(guild?.members)} {t('Mitglieder', 'members')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {demo && <span className="oa-pill amber" style={{ whiteSpace: 'nowrap' }} data-testid="guild-demo-badge">{t('DEMO-MODUS', 'DEMO MODE')}</span>}
            <span className="oa-pill" style={{ background: `${tm.color}22`, color: tm.color, border: `1px solid ${tm.color}55` }}><tm.icon size={13} /> {tm.name}</span>
            <select className="oa-input" style={{ height: 40, width: 'auto', maxWidth: 220 }} value={guildId} onChange={(e) => { setGuildId(e.target.value); setMsg(null); }} data-testid="guild-switcher">
              {session.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <div className="oa-mobile-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`oa-nav-btn ${section === n.id ? 'active' : ''}`} style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={() => { setSection(n.id); setMsg(null); }} data-testid={`guild-mobile-nav-${n.id}`}>
              <n.icon size={16} /> {navLabel(n.id)}
            </button>
          ))}
        </div>

        {msg && <div className={`oa-pill ${msg.ok ? 'green' : 'red'}`} style={{ marginBottom: 16 }} data-testid="guild-message">{msg.ok ? <Check size={13} /> : null} {msg.text}</div>}

        {section === 'overview' && (
          <>
            <div className="oa-grid cols-4">
              <StatTile label={t('Aktive Hörer', 'Active listeners')} value={fmtInt(gdata.listeners)} icon={Users} accent="#ff6b00" foot={<span>{t('gerade im Voice-Channel', 'in voice right now')}</span>} />
              <StatTile label="Uptime" value={`${gdata.uptimePct}%`} icon={Clock} accent="#10b981" foot={<span>{t('letzte 30 Tage', 'last 30 days')}</span>} />
              <StatTile label={t('Gestreamt (Monat)', 'Streamed (month)')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#00e5ff" foot={<span>{t('Wiedergabezeit', 'playback time')}</span>} />
              <StatTile label={t('Aktive Bots', 'Active bots')} value={gdata.activeWorkers} icon={Server} accent="#5865f2" foot={<span>{t(`${tm.name}-Kontingent`, `${tm.name} quota`)}</span>} />
            </div>
            <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
              <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }}>
                <div className="oa-stat-label" style={{ marginBottom: 14 }}>{t('Hörer-Trend (7 Tage)', 'Listener trend (7 days)')}</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="gdArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} /><stop offset="100%" stopColor="#ff6b00" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="listeners" name="Hörer" stroke="#ff6b00" strokeWidth={2.5} fill="url(#gdArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="oa-card oa-fade">
                <div className="oa-stat-label" style={{ marginBottom: 12 }}>{t('Aktueller Sender', 'Current station')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 12, background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', display: 'grid', placeItems: 'center' }}><Radio size={24} color="#fff" /></div>
                  <div><div style={{ fontWeight: 700, fontSize: 16 }}>{(PRESET_STATIONS.find((s) => s.key === gdata.defaultStation) || {}).name || gdata.defaultStation}</div>
                    <div className="oa-pill orange" style={{ marginTop: 6 }}><span className="oa-dot" /> ON AIR</div></div>
                </div>
                <button className="oa-btn ghost" style={{ width: '100%', marginTop: 16 }} onClick={() => setSection('stations')}><ListMusic size={15} /> {t('Sender wechseln', 'Change station')}</button>
              </div>
            </div>
          </>
        )}

        {section === 'stations' && (
          <>
            <div className="oa-section-title"><Radio size={15} /> {t('Standard-Sender', 'Default stations')}</div>
            <div className="oa-grid cols-3" data-testid="guild-preset-stations">
              {PRESET_STATIONS.map((s) => {
                const active = gdata.defaultStation === s.key;
                return (
                  <button key={s.key} className="oa-card hoverable" style={{ textAlign: 'left', cursor: 'pointer', borderColor: active ? 'rgba(255,107,0,0.6)' : undefined, background: active ? 'rgba(255,107,0,0.08)' : undefined }} onClick={() => setDefaultStation(s.key)} data-testid={`guild-station-${s.key}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, background: active ? 'linear-gradient(135deg,#ff6b00,#ff2a5f)' : '#1c2235', display: 'grid', placeItems: 'center' }}><Music2 size={17} color={active ? '#fff' : '#94a3b8'} /></div>
                        <div><div style={{ fontWeight: 700 }}>{s.name}</div><div className="oa-mono" style={{ fontSize: 11, color: '#64748b' }}>{s.genre}</div></div>
                      </div>
                      {active && <Check size={18} color="#ff6b00" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '28px 0 12px' }}>
              <div className="oa-section-title" style={{ margin: 0 }}><ListMusic size={15} /> {t('Eigene Sender', 'Custom stations')} ({gdata.custom.length}/{tm.customLimit === 999 ? '∞' : tm.customLimit})</div>
            </div>

            {tm.customLimit === 0 ? (
              <div className="oa-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }} data-testid="guild-custom-locked">
                <Lock size={22} color="#94a3b8" />
                <div><div style={{ fontWeight: 700 }}>{t('Eigene Sender sind ein Pro-Feature', 'Custom stations are a Pro feature')}</div><div style={{ color: '#94a3b8', fontSize: 13 }}>{t('Upgrade auf Pro oder Ultimate, um eigene Stream-URLs hinzuzufügen.', 'Upgrade to Pro or Ultimate to add your own stream URLs.')}</div></div>
                <button className="oa-btn primary" style={{ marginLeft: 'auto' }} onClick={() => setSection('subscription')}>Upgrade</button>
              </div>
            ) : (
              <>
                <div className="oa-card" style={{ marginBottom: 16 }} data-testid="guild-custom-form">
                  <div className="oa-grid cols-2" style={{ gap: 12 }}>
                    <div><label className="oa-stat-label">Name</label><input className="oa-input" style={{ marginTop: 6, fontFamily: 'DM Sans' }} value={newStation.name} placeholder={t('z.B. Server Chill', 'e.g. Server Chill')} onChange={(e) => setNewStation({ ...newStation, name: e.target.value })} data-testid="guild-custom-name" /></div>
                    <div><label className="oa-stat-label">Stream-URL</label><input className="oa-input" style={{ marginTop: 6 }} value={newStation.url} placeholder="https://…/stream.mp3" onChange={(e) => setNewStation({ ...newStation, url: e.target.value })} data-testid="guild-custom-url" /></div>
                  </div>
                  <button className="oa-btn primary" style={{ marginTop: 14 }} onClick={addCustom} data-testid="guild-custom-add"><Plus size={16} /> {t('Hinzufügen', 'Add')}</button>
                </div>
                <div className="oa-table-wrap" data-testid="guild-custom-list">
                  <table className="oa-table">
                    <thead><tr><th>Name</th><th>Stream-URL</th><th style={{ textAlign: 'right' }}></th></tr></thead>
                    <tbody>
                      {gdata.custom.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#64748b', padding: 22 }}>{t('Noch keine eigenen Sender', 'No custom stations yet')}</td></tr>}
                      {gdata.custom.map((c) => (
                        <tr key={c.key} data-testid={`guild-custom-row-${c.key}`}>
                          <td style={{ fontWeight: 600 }}>{c.name}</td>
                          <td className="oa-mono" style={{ fontSize: 12, color: '#94a3b8', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.url}</td>
                          <td style={{ textAlign: 'right' }}><button className="oa-btn ghost" style={{ height: 32, padding: '0 9px', color: '#ff8fab' }} onClick={() => removeCustom(c.key)} data-testid={`guild-custom-remove-${c.key}`}><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {section === 'roles' && (
          <>
            <div className="oa-section-title"><ShieldCheck size={15} /> {t('Command-Berechtigungen', 'Command permissions')}</div>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16, marginTop: -6 }}>{t('Lege fest, welche Rolle welche Slash-Commands nutzen darf.', 'Define which role may use which slash commands.')}</p>
            <div className="oa-table-wrap" data-testid="guild-perms-matrix">
              <table className="oa-table">
                <thead><tr><th>Command</th>{gdata.roles.map((r) => <th key={r.id} style={{ textAlign: 'center' }}><span style={{ color: r.color }}>{r.name}</span></th>)}</tr></thead>
                <tbody>
                  {COMMANDS.map((c) => (
                    <tr key={c.id}>
                      <td className="oa-mono" style={{ color: '#ffb27a' }}>{c.label}</td>
                      {gdata.roles.map((r) => {
                        const on = !!perms[`${c.id}:${r.id}`];
                        return (
                          <td key={r.id} style={{ textAlign: 'center' }}>
                            <button onClick={() => togglePerm(c.id, r.id)} data-testid={`guild-perm-${c.id}-${r.id}`} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? 'linear-gradient(90deg,#ff6b00,#ff2a5f)' : '#2a3450', position: 'relative', transition: 'background 0.2s' }}>
                              <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="oa-btn primary" style={{ marginTop: 16 }} onClick={savePerms} data-testid="guild-perms-save"><Check size={16} /> {t('Speichern', 'Save')}</button>
          </>
        )}

        {section === 'stats' && (
          <>
            <div className="oa-grid cols-3">
              <StatTile label={t('Ø Hörer / Tag', 'Avg. listeners / day')} value={fmtInt(Math.round((gdata.trend.reduce((a, b) => a + b, 0)) / Math.max(1, gdata.trend.length)))} icon={Users} accent="#ff6b00" />
              <StatTile label={t('Peak Hörer', 'Peak listeners')} value={fmtInt(Math.max(0, ...gdata.trend))} icon={BarChart3} accent="#00e5ff" />
              <StatTile label={t('Gestreamt (Monat)', 'Streamed (month)')} value={fmtMinutes(gdata.minutesMonth)} icon={Music2} accent="#10b981" />
            </div>
            <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="guild-top-stations">
              <div className="oa-stat-label" style={{ marginBottom: 14 }}>{t('Top-Sender nach Wiedergabezeit (Minuten)', 'Top stations by playback time (minutes)')}</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topData} layout="vertical" margin={{ top: 4, right: 16, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={130} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="minutes" name="Minuten" radius={[0, 6, 6, 0]}>
                    {topData.map((_, i) => <Cell key={i} fill={['#ff6b00', '#00e5ff', '#5865f2', '#10b981'][i % 4]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {section === 'subscription' && (
          <div className="oa-grid cols-3" data-testid="guild-subscription">
            {Object.entries(TIER_META).map(([key, meta]) => {
              const current = key === tier;
              return (
                <div className="oa-card oa-fade" key={key} style={{ borderColor: current ? `${meta.color}66` : undefined, position: 'relative' }} data-testid={`guild-plan-${key}`}>
                  {current && <span className="oa-pill" style={{ position: 'absolute', top: 16, right: 16, background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}>{t('Aktiv', 'Active')}</span>}
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `${meta.color}1f`, color: meta.color, display: 'grid', placeItems: 'center', marginBottom: 14 }}><meta.icon size={22} /></div>
                  <div className="oa-display" style={{ fontSize: 22, fontWeight: 800 }}>{meta.name}</div>
                  <div style={{ margin: '10px 0 16px' }}>
                    {[
                      key === 'free' ? t('1 Bot · Standard-Sender', '1 bot · default stations') : key === 'pro' ? t('2 Bots · 5 eigene Sender', '2 bots · 5 custom stations') : t('Bis 5 Bots · ∞ eigene Sender', 'Up to 5 bots · ∞ custom stations'),
                      key === 'free' ? t('64 kbps Qualität', '64 kbps quality') : key === 'pro' ? t('256 kbps Qualität', '256 kbps quality') : t('320 kbps HiFi', '320 kbps HiFi'),
                      key === 'free' ? t('Basis-Statistiken', 'Basic statistics') : t('Erweiterte Statistiken', 'Advanced statistics'),
                      key === 'ultimate' ? t('Priorisierter Support', 'Priority support') : t('Community-Support', 'Community support'),
                    ].map((f, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#cbd5e1', marginBottom: 8 }}><Check size={14} color={meta.color} /> {f}</div>)}
                  </div>
                  {current ? <button className="oa-btn ghost" style={{ width: '100%' }} disabled>{t('Aktueller Plan', 'Current plan')}</button>
                    : <a className="oa-btn primary" style={{ width: '100%', textDecoration: 'none' }} href="/#pricing" data-testid={`guild-upgrade-${key}`}><ChevronRight size={15} /> {key === 'free' ? 'Downgrade' : 'Upgrade'}</a>}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
