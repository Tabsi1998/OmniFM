import React, { useState, useEffect, useCallback, useRef } from 'react';
import Hero from './components/Hero.js';
import Features from './components/Features.js';
import TrustBar from './components/TrustBar.js';
import WhyOmniFM from './components/WhyOmniFM.js';
import DashboardShowcase from './components/DashboardShowcase.js';
import StationBrowser from './components/StationBrowser.js';
import UseCasesSection from './components/UseCasesSection.js';
import Premium from './components/Premium.js';
import ImpressumSection from './components/ImpressumSection.js';
import PrivacySection from './components/PrivacySection.js';
import TermsSection from './components/TermsSection.js';
import StatsFooter from './components/StatsFooter.js';
import Navbar from './components/Navbar.js';
import PlanMatrix from './components/PlanMatrix.js';
import DashboardPortal from './components/DashboardPortal.js';
import FaqSection from './components/FaqSection.js';
import { I18nProvider } from './i18n.js';
import { buildApiUrl } from './lib/api.js';
import { resolvePageFromUrl } from './lib/pageRouting.js';

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
    if (currentPage === 'dashboard') {
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
  }, [fetchData]);

  if (currentPage === 'imprint') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <ImpressumSection legal={legal} standalone />
        <StatsFooter stats={stats} bots={bots} legal={legal} />
      </div>
    );
  }

  if (currentPage === 'privacy') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <PrivacySection legal={legal} privacy={privacy} standalone />
        <StatsFooter stats={stats} bots={bots} legal={legal} />
      </div>
    );
  }

  if (currentPage === 'terms') {
    return (
      <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <div className="noise-overlay" />
        <Navbar page={currentPage} />
        <TermsSection legal={legal} terms={terms} />
        <StatsFooter stats={stats} bots={bots} legal={legal} />
      </div>
    );
  }

  if (currentPage === 'dashboard') {
    return (
      <div data-testid="app-dashboard-root" style={{ position: 'relative', minHeight: '100vh' }}>
        <DashboardPortal />
      </div>
    );
  }

  return (
    <div data-testid="app-root" style={{ position: 'relative', minHeight: '100vh' }}>
      <div className="noise-overlay" />
      <Navbar page={currentPage} />
      <Hero stats={stats} bots={bots} />
      <TrustBar stats={stats} />
      <Features />
      <WhyOmniFM />
      <StationBrowser stations={stations} loading={loading} />
      <DashboardShowcase />
      <UseCasesSection />
      <Premium bots={bots} />
      <PlanMatrix />
      <FaqSection />
      <StatsFooter stats={stats} bots={bots} legal={legal} />
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

export default App;
