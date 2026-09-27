import { describe, expect, it } from 'vitest';
import { LOCALE_MESSAGES } from './i18n.js';

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
