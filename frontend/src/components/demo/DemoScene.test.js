import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import { loadLanguage } from '../../i18n/languages.js';
import DemoScene from './DemoScene.js';
import LiveDemo, { CAPTION_HEIGHT, sceneHeight } from './LiveDemo.js';
import { TIMELINES } from './timelines.js';
import demo from './demoMessages.json';

// The live demos of the first steps in Discord (#431): they play through,
// end with the bot's real messages, stand still for "less motion", pause on
// request and speak the visitor's language.

function inLanguage(code) {
  window.history.replaceState({}, '', `/?lang=${code}`);
}

function scene(name, size = 'small') {
  return render(<I18nProvider><DemoScene scene={name} size={size} /></I18nProvider>);
}

// Lets the clock run through every step of a scene once.
function playThrough(name) {
  for (const step of TIMELINES[name]) {
    act(() => { vi.advanceTimersByTime(step.ms); });
  }
}

beforeAll(() => loadLanguage('fr'));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.matchMedia;
  window.history.replaceState({}, '', '/');
});

describe('live demos', () => {
  it('/play lofi: the member joins, types, picks a station, and the bot’s real panel appears', () => {
    vi.useFakeTimers();
    inLanguage('de');
    const { container } = scene('play');
    const figure = screen.getByTestId('demo-play');
    expect(figure.getAttribute('aria-label')).toBe('Demo: mit /play lofi das Radio starten');
    for (let index = 0; index < TIMELINES.play.length - 1; index += 1) {
      act(() => { vi.advanceTimersByTime(TIMELINES.play[index].ms); });
    }
    expect(figure.getAttribute('data-step')).toBe(String(TIMELINES.play.length - 1));
    const panel = screen.getByTestId('discord-message-preview');
    expect(panel.textContent).toContain('Rainy Window');
    expect(panel.textContent).toContain('Lofi Café');
    expect(container.textContent).toContain('Alex hat /play verwendet');
    expect(container.querySelector('li[data-active="true"]').textContent).toContain('Radio läuft');
  });

  it('the panel is clicked through: pause, play on, a favourite; it starts over after the last step', () => {
    vi.useFakeTimers();
    inLanguage('de');
    scene('panel', 'large');
    const text = () => screen.getByTestId('discord-message-preview').textContent;
    expect(text()).toContain('Rainy Window');
    for (let index = 0; index < 3; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.panel[index].ms); });
    expect(screen.getByTestId('preview-button-np:toggle').textContent).toContain('Weiter');
    for (let index = 3; index < 9; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.panel[index].ms); });
    expect(text()).toContain('Sunset Drive');
    act(() => { vi.advanceTimersByTime(TIMELINES.panel[9].ms); });
    expect(screen.getByTestId('demo-panel').getAttribute('data-step')).toBe('0');
  });

  it('/invite shows the bot’s real answer, and the commander scene ends authorised', () => {
    vi.useFakeTimers();
    inLanguage('de');
    const { container } = scene('worker');
    playThrough('worker');
    for (let index = 0; index < TIMELINES.worker.length - 1; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.worker[index].ms); });
    expect(container.textContent).toContain(demo.invite.de.embeds[0].title);
    expect(container.textContent).toContain('Invite OmniFM 1');
    expect(container.textContent).toContain('OmniFM 1 ist jetzt auf OmniFM Demo');
    cleanup();

    scene('commander');
    for (let index = 0; index < TIMELINES.commander.length - 1; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.commander[index].ms); });
    expect(screen.getByTestId('demo-commander').textContent).toContain('Autorisiert');
  });

  it('less motion: a still of the last step, every step written out, no clock and no pause button', () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: true }));
    inLanguage('de');
    scene('commander');
    const figure = screen.getByTestId('demo-commander');
    expect(figure.getAttribute('data-still')).toBe('true');
    expect(figure.textContent).toContain('Autorisiert');
    expect(figure.querySelectorAll('li[data-active="true"]')).toHaveLength(3);
    expect(screen.queryByTestId('demo-commander-toggle')).toBeNull();
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(figure.getAttribute('data-step')).toBe(String(TIMELINES.commander.length - 1));
  });

  it('the pause button stops the demo and starts it again', () => {
    vi.useFakeTimers();
    inLanguage('de');
    scene('worker');
    const toggle = screen.getByTestId('demo-worker-toggle');
    expect(toggle.getAttribute('aria-label')).toBe('Demo anhalten');
    fireEvent.click(toggle);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('demo-worker').getAttribute('data-step')).toBe('0');
    expect(toggle.getAttribute('aria-label')).toBe('Demo abspielen');
    fireEvent.click(toggle);
    act(() => { vi.advanceTimersByTime(TIMELINES.worker[0].ms); });
    expect(screen.getByTestId('demo-worker').getAttribute('data-step')).toBe('1');
  });

  it('in French: Discord’s words in French, the command description as Discord shows it, the bot in English', () => {
    vi.useFakeTimers();
    inLanguage('fr');
    const { container } = scene('play');
    expect(container.textContent).toContain('Envoyer un message dans #radio');
    for (let index = 0; index < 3; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.play[index].ms); });
    expect(container.textContent).toContain(demo.commands.fr.play);
    for (let index = 3; index < TIMELINES.play.length - 1; index += 1) act(() => { vi.advanceTimersByTime(TIMELINES.play[index].ms); });
    expect(container.textContent).toContain('Alex a utilisé /play');
    expect(screen.getByTestId('preview-button-np:toggle').textContent).toContain('Pause');
    expect(screen.getByTestId('discord-message-preview').textContent).toMatch(/Earlier|Now playing|Playing/);
  });

  it('on the start page a demo loads only near the screen, in a frame of the same height meanwhile', () => {
    let seen;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback) { seen = callback; }
      observe() {}
      disconnect() {}
    });
    render(<I18nProvider><LiveDemo scene="panel" size="large" /></I18nProvider>);
    const holder = screen.getByTestId('live-demo-panel');
    expect(holder.firstChild.style.height).toBe(`${sceneHeight('panel', 'large') + CAPTION_HEIGHT + 10}px`);
    expect(screen.queryByTestId('demo-panel')).toBeNull();
    act(() => { seen([{ isIntersecting: true }]); });
    vi.unstubAllGlobals();
  });
});
