// OmniFM: the dashboard's small seasonal touch (#427): a badge in the top bar
// in the season's colour. The website's rules apply: the visitor's clock, the
// owner's main switches, and "Deko ausblenden" hides it here too.
import { useI18n } from '../../i18n.js';
import { useWebsiteSeason } from '../../lib/seasonSite.js';

const COLORS = { easter: '#A3E635', advent: '#22C55E', christmas: '#EF4444', winter: '#7DD3FC', newyear: '#FBBF24' };

export default function SeasonBadge() {
  const { t } = useI18n();
  const { season, hidden } = useWebsiteSeason(true);
  if (!season || hidden) return null;
  let color = COLORS[season.season];
  let label = '';
  if (season.season === 'advent') {
    label = `${'🕯️'.repeat(season.candles)}${'⚪'.repeat(4 - season.candles)} ${t('{count}. Advent', 'Advent, week {count}', { count: season.candles })}`;
  } else if (season.season === 'christmas') {
    if (season.phase === 'greeting') {
      label = `🎄 ${t('Frohe Weihnachten', 'Merry Christmas')}`;
    } else {
      label = '❄️';
      color = COLORS.winter;
    }
  } else if (season.season === 'easter') {
    label = season.phase === 'greeting' ? `🐣 ${t('Frohe Ostern', 'Happy Easter')}` : `🌷 ${t('Bald ist Ostern', 'Easter is coming')}`;
  } else if (season.season === 'newyear') {
    label = season.phase === 'countdown'
      ? `🎆 ${t('Countdown bis {year}', 'Countdown to {year}', { year: season.year })}`
      : `🥂 ${t('Frohes neues Jahr {year}!', 'Happy New Year {year}!', { year: season.year })}`;
  }
  if (!label) return null;
  return (
    <span className="oa-pill" data-testid="dashboard-season-badge" style={{ background: `${color}1f`, color, border: `1px solid ${color}55` }}>
      {label}
    </span>
  );
}
