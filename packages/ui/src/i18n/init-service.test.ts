import { afterEach, describe, expect, it, vi } from 'vitest';

import { initServiceI18n, mergeBundles } from './init-service';
import { isLocaleLoaded, loadLocale } from './load-locale';

describe('mergeBundles', () => {
  it('keeps sibling keys when a later bundle redeclares one nested key', () => {
    const fromPackage = {
      common: {
        actions: { save: 'Save', cancel: 'Cancel' },
        aria: { close: 'Close' },
      },
    };
    const fromService = {
      common: {
        actions: { save: 'Save changes' },
      },
    };

    expect(mergeBundles(fromPackage, fromService)).toEqual({
      common: {
        actions: { save: 'Save changes', cancel: 'Cancel' },
        aria: { close: 'Close' },
      },
    });
  });

  it('adds namespaces only one side defines and lets the last bundle win', () => {
    expect(
      mergeBundles(
        { search: { title: 'Search' } },
        undefined,
        { nav: { home: 'Home' } },
        { search: { title: 'Find' } },
      ),
    ).toEqual({ search: { title: 'Find' }, nav: { home: 'Home' } });
  });

  it('replaces a leaf with a subtree (and back) instead of merging across kinds', () => {
    expect(
      mergeBundles({ a: { key: 'leaf' } }, { a: { key: { nested: 'tree' } } }),
    ).toEqual({ a: { key: { nested: 'tree' } } });
  });
});

describe('initServiceI18n with lazyBundles', () => {
  it('fetches a language on first use, merged as the static ones are', async () => {
    const i18n = initServiceI18n({
      bundles: { en: { app: { title: 'Home' } } },
      lazyBundles: { de: async () => ({ app: { title: 'Startseite' } }) },
      regional: {},
      global: { app: { brand: 'Tale' } },
      packages: [
        {
          bundles: {
            en: { common: { save: 'Save' } },
            de: { common: { save: 'Speichern' } },
          },
        },
      ],
    });

    expect(isLocaleLoaded(i18n, 'de')).toBe(false);
    expect(i18n.getFixedT('de')('app:title')).toBe('Home');

    await loadLocale(i18n, 'de');
    const t = i18n.getFixedT('de');
    expect(t('app:title')).toBe('Startseite');
    expect(t('common:save')).toBe('Speichern');
    expect(t('app:brand')).toBe('Tale');
  });
});

describe('initServiceI18n with topics', () => {
  afterEach(() => {
    globalThis.__taleMessageTopics = undefined;
  });

  it('serves English as modules register it and fetches the other locales per topic', async () => {
    // A fresh registry: the instance `initServiceI18n` sets up is one per page.
    vi.resetModules();
    const service = await import('./init-service');
    const topics = await import('./topics');
    const locales = await import('./load-locale');
    const homeDe = vi.fn(async () => ({ title: 'Startseite' }));
    const i18n = service.initServiceI18n({
      bundles: { en: {} },
      topics: { lazy: { de: { home: homeDe } } },
      regional: {},
      packages: [
        {
          bundles: {
            en: { common: { save: 'Save' } },
            de: { common: { save: 'Speichern' } },
          },
        },
      ],
    });

    topics.registerTopic('home', { title: 'Home' });
    expect(i18n.t('home:title')).toBe('Home');
    expect(locales.isLocaleLoaded(i18n, 'de')).toBe(false);

    await locales.loadLocale(i18n, 'de');
    const t = i18n.getFixedT('de');
    expect(t('home:title')).toBe('Startseite');
    expect(t('common:save')).toBe('Speichern');
    expect(homeDe).toHaveBeenCalledTimes(1);
  });
});
