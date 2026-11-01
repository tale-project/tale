import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Messages = Record<string, unknown>;

// The German topic files of each test, in place of the catalog's.
const catalog = vi.hoisted(() => ({
  de: {} as Record<string, () => Promise<Messages>>,
}));

vi.mock('@tale/ui/i18n/detect-locale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/detect-locale')>()),
  detectPreferredLocale: () => 'de',
}));

vi.mock('@tale/ui/i18n/topic-catalogs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/topic-catalogs')>()),
  topicLoaders: () => ({ de: catalog.de }),
}));

// The session's switch is one per page: each test starts from fresh modules.
beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.__taleMessageTopics = undefined;
});

describe('sessionLocaleReady', () => {
  it('switches to the session’s language once, whatever the later navigations', async () => {
    catalog.de = { home: async () => ({ title: 'Startseite' }) };
    const { i18n, sessionLocaleReady } = await import('./i18n');
    expect(i18n.language).toBe('en');

    const ready = sessionLocaleReady();
    await ready;
    expect(i18n.language).toBe('de');
    expect(i18n.t('home:title')).toBe('Startseite');

    await i18n.changeLanguage('fr');
    expect(sessionLocaleReady()).toBe(ready);
    await sessionLocaleReady();
    expect(i18n.language).toBe('fr');
  });

  it('never rejects: the page stays in English when not one topic loads', async () => {
    vi.useFakeTimers();
    catalog.de = {
      home: () => Promise.reject(new Error('offline')),
      chat: () => Promise.reject(new Error('offline')),
    };
    const { i18n, sessionLocaleReady } = await import('./i18n');

    await expect(sessionLocaleReady()).resolves.toBeUndefined();
    expect(i18n.language).toBe('en');
    expect(console.warn).toHaveBeenCalledWith(
      '[i18n] the de messages did not load; the page stays in en',
      expect.any(Error),
    );
  });

  it('waits no longer than a chunk does, so a stalled topic cannot hold the first frame', async () => {
    vi.useFakeTimers();
    catalog.de = {
      home: async () => ({ title: 'Startseite' }),
      chat: () => new Promise<Messages>(() => undefined),
    };
    const { i18n, sessionLocaleReady } = await import('./i18n');
    const { registerTopic } = await import('@tale/ui/i18n/topics');
    registerTopic('chat', { title: 'Chat' });

    let settled = false;
    void sessionLocaleReady().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(true);
    expect(i18n.language).toBe('de');
    expect(i18n.t('home:title')).toBe('Startseite');
    expect(i18n.t('chat:title')).toBe('Chat');
  });
});
