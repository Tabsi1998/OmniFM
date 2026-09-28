import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, LOCALE_MESSAGES, useI18n } from './i18n.js';

// Every text exists in German and English (#294): the same keys, the same
// list lengths, and no empty string where the other language has text.
function differences(de, en, path = '') {
  const found = [];
  if (Array.isArray(de) || Array.isArray(en)) {
    if (!Array.isArray(de) || !Array.isArray(en)) return [`${path}: list in only one language`];
    if (de.length !== en.length) found.push(`${path}: ${de.length} entries in German, ${en.length} in English`);
    for (let index = 0; index < Math.min(de.length, en.length); index += 1) found.push(...differences(de[index], en[index], `${path}[${index}]`));
    return found;
  }
  if (de && typeof de === 'object' && en && typeof en === 'object') {
    for (const key of new Set([...Object.keys(de), ...Object.keys(en)])) {
      if (!(key in de)) found.push(`${path}.${key}: missing in German`);
      else if (!(key in en)) found.push(`${path}.${key}: missing in English`);
      else found.push(...differences(de[key], en[key], `${path}.${key}`));
    }
    return found;
  }
  if (typeof de !== typeof en) return [`${path}: ${typeof de} in German, ${typeof en} in English`];
  if (typeof de === 'string' && (de.trim() === '') !== (en.trim() === '')) return [`${path}: empty in one language`];
  return found;
}

describe('translations', () => {
  it('has German and English', () => {
    expect(Object.keys(LOCALE_MESSAGES).sort()).toEqual(['de', 'en']);
  });

  it('has every text in both languages', () => {
    expect(differences(LOCALE_MESSAGES.de, LOCALE_MESSAGES.en)).toEqual([]);
  });
});

// The other seven languages come as their own download (#306); the page shows
// them once it is there. Their completeness: test/website-languages.test.js.
function Probe() {
  const { copy, t, locale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="cta">{copy.hero.ctaInvite}</span>
      <span data-testid="stop">{t('Stoppen', 'Stop')}</span>
    </div>
  );
}

describe('a language of its own download', () => {
  afterEach(cleanup);

  it('follows the browser and shows the page in French once the file is there', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'fr']);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('locale').textContent).toBe('fr');
    await screen.findByText('Inviter le commander');
    expect(screen.getByTestId('stop').textContent).toBe('Arrêter');
  });

  it('shows English for a language the site does not speak', () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('cta').textContent).toBe('Invite commander');
  });
});
