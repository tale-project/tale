import { useLocale } from '@tale/ui/i18n/locale-provider';
import { act, waitFor, within } from '@testing-library/react';
import i18next, { type i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';
import { useTranslation } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AppShell } from './app-shell';
import { Toaster } from './components/feedback/toaster';
import { useT } from './i18n/client';
import { mergeBundles } from './i18n/init-service';
import { registerLocaleLoader } from './i18n/load-locale';
import { LocaleLoadNotice } from './i18n/locale-load-notice';
import { uiMessages } from './i18n/messages';

function createI18n() {
  const instance = i18next.createInstance();
  void instance.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: { hello: 'Hello' } },
      'de-DE': { translation: { hello: 'Hallo' } },
      'fr-FR': { translation: { hello: 'Bonjour' } },
    },
  });
  return instance;
}

beforeEach(() => {
  localStorage.clear();
});

describe('AppShell', () => {
  it('renders children inside the i18n tree when locale is omitted (URL-driven mode)', () => {
    const i18n = createI18n();

    function Greeting() {
      const { t } = useTranslation();
      return <span data-testid="greeting">{t('hello')}</span>;
    }

    render(
      <AppShell i18n={i18n}>
        <Greeting />
      </AppShell>,
    );

    expect(screen.getByTestId('greeting')).toHaveTextContent('Hello');
  });

  // The bridge is the whole reason AppShell exists — without it, the
  // language picker only updates its own copy and the i18n instance stays
  // on the previous language.
  it('bridges client-mode locale changes to the i18n instance', async () => {
    localStorage.setItem('user-locale', 'de-DE');
    const i18n = createI18n();

    function Greeting() {
      const { t } = useTranslation();
      return <span data-testid="greeting">{t('hello')}</span>;
    }

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <Greeting />
      </AppShell>,
    );

    await waitFor(() => {
      expect(i18n.language).toBe('de-DE');
    });
    expect(screen.getByTestId('greeting')).toHaveTextContent('Hallo');
  });

  it('invokes onChange with the detected locale on mount', async () => {
    localStorage.setItem('user-locale', 'fr-FR');
    const i18n = createI18n();
    const onChange = vi.fn();

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client', onChange }}>
        <span data-testid="ready">ready</span>
      </AppShell>,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('fr-FR');
    });
  });

  it('exposes useLocale to children in client mode', () => {
    localStorage.setItem('user-locale', 'de-DE');
    const i18n = createI18n();

    function LocaleProbe() {
      const { locale } = useLocale();
      return <span data-testid="locale">{locale}</span>;
    }

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <LocaleProbe />
      </AppShell>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('de-DE');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const i18n = createI18n();
      const { container } = render(
        <AppShell i18n={i18n}>
          <main>
            <h1>Hello</h1>
          </main>
        </AppShell>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('AppShell with a language fetched on first use', () => {
  type Bundle = Record<string, Record<string, unknown>>;

  const french: Bundle = mergeBundles(
    uiMessages.global,
    uiMessages.bundles.fr,
    { home: { title: 'Accueil' } },
  );

  /** English and German in the store from the start; French on first use. */
  async function lazyFrench(
    fetch: () => Promise<Bundle>,
  ): Promise<I18nInstance> {
    const i18n = i18next.createInstance();
    await i18n.use(ICU).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: mergeBundles(uiMessages.global, uiMessages.bundles.en, {
          home: { title: 'Home' },
        }),
        de: mergeBundles(uiMessages.global, uiMessages.bundles.de, {
          home: { title: 'Startseite' },
        }),
      },
      // As `initI18n`: a French read before French landed is not kept.
      i18nFormat: { bindI18nStore: 'added' },
    });
    registerLocaleLoader(i18n, 'fr', fetch);
    return i18n;
  }

  /**
   * A page, and a language picker that reads the provider like a menu;
   * `seen` collects what the picker read on every render.
   */
  function Page({ seen }: { seen?: string[] }) {
    const { t } = useT('home');
    const { locale, setLocale, shownLocale, status } = useLocale();
    const read = `${locale} ${shownLocale} ${status}`;
    seen?.push(read);
    return (
      <main>
        <h1>{t('title')}</h1>
        <p data-testid="switch">{read}</p>
        <button type="button" onClick={() => setLocale('fr')}>
          Français
        </button>
        <button type="button" onClick={() => setLocale('en')}>
          English
        </button>
        <button type="button" onClick={() => setLocale('de')}>
          Deutsch
        </button>
      </main>
    );
  }

  function renderPage(i18n: I18nInstance, seen?: string[]) {
    return render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <Page seen={seen} />
        <LocaleLoadNotice />
        <Toaster />
      </AppShell>,
    );
  }

  /** What the language picker reads: picked, shown, and where it stands. */
  function languageSwitch() {
    return screen.getByTestId('switch');
  }

  async function findNotice(title: string): Promise<HTMLElement> {
    const heading = await screen.findByText(title);
    const notice = heading.closest('li');
    if (notice === null) throw new Error(`no toast holds "${title}"`);
    return notice;
  }

  beforeEach(() => {
    // The failed fetches below are expected; their warnings are noise here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the language the page shows while the picked one loads, then switches to it', async () => {
    localStorage.setItem('user-locale', 'en');
    let deliver = (_bundle: Bundle) => {};
    const fetch = vi.fn(
      () =>
        new Promise<Bundle>((resolve) => {
          deliver = resolve;
        }),
    );
    const i18n = await lazyFrench(fetch);
    const seen: string[] = [];
    const { user } = renderPage(i18n, seen);
    expect(languageSwitch()).toHaveTextContent('en en shown');

    await user.click(screen.getByRole('button', { name: 'Français' }));

    // Stored at once; the page, and the language marked, wait for its words,
    // from the render the pick causes on.
    expect(localStorage.getItem('user-locale')).toBe('fr');
    expect(languageSwitch()).toHaveTextContent('fr en loading');
    expect(screen.getByRole('heading')).toHaveTextContent('Home');
    expect(seen).not.toContain('fr fr shown');

    await act(async () => {
      deliver(french);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(languageSwitch()).toHaveTextContent('fr fr shown'),
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Accueil');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('marks a language already in the store as shown as soon as it is picked', async () => {
    localStorage.setItem('user-locale', 'en');
    const i18n = await lazyFrench(vi.fn());
    const seen: string[] = [];
    const { user } = renderPage(i18n, seen);

    await user.click(screen.getByRole('button', { name: 'Deutsch' }));

    expect(languageSwitch()).toHaveTextContent('de de shown');
    expect(screen.getByRole('heading')).toHaveTextContent('Startseite');
    // No render shows it as on its way.
    expect(seen.filter((read) => read.endsWith(' loading'))).toEqual([]);
  });

  // As the platform's first frame, when a topic of the session's language
  // stalls: the instance switched without waiting for it.
  it('marks the language the instance already shows as shown while its words are on their way', async () => {
    localStorage.setItem('user-locale', 'fr');
    let deliver = (_bundle: Bundle) => {};
    const fetch = vi.fn(
      () =>
        new Promise<Bundle>((resolve) => {
          deliver = resolve;
        }),
    );
    const i18n = await lazyFrench(fetch);
    await i18n.changeLanguage('fr');
    const seen: string[] = [];

    renderPage(i18n, seen);

    // English until its words land; no render marks French as on its way.
    expect(screen.getByRole('heading')).toHaveTextContent('Home');
    expect(seen).not.toEqual([]);
    expect(seen.filter((read) => read !== 'fr fr shown')).toEqual([]);

    await act(async () => {
      deliver(french);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByRole('heading')).toHaveTextContent('Accueil'),
    );
    expect(languageSwitch()).toHaveTextContent('fr fr shown');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says in the language the page shows that the picked one did not load, and fetches it again on Try again', async () => {
    localStorage.setItem('user-locale', 'de');
    const fetch = vi
      .fn<() => Promise<Bundle>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(french);
    const i18n = await lazyFrench(fetch);
    const { user } = renderPage(i18n);
    await waitFor(() =>
      expect(screen.getByRole('heading')).toHaveTextContent('Startseite'),
    );

    await user.click(screen.getByRole('button', { name: 'Français' }));

    const notice = await findNotice('Français konnte nicht geladen werden');
    expect(notice).toHaveTextContent(
      'Prüfe deine Verbindung und versuche es erneut.',
    );
    // An error toast stays until it is closed, so it carries its own close.
    expect(
      within(notice).getByRole('button', { name: 'Schließen' }),
    ).toBeInTheDocument();
    // The page stays German, and so does the language marked.
    expect(languageSwitch()).toHaveTextContent('fr de failed');
    expect(screen.getByRole('heading')).toHaveTextContent('Startseite');

    await user.click(
      within(notice).getByRole('button', { name: 'Erneut versuchen' }),
    );

    await waitFor(() =>
      expect(languageSwitch()).toHaveTextContent('fr fr shown'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading')).toHaveTextContent('Accueil');
  });

  it('fetches a language that did not load again when it is picked again', async () => {
    localStorage.setItem('user-locale', 'en');
    const fetch = vi
      .fn<() => Promise<Bundle>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(french);
    const i18n = await lazyFrench(fetch);
    const { user } = renderPage(i18n);

    await user.click(screen.getByRole('button', { name: 'Français' }));
    await findNotice("Couldn't load Français");
    expect(languageSwitch()).toHaveTextContent('fr en failed');

    await user.click(screen.getByRole('button', { name: 'Français' }));

    await waitFor(() =>
      expect(languageSwitch()).toHaveTextContent('fr fr shown'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading')).toHaveTextContent('Accueil');
  });

  it('says so again when a retry fails as well', async () => {
    localStorage.setItem('user-locale', 'en');
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const i18n = await lazyFrench(fetch);
    const { user } = renderPage(i18n);

    await user.click(screen.getByRole('button', { name: 'Français' }));
    const notice = await findNotice("Couldn't load Français");

    await user.click(within(notice).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    // A notice of its own, not the one Try again closed.
    await waitFor(() =>
      expect(screen.getByText("Couldn't load Français").closest('li')).not.toBe(
        notice,
      ),
    );
    expect(languageSwitch()).toHaveTextContent('fr en failed');
  });

  it('drops the notice when another language is picked', async () => {
    localStorage.setItem('user-locale', 'en');
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const i18n = await lazyFrench(fetch);
    const { user } = renderPage(i18n);

    await user.click(screen.getByRole('button', { name: 'Français' }));
    await findNotice("Couldn't load Français");

    await user.click(screen.getByRole('button', { name: 'English' }));

    expect(languageSwitch()).toHaveTextContent('en en shown');
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load Français")).toBeNull(),
    );
  });

  it('fetches a stored language that did not load again once the browser is back online', async () => {
    // A session that starts in a language whose messages cannot load stays
    // in English, and says so.
    localStorage.setItem('user-locale', 'fr');
    const fetch = vi
      .fn<() => Promise<Bundle>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(french);
    const i18n = await lazyFrench(fetch);
    renderPage(i18n);

    const notice = await findNotice("Couldn't load Français");
    expect(notice).toHaveTextContent('Check your connection and try again.');
    expect(languageSwitch()).toHaveTextContent('fr en failed');
    expect(screen.getByRole('heading')).toHaveTextContent('Home');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() =>
      expect(languageSwitch()).toHaveTextContent('fr fr shown'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading')).toHaveTextContent('Accueil');
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load Français")).toBeNull(),
    );
  });
});
