import { afterEach, describe, expect, it, vi } from 'vitest';

import { openStore } from '../../db/store.ts';
import type { Store } from '../../db/store.ts';
import { CancelledError, cancel } from '../../lib/abort.ts';
import { FakeExitIpChecker } from '../../testing/fake-exit-ip.ts';
import { settle } from '../../testing/promises.ts';
import { CHECK_CONCURRENCY, ProxyChecks } from './checks.ts';
import { parseProxy } from './parsing.ts';
import { ExitIpError, hostPort } from './types.ts';
import type { ExitIp, ExitIpChecker, ProxyConfig } from './types.ts';

const stores: Store[] = [];
const pools: ProxyChecks[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.aclose()));
  for (const store of stores.splice(0)) store.close();
});

/** A pool of `count` proxies 192.0.2.1:8080, 192.0.2.2:8080, ... and the checks over it. */
function setup(
  count: number,
  options: { concurrency?: number; checker?: ExitIpChecker } = {},
) {
  const store = openStore(':memory:');
  stores.push(store);
  const ids = Array.from(
    { length: count },
    (_, index) => store.addProxy(parseProxy(`192.0.2.${index + 1}:8080`)).id,
  );
  const checker = new FakeExitIpChecker();
  const checks = new ProxyChecks(store, options.checker ?? checker, {
    concurrency: options.concurrency,
  });
  pools.push(checks);
  return { store, ids, checker, checks };
}

async function idle(checks: ProxyChecks, ids: readonly number[]) {
  for (let round = 0; round < 200; round++) {
    if (ids.every((id) => !checks.isChecking(id))) return;
    await settle();
  }
  throw new Error('the checks did not finish');
}

/** The host:port of the proxies checked, in order. */
function checked(checker: FakeExitIpChecker): string[] {
  return checker.calls.map((proxy) => hostPort(proxy));
}

describe('queue', () => {
  it('checks in the background and stores a working proxy’s exit IP, country and latency', async () => {
    const { store, ids, checker, checks } = setup(1);
    checker.setIp('192.0.2.1:8080', '198.51.100.7', 'CH', 17);
    checks.queue(ids);
    expect(checks.isChecking(ids[0])).toBe(true);
    await idle(checks, ids);
    expect(store.getProxy(ids[0])?.check).toMatchObject({
      ok: true,
      exitIp: '198.51.100.7',
      country: 'CH',
      latencyMs: 17,
      error: null,
    });
  });

  it('stores why a proxy does not work', async () => {
    const { store, ids, checker, checks } = setup(1);
    checker.setError('192.0.2.1:8080', 'cannot connect to the proxy');
    checks.queue(ids);
    await idle(checks, ids);
    expect(store.getProxy(ids[0])?.check).toMatchObject({
      ok: false,
      error: 'cannot connect to the proxy',
    });
  });

  it('does not check a proxy that is queued or running again', async () => {
    const { ids, checker, checks } = setup(1);
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(1);
    checks.queue(ids); // running
    checks.queue(ids);
    gate.release();
    await idle(checks, ids);
    expect(checker.calls).toHaveLength(1);

    checks.queue(ids); // over: a new check
    await idle(checks, ids);
    expect(checker.calls).toHaveLength(2);
  });

  it('checks at most CHECK_CONCURRENCY proxies at a time', async () => {
    expect(CHECK_CONCURRENCY).toBe(8);
    const { ids, checker, checks } = setup(20);
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(8);
    await settle();
    expect(checker.inFlight).toBe(8);
    expect(checker.calls).toHaveLength(8);
    expect(ids.every((id) => checks.isChecking(id))).toBe(true); // queued ones count
    gate.release();
    await idle(checks, ids);
    expect(checker.calls).toHaveLength(20);
    expect(checker.maxInFlight).toBe(8);
  });

  it('takes the queue in order, within the limit', async () => {
    const { ids, checker, checks } = setup(5, { concurrency: 2 });
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(2);
    await settle();
    expect(checked(checker)).toEqual(['192.0.2.1:8080', '192.0.2.2:8080']);
    gate.release();
    await idle(checks, ids);
    expect(checked(checker)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `192.0.2.${n}:8080`),
    );
    expect(checker.maxInFlight).toBe(2);
  });

  it('does not ask the checker about a proxy that was deleted', async () => {
    const { store, ids, checker, checks } = setup(1);
    store.deleteProxy(ids[0]);
    checks.queue(ids);
    await idle(checks, ids);
    expect(checker.calls).toEqual([]);
    expect(store.getProxy(ids[0])).toBeNull();
  });
});

describe('check', () => {
  it('checks at once and returns what it stored', async () => {
    const { store, ids, checker, checks } = setup(1);
    checker.setIp('192.0.2.1:8080', '198.51.100.7', 'DE', 33);
    const result = await checks.check(ids[0]);
    expect(result).toEqual({
      ip: '198.51.100.7',
      country: 'DE',
      latencyMs: 33,
    });
    expect(store.getProxy(ids[0])?.check).toMatchObject({
      ok: true,
      exitIp: '198.51.100.7',
    });
    expect(checks.isChecking(ids[0])).toBe(false);
  });

  it('rejects with an ExitIpError for a proxy that does not work, and stores it', async () => {
    const { store, ids, checker, checks } = setup(1);
    checker.setError('192.0.2.1:8080', 'the proxy rejected the credentials');
    const error = await checks.check(ids[0]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExitIpError);
    expect(error).toMatchObject({
      message: 'the proxy rejected the credentials',
    });
    expect(store.getProxy(ids[0])?.check).toMatchObject({
      ok: false,
      error: 'the proxy rejected the credentials',
    });
  });

  it('runs ahead of the queue', async () => {
    const { ids, checker, checks } = setup(4, { concurrency: 1 });
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(1);
    const last = checks.check(ids[3]);
    await checker.waitForCalls(2);
    // The first holds the only slot, and the fourth did not wait for it.
    expect(checked(checker)).toEqual(['192.0.2.1:8080', '192.0.2.4:8080']);
    gate.release();
    await last;
    await idle(checks, ids);
    // And the queue does not check it again when its turn comes.
    expect(checked(checker).sort()).toEqual(
      [1, 2, 3, 4].map((n) => `192.0.2.${n}:8080`),
    );
  });

  it('joins the check that is running, so a proxy is never checked twice at once', async () => {
    const { ids, checker, checks } = setup(1);
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(1);
    const first = checks.check(ids[0]);
    const second = checks.check(ids[0]);
    gate.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(checker.calls).toHaveLength(1);
  });

  it('starts one check for callers that ask in the same turn', async () => {
    const { ids, checker, checks } = setup(1);
    const results = await Promise.all([
      checks.check(ids[0]),
      checks.check(ids[0]),
      checks.check(ids[0]),
    ]);
    expect(new Set(results.map((result) => result.ip)).size).toBe(1);
    expect(checker.calls).toHaveLength(1);
  });

  it('gives each caller an error of its own for a failed check', async () => {
    const { ids, checker, checks } = setup(1);
    checker.setError('192.0.2.1:8080', 'boom');
    const gate = checker.hold();
    const first = checks.check(ids[0]).catch((caught: unknown) => caught);
    const second = checks.check(ids[0]).catch((caught: unknown) => caught);
    gate.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBeInstanceOf(ExitIpError);
    expect(b).toBeInstanceOf(ExitIpError);
    expect(a).not.toBe(b);
    expect(a).toMatchObject({ message: 'boom' });
    expect(b).toMatchObject({ message: 'boom' });
  });

  it('checks again each time it is asked, once the last check is over', async () => {
    const { ids, checker, checks } = setup(1);
    await checks.check(ids[0]);
    checker.setIp('192.0.2.1:8080', '198.51.100.9');
    expect((await checks.check(ids[0])).ip).toBe('198.51.100.9');
    expect(checker.calls).toHaveLength(2);
  });

  it('says the proxy was deleted, without asking the checker', async () => {
    const { store, ids, checker, checks } = setup(1);
    store.deleteProxy(ids[0]);
    await expect(checks.check(ids[0])).rejects.toThrow('the proxy was deleted');
    expect(checker.calls).toEqual([]);
  });

  it('turns a failure of the checker itself into a verdict that shows no detail, and logs it', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const broken: ExitIpChecker = {
      check(_proxy: ProxyConfig): Promise<ExitIp> {
        return Promise.reject(
          new TypeError('cannot read properties of http://user:secret@proxy'),
        );
      },
    };
    const { store, ids, checks } = setup(1, { checker: broken });
    await expect(checks.check(ids[0])).rejects.toThrow(
      'the check failed (TypeError)',
    );
    expect(store.getProxy(ids[0])?.check.error).toBe(
      'the check failed (TypeError)',
    );
    expect(JSON.stringify(store.getProxy(ids[0]))).not.toContain('secret@');
    expect(error).toHaveBeenCalled();
  });

  it('stops waiting when the caller is cancelled, and the check goes on and is stored', async () => {
    const { store, ids, checker, checks } = setup(1);
    const gate = checker.hold();
    const controller = new AbortController();
    const waiting = checks.check(ids[0], { signal: controller.signal });
    await checker.waitForCalls(1);
    cancel(controller);
    await expect(waiting).rejects.toBeInstanceOf(CancelledError);
    expect(checks.isChecking(ids[0])).toBe(true);
    expect(store.getProxy(ids[0])?.check.ok).toBeNull();

    gate.release();
    await idle(checks, ids);
    expect(store.getProxy(ids[0])?.check.ok).toBe(true);
    expect(checker.calls).toHaveLength(1);
  });

  it('rejects at once for a caller that was cancelled already, and still checks', async () => {
    const { store, ids, checks } = setup(1);
    const controller = new AbortController();
    cancel(controller);
    await expect(
      checks.check(ids[0], { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError);
    await idle(checks, ids);
    expect(store.getProxy(ids[0])?.check.ok).toBe(true);
  });

  it('tells whoever waits when the store fails, and logs it', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { store, ids, checker, checks } = setup(1);
    const gate = checker.hold();
    const waiting = checks.check(ids[0]);
    await checker.waitForCalls(1);
    vi.spyOn(store, 'recordCheckOk').mockImplementation(() => {
      throw new Error('disk full');
    });
    gate.release();
    await expect(waiting).rejects.toThrow('disk full');
    expect(checks.isChecking(ids[0])).toBe(false);
    expect(error).toHaveBeenCalledWith(
      'an exit-IP check task failed',
      expect.any(Error),
    );
  });
});

describe('aclose', () => {
  it('drops the queue, tells the waiters they were cancelled and records no result', async () => {
    const { store, ids, checker, checks } = setup(3, { concurrency: 1 });
    const gate = checker.hold();
    checks.queue(ids);
    await checker.waitForCalls(1);
    const waiting = checks.check(ids[0]);

    await checks.aclose();
    await expect(waiting).rejects.toBeInstanceOf(CancelledError);
    expect(checks.isChecking(ids[0])).toBe(false);

    gate.release();
    await settle();
    await settle();
    // The check that was under way is not recorded, and the queued ones never began.
    expect(checker.calls).toHaveLength(1);
    expect(store.listProxies().map((proxy) => proxy.check.ok)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('refuses new work, and does not wait for a check that cannot be interrupted', async () => {
    const { ids, checker, checks } = setup(2);
    const gate = checker.hold();
    checks.queue([ids[0]]);
    await checker.waitForCalls(1);
    await checks.aclose(); // returns while the check is still held
    await expect(checks.check(ids[1])).rejects.toBeInstanceOf(CancelledError);
    checks.queue([ids[1]]);
    expect(checks.isChecking(ids[1])).toBe(false);
    await checks.aclose(); // twice is once
    gate.release();
    await settle();
    expect(checker.calls).toHaveLength(1);
  });
});
