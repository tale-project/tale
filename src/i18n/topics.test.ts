import { createInstance, type i18n as I18nInstance } from 'i18next';
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
