import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors.ts';
import { FakeBackend } from './fake-browser.ts';
import { FakeExitIpChecker } from './fake-exit-ip.ts';
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
} from './harness.ts';
import type { TestManager } from './harness.ts';

const open: TestManager[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(open.splice(0).map((app) => app.close()));
});

function start(options?: Parameters<typeof createTestManager>[0]) {
  const app = createTestManager(options);
  open.push(app);
  return app;
}

describe('createTestManager', () => {
  it('gives a real manager over the fakes and a temporary directory', async () => {
    const app = start();
    expect(app.backend).toBeInstanceOf(FakeBackend);
    expect(app.checker).toBeInstanceOf(FakeExitIpChecker);
    expect(existsSync(app.dataDir)).toBe(true);
    expect(app.dbPath).toBeNull();
    expect(app.manager.meta().version).toBe('test');

    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    expect(created.status).toBe('starting');
    const running = await waitForStatus(app.manager, created.id, 'running');
    expect(running.proxy?.display).toBe('http://192.0.2.1:8080');
    expect(app.backend.launches).toHaveLength(1);
    expect(app.backend.latest().spec.profileDir).toBe(
      join(app.dataDir, 'profiles', String(created.id)),
    );
  });

  it('can keep its database in a file', async () => {
    const app = start({ store: 'file' });
    expect(app.dbPath).toBe(join(app.dataDir, 'manager.db'));
    expect(existsSync(app.dbPath ?? '')).toBe(true);
  });

  it('removes the temporary directory when it is closed, after closing every browser', async () => {
    const app = createTestManager();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    await app.close();
    expect(app.backend.latest().closed).toBe(true);
    expect(existsSync(app.dataDir)).toBe(false);
    await app.close(); // closing twice is closing once
  });

  it('keeps the directory on request, for a manager that opens it again', async () => {
    const first = createTestManager({ store: 'file' });
    first.manager.updateSettings({ startPage: 'example.org' });
    await first.close({ keepData: true });
    expect(existsSync(first.dataDir)).toBe(true);

    const second = start({ store: 'file', dataDir: first.dataDir });
    expect(second.manager.settings().startPage).toBe('https://example.org');
    await second.close();
    expect(existsSync(first.dataDir)).toBe(true); // not its directory to remove
    const { rmSync } = await import('node:fs');
    rmSync(first.dataDir, { recursive: true, force: true });
  });

  it('uses the backend and the checker it is given', () => {
    const backend = new FakeBackend();
    const checker = new FakeExitIpChecker();
    const app = start({ backend, checker });
    expect(app.backend).toBe(backend);
    expect(app.checker).toBe(checker);
  });
});

describe('the helpers', () => {
  it('wait for the status and for no background activity', async () => {
    const app = start();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager);
    expect(created).toMatchObject({
      status: 'starting',
      activity: 'assigning_proxy',
    });
    const done = await settled(app.manager, created.id);
    expect(done).toMatchObject({ status: 'running', activity: null });
    expect(getSession(app.manager, created.id).name).toBe('0001');
  });

  it('fail with the state the session was in', async () => {
    const app = start();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    await expect(
      waitForStatus(app.manager, created.id, 'stopped', 20),
    ).rejects.toThrow(/session is running\/null \(null\), expected stopped/);
    await expect(
      waitFor(app.manager, created.id, () => false, 10),
    ).rejects.toThrow(/did not get there in 10 ms/);
    expect(() => getSession(app.manager, 999)).toThrow(/does not exist/);
  });

  it('keep polling, and keep their time limit, when the test fakes the timers', async () => {
    const app = start();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    vi.useFakeTimers();
    await waitForStatus(app.manager, created.id, 'running');
    const started = performance.now();
    await expect(
      waitFor(app.manager, created.id, () => false, 30),
    ).rejects.toThrow(/did not get there in 30 ms/);
    vi.useRealTimers();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('wait for the proxy checks', async () => {
    const app = start();
    const gate = app.checker.hold();
    addProxy(app.manager, '192.0.2.1:8080');
    expect(app.manager.meta().counts.checkingProxies).toBe(1);
    await expect(waitForChecks(app.manager, 20)).rejects.toThrow(
      /still running/,
    );
    gate.release();
    await waitForChecks(app.manager);
    expect(app.manager.meta().counts.checkingProxies).toBe(0);
  });
});

describe('seedProxy', () => {
  it('adds 192.0.2.<n>:8080 through the store, with no check queued', async () => {
    const app = start();
    const id = seedProxy(app.store, 3);
    expect(app.store.getProxy(id)?.config).toMatchObject({
      host: '192.0.2.3',
      port: 8080,
    });
    expect(app.manager.meta().counts).toMatchObject({
      proxies: 1,
      checkingProxies: 0,
    });
    expect(app.checker.calls).toEqual([]);
    expect(app.store.getProxy(id)?.check.ok).toBeNull();
  });

  it('stores a working or a failed check on request', () => {
    const app = start();
    const working = seedProxy(app.store, 1, { ok: true });
    const elsewhere = seedProxy(app.store, 2, {
      ok: true,
      exitIp: '198.51.100.2',
    });
    const failed = seedProxy(app.store, 3, { ok: false });
    expect(app.store.getProxy(working)?.check).toMatchObject({
      ok: true,
      exitIp: '203.0.113.1',
      country: 'US',
    });
    expect(app.store.getProxy(elsewhere)?.check.exitIp).toBe('198.51.100.2');
    expect(app.store.getProxy(failed)?.check).toMatchObject({
      ok: false,
      error: 'proxy refused the connection',
    });
  });

  it('can give the proxy credentials', () => {
    const app = start();
    const id = seedProxy(app.store, 1, { credentials: ':user:secret' });
    expect(app.store.getProxy(id)?.config).toMatchObject({
      username: 'user',
      password: 'secret',
    });
  });
});

describe('refusalOf', () => {
  it('gives the refusal of an action that throws, or that rejects', async () => {
    const app = start();
    const thrown = await refusalOf(() => app.manager.session(99));
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown.code).toBe('session_not_found');
    const rejected = await refusalOf(() => app.manager.startSession(99));
    expect(rejected.status).toBe(404);
  });

  it('does not hide another failure, nor an action that was not refused', async () => {
    await expect(
      refusalOf(() => {
        throw new TypeError('a bug');
      }),
    ).rejects.toThrow('a bug');
    await expect(refusalOf(() => 'fine')).rejects.toThrow(
      'expected the action to be refused',
    );
  });
});
