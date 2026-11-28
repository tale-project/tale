import { createInstance, type i18n as I18nInstance } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoizeLanguageHierarchy } from './language-hierarchy';

// The fallback shape `initI18n` builds: regional variants fall back to their
// base locale, everything else to English.
const FALLBACK_LNG = {
  default: ['en'],
  'de-CH': ['de', 'en'],
  'fr-CH': ['fr', 'en'],
};

async function instance(): Promise<I18nInstance> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'de-CH',
    fallbackLng: FALLBACK_LNG,
    resources: {
      en: { common: { save: 'Save', cancel: 'Cancel' } },
      de: { common: { save: 'Speichern', cancel: 'Abbrechen' } },
      'de-CH': { common: { save: 'Sichern' } },
    },
  });
  return i18n;
}

interface Utils {
  toResolveHierarchy: (code: unknown, fallbackCode?: unknown) => string[];
  options: { fallbackLng?: unknown };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- i18next types its services as `any`
const utilsOf = (i18n: I18nInstance) => i18n.services.languageUtils as Utils;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('memoizeLanguageHierarchy', () => {
  it('answers the chain i18next derives, for every kind of code', async () => {
    const plain = await instance();
    const memo = await instance();
    memoizeLanguageHierarchy(memo);
    for (const code of ['de-CH', 'de_CH', 'en', 'en-US', 'fr', 'fr-CH']) {
      const expected = utilsOf(plain).toResolveHierarchy(code);
      expect(utilsOf(memo).toResolveHierarchy(code)).toEqual(expected);
      // A second read answers the same chain from the map.
      expect(utilsOf(memo).toResolveHierarchy(code)).toEqual(expected);
    }
  });

  it('derives a language once, however many labels read it', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    const canonical = vi.spyOn(Intl, 'getCanonicalLocales');
    for (let i = 0; i < 50; i++) i18n.t('common:save');
    const afterFirstLabels = canonical.mock.calls.length;
    for (let i = 0; i < 500; i++) i18n.t('common:save');
    expect(canonical.mock.calls.length).toBe(afterFirstLabels);
    expect(i18n.t('common:save')).toBe('Sichern');
    // A key the regional bundle lacks still falls back to its base locale.
    expect(i18n.t('common:cancel')).toBe('Abbrechen');
  });

  it('hands out a copy, since i18next mutates the chain it gets', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    const first = utilsOf(i18n).toResolveHierarchy('de-CH');
    first.unshift('xx');
    first.pop();
    expect(utilsOf(i18n).toResolveHierarchy('de-CH')).toEqual([
      'de-CH',
      'de',
      'en',
    ]);
  });

  it('leaves a call with its own fallback to i18next', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    expect(utilsOf(i18n).toResolveHierarchy('de-CH', ['fr'])).toEqual([
      'de-CH',
      'de',
      'fr',
    ]);
    expect(utilsOf(i18n).toResolveHierarchy('de-CH')).toEqual([
      'de-CH',
      'de',
      'en',
    ]);
  });

  it('starts over when the fallback configuration is replaced', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    expect(utilsOf(i18n).toResolveHierarchy('de-CH')).toEqual([
      'de-CH',
      'de',
      'en',
    ]);
    utilsOf(i18n).options.fallbackLng = { default: ['fr'] };
    expect(utilsOf(i18n).toResolveHierarchy('de-CH')).toEqual([
      'de-CH',
      'de',
      'fr',
    ]);
  });

  it('wraps an instance once', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    const wrapped = utilsOf(i18n).toResolveHierarchy;
    memoizeLanguageHierarchy(i18n);
    expect(utilsOf(i18n).toResolveHierarchy).toBe(wrapped);
  });

  it('keeps a language change working', async () => {
    const i18n = await instance();
    memoizeLanguageHierarchy(i18n);
    expect(i18n.t('common:save')).toBe('Sichern');
    await i18n.changeLanguage('en');
    expect(i18n.languages).toEqual(['en']);
    expect(i18n.t('common:save')).toBe('Save');
    await i18n.changeLanguage('de-CH');
    expect(i18n.languages).toEqual(['de-CH', 'de', 'en']);
    expect(i18n.t('common:cancel')).toBe('Abbrechen');
  });
});
