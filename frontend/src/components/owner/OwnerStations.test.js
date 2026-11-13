import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OwnerStations from './OwnerStations.js';

// #538: the cockpit keeps "the server answers" and "plays in Discord" apart.

afterEach(cleanup);

const noop = () => {};
const station = (key) => ({ key, name: key, url: `https://stream.example.com/${key}`, tier: 'free', genre: 'Pop' });

function setup(stHealth) {
  render(
    <OwnerStations
      checkStationHealth={noop}
      closeStationForm={noop}
      deleteStation={noop}
      openEditStation={noop}
      openNewStation={noop}
      saveStation={noop}
      setStForm={noop}
      setStMsg={noop}
      setStTest={noop}
      stBusy={false}
      stForm={null}
      stHealth={stHealth}
      stHealthBusy={false}
      stHealthProg={null}
      stHealthSummary={null}
      stMsg={null}
      stTest={null}
      stationList={Object.keys(stHealth).map(station)}
      stations={{ total: 0, free: 0, pro: 0 }}
      suggestColorFromLogo={noop}
      testStationUrl={noop}
    />,
  );
  return (key) => screen.getByTestId(`station-status-${key}`);
}

describe('station cockpit: live status', () => {
  it('tells playable, answering without audio, locked and offline apart', () => {
    const status = setup({
      plays: { ok: true, reachable: true, authorized: true, playableAudio: true, discordOk: true, latencyMs: 80, browserOk: true },
      page: { ok: false, reachable: true, authorized: true, playableAudio: false, discordOk: false, format: 'html', error: 'Kein Audio (HTML-Seite)' },
      locked: { ok: false, reachable: true, authorized: false, playableAudio: false, discordOk: false, status: 401, error: 'HTTP 401 (Zugriff verweigert)' },
      gone: { ok: false, reachable: false, authorized: null, playableAudio: false, discordOk: false, error: 'Timeout nach 5000 ms' },
    });

    expect(status('plays').textContent).toContain('Discord · 80ms');
    expect(status('plays').textContent).toContain('Browser');

    expect(status('page').textContent).toContain('Antwortet · kein Audio');
    expect(status('page').textContent).not.toContain('Discord');
    expect(status('page').querySelector('[title]').getAttribute('title')).toContain('Kein Audio (HTML-Seite)');

    expect(status('locked').textContent).toContain('Antwortet · Zugriff verweigert');
    expect(status('locked').textContent).not.toContain('Discord');
    expect(status('locked').querySelector('[title]').getAttribute('title')).toContain('HTTP 401');

    expect(status('gone').textContent).toContain('Offline');
  });

  it('explains the difference in the legend', () => {
    setup({});
    expect(screen.getByTestId('station-status-legend').textContent).toContain('Antwortet = Server antwortet, aber in Discord nicht spielbar');
  });
});
