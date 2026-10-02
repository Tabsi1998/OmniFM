import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider, useI18n } from '../i18n.js';
import { LanguageLinks, LanguageMenu, LanguageSelect } from './LanguageMenu.js';

// The visitor picks the website's language (#497).

function Shown() {
  const { locale } = useI18n();
  return <span data-testid="locale">{locale}</span>;
}

function renderInGerman(ui) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de']);
  return render(<I18nProvider>{ui}<Shown /></I18nProvider>);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('the language menu in the header', () => {
  it('lists the nine languages in their own names, as real addresses', () => {
    renderInGerman(<LanguageMenu />);
    const button = screen.getByTestId('language-menu-button');
    expect(button.getAttribute('aria-label')).toBe('Sprache: Deutsch');
    expect(button.textContent).toBe('DE');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const options = within(screen.getByTestId('language-menu-list')).getAllByRole('link');
    expect(options.map((option) => option.textContent)).toEqual([
      'Deutsch', 'English', 'Français', 'Español', 'Italiano', 'Polski', 'Türkçe', 'Português (Brasil)', 'Nederlands',
    ]);
    const french = screen.getByTestId('language-option-fr');
    expect(french.getAttribute('lang')).toBe('fr');
    expect(french.getAttribute('hreflang')).toBe('fr');
    expect(new URL(french.getAttribute('href'), window.location.origin).searchParams.get('lang')).toBe('fr');
    expect(screen.getByTestId('language-option-pt').getAttribute('lang')).toBe('pt-BR');
    expect(screen.getByTestId('language-option-de').getAttribute('aria-current')).toBe('true');
    expect(french.getAttribute('aria-current')).toBeNull();
  });

  it('switches at once, remembers the choice and writes it into the address', () => {
    renderInGerman(<LanguageMenu />);
    fireEvent.click(screen.getByTestId('language-menu-button'));
    fireEvent.click(screen.getByTestId('language-option-fr'));
    expect(screen.getByTestId('locale').textContent).toBe('fr');
    expect(window.localStorage.getItem('omnifm.web.locale')).toBe('fr');
    expect(new URL(window.location.href).searchParams.get('lang')).toBe('fr');
    expect(screen.queryByTestId('language-menu-list')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('language-menu-button'));
  });

  it('closes with Escape or a click elsewhere and gives the focus back', () => {
    renderInGerman(<LanguageMenu />);
    const button = screen.getByTestId('language-menu-button');
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('language-menu-list')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('language-menu-list')).toBeNull();
  });

  it('leaves a click for a new tab to the browser', () => {
    renderInGerman(<LanguageMenu />);
    // jsdom does not open tabs; the page must not switch either.
    const stop = (event) => event.preventDefault();
    document.addEventListener('click', stop);
    fireEvent.click(screen.getByTestId('language-menu-button'));
    fireEvent.click(screen.getByTestId('language-option-fr'), { ctrlKey: true });
    document.removeEventListener('click', stop);
    expect(screen.getByTestId('locale').textContent).toBe('de');
    expect(window.localStorage.getItem('omnifm.web.locale')).toBeNull();
  });
});

describe('the language links and the dashboard list', () => {
  it('the links of the footer and the phone menu switch and mark the current one', () => {
    const picked = vi.fn();
    renderInGerman(<LanguageLinks testid="footer-languages" onPicked={picked} />);
    expect(screen.getByRole('group', { name: 'Sprache' })).toBeTruthy();
    expect(screen.getByTestId('footer-languages-de').getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByTestId('footer-languages-pl'));
    expect(screen.getByTestId('locale').textContent).toBe('pl');
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it('the dashboard list switches the page language', () => {
    renderInGerman(<LanguageSelect />);
    const select = screen.getByTestId('language-select');
    expect(select.getAttribute('aria-label')).toBe('Sprache der Seite');
    fireEvent.change(select, { target: { value: 'nl' } });
    expect(screen.getByTestId('locale').textContent).toBe('nl');
    expect(window.localStorage.getItem('omnifm.web.locale')).toBe('nl');
  });
});
