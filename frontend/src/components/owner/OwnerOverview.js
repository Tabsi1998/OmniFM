// OmniFM: owner console: overview with licenses, revenue, servers and stations.
// Split out of components/OwnerAdmin.js (#296); its state stays there.
import { KeyRound, TrendingUp, Users, Music2 } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  AreaChart,
  Area,
  CartesianGrid,
} from 'recharts';
import OwnerServerRetention from '../OwnerServerRetention.js';
import { ChartTooltip, Equalizer, StatTile, fmtMoney } from './ownerUi.js';

export default function OwnerOverview({ apiGet, mrr, ov, planData, revenueTrend, stationPie, stations }) {
  return (
    <>
      <div className="oa-grid cols-4">
        <StatTile testid="stat-licenses" label="Aktive Lizenzen" value={ov?.licenses?.active ?? '—'} icon={KeyRound} accent="#00e5ff"
          foot={<span><b>{ov?.licenses?.seatsSold ?? 0}</b> Seats verkauft · {ov?.licenses?.expired ?? 0} abgelaufen</span>} />
        <StatTile testid="stat-mrr" label="MRR" value={fmtMoney(mrr)} icon={TrendingUp} accent="#10b981"
          foot={<span className="oa-trend-up"><TrendingUp size={13} /> {fmtMoney(ov?.revenue?.arr)} ARR</span>} />
        <StatTile testid="stat-guilds" label="Verwaltete Server" value={ov?.guilds?.managed ?? '—'} icon={Users} accent="#00e5ff"
          foot={<span>{ov?.bots?.online ?? 0}/{ov?.bots?.configured ?? 0} Bots online{ov?.guilds?.live === false ? ' · Bot offline' : ''}</span>} />
        <StatTile testid="stat-stations" label="Radio-Stationen" value={ov?.stations?.total ?? '—'} icon={Music2} accent="#ff6b00"
          foot={<span>{ov?.stations?.free ?? 0} Free · {ov?.stations?.pro ?? 0} Pro</span>} />
      </div>

      <OwnerServerRetention apiGet={apiGet} />

      <div className="oa-grid cols-3" style={{ marginTop: 18 }}>
        <div className="oa-card oa-fade" style={{ gridColumn: 'span 2' }} data-testid="chart-revenue">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div><div className="oa-stat-label">MRR — aktueller Stand</div><div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{fmtMoney(mrr)} <span style={{ fontSize: 12, color: '#8190a8' }}>/ Monat · keine Historie</span></div></div>
            <Equalizer />
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={revenueTrend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="oaRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff6b00" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#ff6b00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} />
              <XAxis dataKey="month" stroke="#8190a8" fontSize={11} tickLine={false} axisLine={false} tick={false} />
              <YAxis stroke="#8190a8" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="mrr" name="MRR" stroke="#ff6b00" strokeWidth={2.5} fill="url(#oaRev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="oa-card oa-fade" data-testid="chart-stations">
          <div className="oa-stat-label" style={{ marginBottom: 10 }}>Stationen nach Tier</div>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={stationPie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3} stroke="none">
                {stationPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4 }}>
            <span className="oa-mono" style={{ fontSize: 11, color: '#94a3b8' }}><span style={{ color: '#8190a8' }}>●</span> Free {stations?.free ?? 0}</span>
            <span className="oa-mono" style={{ fontSize: 11, color: '#94a3b8' }}><span style={{ color: '#ff6b00' }}>●</span> Pro {stations?.pro ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="oa-grid cols-2" style={{ marginTop: 18 }}>
        <div className="oa-card oa-fade" data-testid="chart-plans">
          <div className="oa-stat-label" style={{ marginBottom: 14 }}>Aktive Lizenzen nach Plan</div>
          {planData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={planData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1b2133" vertical={false} />
                <XAxis dataKey="plan" stroke="#8190a8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="#8190a8" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="count" name="Lizenzen" radius={[6, 6, 0, 0]}>
                  {planData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{ color: '#8190a8', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>Keine aktiven Lizenzen</div>}
        </div>
      </div>
    </>
  );
}
