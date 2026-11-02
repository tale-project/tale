// Proxy assignment, rotation and naming rules, exercised on the manager
// directly. Proxies are added through the store, so the only exit-IP checks are
// the ones these rules make.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '../../../lib/api/schemas.ts';
import { Gate, NEW_YORK } from '../../testing/fake-browser.ts';
import {
  createTestManager,
  refusalOf,
  seedProxy,
  settled,
  waitFor,
  waitForChecks,
} from '../../testing/harness.ts';
import type { TestManager, TestManagerOptions } from '../../testing/harness.ts';
import { hostPort } from '../proxies/types.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: TestManagerOptions): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

/** Proxy 192.0.2.<n>:8080; the fake checker sees it exit through 203.0.113.<n>. */
const add = (
  app: TestManager,
  n: number,
  options?: Parameters<typeof seedProxy>[2],
) => seedProxy(app.store, n, options);

const host = (n: number): string => `192.0.2.${n}:8080`;

/** The host:port of every proxy the checker was asked about, in order. */
const checked = (app: TestManager): string[] =>
  app.checker.calls.map((proxy) => hostPort(proxy));

/** Creates a session and waits until it runs. */
async function started(app: TestManager, name?: string): Promise<Session> {
  const created = await app.manager.createSession({ name });
  const session = await settled(app.manager, created.id);
  expect(session.status, session.error ?? undefined).toBe('running');
  return session;
}

const proxyIdOf = (session: Session): number | null =>
  session.proxy?.id ?? null;

const freeProxies = (app: TestManager): number =>
  app.manager.meta().counts.freeProxies;

async function stopped(app: TestManager, id: number): Promise<void> {
  await app.manager.stopSession(id);
  await waitFor(app.manager, id, (s) => s.status === 'stopped');
}

describe('candidates', () => {
  it('prefers working proxies, then unchecked ones by id, and never a failed one', async () => {
    const app = setup();
    add(app, 1, { ok: false });
    const unchecked = add(app, 2);
    const working = add(app, 3, { ok: true });
    const uncheckedToo = add(app, 4);
    expect(freeProxies(app)).toBe(3);
    const assigned: (number | null)[] = [];
    for (let n = 0; n < 3; n++) assigned.push(proxyIdOf(await started(app)));
    expect(assigned).toEqual([working, unchecked, uncheckedToo]);

    const noFree = await refusalOf(() => app.manager.createSession());
    expect([noFree.status, noFree.code]).toEqual([409, 'no_free_proxy']);
    expect(app.manager.listSessions()).toHaveLength(3); // nothing was created
  });

  it('checks the candidate fresh, and that check is the start preflight', async () => {
    const app = setup();
    add(app, 1, { ok: true, exitIp: '198.51.100.1' }); // outdated: the proxy now exits elsewhere
    app.checker.setIp(host(1), '198.51.100.2', 'CH');
    const created = await app.manager.createSession({ name: 'a' });
    expect([created.status, created.activity, created.proxy]).toEqual([
      'starting',
      'assigning_proxy',
      null,
    ]);
    const session = await settled(app.manager, created.id);
    expect(session.status).toBe('running');
    expect(session.proxy).toMatchObject({
      exitIp: '198.51.100.2',
      country: 'CH',
      checkStatus: 'ok',
    });
    expect(checked(app)).toEqual([host(1)]); // checked once
    expect(app.backend.launches[0].spec.location.ip).toBe('198.51.100.2');
  });

  it('marks a failing candidate failed and tries the next one', async () => {
    const app = setup();
    const broken = add(app, 1);
    const working = add(app, 2);
    app.checker.setError(host(1), 'cannot connect to the proxy');
    const session = await started(app);
    expect(proxyIdOf(session)).toBe(working);
    expect(checked(app)).toEqual([host(1), host(2)]);
    const proxy = app.manager.listProxies().find((p) => p.id === broken);
    expect(proxy?.check).toMatchObject({
      status: 'failed',
      error: 'cannot connect to the proxy',
    });
    expect(proxy?.session).toBeNull();
  });

  it('gives up when no proxy works, says so, and the session can start once they work again', async () => {
    const app = setup();
    add(app, 1);
    add(app, 2);
    app.checker.setError(host(1), 'boom');
    app.checker.setError(host(2), 'boom');
    const created = await app.manager.createSession();
    const session = await settled(app.manager, created.id);
    expect([session.status, session.errorCode, session.proxy]).toEqual([
      'error',
      'no_working_proxy',
      null,
    ]);
    expect(session.error).toBe(
      'No working proxy available (2 failed their check). Add proxies or re-check them, then start again.',
    );
    expect(session.errorExtra).toEqual({ failed: 2 }); // the page words the count itself
    expect(app.backend.attempts).toEqual([]);
    const { counts } = app.manager.meta();
    expect([counts.freeProxies, counts.failedProxies]).toEqual([0, 2]);
    const refused = await refusalOf(() => app.manager.startSession(session.id));
    expect(refused.code).toBe('no_free_proxy');
    expect(refused.message).toContain('No free proxy');

    app.checker.results.clear(); // the proxies work again: a re-check makes them assignable
    app.manager.checkAllProxies();
    await waitForChecks(app.manager);
    await app.manager.startSession(session.id);
    expect((await settled(app.manager, session.id)).status).toBe('running');
  });

  it('skips a proxy whose known exit IP is that of a taken proxy', async () => {
    const app = setup();
    add(app, 1, { ok: true, exitIp: '198.51.100.9' });
    add(app, 2, { ok: true, exitIp: '198.51.100.9' }); // e.g. two credentials for one sticky session
    const other = add(app, 3);
    app.checker.setIp(host(1), '198.51.100.9');
    await started(app);
    expect(freeProxies(app)).toBe(1);
    expect(proxyIdOf(await started(app))).toBe(other);
    expect(checked(app)).not.toContain(host(2));
  });

  it('skips, without marking it failed, a proxy whose fresh exit IP is that of a taken proxy', async () => {
    const app = setup();
    const first = add(app, 1);
    const twin = add(app, 2);
    const other = add(app, 3);
    for (const n of [1, 2]) app.checker.setIp(host(n), '198.51.100.9');
    expect(proxyIdOf(await started(app))).toBe(first);
    expect(proxyIdOf(await started(app))).toBe(other);
    const proxy = app.manager.listProxies().find((p) => p.id === twin);
    expect(proxy?.check).toMatchObject({
      status: 'ok',
      exitIp: '198.51.100.9',
    });
    expect(proxy?.session).toBeNull();
    expect(freeProxies(app)).toBe(0); // its exit IP is taken now
  });

  it('names no count of failed proxies when none failed: the one left exits through a taken IP', async () => {
    const app = setup();
    add(app, 1);
    add(app, 2);
    for (const n of [1, 2]) app.checker.setIp(host(n), '198.51.100.9');
    await started(app);

    const created = await app.manager.createSession();
    const session = await settled(app.manager, created.id);
    expect([session.status, session.errorCode, session.errorExtra]).toEqual([
      'error',
      'no_working_proxy',
      null,
    ]);
    expect(session.error).toBe(
      'No free proxy available: every session needs its own proxy. Add proxies, then start again.',
    );
  });
});

describe('a candidate that is offered again', () => {
  it('is tried once per assignment, whatever the store says, so an assignment always ends', async () => {
    // A failed check that cannot be stored leaves the proxy a candidate.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = setup();
    add(app, 1);
    add(app, 2);
    app.checker.setError(host(1), 'boom');
    app.checker.setError(host(2), 'boom');
    vi.spyOn(app.store, 'recordCheckFailed').mockImplementation(
      () => undefined,
    );
    const created = await app.manager.createSession();
    const session = await settled(app.manager, created.id);
    expect([session.status, session.errorCode]).toEqual([
      'error',
      'no_working_proxy',
    ]);
    expect(session.error).toBe(
      'No working proxy available (2 failed their check). Add proxies or re-check them, then start again.',
    );
    expect(checked(app)).toEqual([host(1), host(2)]);
  });
});

describe('concurrency', () => {
  it('never checks or claims the same candidate twice at once', async () => {
    const app = setup();
    for (const n of [1, 2, 3]) add(app, n);
    app.checker.setError(host(1), 'boom');
    const gate = app.checker.hold();
    const [a, b] = await Promise.all([
      app.manager.createSession(),
      app.manager.createSession(),
    ]);
    await app.checker.waitForCalls(2);
    expect(checked(app).sort()).toEqual([host(1), host(2)]);
    expect(freeProxies(app)).toBe(1); // both candidates are reserved
    gate.release();
    const [doneA, doneB] = [
      await settled(app.manager, a.id),
      await settled(app.manager, b.id),
    ];
    // The one whose candidate failed took the next free one.
    expect(new Set([proxyIdOf(doneA), proxyIdOf(doneB)])).toEqual(
      new Set([2, 3]),
    );
    expect(checked(app).sort()).toEqual([host(1), host(2), host(3)]);
  });

  it('gives every one of many simultaneous creations a proxy and a name of its own', async () => {
    const app = setup();
    for (let n = 1; n <= 12; n++) add(app, n);
    const created = await Promise.all(
      Array.from({ length: 12 }, () => app.manager.createSession()),
    );
    const done = await Promise.all(
      created.map((session) => settled(app.manager, session.id)),
    );
    expect(done.map((session) => session.status)).toEqual(
      Array(12).fill('running'),
    );
    expect(new Set(done.map(proxyIdOf)).size).toBe(12);
    expect(new Set(done.map((session) => session.name)).size).toBe(12);
    expect(created.map((session) => session.name)).toEqual(
      Array.from({ length: 12 }, (_, n) => String(n + 1).padStart(4, '0')),
    );
    expect(freeProxies(app)).toBe(0);
    // Their identities differ, each drawn knowing the earlier ones.
    expect(app.backend.identityRequests.map((r) => r.taken.size)).toEqual(
      Array.from({ length: 12 }, (_, n) => n * 2),
    );
  });

  it('checks the proxy of a session at once, ahead of a long queue of checks', async () => {
    const app = setup();
    for (let n = 1; n <= 30; n++) add(app, n, { ok: n === 25 ? true : null });
    const gate = app.checker.hold();
    app.manager.checkAllProxies();
    await app.checker.waitForCalls(8);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(checked(app)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(host)); // the limit
    // The best candidate is the working one, far back in the queue.
    const session = await app.manager.createSession({ name: 'a' });
    await app.checker.waitForCalls(9);
    expect(checked(app)[8]).toBe(host(25));
    gate.release();
    expect((await settled(app.manager, session.id)).proxy?.id).toBe(25);
    // And its turn in the queue did not check it again.
    expect(checked(app).filter((entry) => entry === host(25))).toHaveLength(1);
    await waitForChecks(app.manager);
    expect(app.checker.calls).toHaveLength(30);
  });

  it('frees the candidate of a session that is stopped as soon as it is created', async () => {
    const app = setup();
    add(app, 1);
    const created = await app.manager.createSession({ name: 'a' });
    const result = await app.manager.stopSession(created.id);
    expect([result.status, result.activity]).toEqual(['stopped', null]);
    expect(freeProxies(app)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.backend.attempts).toEqual([]);
    expect(app.manager.session(created.id).proxy).toBeNull();
    expect(freeProxies(app)).toBe(1);
  });

  it('deletes a session that is deleted as soon as it is created, with nothing left behind', async () => {
    const app = setup();
    add(app, 1);
    const created = await app.manager.createSession({ name: 'a' });
    await app.manager.deleteSession(created.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.manager.listSessions()).toEqual([]);
    expect(app.backend.attempts).toEqual([]);
    expect(freeProxies(app)).toBe(1);
    expect(app.manager.listProxies()[0].session).toBeNull();
  });

  it('creates one session when two are created for one free proxy', async () => {
    const app = setup();
    add(app, 1);
    const results = await Promise.allSettled([
      app.manager.createSession(),
      app.manager.createSession(),
    ]);
    const refused = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: 'no_free_proxy' });
    expect(app.manager.listSessions()).toHaveLength(1);
  });

  it('releases the candidate when the session is stopped while it is assigned', async () => {
    const app = setup();
    const proxy = add(app, 1);
    const gate = app.checker.hold();
    const session = await app.manager.createSession();
    await app.checker.waitForCalls(1);
    expect(freeProxies(app)).toBe(0);

    const result = await app.manager.stopSession(session.id);
    expect([
      result.status,
      result.activity,
      result.proxy,
      result.error,
    ]).toEqual(['stopped', null, null, null]);
    expect(freeProxies(app)).toBe(1);
    gate.release(); // the check itself goes on and is recorded
    await waitForChecks(app.manager);
    const [listed] = app.manager.listProxies();
    expect(listed.check.status).toBe('ok');
    expect(listed.session).toBeNull();
    expect(app.backend.attempts).toEqual([]);
    expect(app.manager.session(session.id).proxy).toBeNull();

    await app.manager.startSession(session.id);
    expect(proxyIdOf(await settled(app.manager, session.id))).toBe(proxy);
  });

  it('leaks nothing when the session is deleted while it is assigned', async () => {
    const app = setup();
    add(app, 1);
    const gate = app.checker.hold();
    const session = await app.manager.createSession();
    await app.checker.waitForCalls(1);
    await app.manager.deleteSession(session.id);
    expect(app.manager.listSessions()).toEqual([]);
    expect(freeProxies(app)).toBe(1);
    gate.release();
    await waitForChecks(app.manager);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.backend.attempts).toEqual([]);
    expect(app.manager.listProxies()[0].session).toBeNull();
  });

  it('keeps the checked proxy and closes the browser when the session is stopped while launching', async () => {
    const app = setup();
    const proxy = add(app, 1);
    app.backend.launchGate = new Gate();
    const session = await app.manager.createSession();
    const launching = await waitFor(
      app.manager,
      session.id,
      (s) => s.activity === 'launching',
    );
    expect(proxyIdOf(launching)).toBe(proxy);
    expect((await app.manager.stopSession(session.id)).status).toBe('stopping');
    app.backend.launchGate.open();
    const done = await waitFor(
      app.manager,
      session.id,
      (s) => s.status === 'stopped',
    );
    expect(proxyIdOf(done)).toBe(proxy);
    expect(app.backend.launches[0].closed).toBe(true);
  });

  it('does not let the proxy be deleted while it is checked for a session', async () => {
    const app = setup();
    const candidate = add(app, 1);
    const gate = app.checker.hold();
    const session = await app.manager.createSession({ name: 'a' });
    await app.checker.waitForCalls(1);
    const busy = await refusalOf(() => app.manager.deleteProxy(candidate));
    expect(busy.code).toBe('proxy_busy');
    expect(busy.extra.session).toMatchObject({ name: 'a' });
    gate.release();
    expect(proxyIdOf(await settled(app.manager, session.id))).toBe(candidate);
  });

  it('does not let the proxy be deleted during the preflight of a start', async () => {
    const app = setup();
    const proxy = add(app, 1);
    const session = await started(app);
    await stopped(app, session.id);
    const gate = app.checker.hold();
    const start = app.manager.startSession(session.id);
    await app.checker.waitForCalls(2);
    const busy = await refusalOf(() =>
      app.manager.deleteProxy(proxy, { force: true }),
    );
    expect(busy.code).toBe('proxy_busy');
    gate.release();
    await start;
    expect((await settled(app.manager, session.id)).status).toBe('running');
  });
});

describe('rotation', () => {
  it('restarts a running session with a new proxy, and the old one is free', async () => {
    const app = setup();
    const old = add(app, 1);
    const session = await started(app);
    expect(session.fingerprint.locale).toBe('en-US');
    const fresh = add(app, 2);
    app.backend.geo = {
      country: 'CH',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    };

    const rotating = await app.manager.rotateSession(session.id);
    expect([rotating.status, rotating.activity, proxyIdOf(rotating)]).toEqual([
      'starting',
      'assigning_proxy',
      old,
    ]);
    const rotated = await settled(app.manager, session.id);
    expect([rotated.status, proxyIdOf(rotated)]).toEqual(['running', fresh]);
    expect([rotated.fingerprint.locale, rotated.fingerprint.timezone]).toEqual([
      'de-CH',
      'Europe/Zurich',
    ]);
    const [first, second] = app.backend.launches;
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(second.spec.location.ip).toBe('203.0.113.2');
    expect(
      app.manager.listProxies().find((p) => p.id === old)?.session,
    ).toBeNull();
  });

  it('changes only the proxy of a stopped session', async () => {
    const app = setup();
    add(app, 1);
    const session = await started(app);
    await stopped(app, session.id);
    const fresh = add(app, 2);
    const rotating = await app.manager.rotateSession(session.id);
    expect([rotating.status, rotating.activity]).toEqual([
      'stopped',
      'assigning_proxy',
    ]);
    const rotated = await settled(app.manager, session.id);
    expect([rotated.status, rotated.error, proxyIdOf(rotated)]).toEqual([
      'stopped',
      null,
      fresh,
    ]);
    // They follow the new exit IP.
    expect([rotated.fingerprint.locale, rotated.fingerprint.timezone]).toEqual([
      null,
      null,
    ]);
    expect(app.backend.launches).toHaveLength(1);
  });

  it.each([true, false])(
    'keeps the old proxy when no candidate works (running: %s)',
    async (running) => {
      const app = setup();
      const old = add(app, 1);
      const session = await started(app);
      if (!running) await stopped(app, session.id);
      add(app, 2);
      app.checker.setError(host(2), 'boom');
      await app.manager.rotateSession(session.id);
      const rotated = await settled(app.manager, session.id);
      expect([rotated.status, rotated.errorCode, proxyIdOf(rotated)]).toEqual([
        running ? 'error' : 'stopped',
        'no_working_proxy',
        old,
      ]);
      expect(rotated.error?.endsWith('then rotate again.')).toBe(true);
      expect(rotated.errorExtra).toEqual({ failed: 1 });
      expect(rotated.fingerprint.locale).toBe('en-US'); // unchanged
    },
  );

  it('needs another free proxy and a session that is idle or running', async () => {
    const app = setup();
    add(app, 1);
    const session = await started(app);
    const noFree = await refusalOf(() => app.manager.rotateSession(session.id));
    expect(noFree.code).toBe('no_free_proxy');

    add(app, 2);
    add(app, 3);
    app.backend.launchGate = new Gate();
    await app.manager.rotateSession(session.id);
    const busy = await refusalOf(() => app.manager.rotateSession(session.id)); // still starting
    expect(busy.code).toBe('session_busy');
    app.backend.launchGate.open();
    await settled(app.manager, session.id);
  });

  it('frees the candidate of a rotation that is stopped before it began to check it', async () => {
    const app = setup();
    const old = add(app, 1);
    const session = await started(app);
    add(app, 2);
    // The old browser takes its time to close: the new start waits for it.
    const [browser] = app.backend.launches;
    const closing = Promise.withResolvers<void>();
    const closed = browser.close.bind(browser);
    vi.spyOn(browser, 'close').mockImplementation(async () => {
      await closing.promise;
      await closed();
    });
    await app.manager.rotateSession(session.id);
    expect(freeProxies(app)).toBe(0); // the candidate is reserved
    expect(app.checker.calls).toHaveLength(1); // and nothing has been checked for it yet

    const stoppedNow = await app.manager.stopSession(session.id);
    expect([stoppedNow.status, proxyIdOf(stoppedNow)]).toEqual([
      'stopped',
      old,
    ]);
    expect(freeProxies(app)).toBe(1); // nothing is left reserved
    closing.resolve();
    await waitFor(app.manager, session.id, (s) => s.status === 'stopped');
    expect(app.checker.calls).toHaveLength(1);
    expect(proxyIdOf(app.manager.session(session.id))).toBe(old);
  });

  it('keeps the old proxy when it is stopped during the rotation', async () => {
    const app = setup();
    const old = add(app, 1);
    const session = await started(app);
    add(app, 2);
    const gate = app.checker.hold();
    await app.manager.rotateSession(session.id);
    await app.checker.waitForCalls(2);

    const result = await app.manager.stopSession(session.id);
    expect([result.status, proxyIdOf(result)]).toEqual(['stopped', old]);
    expect(app.backend.launches[0].closed).toBe(true);
    gate.release();
    expect(freeProxies(app)).toBe(1);
    await app.manager.startSession(session.id); // with its old proxy
    expect(proxyIdOf(await settled(app.manager, session.id))).toBe(old);
  });
});

describe('start', () => {
  it('gives a session whose proxy was deleted another one', async () => {
    const app = setup();
    const first = add(app, 1);
    const session = await started(app);
    await stopped(app, session.id);
    const inUse = await refusalOf(() => app.manager.deleteProxy(first));
    expect(inUse.code).toBe('proxy_in_use');
    app.manager.deleteProxy(first, { force: true });
    const noFree = await refusalOf(() => app.manager.startSession(session.id));
    expect(noFree.code).toBe('no_free_proxy');

    const second = add(app, 2);
    const starting = await app.manager.startSession(session.id);
    expect([starting.status, starting.activity]).toEqual([
      'starting',
      'assigning_proxy',
    ]);
    expect(proxyIdOf(await settled(app.manager, session.id))).toBe(second);
  });

  it('fails a start whose proxy is unreachable, keeps the proxy and offers a rotation', async () => {
    const app = setup();
    const proxy = add(app, 1);
    add(app, 2);
    const session = await started(app);
    await stopped(app, session.id);
    app.checker.setError(host(1), 'cannot connect to the proxy');
    const unreachable = await refusalOf(() =>
      app.manager.startSession(session.id),
    );
    expect([unreachable.status, unreachable.code]).toEqual([
      502,
      'proxy_unreachable',
    ]);
    expect(unreachable.extra).toEqual({
      proxyId: proxy,
      reason: 'cannot connect to the proxy',
    });
    expect(unreachable.message).toContain('Rotate IP');
    expect(unreachable.message).toBe(
      'The proxy of session 0001 (http://192.0.2.1:8080) is not working: cannot connect to the proxy. Use “Rotate IP” to give the session another proxy.',
    );

    const after = app.manager.session(session.id);
    expect([after.status, after.errorCode]).toEqual([
      'error',
      'proxy_unreachable',
    ]);
    expect(
      after.error?.startsWith(
        'Its proxy is not working: cannot connect to the proxy.',
      ),
    ).toBe(true);
    // The row of the session carries the details the answer did.
    expect(after.errorExtra).toEqual(unreachable.extra);
    expect(proxyIdOf(after)).toBe(proxy); // never silently another IP
    expect(after.proxy?.checkStatus).toBe('failed');

    await app.manager.rotateSession(session.id); // what the error suggests
    const rotated = await settled(app.manager, session.id);
    expect([rotated.status, rotated.error, proxyIdOf(rotated)]).toEqual([
      'stopped',
      null,
      proxy + 1,
    ]);
  });

  it('needs force to start with the exit IP of an active session', async () => {
    const app = setup();
    add(app, 1);
    add(app, 2);
    const a = await started(app, 'a');
    const b = await started(app, 'b');
    await stopped(app, b.id);
    app.checker.setIp(host(2), '203.0.113.1'); // now exits through a's IP
    const inUse = await refusalOf(() => app.manager.startSession(b.id));
    expect([inUse.status, inUse.code]).toEqual([409, 'ip_in_use']);
    expect(inUse.extra.exitIp).toBe('203.0.113.1');
    expect(inUse.extra.sessions).toEqual([
      { id: a.id, name: 'a', status: 'running' },
    ]);
    expect(inUse.message).toBe(
      'Exit IP 203.0.113.1 is already used by running session(s) a.',
    );
    expect((await app.manager.startSession(b.id, { force: true })).status).toBe(
      'starting',
    );
    expect((await settled(app.manager, b.id)).status).toBe('running');
  });
});

describe('the proxy of a session that was started again', () => {
  it('can be deleted when the session is stopped, though the start checked it', async () => {
    const app = setup();
    const proxy = add(app, 1);
    const session = await started(app);
    await stopped(app, session.id);
    await app.manager.startSession(session.id); // checks the proxy first
    await settled(app.manager, session.id);
    await stopped(app, session.id);

    const inUse = await refusalOf(() => app.manager.deleteProxy(proxy));
    expect(inUse.code).toBe('proxy_in_use'); // not "busy": nothing reserves it any more
    app.manager.deleteProxy(proxy, { force: true });
    expect(app.manager.session(session.id).proxy).toBeNull();
  });

  it('can be deleted when the check of the start failed', async () => {
    const app = setup();
    const proxy = add(app, 1);
    const session = await started(app);
    await stopped(app, session.id);
    app.checker.setError(host(1), 'cannot connect to the proxy');
    await refusalOf(() => app.manager.startSession(session.id));

    const inUse = await refusalOf(() => app.manager.deleteProxy(proxy));
    expect(inUse.code).toBe('proxy_in_use');
    expect(freeProxies(app)).toBe(0); // the session keeps it
    app.manager.deleteProxy(proxy, { force: true });
  });
});

describe('names', () => {
  it('default to the smallest free number', async () => {
    const app = setup();
    for (let n = 1; n <= 5; n++) add(app, n);
    expect(app.manager.meta().nextSessionName).toBe('0001');
    const names: string[] = [];
    for (const name of [null, ' ', '0003']) {
      names.push((await app.manager.createSession({ name })).name);
    }
    expect(names).toEqual(['0001', '0002', '0003']);
    const first = app.manager.listSessions().find((s) => s.name === '0001');
    app.manager.renameSession(first?.id ?? 0, 'Shop');
    expect(app.manager.meta().nextSessionName).toBe('0001');
    expect((await app.manager.createSession()).name).toBe('0001');
    expect((await app.manager.createSession()).name).toBe('0004');
  });

  it.each(['', '   ', 'x'.repeat(81)])(
    'refuses the rename to %j',
    async (name) => {
      const app = setup();
      add(app, 1);
      const session = await app.manager.createSession();
      const invalid = await refusalOf(() =>
        app.manager.renameSession(session.id, name),
      );
      expect([invalid.status, invalid.code]).toEqual([422, 'invalid_name']);
    },
  );

  it('are trimmed and unique ignoring case', async () => {
    const app = setup();
    for (const n of [1, 2, 3]) add(app, n);
    const session = await app.manager.createSession({ name: '  Shop Ä  ' });
    expect(session.name).toBe('Shop Ä');
    const taken = await refusalOf(() =>
      app.manager.createSession({ name: 'shop ä' }),
    );
    expect(taken.code).toBe('name_taken');
    expect(app.manager.renameSession(session.id, 'SHOP Ä').name).toBe('SHOP Ä'); // its own name in another case
    expect(
      (await app.manager.createSession({ name: 'x'.repeat(80) })).name,
    ).toBe('x'.repeat(80));
    const tooLong = await refusalOf(() =>
      app.manager.createSession({ name: 'x'.repeat(81) }),
    );
    expect(tooLong.code).toBe('invalid_name');
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['a line feed', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['a tab', 'a\tb'],
    ['an escape', 'a\u001bb'],
    ['DEL', 'a\u007fb'],
    ['a next line (C1)', 'a\u0085b'],
    ['a line separator', 'a\u2028b'],
    ['a paragraph separator', 'a\u2029b'],
  ])(
    'refuse %s inside, when a session is created and when one is renamed',
    async (_what, name) => {
      const app = setup();
      for (const n of [1, 2]) add(app, n);
      const session = await app.manager.createSession({ name: 'fine' });
      const created = await refusalOf(() =>
        app.manager.createSession({ name }),
      );
      expect([created.status, created.code]).toEqual([422, 'invalid_name']);
      const renamed = await refusalOf(() =>
        app.manager.renameSession(session.id, name),
      );
      expect([renamed.status, renamed.code]).toEqual([422, 'invalid_name']);
      expect(app.manager.listSessions().map((s) => s.name)).toEqual(['fine']);
    },
  );

  it('still trim the blanks and line breaks around a name, and keep other characters', async () => {
    const app = setup();
    for (const n of [1, 2, 3]) add(app, n);
    expect(
      (await app.manager.createSession({ name: ' \n Shop \t' })).name,
    ).toBe('Shop');
    expect(
      (await app.manager.createSession({ name: 'Café Müller 日本語' })).name,
    ).toBe('Café Müller 日本語');
    expect((await app.manager.createSession({ name: 'a\u00a0b' })).name).toBe(
      'a\u00a0b',
    );
  });

  it('count characters as a person does', async () => {
    const app = setup();
    add(app, 1);
    const emoji = '😀'.repeat(80);
    expect((await app.manager.createSession({ name: emoji })).name).toBe(emoji);
    const tooLong = await refusalOf(() =>
      app.manager.createSession({ name: '😀'.repeat(81) }),
    );
    expect(tooLong.code).toBe('invalid_name');
  });
});

describe('what a candidate is, by the numbers', () => {
  it('counts the proxies a session can get in the overview', async () => {
    const app = setup();
    add(app, 1, { ok: false });
    add(app, 2);
    add(app, 3, { ok: true });
    expect(app.manager.meta().counts).toMatchObject({
      proxies: 3,
      freeProxies: 2,
      failedProxies: 1,
      checkingProxies: 0,
    });
    app.backend.geo = NEW_YORK;
    await started(app);
    expect(app.manager.meta().counts).toMatchObject({
      freeProxies: 1,
      running: 1,
      sessions: 1,
    });
  });
});
