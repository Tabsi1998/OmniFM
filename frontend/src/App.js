import { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import Hero from './components/Hero.js';
import TrustBar from './components/TrustBar.js';
import WhyOmniFM from './components/WhyOmniFM.js';
import DashboardPreview from './components/DashboardPreview.js';
import StationBrowser from './components/StationBrowser.js';
import Premium from './components/Premium.js';
import SiteFooter from './components/SiteFooter.js';
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
  const res = await fetch(buildApiUrl(path), {
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
    throw new Error(`${path}: ${errorText}`);
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
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const currentPage = typeof window === 'undefined'
    ? 'home'
    : resolvePageFromUrl(window.location.href);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sectionId = getSectionAnchorForPage(currentPage);
    if (!sectionId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage]);

  const fetchData = useCallback(async (signal) => {
    const endpoints = [
      '/api/bots',
      '/api/stations',
      '/api/stats',
      '/api/legal',
      '/api/privacy',
      '/api/terms',
    ];

    const results = await Promise.allSettled(endpoints.map((path) => fetchJson(path, signal)));
    if (!mountedRef.current) return;

    let anyUpdate = false;

    if (results[0].status === 'fulfilled') {
      setBots(results[0].value?.bots || []);
      anyUpdate = true;
    } else if (results[0].reason?.name !== 'AbortError') {
      console.error('Bots API error:', results[0].reason);
    }

    if (results[1].status === 'fulfilled') {
      setStations(results[1].value?.stations || []);
      anyUpdate = true;
    } else if (results[1].reason?.name !== 'AbortError') {
      console.error('Stations API error:', results[1].reason);
    }

    if (results[2].status === 'fulfilled') {
      setStats(results[2].value || {});
      anyUpdate = true;
    } else if (results[2].reason?.name !== 'AbortError') {
      console.error('Stats API error:', results[2].reason);
    }

    if (results[3].status === 'fulfilled') {
      setLegal(results[3].value || null);
      anyUpdate = true;
    } else if (results[3].reason?.name !== 'AbortError') {
      console.error('Legal API error:', results[3].reason);
    }

    if (results[4].status === 'fulfilled') {
      setPrivacy(results[4].value || null);
      anyUpdate = true;
    } else if (results[4].reason?.name !== 'AbortError') {
      console.error('Privacy API error:', results[4].reason);
    }

    if (results[5].status === 'fulfilled') {
      setTerms(results[5].value || null);
      anyUpdate = true;
    } else if (results[5].reason?.name !== 'AbortError') {
      console.error('Terms API error:', results[5].reason);
    }

    const nonAbortFailures = results.filter(
      (result) => result.status === 'rejected' && result.reason?.name !== 'AbortError',
    ).length;

    if (!anyUpdate && nonAbortFailures > 0) {
      console.error('API error: all endpoint requests failed.');
    }

    if (mountedRef.current) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentPage === 'dashboard' || currentPage === 'dashboard-classic' || currentPage === 'dashboard-studio' || currentPage === 'admin' || currentPage === 'brand') {
      setLoading(false);
      return () => {};
    }

    mountedRef.current = true;
    let activeController = null;

    const runFetch = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const controller = new AbortController();
      activeController = controller;
      try {
        await fetchData(controller.signal);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Unhandled fetch loop error:', err);
        }
      } finally {
        inFlightRef.current = false;
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    runFetch();
    const interval = setInterval(runFetch, 15000);

    return () => {
      mountedRef.current = false;
      inFlightRef.current = false;
      clearInterval(interval);
      if (activeController) {
        activeController.abort();
      }
    };
  }, [fetchData, currentPage]);

  const demoScene = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('demo');
  if (DEMO_SCENES.includes(demoScene)) {
    return (
      <Suspense fallback={<PageLoading />}>
        <DemoStage scene={demoScene} />
      </Suspense>
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
        <TrustBar stats={stats} />
        <DiscordShowcase />
        <HowToDiscord bots={bots} />
        <StationBrowser stations={stations} loading={loading} />
        <WhyOmniFM />
        <DashboardPreview />
        <Premium bots={bots} planContext={{ freeStations: stats.freeStations, allStations: stats.stations }} />
        <CommunitySection />
        <FaqSection />
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
