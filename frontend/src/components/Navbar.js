import React, { useEffect, useState } from 'react';
import { Globe, Menu, Radio, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildHomeHref, buildPageHref } from '../lib/pageRouting.js';

const DISCORD_URL = 'https://discord.gg/UeRkfGS43R';

function Navbar({ page = 'home' }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { copy, locale, localeMeta, toggleLocale } = useI18n();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = copy.navbar.links;
  const homeHref = buildHomeHref(locale, '#top');
  const dashboardHref = buildPageHref(locale, 'dashboard');
  const resolveNavHref = (link) => {
    if (link.page) return buildPageHref(locale, link.page);
    return page === 'home' ? link.href : buildHomeHref(locale, link.href);
  };

  return (
    <nav
      data-testid="navbar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: scrolled ? 'rgba(5, 5, 5, 0.88)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        transition: 'background 0.3s, border-color 0.3s, backdrop-filter 0.3s',
      }}
    >
      <a
        href={page === 'home' ? '#top' : homeHref}
        data-testid="nav-logo"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
          color: '#fff',
        }}
      >
        <Radio size={22} color="#00F0FF" />
        <span
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.05em',
          }}
        >
          OMNI<span style={{ color: '#00F0FF' }}>FM</span>
        </span>
      </a>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
        className="nav-desktop"
      >
        {navLinks.map((link) => (
          <a
            key={link.key}
            href={resolveNavHref(link)}
            data-testid={`nav-link-${link.key}`}
            style={{
              color: '#A1A1AA',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: '0.02em',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = '#A1A1AA';
            }}
          >
            {link.label}
          </a>
        ))}

        <a
          href={dashboardHref}
          data-testid="nav-dashboard-link"
          style={{
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            border: '1px solid rgba(88, 101, 242, 0.45)',
            background: 'rgba(88, 101, 242, 0.16)',
            padding: '8px 12px',
          }}
        >
          DASHBOARD
        </a>

        <button
          type="button"
          data-testid="nav-language-toggle"
          onClick={toggleLocale}
          title={localeMeta.switchTitle}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.04)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'border-color 0.2s, background 0.2s',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderColor = 'rgba(0,240,255,0.4)';
            event.currentTarget.style.background = 'rgba(0,240,255,0.08)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          }}
        >
          <Globe size={14} color="#00F0FF" />
          {localeMeta.label} / {localeMeta.switchLabel}
        </button>

        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="nav-discord-link"
          title={copy.navbar.discord}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'rgba(88, 101, 242, 0.12)',
            border: '1px solid rgba(88, 101, 242, 0.25)',
            color: '#5865F2',
            transition: 'background 0.2s, transform 0.15s',
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'rgba(88, 101, 242, 0.25)';
            event.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'rgba(88, 101, 242, 0.12)';
            event.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z" /></svg>
        </a>
      </div>

      <button
        data-testid="nav-mobile-toggle"
        onClick={() => setOpen((current) => !current)}
        style={{
          display: 'none',
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: 4,
        }}
        className="nav-mobile-btn"
      >
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>

      {open && (
        <div
          data-testid="nav-mobile-menu"
          style={{
            position: 'fixed',
            top: 64,
            left: 0,
            right: 0,
            background: 'rgba(5, 5, 5, 0.95)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {navLinks.map((link) => (
            <a
              key={link.key}
              href={resolveNavHref(link)}
              onClick={() => setOpen(false)}
              style={{
                color: '#A1A1AA',
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {link.label}
            </a>
          ))}

          <a
            href={dashboardHref}
            data-testid="nav-mobile-dashboard-link"
            onClick={() => setOpen(false)}
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: 16,
              fontWeight: 700,
              border: '1px solid rgba(88, 101, 242, 0.45)',
              background: 'rgba(88, 101, 242, 0.16)',
              padding: '10px 12px',
            }}
          >
            Dashboard
          </a>

          <button
            type="button"
            onClick={() => {
              toggleLocale();
              setOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 0,
              border: 'none',
              background: 'none',
              color: '#fff',
              textAlign: 'left',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Globe size={16} color="#00F0FF" />
            {copy.navbar.language}: {localeMeta.switchLabel}
          </button>

          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#5865F2',
              textDecoration: 'none',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z" /></svg>
            {copy.navbar.discord}
          </a>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-btn { display: block !important; }
        }
      `}</style>
    </nav>
  );
}

export default Navbar;
