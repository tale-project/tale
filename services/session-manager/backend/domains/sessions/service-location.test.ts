// A session says where it is (timezone, geolocation, language): that must
// always fit the proxy's exit IP, and stay the same for as long as the exit IP
// does.

import { Database } from 'bun:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '../../../lib/api/schemas.ts';
import { Gate, NEW_YORK } from '../../testing/fake-browser.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  getSession,
  refusalOf,
  waitFor,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager, TestManagerOptions } from '../../testing/harness.ts';
import { GeoLookupError } from '../identity/types.ts';
import type { GeoInfo } from '../identity/types.ts';
import {
  FIRST_RECHECK_MS,
  RECHECK_EVERY_MS,
  WATCH_TICK_MS,
} from './service.ts';

const ZURICH: GeoInfo = {
  country: 'CH',
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  latitude: 47.37,
  longitude: 8.54,
};
const GENEVA: GeoInfo = {
  country: 'CH',
  locale: 'fr-CH',
  timezone: 'Europe/Zurich',
  latitude: 46.2,
  longitude: 6.14,
};

const apps: TestManager[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: TestManagerOptions): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

/** A proxy and a running session on it. */
async function running(
  app: TestManager,
  proxy = '192.0.2.1:8080',
  name = 'a',
): Promise<Session> {
  addProxy(app.manager, proxy);
  const created = await createSession(app.manager, name);
  return waitForStatus(app.manager, created.id, 'running');
}

async function stop(app: TestManager, id: number): Promise<Session> {
  await app.manager.stopSession(id);
  return waitForStatus(app.manager, id, 'stopped');
}

/** Stops the session and starts it again. */
async function restart(app: TestManager, id: number): Promise<Session> {
  await stop(app, id);
  await app.manager.startSession(id);
  return waitForStatus(app.manager, id, 'running');
}

describe('the place', () => {
  it('is that of the exit IP', async () => {
    const app = setup();
    app.backend.geo = ZURICH;
    const session = await running(app);
    expect(session.location).toEqual({
      ip: '203.0.113.1',
      country: 'CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
      inSync: true,
    });
    // Looked up for the exit IP the proxy was checked with, and that is what the browser starts with.
    expect(app.backend.lookups).toEqual(['203.0.113.1']);
    expect(app.backend.launches[0].spec.location.ip).toBe('203.0.113.1');
    expect(session.fingerprint.timezone).toBe('Europe/Zurich');
    expect(session.fingerprint.locale).toBe('de-CH');

    const done = await stop(app, session.id);
    expect(done.location?.inSync).toBeNull(); // only a running session can be out of step
  });

  it('stays the same while the exit IP does', async () => {
    const app = setup();
    app.backend.geo = ZURICH;
    const session = await running(app);
    const first = app.backend.launches[0].spec;
    app.backend.geo = GENEVA; // the GeoIP database was updated: it now puts the same IP elsewhere, in French

    const again = await restart(app, session.id);
    const second = app.backend.launches[1].spec;
    expect(second.location).toEqual(first.location); // the same timezone and coordinates
    expect(second.identity.locale).toBe(first.identity.locale);
    expect(second.identity.locale).toBe('de-CH'); // and the same language
    expect(again.location).toEqual({ ...session.location, inSync: true });
    expect(app.backend.lookups).toEqual(['203.0.113.1']); // the database was not even asked again

    await restart(app, session.id);
    expect(app.backend.launches[2].spec.location).toEqual(first.location);
    expect(app.backend.lookups).toHaveLength(1);
  });

  it('is derived again for another exit IP of the same proxy, and the language only for another country', async () => {
    const app = setup();
    app.backend.geo = ZURICH;
    const session = await running(app);
    // The proxy now exits through another IP in the same country: a new place, but the language is kept.
    app.checker.setIp('192.0.2.1:8080', '203.0.113.77');
    app.backend.geo = GENEVA;
    app.manager.checkProxy(1);
    const moved = await restart(app, session.id);
    expect(moved.location?.ip).toBe('203.0.113.77');
    expect(moved.location?.latitude).toBe(46.2);
    expect(moved.fingerprint.locale).toBe('de-CH'); // same country: the language does not change

    // Another country: the language is drawn again for it.
    app.checker.setIp('192.0.2.1:8080', '203.0.113.88');
    app.backend.geo = NEW_YORK;
    app.manager.checkProxy(1);
    const abroad = await restart(app, session.id);
    expect(abroad.location?.country).toBe('US');
    expect(abroad.location?.timezone).toBe('America/New_York');
    expect(abroad.fingerprint.locale).toBe('en-US');
    expect(app.backend.latest().spec.identity.locale).toBe('en-US');
  });

  it('is found for a session that has none, which keeps its language', async () => {
    // A session from before places were kept has a language but no place.
    const app = setup({ store: 'file' });
    app.backend.geo = ZURICH;
    const session = await running(app);
    await stop(app, session.id);
    const raw = new Database(app.dbPath ?? '');
    try {
      raw.run('UPDATE sessions SET location = NULL'); // what an older database looks like
    } finally {
      raw.close();
    }
    app.backend.geo = GENEVA; // drawing a language again would give fr-CH
    await app.manager.startSession(session.id);
    const again = await waitForStatus(app.manager, session.id, 'running');
    expect(again.location?.latitude).toBe(46.2);
    expect(again.fingerprint.locale).toBe('de-CH');
  });

  it('keeps the place and finds the language for a session that has a place but no language', async () => {
    const app = setup({ store: 'file' });
    app.backend.geo = ZURICH;
    const session = await running(app);
    await stop(app, session.id);
    const raw = new Database(app.dbPath ?? '');
    try {
      raw.run(
        `UPDATE sessions SET identity = json_set(identity, '$.locale', json('null'))`,
      );
    } finally {
      raw.close();
    }
    expect(app.manager.session(session.id).fingerprint.locale).toBeNull();
    app.backend.geo = GENEVA; // asked again for the language, it says French
    await app.manager.startSession(session.id);
    const again = await waitForStatus(app.manager, session.id, 'running');
    expect(again.location).toEqual({ ...session.location, inSync: true }); // the place is the one it had
    expect(again.fingerprint.locale).toBe('fr-CH');
    expect(app.backend.lookups).toEqual(['203.0.113.1', '203.0.113.1']);
  });

  it('is new, with a new language, for a new proxy', async () => {
    const app = setup();
    app.backend.geo = ZURICH;
    const session = await running(app);
    addProxy(app.manager, '192.0.2.2:8080');
    app.backend.geo = NEW_YORK;
    const rotating = await app.manager.rotateSession(session.id);
    expect(rotating.status).toBe('starting');
    const rotated = await waitForStatus(app.manager, session.id, 'running');
    expect(rotated.location?.ip).toBe('203.0.113.2');
    expect(rotated.location?.timezone).toBe('America/New_York');
    expect(rotated.fingerprint.locale).toBe('en-US');
  });

  it('is unknown for an exit IP the GeoIP database has no place for: the session does not start', async () => {
    const app = setup();
    app.backend.geoByIp.set(
      '203.0.113.1',
      new GeoLookupError('the GeoIP database has no location for 203.0.113.1'),
    );
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    const failed = await waitForStatus(app.manager, created.id, 'error');
    expect(failed.errorCode).toBe('unknown_ip_location');
    expect(failed.error).toBe(
      'Cannot match timezone and location to the proxy: the GeoIP database has no location for 203.0.113.1.',
    );
    expect(failed.errorExtra).toEqual({
      reason: 'the GeoIP database has no location for 203.0.113.1',
    });
    expect(app.backend.attempts).toEqual([]);
    expect(failed.lastStartedAt).toBeNull();
    expect(failed.location).toBeNull();
  });

  it('is not recorded when the session is stopped while the place is looked up', async () => {
    const app = setup();
    const session = await running(app);
    await stop(app, session.id);
    const before = app.manager.session(session.id);

    const lookup = new Gate();
    app.backend.geoFor = async () => {
      await lookup.wait();
      return GENEVA;
    };
    app.checker.setIp('192.0.2.1:8080', '203.0.113.50'); // another exit IP: the place is looked up again
    await app.manager.startSession(session.id);
    await waitFor(
      app.manager,
      session.id,
      () => app.backend.lookups.length === 2,
    );
    const stopping = await app.manager.stopSession(session.id);
    expect(stopping.status).toBe('stopped');
    lookup.open();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = app.manager.session(session.id);
    expect(after.location).toEqual(before.location);
    expect(after.lastStartedAt).toBe(before.lastStartedAt);
    expect(app.backend.launches).toHaveLength(1); // only the first start launched
  });
});

describe('the exit IP while the session runs', () => {
  it('says when the proxy exits elsewhere now, and when it is back', async () => {
    const app = setup();
    const session = await running(app);
    expect(session.location?.inSync).toBe(true);

    app.checker.setIp('192.0.2.1:8080', '203.0.113.99'); // a rotating proxy, or a provider that moved the IP
    await app.manager.recheckRunning({ force: true });
    const outOfStep = app.manager.session(session.id);
    expect(outOfStep.status).toBe('running');
    expect(outOfStep.location?.inSync).toBe(false);
    expect(outOfStep.location?.ip).toBe('203.0.113.1'); // what the session reports is for the IP it started with
    expect(outOfStep.proxy?.exitIp).toBe('203.0.113.99'); // and that is where the proxy exits now

    app.checker.setIp('192.0.2.1:8080', '203.0.113.1'); // and back
    const checked = await app.manager.checkSessionIp(session.id);
    expect(checked.location?.inSync).toBe(true);
  });

  it('claims nothing about a proxy that does not answer', async () => {
    const app = setup();
    const session = await running(app);
    app.checker.setError('192.0.2.1:8080', 'connection refused');
    const failed = await refusalOf(() =>
      app.manager.checkSessionIp(session.id),
    );
    expect([failed.status, failed.code]).toEqual([502, 'proxy_unreachable']);
    expect(failed.message).toBe(
      'The proxy of session a is not working: connection refused.',
    );
    expect(failed.extra).toEqual({
      proxyId: session.proxy?.id,
      reason: 'connection refused',
    });
    const now = app.manager.session(session.id);
    expect(now.status).toBe('running');
    expect(now.location?.inSync).toBeNull(); // not known: not "in step"
  });

  it('needs a session with a proxy to look at', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    await app.manager.stopSession(created.id);
    await waitForStatus(app.manager, created.id, 'stopped');
    app.manager.deleteProxy(1, { force: true });
    const none = await refusalOf(() => app.manager.checkSessionIp(created.id));
    expect([none.status, none.code]).toEqual([409, 'no_proxy']);
    const missing = await refusalOf(() => app.manager.checkSessionIp(999));
    expect([missing.status, missing.code]).toEqual([404, 'session_not_found']);
  });

  it('is watched only for the proxies that are due: 30 seconds after the start, then every 5 minutes', async () => {
    expect([FIRST_RECHECK_MS, RECHECK_EVERY_MS, WATCH_TICK_MS]).toEqual([
      30_000, 300_000, 10_000,
    ]);
    let now = 1_000_000;
    const app = setup({ monotonic: () => now });
    await running(app);
    const checks = () => app.checker.calls.length;
    const start = checks();

    await app.manager.recheckRunning(); // the first look comes soon after the start, not at once
    expect(checks()).toBe(start);
    now += FIRST_RECHECK_MS - 1;
    await app.manager.recheckRunning();
    expect(checks()).toBe(start);
    now += 1;
    await app.manager.recheckRunning();
    expect(checks()).toBe(start + 1);
    await app.manager.recheckRunning(); // looked at: the next look is far off
    expect(checks()).toBe(start + 1);
    now += RECHECK_EVERY_MS - 1;
    await app.manager.recheckRunning();
    expect(checks()).toBe(start + 1);
    now += 1;
    await app.manager.recheckRunning();
    expect(checks()).toBe(start + 2);
  });

  it('is not watched once the session is stopped', async () => {
    const app = setup();
    const session = await running(app);
    await stop(app, session.id);
    const checks = app.checker.calls.length;
    await app.manager.recheckRunning({ force: true });
    expect(app.checker.calls).toHaveLength(checks);
  });

  it('looks at every running session at once with force, each proxy once', async () => {
    const app = setup();
    await running(app, '192.0.2.1:8080', 'a');
    await running(app, '192.0.2.2:8080', 'b');
    const checks = app.checker.calls.length;
    await app.manager.recheckRunning({ force: true });
    expect(
      app.checker.calls
        .slice(checks)
        .map((proxy) => proxy.host)
        .sort(),
    ).toEqual(['192.0.2.1', '192.0.2.2']);
  });

  it('does not warn about a proxy that does not answer, but about anything else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = setup();
    await running(app);
    app.checker.setError('192.0.2.1:8080', 'refused');
    await app.manager.recheckRunning({ force: true });
    expect(warn).not.toHaveBeenCalled();

    vi.spyOn(app.store, 'recordCheckFailed').mockImplementation(() => {
      throw new Error('disk full');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await app.manager.recheckRunning({ force: true });
    expect(warn).toHaveBeenCalledWith(
      'looking at an exit IP failed',
      expect.objectContaining({ message: 'disk full' }),
    );
  });
});

describe('the watch', () => {
  /** A `sleep` the test wakes by hand. */
  function manualSleep() {
    const sleeps: { ms: number; wake: () => void }[] = [];
    const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise<void>((resolve) => {
        sleeps.push({ ms, wake: resolve });
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    return { sleeps, sleep };
  }

  async function turns(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('looks every 10 seconds at the proxies that are due, until it is told to stop', async () => {
    let now = 0;
    const { sleeps, sleep } = manualSleep();
    const app = setup({ monotonic: () => now, sleep });
    await running(app);
    const checks = () => app.checker.calls.length;
    const start = checks();

    const controller = new AbortController();
    const watching = app.manager.watchExitIps(controller.signal);
    await turns();
    expect(sleeps.map((s) => s.ms)).toEqual([10_000]);

    sleeps[0].wake(); // nothing is due yet
    await turns();
    expect(sleeps).toHaveLength(2);
    expect(checks()).toBe(start);

    now = FIRST_RECHECK_MS;
    sleeps[1].wake();
    await turns();
    expect(sleeps).toHaveLength(3);
    expect(checks()).toBe(start + 1);

    controller.abort();
    await watching;
    expect(sleeps).toHaveLength(3);
  });

  it('runs on the real clock and timers when it is given no seams', async () => {
    const app = setup();
    await running(app);
    const start = app.checker.calls.length;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const controller = new AbortController();
    const watching = app.manager.watchExitIps(controller.signal);

    /** Seconds until the watch looks at the proxy again (a tick is 10 seconds). */
    const secondsUntilNextLook = async (): Promise<number> => {
      const before = app.checker.calls.length;
      for (let seconds = 10; seconds <= 400; seconds += 10) {
        await vi.advanceTimersByTimeAsync(WATCH_TICK_MS);
        if (app.checker.calls.length > before) return seconds;
      }
      return Number.POSITIVE_INFINITY;
    };
    // The first look is early: 30 seconds after the start, at the next tick.
    const first = await secondsUntilNextLook();
    expect(first).toBeGreaterThanOrEqual(30);
    expect(first).toBeLessThanOrEqual(40);
    // The next ones are 5 minutes apart.
    const second = await secondsUntilNextLook();
    expect(second).toBeGreaterThanOrEqual(300);
    expect(second).toBeLessThanOrEqual(310);
    expect(app.checker.calls).toHaveLength(start + 2);

    controller.abort();
    await watching;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('ends at once when it is already told to stop', async () => {
    const { sleeps, sleep } = manualSleep();
    const app = setup({ sleep });
    const controller = new AbortController();
    controller.abort();
    await app.manager.watchExitIps(controller.signal);
    expect(sleeps).toEqual([]);
  });

  it('goes on after a round that failed, and says so', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { sleeps, sleep } = manualSleep();
    const app = setup({ sleep });
    const lookup = vi
      .spyOn(app.store, 'sessionLinks')
      .mockImplementationOnce(() => {
        throw new Error('database is locked');
      });
    const controller = new AbortController();
    const watching = app.manager.watchExitIps(controller.signal);
    await turns();
    sleeps[0].wake();
    await turns();
    expect(error).toHaveBeenCalledWith(
      'looking at the exit IPs of the running sessions failed',
      expect.objectContaining({ message: 'database is locked' }),
    );
    expect(sleeps).toHaveLength(2); // and it waits for the next round
    expect(lookup).toHaveBeenCalledOnce();
    controller.abort();
    await watching;
  });
});

describe('restart', () => {
  it('matches the session to the new exit IP and keeps its tabs', async () => {
    const app = setup();
    app.backend.geo = ZURICH;
    const session = await running(app);
    await app.backend.launches[0].remote.openTab('https://two.example');
    app.checker.setIp('192.0.2.1:8080', '203.0.113.99');
    app.backend.geo = GENEVA;
    await app.manager.recheckRunning({ force: true });

    const restarting = await app.manager.restartSession(session.id);
    expect(restarting.activity).toBe('launching'); // no proxy assignment: it keeps its proxy
    const synced = await waitForStatus(app.manager, session.id, 'running');
    expect(synced.location?.ip).toBe('203.0.113.99');
    expect(synced.location?.inSync).toBe(true);
    expect(synced.location?.latitude).toBe(46.2);
    expect(synced.proxy?.id).toBe(session.proxy?.id);
    const [first, second] = app.backend.launches;
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(second.remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('needs a running session and a proxy that works', async () => {
    const app = setup();
    const session = await running(app);
    app.checker.setError('192.0.2.1:8080', 'connection refused');
    const refused = await refusalOf(() =>
      app.manager.restartSession(session.id),
    );
    expect([refused.status, refused.code]).toEqual([502, 'proxy_unreachable']);
    expect(refused.extra).toEqual({
      proxyId: session.proxy?.id,
      reason: 'connection refused',
    });
    expect(getSession(app.manager, session.id).status).toBe('running'); // left as it was
    expect(getSession(app.manager, session.id).error).toBeNull();
    expect(getSession(app.manager, session.id).errorExtra).toBeNull();

    await stop(app, session.id);
    const notRunning = await refusalOf(() =>
      app.manager.restartSession(session.id),
    );
    expect([notRunning.status, notRunning.code]).toEqual([
      409,
      'session_not_running',
    ]);
    expect(notRunning.message).toBe('Session a is not running.');
    const missing = await refusalOf(() => app.manager.restartSession(999));
    expect(missing.status).toBe(404);
  });

  it('is refused for a session without a proxy', async () => {
    const app = setup();
    const session = await running(app);
    // The proxy goes away under a running session: the manager refuses to do
    // that, so the store is used directly.
    app.store.deleteProxy(1);
    const none = await refusalOf(() => app.manager.restartSession(session.id));
    expect([none.status, none.code]).toEqual([409, 'no_proxy']);
  });
});
