import { Suspense, lazy, useState, useEffect, useRef } from 'react';
import Hero from './components/Hero.js';
import TrustBar from './components/TrustBar.js';
import WhyOmniFM from './components/WhyOmniFM.js';
import DashboardPreview from './components/DashboardPreview.js';
import StationBrowser from './components/StationBrowser.js';
import Premium from './components/Premium.js';
import SiteFooter from './components/SiteFooter.js';
import NotFoundPage from './components/NotFoundPage.js';
import Navbar from './components/Navbar.js';
import DiscordShowcase from './components/DiscordShowcase.js';
import HowToDiscord from './components/HowToDiscord.js';
import CommunitySection from './components/CommunitySection.js';
import NowPlayingBar from './components/NowPlayingBar.js';
import FaqSection from './components/FaqSection.js';
import CookieConsent from './components/CookieConsent.js';
import { I18nProvider } from './i18n.js';
import { PlayerProvider } from './lib/player.js';
import { buildApiUrl } from './lib/api.js';
import { getSectionAnchorForPage, resolvePageFromUrl } from './lib/pageRouting.js';
import { startSiteData } from './lib/siteData.js';
import { fetchAfterFirstPaint } from './lib/firstPaint.js';
import SeasonLayer from './components/season/SeasonLayer.js';

// Loaded only on their own pages (#296): the start page carries neither the
// dashboard nor the owner console, nor the charts both of them draw.
const GuildDashboard = lazy(() => import('./components/GuildDashboard.js'));
const OwnerAdmin = lazy(() => import('./components/OwnerAdmin.js'));
const BrandKit = lazy(() => import('./components/BrandKit.js'));
const ImpressumSection = lazy(() => import('./components/ImpressumSection.js'));
const PrivacySection = lazy(() => import('./components/PrivacySection.js'));
const TermsSection = lazy(() => import('./components/TermsSection.js'));
const StatusPage = lazy(() => import('./components/StatusPage.js'));
const ChartsPage = lazy(() => import('./components/ChartsPage.js'));
const StartGuide = lazy(() => import('./components/StartGuide.js'));
// One live demo alone, for recording clips (#431): /?demo=play
const DemoStage = lazy(() => import('./components/demo/DemoStage.js'));
const DEMO_SCENES = ['commander', 'worker', 'play', 'panel', 'dashboard'];

// What shows for the moment a page's code is on its way.
function PageLoading() {
  return <div data-testid="page-loading" style={{ minHeight: '60vh' }} aria-busy="true" />;
}

async function fetchJson(path, signal) {
  const res = await fetchAfterFirstPaint(buildApiUrl(path), {
    cache: 'no-store',
    signal,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // keep null fallback when response is not JSON
  }

  if (!res.ok) {
    const errorText = data && typeof data.error === 'string'
      ? data.error
      : `HTTP ${res.status}`;
    const error = new Error(`${path}: ${errorText}`);
    // When the server says when to ask again (429), the page waits that long.
    const retryAfter = Number.parseInt(String(res.headers?.get?.('retry-after') || ''), 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }

  return data || {};
}

function AppContent() {
  const [bots, setBots] = useState([]);
  const [stations, setStations] = useState([]);
  const [stats, setStats] = useState({});
  const [legal, setLegal] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [terms, setTerms] = useState(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(loading);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  const currentPage = typeof window === 'undefined'
    ? 'home'
    : resolvePageFromUrl(window.location.href);

  // /preise, /sender, /faq or a #section of the start page (#501): the
  // sections above draw only when they come near, and grow when their data
  // comes. The section stays at the top until the data is there and nothing
  // moved for a second, or the reader scrolls; ten seconds at most.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sectionId = getSectionAnchorForPage(currentPage)
      || (currentPage === 'home' ? decodeURIComponent(window.location.hash.slice(1)) : '');
    if (!sectionId || sectionId === 'top') return undefined;
    let held = true;
    const jump = () => {
      // At once: a smooth scroll (the page's CSS) passes every section on the
      // way, each draws and grows, and the section runs away from it.
      if (held) document.getElementById(sectionId)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const frame = window.requestAnimationFrame(jump);
    const READER_MOVES = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    let quiet = 0;
    let resizes = null;
    const release = () => {
      held = false;
      window.clearTimeout(quiet);
      resizes?.disconnect();
      READER_MOVES.forEach((name) => window.removeEventListener(name, release));
    };
    const settleSoon = () => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => (loadingRef.current ? settleSoon() : release()), 1000);
    };
    const main = document.querySelector('main');
    if (typeof ResizeObserver === 'function' && main) {
      resizes = new ResizeObserver(() => {
        jump();
        settleSoon();
      });
      resizes.observe(main);
    }
    READER_MOVES.forEach((name) => window.addEventListener(name, release, { passive: true }));
    settleSoon();
    const longest = window.setTimeout(release, 10_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(longest);
      release();
    };
  }, [currentPage]);

  // What the page shows, and nothing else (#485): src/lib/siteData.js.
  useEffect(() => {
    const show = {
      bots: (data) => setBots(data?.bots || []),
      stations: (data) => setStations(data?.stations || []),
      stats: (data) => setStats(data || {}),
      legal: (data) => setLegal(data || null),
      privacy: (data) => setPrivacy(data || null),
      terms: (data) => setTerms(data || null),
    };
    return startSiteData(currentPage, {
      fetchJson,
      apply: (name, data) => show[name](data),
      done: () => setLoading(false),
      isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    });
  }, [currentPage]);

  const demoScene = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('demo');
  if (DEMO_SCENES.includes(demoScene)) {
    return (
      <Suspense fallback={<PageLoading />}>
        <DemoStage scene={demoScene} />
      </Suspense>
    );
  }

  if (currentPage === 'not-found') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <NotFoundPage />
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'imprint') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <ImpressumSection legal={legal} standalone />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'privacy') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <PrivacySection legal={legal} privacy={privacy} standalone />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'terms') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <TermsSection legal={legal} terms={terms} />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'status') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <StatusPage />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'charts') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <ChartsPage />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'start') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <main>
          <Suspense fallback={<PageLoading />}>
            <StartGuide bots={bots} />
          </Suspense>
        </main>
        <SiteFooter legal={legal} />
        <CookieConsent />
      </div>
    );
  }

  if (currentPage === 'dashboard') {
    return (
      <div data-testid="app-dashboard-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <Suspense fallback={<PageLoading />}>
          <GuildDashboard />
        </Suspense>
      </div>
    );
  }

  if (currentPage === 'dashboard-classic') {
    return (
      <div data-testid="app-dashboard-classic-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <Suspense fallback={<PageLoading />}>
          <GuildDashboard />
        </Suspense>
      </div>
    );
  }

  if (currentPage === 'dashboard-studio') {
    return (
      <div data-testid="app-dashboard-studio-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <Suspense fallback={<PageLoading />}>
          <GuildDashboard />
        </Suspense>
      </div>
    );
  }

  if (currentPage === 'admin') {
    return (
      <div data-testid="app-admin-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <Suspense fallback={<PageLoading />}>
          <OwnerAdmin />
        </Suspense>
      </div>
    );
  }

  if (currentPage === 'brand') {
    return (
      <div data-testid="app-brand-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <Suspense fallback={<PageLoading />}>
          <BrandKit />
        </Suspense>
      </div>
    );
  }

  return (
    <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
      <div className="noise-overlay" />
      <Navbar page={currentPage} />
      <main>
        <Hero stats={stats} bots={bots} />
        {/* Below the first screen: drawn when it comes near (#501). */}
        <div className="render-later"><TrustBar stats={stats} /></div>
        <div className="render-later"><DiscordShowcase /></div>
        <div className="render-later"><HowToDiscord bots={bots} /></div>
        <div className="render-later"><StationBrowser stations={stations} loading={loading} /></div>
        <div className="render-later"><WhyOmniFM /></div>
        <div className="render-later"><DashboardPreview /></div>
        <div className="render-later"><Premium bots={bots} planContext={{ freeStations: stats.freeStations, allStations: stats.stations }} /></div>
        <div className="render-later"><CommunitySection /></div>
        <div className="render-later"><FaqSection /></div>
      </main>
      <SeasonLayer />
      <SiteFooter legal={legal} />
      <NowPlayingBar bots={bots} />
      <CookieConsent />
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <PlayerProvider>
        <AppContent />
      </PlayerProvider>
    </I18nProvider>
  );
}

export default App;
