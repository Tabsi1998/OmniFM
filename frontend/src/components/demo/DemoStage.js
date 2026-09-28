// OmniFM: one live demo alone on a dark stage (#431), for recording clips
// with scripts/record-demo-clips.mjs: /?demo=play&lang=de. Drawn 1.5 times
// as big, so a 1280 × 720 video stays sharp. /?demo=dashboard is the tour
// through the dashboard preview (#432), at 1280 × 720 as it is.
import { useI18n } from '../../i18n.js';
import DashboardTour, { TOUR_ROUND_MS } from '../DashboardTour.js';
import DemoScene from './DemoScene.js';

export default function DemoStage({ scene }) {
  const { copy } = useI18n();
  if (scene === 'dashboard') {
    return (
      <div data-testid="demo-stage" style={{ width: 1280, height: 720, overflow: 'hidden', background: '#08090d' }}>
        <div data-testid="demo-dashboard" data-round-ms={TOUR_ROUND_MS}>
          <DashboardTour stage labels={{ ...copy.dashboardPreview, pause: copy.demos.pause, play: copy.demos.play }} />
        </div>
      </div>
    );
  }
  return (
    <div data-testid="demo-stage" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 50% 30%, #1b1c22, #08090d)', overflow: 'hidden' }}>
      <div style={{ width: 560, transform: 'scale(1.5)', transformOrigin: 'center' }}>
        <DemoScene scene={scene} size="large" />
      </div>
    </div>
  );
}
