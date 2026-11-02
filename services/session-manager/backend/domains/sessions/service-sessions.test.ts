// The session lifecycle as the manager sees it: creating, renaming, starting,
// stopping, rotating, deleting, listing and exporting.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportedProxySchema } from '../../../lib/api/schemas.ts';
import { CancelledError } from '../../lib/abort.ts';
import { Gate } from '../../testing/fake-browser.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  getSession,
  refusalOf,
  seedProxy,
  settled,
  waitFor,
  waitForChecks,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager, TestManagerOptions } from '../../testing/harness.ts';
import { IdentityError } from '../identity/types.ts';

const apps: TestManager[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function setup(options?: TestManagerOptions): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

/** Proxies 192.0.2.1:8080, 192.0.2.2:8080, ... */
function proxies(app: TestManager, count: number): void {
  for (let n = 1; n <= count; n++) addProxy(app.manager, `192.0.2.${n}:8080`);
}

/** Watches a promise: `settled` turns true once it resolved or rejected. */
function track(promise: Promise<unknown>): { readonly settled: boolean } {
  const state = { settled: false };
  const markSettled = (): boolean => (state.settled = true);
  promise.then(markSettled, markSettled);
  return state;
}

describe('creating a session', () => {
  it('assigns a proxy and starts in the background', async () => {
    const app = setup();
    const proxy = addProxy(app.manager, 'user:pw@192.0.2.1:8080');
    const created = await createSession(app.manager, '  Shop  ', {
      os: 'linux',
    });
    expect(created.name).toBe('Shop');
    expect(created.proxy).toBeNull();
    expect([
      created.status,
      created.activity,
      created.error,
      created.errorCode,
    ]).toEqual(['starting', 'assigning_proxy', null, null]);
    expect(created.errorExtra).toBeNull();
    expect(created.fingerprint).toEqual({
      userAgent: 'FakeAgent/1',
      platform: 'Win32',
      screen: '1920x1080',
      gpu: 'Fake GPU',
      locale: null,
      timezone: null,
    });
    expect(created.createdAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/,
    );
    expect(created.lastStartedAt).toBeNull();
    expect(created.location).toBeNull();
    expect(created.os).toBe('linux');
    expect(app.backend.identityRequests.map((request) => request.os)).toEqual([
      'linux',
    ]);

    const running = await waitForStatus(app.manager, created.id, 'running');
    expect(running.proxy).toEqual({
      id: proxy.id,
      display: 'http://user@192.0.2.1:8080',
      exitIp: '203.0.113.1',
      country: 'US',
      checkStatus: 'ok',
    });
    expect([running.fingerprint.locale, running.fingerprint.timezone]).toEqual([
      'en-US',
      'America/New_York',
    ]);
    expect(running.lastStartedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    const [browser] = app.backend.launches;
    // The local bridge, no credentials.
    expect(browser.spec.proxy.server).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(Object.keys(browser.spec.proxy)).toEqual(['server']);
    expect(browser.spec.location.ip).toBe('203.0.113.1');
    expect(browser.spec.profileDir).toBe(
      join(app.dataDir, 'profiles', String(created.id)),
    );
    expect(app.manager.listProxies()[0].session).toEqual({
      id: created.id,
      name: 'Shop',
      status: 'running',
    });
    const { counts } = app.manager.meta();
    expect([counts.running, counts.freeProxies]).toEqual([1, 0]);
  });

  it('numbers the sessions when it is given no name, and an OS at random when it is given none', async () => {
    const app = setup();
    proxies(app, 2);
    const created = await app.manager.createSession({});
    expect(created.name).toBe('0001');
    expect(['windows', 'macos', 'linux']).toContain(created.os);
    expect((await createSession(app.manager, '   ')).name).toBe('0002');
    expect(app.manager.meta().nextSessionName).toBe('0003');
    expect(app.backend.identityRequests.map((request) => request.os)).toEqual([
      'random',
      'random',
    ]);
  });

  it('creates nothing when it is refused', async () => {
    const app = setup();
    const noProxy = await refusalOf(() => app.manager.createSession());
    expect([noProxy.status, noProxy.code]).toEqual([409, 'no_free_proxy']);
    expect(noProxy.message).toBe(
      'No free proxy available: every session needs its own proxy. Add proxies to continue.',
    );

    addProxy(app.manager, '192.0.2.1:8080');
    await createSession(app.manager, 'a');
    const taken = await refusalOf(() =>
      app.manager.createSession({ name: 'A' }),
    );
    expect([taken.status, taken.code]).toEqual([409, 'name_taken']);
    expect(taken.message).toBe('A session named “A” already exists.');
    const allTaken = await refusalOf(() =>
      app.manager.createSession({ name: 'b' }),
    );
    expect(allTaken.code).toBe('no_free_proxy');

    addProxy(app.manager, '192.0.2.2:8080');
    const invalid = await refusalOf(() =>
      app.manager.createSession({ name: 'x'.repeat(81) }),
    );
    expect([invalid.status, invalid.code]).toEqual([422, 'invalid_name']);
    expect(invalid.message).toBe(
      'The session name must be 1-80 characters long, without control characters.',
    );
    const badOs = await refusalOf(() =>
      app.manager.createSession({ name: 'c', os: 'android' }),
    );
    expect([badOs.status, badOs.code]).toEqual([422, 'validation_error']);
    app.backend.installed = false;
    const notInstalled = await refusalOf(() => app.manager.createSession());
    expect([notInstalled.status, notInstalled.code]).toEqual([
      503,
      'browser_not_installed',
    ]);
    expect(app.manager.listSessions().map((s) => s.name)).toEqual(['a']);
    // Only the first creation drew an identity: the others were refused first.
    expect(app.backend.identities).toHaveLength(1);
  });

  it('says so when no new fingerprint can be drawn, and creates nothing', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    app.backend.identityError = new IdentityError(
      'Could not generate a windows fingerprint that differs from all existing sessions in 30 tries. Try another OS.',
    );
    const refused = await refusalOf(() => app.manager.createSession());
    expect([refused.status, refused.code]).toEqual([
      409,
      'fingerprint_exhausted',
    ]);
    expect(refused.message).toContain('Try another OS.');
    expect(app.manager.countSessions()).toBe(0);
    // And the next attempt is not stuck behind it.
    app.backend.identityError = null;
    expect((await createSession(app.manager, 'a')).name).toBe('a');
  });

  it('draws identities that differ from those of the sessions that exist', async () => {
    const app = setup();
    proxies(app, 2);
    await createSession(app.manager, 'a');
    await createSession(app.manager, 'b');
    const [first, second] = app.backend.identityRequests;
    expect(first.taken.size).toBe(0);
    expect([...second.taken].sort()).toEqual(['full-1', 'visible-1']);
  });

  it('lets one creation at a time draw its identity, so names and fingerprints stay unique', async () => {
    const app = setup();
    proxies(app, 2);
    const gate = new Gate();
    const draw = app.backend.createIdentity.bind(app.backend);
    const drawing = vi
      .spyOn(app.backend, 'createIdentity')
      .mockImplementation(async (os, taken) => {
        await gate.wait();
        return draw(os, taken);
      });
    const a = app.manager.createSession({ name: 'same' });
    const b = app.manager.createSession({ name: 'same' });
    await vi.waitFor(() => expect(drawing).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drawing).toHaveBeenCalledTimes(1); // the second waits for the first
    gate.open();
    const results = await Promise.allSettled([a, b]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(app.manager.listSessions().map((s) => s.name)).toEqual(['same']);
    expect(drawing).toHaveBeenCalledTimes(1); // the name was seen taken before drawing
  });
});

describe('a creation that fails half way', () => {
  it('lets the next creation through, whatever the failure was', async () => {
    const app = setup();
    proxies(app, 2);
    app.backend.identityError = new Error('the generator crashed');
    await expect(app.manager.createSession({ name: 'a' })).rejects.toThrow(
      'the generator crashed',
    );
    expect(app.manager.countSessions()).toBe(0);
    app.backend.identityError = null;
    expect((await createSession(app.manager, 'a')).name).toBe('a');
  });

  it('is refused when the name was taken while the identity was drawn, and creates nothing', async () => {
    const app = setup();
    proxies(app, 2);
    const first = await createSession(app.manager, 'first');
    const gate = new Gate();
    const draw = app.backend.createIdentity.bind(app.backend);
    const drawing = vi
      .spyOn(app.backend, 'createIdentity')
      .mockImplementation(async (os, taken) => {
        await gate.wait();
        return draw(os, taken);
      });
    const creating = app.manager.createSession({ name: 'wanted' });
    const refusal = refusalOf(() => creating);
    await vi.waitFor(() => expect(drawing).toHaveBeenCalledTimes(1));
    // A rename is not held back by the creation lock.
    app.manager.renameSession(first.id, 'wanted');
    gate.open();
    expect((await refusal).code).toBe('name_taken');
    expect(app.manager.listSessions().map((s) => s.name)).toEqual(['wanted']);
    expect(app.backend.attempts.length).toBeLessThanOrEqual(1);
  });
});

describe('renaming', () => {
  it('works in any status, and is checked like a name at creation', async () => {
    const app = setup();
    proxies(app, 2);
    const a = await createSession(app.manager, 'a');
    const b = await createSession(app.manager, 'b');
    await waitForStatus(app.manager, a.id, 'running');
    const renamed = app.manager.renameSession(a.id, ' renamed ');
    expect([renamed.name, renamed.status]).toEqual(['renamed', 'running']);
    const taken = await refusalOf(() =>
      app.manager.renameSession(b.id, 'RENAMED'),
    );
    expect([taken.status, taken.code]).toEqual([409, 'name_taken']);
    const empty = await refusalOf(() => app.manager.renameSession(b.id, ' '));
    expect([empty.status, empty.code]).toEqual([422, 'invalid_name']);
    expect(
      (await refusalOf(() => app.manager.renameSession(99, 'x'))).status,
    ).toBe(404);
    // The same name is no change at all.
    expect(app.manager.renameSession(a.id, 'renamed').name).toBe('renamed');
  });

  it('is what the browser is given at each start', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    app.manager.renameSession(session.id, 'b');
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    await app.manager.startSession(session.id);
    await waitForStatus(app.manager, session.id, 'running');
    expect(app.backend.launches.map((browser) => browser.spec.name)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('starting and stopping', () => {
  it('starts with the proxy it has and stops, and refuses a second start', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    const running = await waitForStatus(app.manager, session.id, 'running');
    const again = await refusalOf(() => app.manager.startSession(session.id));
    expect([again.status, again.code]).toEqual([409, 'session_running']);
    expect(again.message).toBe('Session a is already running.');

    const stopping = await app.manager.stopSession(session.id);
    expect(['stopping', 'stopped']).toContain(stopping.status);
    await waitForStatus(app.manager, session.id, 'stopped');
    expect(app.backend.launches[0].closed).toBe(true);

    const starting = await app.manager.startSession(session.id, {});
    // It has its proxy: no assignment.
    expect([starting.status, starting.activity]).toEqual([
      'starting',
      'launching',
    ]);
    const restarted = await waitForStatus(app.manager, session.id, 'running');
    expect(restarted.proxy?.id).toBe(running.proxy?.id);
  });

  it('says what a session is doing when it is asked for more', async () => {
    const app = setup();
    proxies(app, 3);
    const gate = app.checker.hold();
    const session = await createSession(app.manager, 'a');
    await app.checker.waitForCalls(1);
    // Assigning a proxy.
    const starting = await refusalOf(() =>
      app.manager.startSession(session.id),
    );
    expect([starting.code, starting.message]).toEqual([
      'session_running',
      'Session a is already starting.',
    ]);
    const rotating = await refusalOf(() =>
      app.manager.rotateSession(session.id),
    );
    expect([rotating.code, rotating.message]).toEqual([
      'session_busy',
      'Session a is getting a proxy. Try again in a moment.',
    ]);
    // The page words it from the code of what the session is doing.
    expect(rotating.extra).toEqual({ doing: 'assigning_proxy' });
    gate.release();
    await settled(app.manager, session.id);

    // Launching.
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    app.backend.launchGate = new Gate();
    await app.manager.startSession(session.id);
    const busy = await refusalOf(() => app.manager.rotateSession(session.id));
    expect(busy.message).toBe('Session a is starting. Try again in a moment.');
    expect(busy.extra).toEqual({ doing: 'starting' });
    app.backend.launchGate.open();
    await waitForStatus(app.manager, session.id, 'running');

    // Stopping.
    const closing = Promise.withResolvers<void>();
    const [browser] = app.backend.launches.slice(-1);
    const closed = browser.close.bind(browser);
    vi.spyOn(browser, 'close').mockImplementation(async () => {
      await closing.promise;
      await closed();
    });
    await app.manager.stopSession(session.id);
    const stopping = await refusalOf(() =>
      app.manager.startSession(session.id),
    );
    expect([stopping.code, stopping.message]).toEqual([
      'session_busy',
      'Session a is stopping. Try again in a moment.',
    ]);
    expect(stopping.extra).toEqual({ doing: 'stopping' });
    const rotatingNow = await refusalOf(() =>
      app.manager.rotateSession(session.id),
    );
    expect(rotatingNow.message).toBe(
      'Session a is stopping. Try again in a moment.',
    );
    expect(rotatingNow.extra).toEqual({ doing: 'stopping' });
    closing.resolve();
    await waitForStatus(app.manager, session.id, 'stopped');
  });

  it('lets only one of two simultaneous starts through', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');

    const results = await Promise.allSettled([
      app.manager.startSession(session.id),
      app.manager.startSession(session.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await waitForStatus(app.manager, session.id, 'running');
    expect(app.backend.launches).toHaveLength(2); // one browser per start, never two at once
  });

  it('stops a session that is not running without fuss', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    const again = await app.manager.stopSession(session.id);
    expect([again.status, again.activity, again.error]).toEqual([
      'stopped',
      null,
      null,
    ]);
    expect((await refusalOf(() => app.manager.stopSession(99))).status).toBe(
      404,
    );
  });

  it('says why when no proxy is left, having waited for the check that was under way', async () => {
    const app = setup();
    app.checker.setError(
      '192.0.2.1:8080',
      'the proxy rejected the credentials',
    );
    const gate = app.checker.hold();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a'); // while the proxy's first check runs
    gate.release();
    const failed = await waitForStatus(app.manager, session.id, 'error');
    expect(app.checker.calls).toHaveLength(1); // the assignment waited for that check
    expect([failed.errorCode, failed.proxy]).toEqual([
      'no_working_proxy',
      null,
    ]);
    expect(
      failed.error?.startsWith(
        'No working proxy available (1 failed their check).',
      ),
    ).toBe(true);
    expect(failed.errorExtra).toEqual({ failed: 1 });
    const retry = await refusalOf(() => app.manager.startSession(session.id));
    expect(retry.code).toBe('no_free_proxy');
  });

  it('fails the start of a session whose proxy is unreachable, with the reason', async () => {
    const app = setup();
    const proxy = addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    app.checker.setError(
      '192.0.2.1:8080',
      'cannot connect to the proxy ([Errno 61] Connection refused)',
    );
    const refused = await refusalOf(() => app.manager.startSession(session.id));
    expect(refused.status).toBe(502);
    expect([refused.code, refused.extra.proxyId]).toEqual([
      'proxy_unreachable',
      proxy.id,
    ]);
    expect(refused.message).toContain('Connection refused');
    // The cause alone, as the proxy check worded it: the page frames it itself.
    expect(refused.extra.reason).toBe(
      'cannot connect to the proxy ([Errno 61] Connection refused)',
    );
    const after = getSession(app.manager, session.id);
    expect([after.status, after.errorCode]).toEqual([
      'error',
      'proxy_unreachable',
    ]);
    expect(after.errorExtra).toEqual({
      proxyId: proxy.id,
      reason: 'cannot connect to the proxy ([Errno 61] Connection refused)',
    });
    expect(
      after.error?.startsWith(
        'Its proxy is not working: cannot connect to the proxy',
      ),
    ).toBe(true);
    expect([after.proxy?.id, after.proxy?.checkStatus]).toEqual([
      proxy.id,
      'failed',
    ]);
  });

  it('refuses the exit IP of a running session unless it is forced', async () => {
    const app = setup();
    proxies(app, 2);
    const a = await createSession(app.manager, 'a');
    const b = await createSession(app.manager, 'b');
    await waitForStatus(app.manager, a.id, 'running');
    await waitForStatus(app.manager, b.id, 'running');
    await app.manager.stopSession(b.id);
    await waitForStatus(app.manager, b.id, 'stopped');
    for (const n of [1, 2]) {
      app.checker.setIp(`192.0.2.${n}:8080`, '203.0.113.9'); // e.g. two credentials for one sticky session
    }
    app.manager.checkAllProxies();
    await vi.waitFor(() => {
      expect(app.manager.meta().counts.checkingProxies).toBe(0);
    });

    const refused = await refusalOf(() =>
      app.manager.startSession(b.id, { force: false }),
    );
    expect([refused.status, refused.code]).toEqual([409, 'ip_in_use']);
    expect(refused.extra.exitIp).toBe('203.0.113.9');
    expect(refused.extra.sessions).toEqual([
      { id: a.id, name: 'a', status: 'running' },
    ]);
    expect(refused.toBody()).toMatchObject({
      error: 'ip_in_use',
      exitIp: '203.0.113.9',
    });
    await app.manager.startSession(b.id, { force: true });
    await waitForStatus(app.manager, b.id, 'running');
  });

  it('refuses a start when the browser is not installed', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    app.backend.installed = false;
    const refused = await refusalOf(() => app.manager.startSession(session.id));
    expect([refused.status, refused.code]).toEqual([
      503,
      'browser_not_installed',
    ]);
  });

  it('follows the browser: it exits, or fails to launch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    app.backend.launches[0].crash(); // e.g. the user quit the browser
    await waitForStatus(app.manager, session.id, 'stopped');

    app.backend.launchError = new Error('Browser closed unexpectedly');
    await app.manager.startSession(session.id);
    const failed = await waitForStatus(app.manager, session.id, 'error');
    expect([failed.error, failed.errorCode]).toEqual([
      'Browser closed unexpectedly',
      null,
    ]);
    // And it can be started again.
    app.backend.launchError = null;
    await app.manager.startSession(session.id);
    expect(
      (await waitForStatus(app.manager, session.id, 'running')).error,
    ).toBeNull();
  });

  it('is told about a missing session', async () => {
    const { manager } = setup();
    for (const action of [
      () => manager.startSession(99),
      () => manager.stopSession(99),
      () => manager.rotateSession(99),
      () => manager.restartSession(99),
      () => manager.checkSessionIp(99),
      () => manager.deleteSession(99),
      () => manager.session(99),
      () => manager.renameSession(99, 'x'),
    ]) {
      const refusal = await refusalOf(action);
      expect([refusal.status, refusal.code, refusal.message]).toEqual([
        404,
        'session_not_found',
        'Session 99 does not exist.',
      ]);
    }
  });
});

describe('deleting a session', () => {
  it('stops it, removes its profile and frees its proxy', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    const profile = join(app.dataDir, 'profiles', String(session.id));
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'prefs.js'), '');

    await app.manager.deleteSession(session.id);
    expect(app.backend.launches[0].closed).toBe(true);
    expect(existsSync(profile)).toBe(false);
    expect(app.manager.listSessions()).toEqual([]);
    expect(
      (await refusalOf(() => app.manager.deleteSession(session.id))).status,
    ).toBe(404);
    expect(app.manager.meta().counts.freeProxies).toBe(1);
    expect(app.manager.listProxies()[0].session).toBeNull();
  });

  it('removes only profiles inside the profiles directory, and never follows a symlink', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    const outside = join(app.dataDir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const profile = join(app.dataDir, 'profiles', String(session.id));
    mkdirSync(join(app.dataDir, 'profiles'), { recursive: true });
    rmSync(profile, { recursive: true, force: true });
    symlinkSync(outside, profile);

    await app.manager.deleteSession(session.id);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('does not touch a symlink inside the profile that points elsewhere', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    const outside = join(app.dataDir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const profile = join(app.dataDir, 'profiles', String(session.id));
    mkdirSync(profile, { recursive: true });
    symlinkSync(outside, join(profile, 'link'));

    await app.manager.deleteSession(session.id);
    expect(existsSync(profile)).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('works for a session that never got a profile', async () => {
    const app = setup();
    const session = await seedAndCreate(app);
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    rmSync(join(app.dataDir, 'profiles'), { recursive: true, force: true });
    await app.manager.deleteSession(session.id);
    expect(app.manager.countSessions()).toBe(0);
  });

  it('waits for a browser that takes its time to close', async () => {
    const app = setup();
    const session = await seedAndCreate(app);
    const [browser] = app.backend.launches;
    const closing = Promise.withResolvers<void>();
    const closed = browser.close.bind(browser);
    vi.spyOn(browser, 'close').mockImplementation(async () => {
      await closing.promise;
      await closed();
    });
    const deleting = app.manager.deleteSession(session.id);
    const deleted = track(deleting);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deleted.settled).toBe(false);
    expect(app.manager.countSessions()).toBe(1);
    closing.resolve();
    await deleting;
    expect(app.manager.countSessions()).toBe(0);
    expect(browser.closed).toBe(true);
  });

  it('is the end of a start that waited behind it', async () => {
    const app = setup();
    const session = await seedAndCreate(app);
    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    const deleting = app.manager.deleteSession(session.id);
    const starting = refusalOf(() => app.manager.startSession(session.id));
    await deleting;
    expect((await starting).code).toBe('session_not_found');
  });
});

/** A proxy, a session on it, running. */
async function seedAndCreate(app: TestManager) {
  seedProxy(app.store, 1);
  const created = await createSession(app.manager, 'a');
  return waitForStatus(app.manager, created.id, 'running');
}

describe('the tabs of a session', () => {
  it('are reported to the store, and a store that fails is logged, not thrown into the browser', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    const [browser] = app.backend.launches;
    await browser.remote.openTab('https://two.example');
    expect(app.store.getSession(session.id)?.tabs?.urls).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);

    vi.spyOn(app.store, 'saveTabs').mockImplementation(() => {
      throw new Error('database is closed');
    });
    await expect(
      browser.remote.openTab('https://three.example'),
    ).resolves.toMatchObject({ url: 'https://three.example' });
    expect(warn).toHaveBeenCalledWith(
      `could not remember the tabs of session ${session.id}`,
      expect.objectContaining({ message: 'database is closed' }),
    );
  });
});

describe('closing the manager', () => {
  it('closes every browser, once, and stops the sessions', async () => {
    const app = setup();
    proxies(app, 2);
    const a = await createSession(app.manager, 'a');
    const b = await createSession(app.manager, 'b');
    await waitForStatus(app.manager, a.id, 'running');
    await waitForStatus(app.manager, b.id, 'running');
    await app.manager.close();
    expect(app.backend.launches.every((browser) => browser.closed)).toBe(true);
    expect(app.backend.launches.map((browser) => browser.closeCalls)).toEqual([
      1, 1,
    ]);
    expect(app.manager.listSessions().map((s) => s.status)).toEqual([
      'stopped',
      'stopped',
    ]);
    await app.manager.close(); // twice is once
  });

  it('cancels the sessions that are still getting a proxy', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    app.checker.hold();
    const session = await createSession(app.manager, 'a');
    await app.checker.waitForCalls(1);
    await app.manager.close();
    expect(app.manager.session(session.id).status).toBe('stopped');
    expect(app.backend.attempts).toEqual([]);
  });

  it('checks nothing afterwards, and says the check was cancelled rather than that the proxy failed', async () => {
    const app = setup();
    const added = addProxy(app.manager, '192.0.2.1:8080');
    await waitForChecks(app.manager);
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    await app.manager.close();
    const checks = app.checker.calls.length;
    expect(app.manager.checkProxy(added.id).id).toBe(added.id); // queued checks are dropped
    await expect(app.manager.checkSessionIp(session.id)).rejects.toBeInstanceOf(
      CancelledError,
    );
    await expect(app.manager.startSession(session.id)).rejects.toBeInstanceOf(
      CancelledError,
    );
    await app.manager.recheckRunning({ force: true }); // and the watch does not fuss
    expect(app.checker.calls).toHaveLength(checks);
  });
});

describe('listing sessions', () => {
  it('goes newest first, in pages', async () => {
    const app = setup();
    proxies(app, 4);
    const ids: number[] = [];
    for (const name of ['a', 'b', 'c']) {
      ids.push((await createSession(app.manager, name)).id);
    }
    for (const id of ids) await waitForStatus(app.manager, id, 'running');
    const idsOf = (page?: Parameters<typeof app.manager.listSessions>[0]) =>
      app.manager.listSessions(page).map((session) => session.id);
    expect(idsOf()).toEqual([...ids].reverse());
    expect(app.manager.countSessions()).toBe(3);
    expect(idsOf({ limit: 2 })).toEqual([ids[2], ids[1]]);
    expect(idsOf({ before: ids[1], limit: 2 })).toEqual([ids[0]]);

    const d = await createSession(app.manager, 'd');
    await waitForStatus(app.manager, d.id, 'running');
    const page = app.manager.listSessions({ minId: ids[1] });
    expect(page.map((session) => session.name)).toEqual(['d', 'c', 'b']);
    expect(page.map((session) => session.proxy?.exitIp)).toEqual([
      '203.0.113.4',
      '203.0.113.3',
      '203.0.113.2',
    ]);
  });

  it('finds one session by id', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    expect(app.manager.session(session.id).name).toBe('a');
    const missing = await refusalOf(() => app.manager.session(999));
    expect([missing.status, missing.code]).toEqual([404, 'session_not_found']);
  });
});

describe('exporting the proxies', () => {
  it('has the proxies of the sessions, oldest session first, named after them, with their passwords', async () => {
    const app = setup({ now: () => new Date('2026-10-31T12:59:23.456Z') });
    addProxy(app.manager, '192.0.2.1:8080:someuser:somepass');
    addProxy(app.manager, '192.0.2.2:8080');
    addProxy(app.manager, '192.0.2.3:8080'); // no session has it
    const a = await createSession(app.manager, 'a');
    const b = await createSession(app.manager, 'b');
    await waitForStatus(app.manager, a.id, 'running');
    await waitForStatus(app.manager, b.id, 'running');

    const exported = app.manager.exportProxies();
    expect(exported).toEqual({
      exported_at: '2026-10-31T12:59:23Z',
      proxies: [
        {
          proxy_key: 'http|192.0.2.1|8080|someuser|somepass',
          name: 'a',
          protocol: 'http',
          host: '192.0.2.1',
          port: 8080,
          username: 'someuser',
          password: 'somepass',
          status: 'active',
          fallback_mode: 'none',
          expiry_warn_days: 7,
        },
        {
          proxy_key: 'http|192.0.2.2|8080||',
          name: 'b',
          protocol: 'http',
          host: '192.0.2.2',
          port: 8080,
          status: 'active',
          fallback_mode: 'none',
          expiry_warn_days: 7,
        },
      ],
      accounts: [],
    });
    // The second has no username or password at all, not even empty ones.
    expect('username' in exported.proxies[1]).toBe(false);
    expect('password' in exported.proxies[1]).toBe(false);
    for (const proxy of exported.proxies) exportedProxySchema.parse(proxy);
  });

  it('exports the date of now, in UTC to the second', async () => {
    const app = setup();
    await seedAndCreate(app);
    expect(app.manager.exportProxies().exported_at).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/,
    );
  });

  it('has nothing to export when no session has a proxy', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080'); // in the pool, but no session has it
    const refused = await refusalOf(() => app.manager.exportProxies());
    expect([refused.status, refused.code]).toEqual([409, 'nothing_to_export']);
    expect(refused.message).toBe(
      'No session has a proxy yet, so there is nothing to export.',
    );
  });

  it('keeps a proxy password out of everything but the export', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080:someuser:hunter2');
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    const everywhere = JSON.stringify([
      app.manager.listProxies(),
      app.manager.listSessions(),
      app.manager.session(created.id),
      app.manager.meta(),
      app.backend.attempts.map((spec) => spec.proxy),
    ]);
    expect(everywhere).not.toContain('hunter2');
    expect(JSON.stringify(app.manager.exportProxies())).toContain('hunter2');
  });
});

describe('the data directory', () => {
  it('can be one that exists already: profiles go into it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'session-manager-dir-'));
    directories.push(dataDir);
    const app = setup({ dataDir });
    addProxy(app.manager, '192.0.2.1:8080');
    const session = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, session.id, 'running');
    expect(app.backend.launches[0].spec.profileDir).toBe(
      join(dataDir, 'profiles', String(session.id)),
    );
    await waitFor(app.manager, session.id, (s) => s.status === 'running');
  });
});
