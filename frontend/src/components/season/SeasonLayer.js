import { Suspense, lazy } from 'react';
import { useI18n } from '../../i18n.js';
import { useWebsiteSeason } from '../../lib/seasonSite.js';

// The decoration itself is its own download, only in a season (#427).
const SeasonDecor = lazy(() => import('./SeasonDecor.js'));

// The start page's seasonal decoration (#427). Outside a season it renders
// nothing and loads nothing; hidden, it leaves a button to bring it back.
export default function SeasonLayer() {
  const { t } = useI18n();
  const { season, hidden, setHidden, reducedMotion } = useWebsiteSeason(true);
  if (!season) return null;
  if (hidden) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 24px 28px' }}>
        <button
          type="button"
          data-testid="season-show"
          onClick={() => setHidden(false)}
          style={{ height: 34, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: '#D4D4D8', fontSize: 13, cursor: 'pointer' }}
        >
          ✨ {t('Saison-Deko einblenden', 'Show the seasonal decoration')}
        </button>
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <SeasonDecor season={season} reducedMotion={reducedMotion} onHide={() => setHidden(true)} />
    </Suspense>
  );
}
