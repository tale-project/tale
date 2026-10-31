import { act, render, screen } from '@testing-library/react';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { type ReactNode, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { useT } from './client';
import { isLocaleLoaded, registerLocaleLoader } from './load-locale';
import { LocaleSync } from './sync';

async function instance(): Promise<I18nInstance> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { home: { title: 'Home' }, chat: { title: 'Chat' } },
      de: { home: { title: 'Startseite' }, chat: { title: 'Unterhaltung' } },
    },
  });
  return i18n;
}

function Provider({
  i18n,
  children,
}: {
  i18n: I18nInstance;
  children: ReactNode;
}) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

function Title({ namespace = 'home' }: { namespace?: string }) {
  const { t } = useT(namespace);
  return <span>{t('title')}</span>;
}

describe('useT', () => {
  it('translates through the provided instance and follows a language change', async () => {
    const i18n = await instance();
    render(
      <Provider i18n={i18n}>
        <Title />
        <Title namespace="chat" />
      </Provider>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(screen.getByText('Startseite')).toBeInTheDocument();
    expect(screen.getByText('Unterhaltung')).toBeInTheDocument();
  });

  it('hands every reader of a namespace the same `t` across renders, and a new one when its words change', async () => {
    const i18n = await instance();
    const seen: unknown[] = [];
    function Reader() {
      const { t } = useT('home');
      seen.push(t);
      return null;
    }
    function Parent({ revision }: { revision: number }) {
      return (
        <div data-revision={revision}>
          <Reader />
          <Reader />
        </div>
      );
    }
    const view = render(
      <Provider i18n={i18n}>
        <Parent revision={0} />
      </Provider>,
    );
    for (const revision of [1, 2]) {
      view.rerender(
        <Provider i18n={i18n}>
          <Parent revision={revision} />
        </Provider>,
      );
    }
    expect(seen.length).toBeGreaterThanOrEqual(6);
    expect(new Set(seen).size).toBe(1);

    // Messages of the namespace landing are a new `t` — one, shared again.
    act(() => {
      i18n.addResourceBundle('en', 'home', { subtitle: 'Welcome' }, true, true);
    });
    expect(new Set(seen).size).toBe(2);
    expect(new Set(seen.slice(-2)).size).toBe(1);

    // So is a new language.
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(new Set(seen).size).toBe(3);
    expect(new Set(seen.slice(-2)).size).toBe(1);
  });

  // A topic that lands after its chunk stopped waiting (`ready`) or was
  // fetched again after a failure: a label worked out once from `t` read the
  // fallback, and must read the words that landed.
  it('works a memoised label out again when its namespace lands after it rendered', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'de',
      fallbackLng: 'en',
      resources: { en: { tasks: { heading: 'Tasks' } } },
    });
    function Heading() {
      const { t } = useT('tasks');
      const heading = useMemo(() => t('heading'), [t]);
      return <h1>{heading}</h1>;
    }
    render(
      <Provider i18n={i18n}>
        <Heading />
      </Provider>,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('Tasks');

    act(() => {
      i18n.addResourceBundle(
        'de',
        'tasks',
        { heading: 'Aufgaben' },
        true,
        true,
      );
    });

    expect(screen.getByRole('heading')).toHaveTextContent('Aufgaben');
  });

  // A language loaded before the session switches to it, or read beside the
  // session's (`useLocalesLoad`), changes no word a reader shows.
  it('re-renders no reader when messages land in a language the session does not read', async () => {
    const i18n = await instance();
    await i18n.changeLanguage('de');
    const seen: unknown[] = [];
    function Reader() {
      const { t } = useT('home');
      seen.push(t);
      return <span>{t('title')}</span>;
    }
    render(
      <Provider i18n={i18n}>
        <Reader />
      </Provider>,
    );
    const rendered = seen.length;

    act(() => {
      i18n.addResourceBundle('fr', 'home', { title: 'Accueil' }, true, true);
    });
    expect(seen).toHaveLength(rendered);

    // The language it falls back to is one it reads.
    act(() => {
      i18n.addResourceBundle('en', 'home', { subtitle: 'Welcome' }, true, true);
    });
    expect(seen.length).toBeGreaterThan(rendered);
    expect(screen.getByText('Startseite')).toBeInTheDocument();
  });

  // react-i18next's `useTranslation` re-subscribed to the instance on every
  // render (its options object was rebuilt each time), which a screen of
  // thousands of labels paid on each update.
  it('subscribes to the instance once, however many readers and renders', async () => {
    const i18n = await instance();
    const on = vi.spyOn(i18n, 'on');
    const off = vi.spyOn(i18n, 'off');
    const onStore = vi.spyOn(i18n.store, 'on');
    function Parent({ revision }: { revision: number }) {
      return (
        <div data-revision={revision}>
          <Title />
          <Title />
          <Title namespace="chat" />
        </div>
      );
    }
    const view = render(
      <Provider i18n={i18n}>
        <Parent revision={0} />
      </Provider>,
    );
    for (let revision = 1; revision <= 10; revision++) {
      view.rerender(
        <Provider i18n={i18n}>
          <Parent revision={revision} />
        </Provider>,
      );
    }
    expect(on.mock.calls.map(([event]) => event)).toEqual(['languageChanged']);
    expect(onStore.mock.calls.map(([event]) => event)).toEqual(['added']);

    view.unmount();
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(off).not.toHaveBeenCalled();
  });

  it('re-renders the readers of a namespace when its messages land, and no others', async () => {
    const i18n = await instance();
    await i18n.changeLanguage('de');
    const homeRendered = vi.fn();
    function Home() {
      homeRendered();
      const { t } = useT('home');
      return <span>{t('title')}</span>;
    }
    function Tasks() {
      const { t } = useT('tasks');
      return <span>{t('heading')}</span>;
    }
    render(
      <Provider i18n={i18n}>
        <Home />
        <Tasks />
      </Provider>,
    );
    expect(screen.getByText('heading')).toBeInTheDocument();
    const before = homeRendered.mock.calls.length;

    act(() => {
      i18n.addResourceBundle(
        'de',
        'tasks',
        { heading: 'Aufgaben' },
        true,
        true,
      );
    });

    expect(screen.getByText('Aufgaben')).toBeInTheDocument();
    expect(homeRendered).toHaveBeenCalledTimes(before);
  });

  it('reads a key as itself when no instance exists', () => {
    // No provider and nothing registered: the fresh module instance of
    // react-i18next has no global i18n in this test file.
    function Bare() {
      const { t } = useT('home');
      return <span>{t('title')}</span>;
    }
    render(<Bare />);
    expect(screen.getByText('title')).toBeInTheDocument();
  });
});

describe('useT with a language fetched on first use', () => {
  it('re-renders its readers in that language once LocaleSync has loaded it', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { home: { title: 'Home' } } },
    });
    let deliver = (_bundle: Record<string, Record<string, unknown>>) => {};
    registerLocaleLoader(
      i18n,
      'de',
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );

    const view = render(
      <Provider i18n={i18n}>
        <Title />
      </Provider>,
    );
    view.rerender(
      <Provider i18n={i18n}>
        <LocaleSync locale="de" />
        <Title />
      </Provider>,
    );
    // The switch waits for the messages: the page stays in English, whole.
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).not.toBe('de');

    await act(async () => {
      deliver({ home: { title: 'Startseite' } });
      await Promise.resolve();
    });
    expect(isLocaleLoaded(i18n, 'de')).toBe(true);
    expect(await screen.findByText('Startseite')).toBeInTheDocument();
    expect(i18n.language).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });
});
