import { render, renderHook } from '@testing-library/react';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Messages = Record<string, unknown>;
type Topics = typeof import('./topics');
type LoadLocale = typeof import('./load-locale');

// The registry is one per page: each test starts from fresh modules.
let topics: Topics;
let locales: LoadLocale;

beforeEach(async () => {
  vi.resetModules();
  topics = await import('./topics');
  locales = await import('./load-locale');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.__taleMessageTopics = undefined;
});

async function instance(): Promise<I18nInstance> {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: { 'de-CH': ['de', 'en'], default: ['en'] },
    resources: {},
  });
  return i18n;
}

/** A topic file that answers when the test says so. */
function deferred(messages: Messages) {
  let deliver = () => {};
  let fail = (_error: Error) => {};
  const load = vi.fn(
    () =>
      new Promise<Messages>((resolve, reject) => {
        deliver = () => resolve(messages);
        fail = reject;
      }),
  );
  return {
    load,
    deliver: () => deliver(),
    fail: (error: Error) => fail(error),
  };
}

describe('registerTopic', () => {
  it('puts English in the store, whether it registers before or after the instance attaches', async () => {
    topics.registerTopic('home', { title: 'Home' });
    const i18n = await instance();
    topics.attachTopics(i18n, { lazy: {} });
    topics.registerTopic('chat', { send: 'Send' });

    expect(i18n.t('home:title')).toBe('Home');
    expect(i18n.t('chat:send')).toBe('Send');
  });
});

describe('loadLocale on a per-topic instance', () => {
  it('fetches the registered topics a locale reads, a region with its language', async () => {
    const i18n = await instance();
    const homeDe = vi.fn(async () => ({ title: 'Startseite' }));
    const homeCh = vi.fn(async () => ({ title: 'Startsiite' }));
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    topics.attachTopics(i18n, {
      lazy: {
        de: { home: homeDe, chat: chatDe },
        'de-CH': { home: homeCh },
      },
    });
    topics.registerTopic('home', { title: 'Home' });

    expect(locales.isLocaleLoaded(i18n, 'de-CH')).toBe(false);
    await locales.loadLocale(i18n, 'de-CH');

    expect(locales.isLocaleLoaded(i18n, 'de-CH')).toBe(true);
    expect(chatDe).not.toHaveBeenCalled();
    expect(i18n.getFixedT('de-CH', 'home')('title')).toBe('Startsiite');
    expect(i18n.getFixedT('de', 'home')('title')).toBe('Startseite');
    await locales.loadLocale(i18n, 'de');
    expect(homeDe).toHaveBeenCalledTimes(1);
  });

  it('fetches a topic that registers later in the locale it loaded', async () => {
    const i18n = await instance();
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    topics.attachTopics(i18n, { lazy: { de: { chat: chatDe } } });
    await locales.loadLocale(i18n, 'de');

    topics.registerTopic('chat', { send: 'Send' });

    expect(chatDe).toHaveBeenCalledTimes(1);
    expect(locales.isLocaleLoaded(i18n, 'de')).toBe(false);
    await locales.loadLocale(i18n, 'de');
    expect(i18n.getFixedT('de', 'chat')('send')).toBe('Senden');
  });

  it('follows the language the session switches to, and no longer the one it left', async () => {
    const i18n = await instance();
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    const chatFr = vi.fn(async () => ({ send: 'Envoyer' }));
    topics.attachTopics(i18n, {
      lazy: { de: { chat: chatDe }, fr: { chat: chatFr } },
    });
    await locales.loadLocale(i18n, 'de');
    await i18n.changeLanguage('fr');

    topics.registerTopic('chat', { send: 'Send' });

    expect(chatFr).toHaveBeenCalledTimes(1);
    expect(chatDe).not.toHaveBeenCalled();
  });

  it('follows the language the session starts in', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'de', fallbackLng: 'en', resources: {} });
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    topics.attachTopics(i18n, { lazy: { de: { chat: chatDe } } });

    topics.registerTopic('chat', { send: 'Send' });

    expect(chatDe).toHaveBeenCalledTimes(1);
  });

  it('stops following a language whose switch was given up for the one the session shows', async () => {
    const i18n = await instance();
    const homeFr = deferred({ title: 'Accueil' });
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    const chatFr = vi.fn(async () => ({ send: 'Envoyer' }));
    topics.attachTopics(i18n, {
      lazy: {
        de: { home: async () => ({ title: 'Startseite' }), chat: chatDe },
        fr: { home: homeFr.load, chat: chatFr },
      },
    });
    topics.registerTopic('home', { title: 'Home' });
    await locales.loadLocale(i18n, 'de');
    await i18n.changeLanguage('de');

    // Language → Français, then back to Deutsch before French has loaded.
    const { LocaleSync } = await import('./sync');
    const view = render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(LocaleSync, { locale: 'fr' }),
      ),
    );
    expect(homeFr.load).toHaveBeenCalledTimes(1);
    view.rerender(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(LocaleSync, { locale: 'de' }),
      ),
    );

    topics.registerTopic('chat', { send: 'Send' });
    expect(chatDe).toHaveBeenCalledTimes(1);
    expect(chatFr).not.toHaveBeenCalled();
    await expect(
      globalThis.__taleMessageTopics?.ready(['chat']),
    ).resolves.toBeUndefined();

    homeFr.deliver();
    await vi.waitFor(() =>
      expect(i18n.getFixedT('fr', 'home')('title')).toBe('Accueil'),
    );
    expect(i18n.language).toBe('de');
  });

  it('stops following a language whose topics did not load', async () => {
    const i18n = await instance();
    const homeFr = vi
      .fn<() => Promise<Messages>>()
      .mockRejectedValueOnce(new Error('offline'));
    const chatFr = vi.fn(async () => ({ send: 'Envoyer' }));
    topics.attachTopics(i18n, {
      lazy: { fr: { home: homeFr, chat: chatFr } },
    });
    topics.registerTopic('home', { title: 'Home' });

    await expect(locales.loadLocale(i18n, 'fr')).rejects.toThrow('offline');
    topics.registerTopic('chat', { send: 'Send' });

    expect(chatFr).not.toHaveBeenCalled();
  });

  it('answers at once for English, which comes with the code', async () => {
    const i18n = await instance();
    topics.attachTopics(i18n, { lazy: { de: {} } });
    topics.registerTopic('home', { title: 'Home' });

    expect(locales.isLocaleLoaded(i18n, 'en-US')).toBe(true);
    await expect(locales.loadLocale(i18n, 'en')).resolves.toBeUndefined();
  });

  it('fetches every topic of a locale when eager, registered or not', async () => {
    const i18n = await instance();
    const homeDe = vi.fn(async () => ({ title: 'Startseite' }));
    const chatDe = vi.fn(async () => ({ send: 'Senden' }));
    topics.attachTopics(i18n, {
      lazy: { de: { home: homeDe, chat: chatDe } },
      eager: true,
    });

    await locales.loadLocale(i18n, 'de');

    expect(homeDe).toHaveBeenCalledTimes(1);
    expect(chatDe).toHaveBeenCalledTimes(1);
    expect(i18n.getFixedT('de', 'chat')('send')).toBe('Senden');
  });

  it('forgets a failed topic, so the next load tries it again', async () => {
    const i18n = await instance();
    const homeFr = vi
      .fn<() => Promise<Messages>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ title: 'Accueil' });
    topics.attachTopics(i18n, { lazy: { fr: { home: homeFr } } });
    topics.registerTopic('home', { title: 'Home' });

    await expect(locales.loadLocale(i18n, 'fr')).rejects.toThrow('offline');
    await locales.loadLocale(i18n, 'fr');

    expect(homeFr).toHaveBeenCalledTimes(2);
    expect(i18n.getFixedT('fr', 'home')('title')).toBe('Accueil');
  });
});

describe('useLocalesLoaded on a per-topic instance', () => {
  // The data-notice editor reads its default in every language beside an
  // English session.
  it('fetches the namespaces a screen reads in other languages, and the pages after it fetch and wait for none of them', async () => {
    const i18n = await instance();
    const noticeDe = vi.fn(async () => ({ default: 'Hinweis' }));
    const noticeFr = vi.fn(async () => ({ default: 'Avis' }));
    const homeDe = vi.fn(async () => ({ title: 'Startseite' }));
    const tasksDe = vi.fn(async () => ({ title: 'Aufgaben' }));
    const tasksFr = vi.fn(async () => ({ title: 'Tâches' }));
    topics.attachTopics(i18n, {
      lazy: {
        de: { notice: noticeDe, home: homeDe, tasks: tasksDe },
        fr: { notice: noticeFr, tasks: tasksFr },
      },
    });
    topics.registerTopic('home', { title: 'Home' });
    topics.registerTopic('notice', { default: 'Notice' });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(I18nextProvider, { i18n }, children);

    const { result } = renderHook(
      () => locales.useLocalesLoaded(['en', 'de', 'fr'], ['notice']),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(i18n.getFixedT('de', 'notice')('default')).toBe('Hinweis');
    expect(i18n.getFixedT('fr', 'notice')('default')).toBe('Avis');
    expect(homeDe).not.toHaveBeenCalled();

    // A page loaded afterwards brings the tasks topic.
    topics.registerTopic('tasks', { title: 'Tasks' });
    await expect(
      globalThis.__taleMessageTopics?.ready(['tasks']),
    ).resolves.toBeUndefined();
    expect(tasksDe).not.toHaveBeenCalled();
    expect(tasksFr).not.toHaveBeenCalled();

    // Its words stay in: the screen mounted again reads them at once.
    expect(locales.isLocaleLoaded(i18n, 'de', ['notice'])).toBe(true);
    expect(locales.isLocaleLoaded(i18n, 'de')).toBe(false);
  });
});

describe('the chunks’ wait (__taleMessageTopics.ready)', () => {
  it('resolves once the topics are in for the followed language', async () => {
    const i18n = await instance();
    const tasksDe = deferred({ title: 'Aufgaben' });
    topics.attachTopics(i18n, { lazy: { de: { tasks: tasksDe.load } } });
    await locales.loadLocale(i18n, 'de');
    topics.registerTopic('tasks', { title: 'Tasks' });

    let settled = false;
    const wait = globalThis.__taleMessageTopics?.ready(['tasks']).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    tasksDe.deliver();
    await wait;
    expect(i18n.getFixedT('de', 'tasks')('title')).toBe('Aufgaben');
  });

  it('resolves at once in English, and never rejects', async () => {
    const i18n = await instance();
    const tasksDe = deferred({ title: 'Aufgaben' });
    topics.attachTopics(i18n, { lazy: { de: { tasks: tasksDe.load } } });
    await expect(
      globalThis.__taleMessageTopics?.ready(['tasks']),
    ).resolves.toBeUndefined();
    expect(tasksDe.load).not.toHaveBeenCalled();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await locales.loadLocale(i18n, 'de');
    const wait = globalThis.__taleMessageTopics?.ready(['tasks']);
    tasksDe.fail(new Error('offline'));
    await expect(wait).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('stops waiting after `waitMs`, so a slow topic cannot hold a page', async () => {
    vi.useFakeTimers();
    const i18n = await instance();
    const tasksDe = deferred({ title: 'Aufgaben' });
    topics.attachTopics(i18n, {
      lazy: { de: { tasks: tasksDe.load } },
      waitMs: 50,
    });
    void locales.loadLocale(i18n, 'de');

    const wait = globalThis.__taleMessageTopics?.ready(['tasks']);
    await vi.advanceTimersByTimeAsync(50);

    await expect(wait).resolves.toBeUndefined();
  });
});

describe('ensureTopic', () => {
  it('fetches a topic a reader needs in its language, once', async () => {
    const i18n = await instance();
    const tasksFr = vi.fn(async () => ({ title: 'Tâches' }));
    topics.attachTopics(i18n, { lazy: { fr: { tasks: tasksFr } } });
    topics.registerTopic('tasks', { title: 'Tasks' });

    topics.ensureTopic(i18n, 'fr', 'tasks');
    topics.ensureTopic(i18n, 'fr', 'tasks');
    await vi.waitFor(() =>
      expect(i18n.getFixedT('fr', 'tasks')('title')).toBe('Tâches'),
    );
    expect(tasksFr).toHaveBeenCalledTimes(1);
  });

  it('says once when a topic is read that no loaded module names', async () => {
    const i18n = await instance();
    topics.attachTopics(i18n, {
      lazy: { de: { tasks: async () => ({ title: 'Aufgaben' }) } },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    topics.ensureTopic(i18n, 'en', 'tasks');
    topics.ensureTopic(i18n, 'en', 'tasks');
    topics.ensureTopic(i18n, 'en', 'docs');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('"tasks"');
  });

  it('ignores an instance it was not attached to', async () => {
    const i18n = await instance();
    const other = await instance();
    const tasksFr = vi.fn(async () => ({ title: 'Tâches' }));
    topics.attachTopics(i18n, { lazy: { fr: { tasks: tasksFr } } });

    topics.ensureTopic(other, 'fr', 'tasks');

    expect(tasksFr).not.toHaveBeenCalled();
  });
});
