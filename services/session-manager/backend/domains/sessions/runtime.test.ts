import net from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FakeBackend,
  Gate,
  fakeIdentity,
  fakeLocation,
} from '../../testing/fake-browser.ts';
import { settle } from '../../testing/promises.ts';
import { parseProxy } from '../proxies/parsing.ts';
import type { ProxyConfig, RunningBridge } from '../proxies/types.ts';
import {
  ACTIVE,
  SHUTDOWN_TIMEOUT_MS,
  SessionRuntime,
  StartError,
} from './runtime.ts';
import type { Launch, Prepare, SessionState, Status } from './runtime.ts';

const HTTP_PROXY = parseProxy('http://192.0.2.1:8080');
const PROFILES = '/tmp/session-manager-runtime-test';

const runtimes: SessionRuntime[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});

function setup(options: ConstructorParameters<typeof SessionRuntime>[1] = {}) {
  const backend = new FakeBackend();
  const runtime = new SessionRuntime(backend, options);
  runtimes.push(runtime);
  return { backend, runtime };
}

function place(ip: string) {
  return fakeLocation(ip, { timezone: 'America/Chicago' });
}

function launchOf(
  upstream: ProxyConfig = HTTP_PROXY,
  ip = '8.8.8.8',
  name = '0001',
): Launch {
  return { name, identity: fakeIdentity(), upstream, location: place(ip) };
}

function ready(upstream: ProxyConfig = HTTP_PROXY): Prepare {
  return () => Promise.resolve(launchOf(upstream));
}

function start(
  runtime: SessionRuntime,
  upstream: ProxyConfig = HTTP_PROXY,
  sessionId = 1,
): void {
  runtime.start(sessionId, {
    profileDir: `${PROFILES}/${sessionId}`,
    prepare: ready(upstream),
  });
}

const idle = (status: Status): SessionState => ({
  status,
  activity: null,
  error: null,
  errorCode: null,
  errorExtra: null,
});

/** Until the session has the status (and, unless it is active, its task has ended). */
async function waitFor(
  runtime: SessionRuntime,
  status: Status,
  sessionId = 1,
): Promise<void> {
  for (let round = 0; round < 500; round++) {
    const reached =
      runtime.state(sessionId).status === status &&
      (ACTIVE.has(status) || !runtime.isBusy(sessionId));
    if (reached) return;
    await settle();
  }
  throw new Error(
    `session ${sessionId} is ${JSON.stringify(runtime.state(sessionId))}, expected ${status}`,
  );
}

/** Watches a promise: `settled` turns true once it resolved or rejected. */
function track(promise: Promise<unknown>): { readonly settled: boolean } {
  const state = { settled: false };
  const markSettled = (): boolean => (state.settled = true);
  promise.then(markSettled, markSettled);
  return state;
}

/** A prepare that waits for the stop, as a well-behaved one does. */
function waitsForStop(onCancelled: () => void): Prepare {
  return async (signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    onCancelled();
    signal.throwIfAborted();
    throw new Error('the preparation was not stopped');
  };
}

describe('start and stop', () => {
  it('starts a browser with the launch, and stops it', async () => {
    const { backend, runtime } = setup();
    expect(runtime.state(1)).toEqual(idle('stopped'));
    start(runtime);
    expect(runtime.state(1)).toEqual({
      status: 'starting',
      activity: 'launching',
      error: null,
      errorCode: null,
      errorExtra: null,
    });
    await waitFor(runtime, 'running');
    expect(runtime.state(1)).toEqual(idle('running'));
    expect(backend.launches).toHaveLength(1);
    const browser = backend.latest();
    expect(browser.spec.proxy).toEqual({ server: 'http://192.0.2.1:8080' });
    expect(browser.spec.location.ip).toBe('8.8.8.8');
    expect(browser.spec.profileDir).toBe(`${PROFILES}/1`);
    expect(browser.spec.name).toBe('0001');
    expect(runtime.handle(1)).toBe(browser);
    expect(runtime.isActive(1)).toBe(true);
    expect(runtime.isBusy(1)).toBe(true);
    expect(() => start(runtime)).toThrow('session 1 is busy'); // one browser per profile

    await runtime.stop(1);
    expect(runtime.state(1).status).toBe('stopping');
    await waitFor(runtime, 'stopped');
    expect(browser.closed).toBe(true);
    expect(browser.closeCalls).toBe(1);
    expect(runtime.handle(1)).toBeNull();
    expect(runtime.isActive(1)).toBe(false);
    expect(runtime.isBusy(1)).toBe(false);
  });

  it('gives the launch its tabs, start page and layout listener, with defaults', async () => {
    const { backend, runtime } = setup();
    runtime.start(1, { profileDir: PROFILES, prepare: ready() });
    await waitFor(runtime, 'running');
    expect(backend.latest().spec.tabs).toEqual({ urls: [], active: 0 });
    expect(backend.latest().spec.startPage).toBe('https://www.google.com');
    expect(backend.latest().spec.onLayout).toBeUndefined();

    const layouts: unknown[] = [];
    const tabs = { urls: ['https://a.example'], active: 0 };
    runtime.start(2, {
      profileDir: PROFILES,
      prepare: async () => ({
        ...launchOf(),
        tabs,
        startPage: 'https://start.example',
        onLayout: (layout) => layouts.push(layout),
      }),
    });
    await waitFor(runtime, 'running', 2);
    const spec = backend.latest().spec;
    expect(spec.tabs).toBe(tabs);
    expect(spec.startPage).toBe('https://start.example');
    expect(layouts).toEqual([tabs]); // the fake browser reports its tabs at the start
  });

  it('ends the session when the browser exits on its own', async () => {
    const { backend, runtime } = setup();
    start(runtime);
    await waitFor(runtime, 'running');
    backend.latest().crash();
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual(idle('stopped'));
    expect(runtime.handle(1)).toBeNull();
    expect(backend.latest().closeCalls).toBe(1); // closed once, whoever noticed first
  });

  it('reports a failed launch by its first line, and can be started again', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { backend, runtime } = setup();
    backend.launchError = new Error(
      'A copy of Camoufox is already open.\nCall log: ...',
    );
    start(runtime);
    await waitFor(runtime, 'error');
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'A copy of Camoufox is already open.',
      errorCode: null,
      errorExtra: null,
    });
    expect(error).toHaveBeenCalled();
    expect(runtime.isActive(1)).toBe(false);

    backend.launchError = null;
    start(runtime);
    await waitFor(runtime, 'running');
    expect(runtime.state(1)).toEqual(idle('running')); // the old error is gone
  });

  it('carries the code of a start error that ends the preparation', async () => {
    const { backend, runtime } = setup();
    runtime.start(1, {
      profileDir: PROFILES,
      assigning: true,
      prepare: () =>
        Promise.reject(
          new StartError('no_working_proxy', 'No working proxy available.'),
        ),
    });
    expect(runtime.state(1)).toEqual({
      status: 'starting',
      activity: 'assigning_proxy',
      error: null,
      errorCode: null,
      errorExtra: null,
    });
    await waitFor(runtime, 'error');
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'No working proxy available.',
      errorCode: 'no_working_proxy',
      errorExtra: null,
    });
    expect(backend.attempts).toEqual([]);
  });

  it('keeps what a start error names besides its code, until the next start', async () => {
    const { runtime } = setup();
    const cause = 'the GeoIP database has no location for 8.8.8.8';
    runtime.start(1, {
      profileDir: PROFILES,
      prepare: () =>
        Promise.reject(
          new StartError('unknown_ip_location', 'Cannot match.', {
            reason: cause,
          }),
        ),
    });
    await waitFor(runtime, 'error');
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'Cannot match.',
      errorCode: 'unknown_ip_location',
      errorExtra: { reason: cause },
    });

    start(runtime);
    await waitFor(runtime, 'running');
    expect(runtime.state(1)).toEqual(idle('running'));
  });

  it('shows no details for a start error that names none', async () => {
    const { runtime } = setup();
    const error = new StartError('no_working_proxy', 'No free proxy.');
    expect(error.extra).toEqual({});
    runtime.start(1, {
      profileDir: PROFILES,
      prepare: () => Promise.reject(error),
    });
    await waitFor(runtime, 'error');
    expect(runtime.state(1).errorExtra).toBeNull(); // not an empty object
  });

  it('hands out the details as a copy: what a reader does with them is its own', async () => {
    const { runtime } = setup();
    runtime.fail(1, 'proxy_unreachable', 'Its proxy is not working.', {
      proxyId: 7,
      reason: 'cannot connect to the proxy',
    });
    const shown = runtime.state(1).errorExtra;
    if (shown === null) throw new Error('the details were lost');
    shown.reason = 'changed';
    expect(runtime.state(1).errorExtra).toEqual({
      proxyId: 7,
      reason: 'cannot connect to the proxy',
    });
  });

  it('shows the assignment only when asked to', () => {
    const { runtime } = setup();
    const never = () => new Promise<Launch>(() => undefined);
    runtime.start(1, { profileDir: PROFILES, prepare: never });
    runtime.start(2, { profileDir: PROFILES, prepare: never, assigning: true });
    expect(runtime.state(1).activity).toBe('launching');
    expect(runtime.state(2).activity).toBe('assigning_proxy');
  });
});

describe('stopping before the browser is launched', () => {
  it('cancels the preparation, and returns once it is cancelled', async () => {
    const { backend, runtime } = setup();
    let cancelled = false;
    runtime.start(1, {
      profileDir: PROFILES,
      assigning: true,
      prepare: waitsForStop(() => {
        cancelled = true;
      }),
    });
    await settle();
    await runtime.stop(1);
    expect(runtime.isBusy(1)).toBe(false);
    expect(runtime.state(1)).toEqual(idle('stopped'));
    await settle();
    expect(cancelled).toBe(true);
    expect(backend.attempts).toEqual([]);
  });

  it('tells the preparation to stop through the signal, and ends the task at once even if it ignores it', async () => {
    const { backend, runtime } = setup();
    let signalSeen: AbortSignal | undefined;
    const late = Promise.withResolvers<Launch>();
    runtime.start(1, {
      profileDir: PROFILES,
      prepare: (signal) => {
        signalSeen = signal;
        return late.promise;
      },
    });
    await settle();
    expect(signalSeen?.aborted).toBe(false);
    await runtime.stop(1);
    expect(signalSeen?.aborted).toBe(true);
    expect(runtime.isBusy(1)).toBe(false);
    expect(runtime.state(1)).toEqual(idle('stopped'));

    // The preparation finishes after all: nobody launches with its result.
    late.resolve(launchOf());
    await settle();
    expect(backend.attempts).toEqual([]);
    expect(runtime.state(1)).toEqual(idle('stopped'));
  });

  it('does not even begin the preparation when the stop comes first', async () => {
    const { backend, runtime } = setup();
    const prepare = vi.fn(ready());
    runtime.start(1, { profileDir: PROFILES, prepare });
    await runtime.stop(1);
    await settle();
    expect(prepare).not.toHaveBeenCalled();
    expect(backend.attempts).toEqual([]);
    expect(runtime.state(1)).toEqual(idle('stopped'));
  });

  it.each([0, 1, 2, 3, 4, 5, 6])(
    'ends stopped, with no browser left open, when the stop comes %i turns after the preparation returned',
    async (turns) => {
      const { backend, runtime } = setup();
      // The stop lands `turns` microtask turns after the preparation returned:
      // before the task goes on (nothing launches) or after (the browser
      // launches and is closed again), but never in between.
      const later = (count: number, action: () => void): void => {
        if (count === 0) action();
        else queueMicrotask(() => later(count - 1, action));
      };
      runtime.start(1, {
        profileDir: PROFILES,
        prepare: async () => {
          later(turns, () => void runtime.stop(1));
          return launchOf();
        },
      });
      await settle();
      await settle();
      expect(runtime.state(1)).toEqual(idle('stopped'));
      expect(runtime.isBusy(1)).toBe(false);
      expect(runtime.handle(1)).toBeNull();
      expect(backend.launches.every((browser) => browser.closed)).toBe(true);
    },
  );

  it('ignores a failure of an abandoned preparation', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { runtime } = setup();
      const late = Promise.withResolvers<Launch>();
      runtime.start(1, { profileDir: PROFILES, prepare: () => late.promise });
      await settle();
      await runtime.stop(1);
      late.reject(new Error('fails after the stop'));
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(runtime.state(1)).toEqual(idle('stopped'));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('closes the browser once it is launched when the stop came while launching', async () => {
    const { backend, runtime } = setup();
    backend.launchGate = new Gate();
    start(runtime);
    await settle();
    await runtime.stop(1);
    expect(runtime.state(1).status).toBe('stopping');
    expect(runtime.state(1).activity).toBe('launching');
    backend.launchGate.open();
    await waitFor(runtime, 'stopped');
    expect(backend.latest().closed).toBe(true);
  });

  it('does not say a browser is running that was asked to stop while it launched', async () => {
    const { backend, runtime } = setup();
    // The browser comes up and takes its time to close.
    const closing = Promise.withResolvers<void>();
    const original = backend.launch.bind(backend);
    vi.spyOn(backend, 'launch').mockImplementation(async (spec) => {
      const browser = await original(spec);
      const closed = browser.close.bind(browser);
      vi.spyOn(browser, 'close').mockImplementation(async () => {
        await closing.promise;
        await closed();
      });
      return browser;
    });
    backend.launchGate = new Gate();
    start(runtime);
    await settle();
    await runtime.stop(1);
    backend.launchGate.open();
    for (let round = 0; round < 5; round++) await settle();
    expect(runtime.state(1)).toEqual({
      status: 'stopping',
      activity: null,
      error: null,
      errorCode: null,
      errorExtra: null,
    });
    closing.resolve();
    await waitFor(runtime, 'stopped');
    expect(backend.latest().closed).toBe(true);
  });

  it('does nothing for a session that was never started, or is over', async () => {
    const { runtime } = setup();
    await runtime.stop(7);
    await runtime.stopAndWait(7);
    start(runtime);
    await waitFor(runtime, 'running');
    await runtime.stopAndWait(1);
    expect(runtime.isBusy(1)).toBe(false);
    await runtime.stop(1);
    expect(runtime.state(1)).toEqual(idle('stopped'));
  });
});

describe('restart', () => {
  it('launches again only after the old browser has closed', async () => {
    const { backend, runtime } = setup();
    start(runtime);
    await waitFor(runtime, 'running');
    const old = backend.latest();
    let oldClosedWhenPrepared: boolean | undefined;
    const other = parseProxy('http://192.0.2.2:8080');

    runtime.restart(1, {
      profileDir: `${PROFILES}/1`,
      prepare: async () => {
        oldClosedWhenPrepared = old.closed; // the profile is free again
        return launchOf(other, '1.1.1.1');
      },
    });
    expect(runtime.state(1)).toEqual({
      status: 'starting',
      activity: 'assigning_proxy',
      error: null,
      errorCode: null,
      errorExtra: null,
    });
    await waitFor(runtime, 'running');
    expect(oldClosedWhenPrepared).toBe(true);
    expect(backend.launches.map((browser) => browser.spec.location.ip)).toEqual(
      ['8.8.8.8', '1.1.1.1'],
    );
    expect(runtime.handle(1)).toBe(backend.launches[1]);
    expect(backend.launches[1].closed).toBe(false);
  });

  it('can leave the assignment out, and starts a session that is not running', async () => {
    const { backend, runtime } = setup();
    runtime.restart(1, {
      profileDir: PROFILES,
      prepare: ready(),
      assigning: false,
    });
    expect(runtime.state(1).activity).toBe('launching');
    await waitFor(runtime, 'running');
    expect(backend.launches).toHaveLength(1);
  });

  it('can be stopped while it waits for the old browser', async () => {
    const { backend, runtime } = setup();
    start(runtime);
    await waitFor(runtime, 'running');
    const old = backend.latest();
    const closing = Promise.withResolvers<void>();
    vi.spyOn(old, 'close').mockImplementation(async () => {
      await closing.promise;
    });
    const prepare = vi.fn(ready());
    runtime.restart(1, { profileDir: PROFILES, prepare });
    await settle();
    expect(prepare).not.toHaveBeenCalled(); // the old browser is still closing
    await runtime.stop(1);
    expect(runtime.state(1)).toEqual(idle('stopped'));
    expect(runtime.isBusy(1)).toBe(true); // the old task is still closing its browser
    closing.resolve();
    await waitFor(runtime, 'stopped');
    expect(prepare).not.toHaveBeenCalled();
    expect(backend.launches).toHaveLength(1);
  });
});

describe('changing the proxy', () => {
  it('keeps the session stopped, and shows the error of a failed assignment', async () => {
    const { runtime } = setup();
    const gate = new Gate();
    runtime.changeProxy(1, async () => {
      await gate.wait();
      throw new StartError('no_working_proxy', 'No working proxy available.');
    });
    expect(runtime.state(1)).toEqual({
      status: 'stopped',
      activity: 'assigning_proxy',
      error: null,
      errorCode: null,
      errorExtra: null,
    });
    expect(runtime.isBusy(1)).toBe(true);
    expect(() => start(runtime)).toThrow('busy');
    gate.open();
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual({
      status: 'stopped',
      activity: null,
      error: 'No working proxy available.',
      errorCode: 'no_working_proxy',
      errorExtra: null,
    });
  });

  it('shows how many proxies failed when a rotation finds none that works', async () => {
    const { runtime } = setup();
    runtime.changeProxy(1, () =>
      Promise.reject(
        new StartError(
          'no_working_proxy',
          'No working proxy available (2 failed their check).',
          { failed: 2 },
        ),
      ),
    );
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual({
      status: 'stopped',
      activity: null,
      error: 'No working proxy available (2 failed their check).',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 2 },
    });

    runtime.changeProxy(1, async () => undefined);
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual(idle('stopped')); // the next try starts clean
  });

  it('ends cleanly when it works', async () => {
    const { runtime } = setup();
    const assign = vi.fn(async () => 'claimed');
    runtime.changeProxy(1, assign);
    await waitFor(runtime, 'stopped');
    expect(assign).toHaveBeenCalledOnce();
    expect(runtime.state(1)).toEqual(idle('stopped'));
  });

  it('shows the first line of an unexpected failure and logs it', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { runtime } = setup();
    runtime.changeProxy(1, () => Promise.reject(new Error('disk full\nmore')));
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual({
      status: 'stopped',
      activity: null,
      error: 'disk full',
      errorCode: null,
      errorExtra: null,
    });
    expect(error).toHaveBeenCalledWith(
      'changing the proxy failed',
      expect.any(Error),
    );
  });

  it('is cancelled by a stop', async () => {
    const { runtime } = setup();
    let cancelled = false;
    runtime.changeProxy(
      1,
      waitsForStop(() => {
        cancelled = true;
      }),
    );
    await settle();
    await runtime.stop(1);
    expect(runtime.state(1)).toEqual(idle('stopped'));
    expect(runtime.isBusy(1)).toBe(false);
    await settle();
    expect(cancelled).toBe(true);
  });

  it('may follow a failed start: it clears the error', async () => {
    const { runtime } = setup();
    runtime.fail(1, 'proxy_unreachable', 'Its proxy is not working.');
    runtime.changeProxy(1, async () => undefined);
    await waitFor(runtime, 'stopped');
    expect(runtime.state(1)).toEqual(idle('stopped'));
  });
});

describe('fail', () => {
  it('shows why a start was refused before anything ran, until the next start', async () => {
    const { backend, runtime } = setup();
    runtime.fail(1, 'proxy_unreachable', 'Its proxy is not working.');
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'Its proxy is not working.',
      errorCode: 'proxy_unreachable',
      errorExtra: null,
    });
    expect(runtime.isBusy(1)).toBe(false);
    expect(runtime.isActive(1)).toBe(false);
    start(runtime);
    await waitFor(runtime, 'running');
    expect(runtime.state(1)).toEqual(idle('running'));
    expect(backend.launches).toHaveLength(1);
  });

  it('shows the details of the refusal with it, and drops them with it', async () => {
    const { runtime } = setup();
    runtime.fail(1, 'proxy_unreachable', 'Its proxy is not working.', {
      proxyId: 7,
      reason: 'cannot connect to the proxy',
    });
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'Its proxy is not working.',
      errorCode: 'proxy_unreachable',
      errorExtra: { proxyId: 7, reason: 'cannot connect to the proxy' },
    });
    start(runtime);
    await waitFor(runtime, 'running');
    expect(runtime.state(1).errorExtra).toBeNull();
  });

  it('refuses a session that is busy', async () => {
    const { runtime } = setup();
    start(runtime);
    expect(() => runtime.fail(1, 'x', 'y')).toThrow('busy');
    await waitFor(runtime, 'running');
    expect(() => runtime.fail(1, 'x', 'y')).toThrow('busy');
  });
});

describe('what an unexpected failure shows', () => {
  async function failureOf(thrown: unknown): Promise<string | null> {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runtime } = setup();
    runtime.start(1, {
      profileDir: PROFILES,
      prepare: () => Promise.reject(thrown),
    });
    await waitFor(runtime, 'error');
    return runtime.state(1).error;
  }

  it('is the first line of the message', async () => {
    expect(await failureOf(new Error('first\r\nsecond'))).toBe('first');
    // Only the whole text is trimmed.
    expect(await failureOf(new Error('  padded\nsecond  '))).toBe('padded');
    expect(await failureOf(new Error('a\u2028b'))).toBe('a'); // any line break
    expect(await failureOf(new Error('one line only'))).toBe('one line only');
  });

  it('is at most 300 characters, counting characters as a person does', async () => {
    expect(await failureOf(new Error('x'.repeat(500)))).toBe('x'.repeat(300));
    const emoji = '😀'.repeat(400);
    expect(await failureOf(new Error(emoji))).toBe('😀'.repeat(300));
  });

  it('is the name of the error when it has no message', async () => {
    expect(await failureOf(new Error(''))).toBe('Error');
    expect(await failureOf(new TypeError('  '))).toBe('TypeError');
  });

  it('is the text of something that is not an error', async () => {
    expect(await failureOf('plain text')).toBe('plain text');
  });
});

describe('a proxy with credentials', () => {
  async function connects(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
  }

  function portOf(server: string): number {
    return Number(server.slice(server.lastIndexOf(':') + 1));
  }

  it.each(['http', 'https', 'socks5'])(
    'goes through a local bridge that closes with the session (%s)',
    async (scheme) => {
      const { backend, runtime } = setup();
      start(runtime, parseProxy(`${scheme}://user:secret@192.0.2.1:8080`));
      await waitFor(runtime, 'running');
      const proxy = backend.latest().spec.proxy;
      // The browser gets no credentials: a local address, and nothing else.
      expect(Object.keys(proxy)).toEqual(['server']);
      expect(proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(JSON.stringify(backend.attempts)).not.toContain('secret');
      const port = portOf(proxy.server);
      expect(await connects(port)).toBe(true); // the bridge is listening

      await runtime.stopAndWait(1);
      expect(await connects(port)).toBe(false); // and gone with the session
    },
  );

  it('is closed when the launch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { backend, runtime } = setup();
    backend.launchError = new Error('boom');
    start(runtime, parseProxy('http://user:secret@192.0.2.1:8080'));
    await waitFor(runtime, 'error');
    const port = portOf(backend.attempts[0].proxy.server);
    expect(await connects(port)).toBe(false);
    expect(runtime.state(1).error).toBe('boom');
  });

  it('is closed after the browser, and only then', async () => {
    const events: string[] = [];
    const bridge: RunningBridge = {
      port: 4321,
      playwrightProxy: { server: 'http://127.0.0.1:4321' },
      close: async () => {
        events.push('bridge closed');
      },
    };
    const startBridge = vi.fn(async (upstream: ProxyConfig) => {
      events.push(`bridge started for ${upstream.host}`);
      return bridge;
    });
    const { backend, runtime } = setup({ startBridge });
    start(runtime, parseProxy('http://user:secret@192.0.2.1:8080'));
    await waitFor(runtime, 'running');
    const browser = backend.latest();
    expect(browser.spec.proxy).toEqual({ server: 'http://127.0.0.1:4321' });
    const close = browser.close.bind(browser);
    vi.spyOn(browser, 'close').mockImplementation(async () => {
      events.push('browser closing');
      await close();
      events.push('browser closed');
    });
    await runtime.stopAndWait(1);
    expect(events).toEqual([
      'bridge started for 192.0.2.1',
      'browser closing',
      'browser closed',
      'bridge closed',
    ]);
  });

  it('is closed even when the browser will not close, and the session shows the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const close = vi.fn(async () => undefined);
    const startBridge = async () => ({
      port: 1,
      playwrightProxy: { server: 'http://127.0.0.1:1' },
      close,
    });
    const { backend, runtime } = setup({ startBridge });
    start(runtime, parseProxy('http://user:secret@192.0.2.1:8080'));
    await waitFor(runtime, 'running');
    vi.spyOn(backend.latest(), 'close').mockRejectedValue(
      new Error('could not close\nin detail'),
    );
    await runtime.stopAndWait(1);
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.state(1)).toEqual({
      status: 'error',
      activity: null,
      error: 'could not close',
      errorCode: null,
      errorExtra: null,
    });
  });

  it('is not needed for a proxy without credentials, which is passed directly', async () => {
    const startBridge = vi.fn();
    const { backend, runtime } = setup({ startBridge });
    for (const [id, url] of [
      [1, 'http://192.0.2.1:8080'],
      [2, 'https://192.0.2.1:8443'],
      [3, 'socks5://192.0.2.1:1080'],
    ] as const) {
      start(runtime, parseProxy(url), id);
      await waitFor(runtime, 'running', id);
      expect(backend.latest().spec.proxy).toEqual({ server: url });
    }
    expect(startBridge).not.toHaveBeenCalled();
  });

  it('shows the error when the bridge cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const startBridge = vi.fn(async () => {
      throw new Error('address in use');
    });
    const { backend, runtime } = setup({ startBridge });
    start(runtime, parseProxy('http://user:secret@192.0.2.1:8080'));
    await waitFor(runtime, 'error');
    expect(runtime.state(1).error).toBe('address in use');
    expect(backend.attempts).toEqual([]);
  });
});

describe('a browser that cannot say it is gone', () => {
  it('is taken for gone, and closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { backend, runtime } = setup();
    backend.launchGate = null;
    const original = backend.launch.bind(backend);
    vi.spyOn(backend, 'launch').mockImplementation(async (spec) => {
      const browser = await original(spec);
      vi.spyOn(browser, 'waitClosed').mockRejectedValue(new Error('lost'));
      return browser;
    });
    start(runtime);
    await waitFor(runtime, 'stopped');
    expect(backend.latest().closeCalls).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe('forget', () => {
  it('drops the state of a session', async () => {
    const { runtime } = setup();
    runtime.fail(1, 'x', 'y');
    runtime.forget(1);
    expect(runtime.state(1)).toEqual(idle('stopped'));
    start(runtime);
    await waitFor(runtime, 'running');
    await runtime.stopAndWait(1);
    runtime.forget(1);
    expect(runtime.isBusy(1)).toBe(false);
    expect(runtime.handle(1)).toBeNull();
  });
});

describe('shutdown', () => {
  it('closes every browser and cancels the starts that are still preparing', async () => {
    const { backend, runtime } = setup();
    for (const id of [1, 2]) {
      start(runtime, HTTP_PROXY, id);
      await waitFor(runtime, 'running', id);
    }
    runtime.start(3, {
      profileDir: `${PROFILES}/3`,
      assigning: true,
      prepare: () => new Promise<Launch>(() => undefined),
    });
    await runtime.shutdown();
    expect(backend.launches.every((browser) => browser.closed)).toBe(true);
    expect([1, 2, 3].map((id) => runtime.state(id).status)).toEqual([
      'stopped',
      'stopped',
      'stopped',
    ]);
    expect([1, 2, 3].some((id) => runtime.isBusy(id))).toBe(false);
  });

  it('has nothing to wait for when nothing runs', async () => {
    const sleep = vi.fn(() => new Promise<void>(() => undefined));
    const { runtime } = setup({ sleep });
    await runtime.shutdown();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('waits for the browsers at most the bound, 30 seconds by default', async () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const waited: number[] = [];
    const expire = Promise.withResolvers<void>();
    const { backend, runtime } = setup({
      sleep: (ms) => {
        waited.push(ms);
        return expire.promise;
      },
    });
    start(runtime);
    await waitFor(runtime, 'running');
    // A browser that never finishes closing.
    vi.spyOn(backend.latest(), 'close').mockImplementation(
      () => new Promise<void>(() => undefined),
    );

    const shutting = runtime.shutdown();
    const returned = track(shutting);
    await settle();
    expect(returned.settled).toBe(false);
    expect(waited).toEqual([30_000]);
    expire.resolve();
    await shutting;
    expect(returned.settled).toBe(true);
    expect(warn).toHaveBeenCalledWith('session 1 did not stop within 30000 ms');
  });

  it('does not wait for the bound when the browsers close in time', async () => {
    const sleepSignals: AbortSignal[] = [];
    const { runtime } = setup({
      sleep: (_ms, signal) => {
        if (signal !== undefined) sleepSignals.push(signal);
        return new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    start(runtime);
    await waitFor(runtime, 'running');
    await runtime.shutdown();
    // The timer was dropped.
    expect(sleepSignals).toHaveLength(1);
    expect(sleepSignals[0].aborted).toBe(true);
  });
});
