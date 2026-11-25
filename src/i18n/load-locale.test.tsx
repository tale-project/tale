import { act, render, screen } from '@testing-library/react';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  isLocaleLoaded,
  loadLocale,
  registerLocaleLoader,
  useLocalesLoad,
} from './load-locale';

type Bundle = Record<string, Record<string, unknown>>;

async function englishOnly(): Promise<I18nInstance> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { home: { title: 'Home' } } },
  });
  return i18n;
}

describe('loadLocale', () => {
  it('puts a registered language in the store once, and its regional variants read it', async () => {
    const i18n = await englishOnly();
    const fetch = vi.fn(async (): Promise<Bundle> => ({
      home: { title: 'Startseite' },
    }));
    registerLocaleLoader(i18n, 'de', fetch);

    expect(isLocaleLoaded(i18n, 'de-CH')).toBe(false);
    await Promise.all([loadLocale(i18n, 'de'), loadLocale(i18n, 'de-CH')]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isLocaleLoaded(i18n, 'de-CH')).toBe(true);
    expect(i18n.getFixedT('de', 'home')('title')).toBe('Startseite');
  });

  it('resolves at once for a language the instance was initialised with', async () => {
    const i18n = await englishOnly();

    expect(isLocaleLoaded(i18n, 'en')).toBe(true);
    await expect(loadLocale(i18n, 'en')).resolves.toBeUndefined();
  });

  it('forgets a failed fetch, so the next call tries again', async () => {
    const i18n = await englishOnly();
    const fetch = vi
      .fn<() => Promise<Bundle>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ home: { title: 'Accueil' } });
    registerLocaleLoader(i18n, 'fr', fetch);

    await expect(loadLocale(i18n, 'fr')).rejects.toThrow('offline');
    expect(isLocaleLoaded(i18n, 'fr')).toBe(false);
    await loadLocale(i18n, 'fr');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(i18n.getFixedT('fr', 'home')('title')).toBe('Accueil');
  });
});

describe('useLocalesLoad', () => {
  it('answers loading for a language until it has landed, then re-renders with loaded', async () => {
    const i18n = await englishOnly();
    let deliver = (_bundle: Bundle) => {};
    registerLocaleLoader(
      i18n,
      'de',
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    function Placeholder() {
      const loads = useLocalesLoad(['en', 'de']);
      return (
        <span>
          {loads.de === 'loaded'
            ? i18n.getFixedT('de', 'home')('title')
            : `${loads.en} ${loads.de}`}
        </span>
      );
    }

    render(
      <I18nextProvider i18n={i18n}>
        <Placeholder />
      </I18nextProvider>,
    );
    expect(screen.getByText('loaded loading')).toBeInTheDocument();

    await act(async () => {
      deliver({ home: { title: 'Startseite' } });
      await Promise.resolve();
    });
    expect(await screen.findByText('Startseite')).toBeInTheDocument();
  });

  it('answers failed for a language that did not load, and fetches it again once the browser is back online', async () => {
    const i18n = await englishOnly();
    const fetch = vi
      .fn<() => Promise<Bundle>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ home: { title: 'Accueil' } });
    registerLocaleLoader(i18n, 'fr', fetch);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function Placeholder() {
      const loads = useLocalesLoad(['en', 'fr']);
      return <span>{`${loads.en} ${loads.fr}`}</span>;
    }

    render(
      <I18nextProvider i18n={i18n}>
        <Placeholder />
      </I18nextProvider>,
    );
    expect(await screen.findByText('loaded failed')).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(await screen.findByText('loaded loaded')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(i18n.getFixedT('fr', 'home')('title')).toBe('Accueil');
    warn.mockRestore();
  });
});
