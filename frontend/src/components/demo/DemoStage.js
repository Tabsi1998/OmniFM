// OmniFM: one live demo alone on a dark stage (#431), for recording clips
// with scripts/record-demo-clips.mjs: /?demo=play&lang=de. Drawn 1.5 times
// as big, so a 1280 × 720 video stays sharp.
import DemoScene from './DemoScene.js';

export default function DemoStage({ scene }) {
  return (
    <div data-testid="demo-stage" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 50% 30%, #1b1c22, #08090d)', overflow: 'hidden' }}>
      <div style={{ width: 560, transform: 'scale(1.5)', transformOrigin: 'center' }}>
        <DemoScene scene={scene} size="large" />
      </div>
    </div>
  );
}
