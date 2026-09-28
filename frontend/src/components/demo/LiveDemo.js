// OmniFM: a live demo on the start page (#431). The scenes are their own
// download, loaded when the demo comes near the screen; until then a quiet
// frame of the same size, so the first visit loads nothing extra and the
// page does not jump.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const DemoScene = lazy(() => import('./DemoScene.js'));

/** The steps under a scene: room for two lines, so the frame before loading has the same height. */
export const CAPTION_HEIGHT = 44;

/** The window's height of a scene; the steps below add CAPTION_HEIGHT and a 10 px gap. */
export function sceneHeight(scene, size = 'small') {
  const large = size === 'large';
  return { commander: 300, worker: large ? 420 : 340, play: large ? 440 : 360, panel: large ? 460 : 380 }[scene] || 320;
}

export default function LiveDemo({ scene, size = 'small' }) {
  const ref = useRef(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function');

  useEffect(() => {
    const element = ref.current;
    if (near || !element) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const frame = <div aria-hidden="true" style={{ height: sceneHeight(scene, size) + CAPTION_HEIGHT + 10, borderRadius: 12, background: '#1f2023', border: '1px solid #1a1b1e' }} />;
  return (
    <div ref={ref} data-testid={`live-demo-${scene}`}>
      {near ? <Suspense fallback={frame}><DemoScene scene={scene} size={size} /></Suspense> : frame}
    </div>
  );
}
