// The overview the app opens with.

import { afterEach, describe, expect, it } from 'vitest';

import {
  addProxy,
  createSession,
  createTestManager,
  refusalOf,
  seedProxy,
  waitForChecks,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(options?: Parameters<typeof createTestManager>[0]): TestManager {
  const app = createTestManager(options);
  apps.push(app);
  return app;
}

describe('meta', () => {
  it('has the versions, the OS choices and the counts', async () => {
    const app = setup({ version: '1.2.3' });
    app.backend.browserVersion = '152.0.4-beta.30';
    addProxy(app.manager, '192.0.2.1:8080');
    app.checker.setError('192.0.2.2:8080', 'boom');
    addProxy(app.manager, '192.0.2.2:8080');
    await waitForChecks(app.manager);

    const meta = app.manager.meta();
    expect(meta.version).toBe('1.2.3');
    expect(meta.browserVersion).toBe('152.0.4-beta.30');
    expect(meta.browserInstalled).toBe(true);
    expect([meta.browserInstalling, meta.browserInstallError]).toEqual([
      false,
      null,
    ]);
    expect(meta.osOptions).toEqual(['random', 'windows', 'macos', 'linux']);
    expect(meta.nextSessionName).toBe('0001');
    expect(meta.counts).toEqual({
      proxies: 2,
      freeProxies: 1,
      failedProxies: 1,
      checkingProxies: 0,
      sessions: 0,
      running: 0,
      secrets: 0,
    });
  });

  it('counts proxies that are being checked as checking, not as failed', async () => {
    const app = setup();
    seedProxy(app.store, 1, { ok: false });
    expect(app.manager.meta().counts.failedProxies).toBe(1);
    const gate = app.checker.hold();
    app.manager.checkProxy(1);
    expect(app.manager.meta().counts).toMatchObject({
      failedProxies: 0,
      checkingProxies: 1,
    });
    gate.release();
    await waitForChecks(app.manager);
    expect(app.manager.meta().counts).toMatchObject({
      failedProxies: 0,
      checkingProxies: 0,
      freeProxies: 1,
    });
  });

  it('counts the sessions, the running ones and the free proxies', async () => {
    const app = setup();
    for (const n of [1, 2, 3]) seedProxy(app.store, n);
    const a = await createSession(app.manager, 'a');
    await createSession(app.manager, 'b');
    await waitForStatus(app.manager, a.id, 'running');
    await waitForStatus(app.manager, a.id + 1, 'running');
    expect(app.manager.meta().counts).toMatchObject({
      sessions: 2,
      running: 2,
      freeProxies: 1,
    });
    await app.manager.stopSession(a.id);
    await waitForStatus(app.manager, a.id, 'stopped');
    expect(app.manager.meta().counts).toMatchObject({
      sessions: 2,
      running: 1,
      freeProxies: 1, // a stopped session keeps its proxy
    });
    expect(app.manager.meta().nextSessionName).toBe('0001');
  });

  it('reports the install of the browser, and refuses sessions meanwhile', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    app.backend.installed = false;
    app.backend.install = { installing: true, error: null };
    let meta = app.manager.meta();
    expect([
      meta.browserInstalled,
      meta.browserInstalling,
      meta.browserInstallError,
    ]).toEqual([false, true, null]);
    const installing = await refusalOf(() => app.manager.createSession());
    expect([installing.status, installing.code]).toEqual([
      503,
      'browser_installing',
    ]);
    expect(installing.message).toBe(
      'The Camoufox browser is still being installed. Try again in a moment.',
    );

    app.backend.install = {
      installing: false,
      error: 'no space left on device',
    };
    meta = app.manager.meta();
    expect([meta.browserInstalling, meta.browserInstallError]).toEqual([
      false,
      'no space left on device',
    ]);
    const missing = await refusalOf(() => app.manager.createSession());
    expect([missing.status, missing.code]).toEqual([
      503,
      'browser_not_installed',
    ]);
    expect(missing.message).toContain('The Camoufox browser is not installed.');

    app.backend.installed = true; // installed by hand since: the old issue is moot
    expect(app.manager.meta().browserInstallError).toBeNull();
    expect(app.manager.listSessions()).toEqual([]);
  });

  it('refuses a start while the rest of the install is under way, though the browser is there', async () => {
    const app = setup();
    seedProxy(app.store, 1);
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    await app.manager.stopSession(created.id);
    await waitForStatus(app.manager, created.id, 'stopped');
    app.backend.install = { installing: true, error: null };
    const refused = await refusalOf(() => app.manager.startSession(created.id));
    expect(refused.code).toBe('browser_installing');
  });
});
