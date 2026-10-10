import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installOfflineRecovery } from './offline-recovery';

let stop: (() => void) | undefined;
const reload = vi.fn();

function shell(healthProbe = 'api/health/ready'): void {
  document.body.innerHTML =
    '<h1 id="offline-title"></h1><p id="offline-description"></p><div id="status"><span id="status-text"></span></div><button id="retry-button">Try again</button>';
  if (healthProbe) document.body.dataset.healthProbe = healthProbe;
  else delete document.body.dataset.healthProbe;
}

function controller(scope = '/'): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: { scriptURL: new URL(`${scope}sw.js`, location.origin).href },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockClear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  controller();
  shell();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  delete document.body.dataset.healthProbe;
});

describe('offline shell recovery', () => {
  it('keeps an HTML proxy 503 on the shell, then recovers without an online event', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('<h1>Unavailable</h1>', { status: 503 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    stop = installOfflineRecovery(reload);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById('offline-title')?.textContent).toBe(
      "Can't reach Tale",
    );
    expect(document.getElementById('retry-button')).not.toBeDisabled();
    expect(reload).not.toHaveBeenCalled();
    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json({ ok: true, service: 'backend' })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response('<!doctype html>app', {
            headers: { 'content-type': 'text/html' },
          }),
        ),
      );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(document.getElementById('status-text')?.textContent).toBe(
      'Back online',
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    () =>
      new Response('<h1>Wrong tier</h1>', {
        headers: { 'content-type': 'text/html' },
      }),
    () => Response.json({ ok: true }),
    () => Response.json({ ok: true, service: 'platform' }),
    () => Response.json({ ok: false, service: 'backend' }),
  ])('does not mistake an unrelated HTTP 200 for readiness', async (answer) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(answer())),
    );
    stop = installOfflineRecovery(reload);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('requires the document tier as well as the backend, using the worker scope', async () => {
    controller('/tale/');
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json({ ok: true, service: 'backend' })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('proxy', { status: 503 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    stop = installOfflineRecovery(reload);
    await vi.advanceTimersByTimeAsync(0);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/tale/api/health/ready?',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('aborts a hung request, re-enables retry, and keeps only one probe in flight', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    stop = installOfflineRecovery(reload);
    window.dispatchEvent(new Event('online'));
    document.getElementById('retry-button')?.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(document.getElementById('retry-button')).not.toBeDisabled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(['api/health/ready', ''])(
    'waits for the complete document under the deadline (health probe: %s)',
    async (healthProbe) => {
      shell(healthProbe);
      let documents = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: URL, init: RequestInit) => {
          if (url.pathname.endsWith('/api/health/ready'))
            return Promise.resolve(
              Response.json({ ok: true, service: 'backend' }),
            );
          documents += 1;
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(stream) {
                  stream.enqueue(new TextEncoder().encode('<!doctype html>'));
                  init.signal?.addEventListener('abort', () =>
                    stream.error(new DOMException('Aborted', 'AbortError')),
                  );
                },
              }),
              { headers: { 'content-type': 'text/html' } },
            ),
          );
        }),
      );
      stop = installOfflineRecovery(reload);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(documents).toBe(1);
      expect(reload).not.toHaveBeenCalled();
      expect(document.getElementById('retry-button')).not.toBeDisabled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(documents).toBe(2);
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it('follows document redirects for a docs site and stops all work on cleanup', async () => {
    shell('');
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response('<!doctype html>docs', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    stop = installOfflineRecovery(reload);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'follow',
      cache: 'no-store',
    });
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    window.dispatchEvent(new Event('online'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ['de-CH', 'Du bist offline', 'de'],
    ['fr-FR', 'Tu es hors ligne', 'fr'],
  ])(
    'uses %s without network-loaded translations',
    async (language, title, lang) => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('offline')),
      );
      stop = installOfflineRecovery(reload);
      await vi.advanceTimersByTimeAsync(0);
      expect(document.getElementById('offline-title')?.textContent).toBe(title);
      expect(document.documentElement.lang).toBe(lang);
    },
  );
});
