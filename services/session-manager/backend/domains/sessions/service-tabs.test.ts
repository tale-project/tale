// The start page, and the tabs a session reopens: after Stop, after a crash and
// after Rotate IP.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '../../../lib/api/schemas.ts';
import { EMPTY_LAYOUT } from '../../lib/web-url.ts';
import type { FakeBrowser } from '../../testing/fake-browser.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  refusalOf,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';

const apps: TestManager[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(): TestManager {
  const app = createTestManager();
  apps.push(app);
  return app;
}

async function runningSession(app: TestManager, name = 'a'): Promise<Session> {
  addProxy(app.manager, '192.0.2.1:8080');
  const created = await createSession(app.manager, name);
  return waitForStatus(app.manager, created.id, 'running');
}

/** Stops the session and starts it again. */
async function restart(app: TestManager, sessionId: number): Promise<void> {
  const stopped = await app.manager.stopSession(sessionId);
  expect(['stopping', 'stopped']).toContain(stopped.status);
  await waitForStatus(app.manager, sessionId, 'stopped');
  await app.manager.startSession(sessionId);
  await waitForStatus(app.manager, sessionId, 'running');
}

const urls = (browser: FakeBrowser): string[] =>
  browser.remote.tabs().map((tab) => tab.url);

describe('the start page', () => {
  it('is what a new session opens', async () => {
    const app = setup();
    await runningSession(app);
    expect(app.backend.launches).toHaveLength(1);
    const [browser] = app.backend.launches;
    expect(browser.spec.startPage).toBe('https://www.google.com');
    expect(browser.spec.tabs).toEqual(EMPTY_LAYOUT);
    expect(urls(browser)).toEqual(['https://www.google.com']);
  });

  it('is for new sessions, while old ones reopen their tabs', async () => {
    const app = setup();
    const first = await runningSession(app);
    app.manager.updateSettings({ startPage: 'https://duckduckgo.com' });
    addProxy(app.manager, '192.0.2.2:8080');
    const second = await createSession(app.manager, 'b');
    await waitForStatus(app.manager, second.id, 'running');
    expect(urls(app.backend.launches[1])).toEqual(['https://duckduckgo.com']);

    await restart(app, first.id);
    // Its tab, not the new start page.
    expect(urls(app.backend.launches[2])).toEqual(['https://www.google.com']);
  });
});

describe('the tabs', () => {
  it('are kept when the session is stopped', async () => {
    const app = setup();
    const session = await runningSession(app);
    const { remote } = app.backend.launches[0];
    await remote.goto('https://one.example');
    await remote.openTab('https://two.example');
    await remote.openTab('https://three.example');
    await remote.activateTab(2);
    await restart(app, session.id);

    const reopened = app.backend.launches[1];
    expect(reopened.spec.tabs).toEqual({
      urls: [
        'https://one.example',
        'https://two.example',
        'https://three.example',
      ],
      active: 1,
    });
    expect(urls(reopened)).toEqual([
      'https://one.example',
      'https://two.example',
      'https://three.example',
    ]);
    expect(reopened.remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('are forgotten when the last one is closed: the session ends and opens the start page next time', async () => {
    const app = setup();
    const session = await runningSession(app);
    const { remote } = app.backend.launches[0];
    await remote.openTab('https://two.example');
    for (const tab of remote.tabs()) await remote.closeTab(tab.id);
    await waitForStatus(app.manager, session.id, 'stopped');

    app.manager.updateSettings({ startPage: 'https://duckduckgo.com' });
    await app.manager.startSession(session.id);
    await waitForStatus(app.manager, session.id, 'running');
    expect(app.backend.launches[1].spec.tabs).toEqual(EMPTY_LAYOUT);
    // The start page as it is now.
    expect(urls(app.backend.launches[1])).toEqual(['https://duckduckgo.com']);
  });

  it('are kept when the browser crashes', async () => {
    const app = setup();
    const session = await runningSession(app);
    await app.backend.launches[0].remote.openTab('https://two.example');
    app.backend.launches[0].crash();
    await waitForStatus(app.manager, session.id, 'stopped');
    await app.manager.startSession(session.id);
    await waitForStatus(app.manager, session.id, 'running');
    expect(urls(app.backend.launches[1])).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('are kept when the IP is rotated', async () => {
    const app = setup();
    const session = await runningSession(app);
    addProxy(app.manager, '192.0.2.2:8080');
    await app.backend.launches[0].remote.openTab('https://two.example');
    await app.manager.rotateSession(session.id);
    await waitForStatus(app.manager, session.id, 'running');
    expect(app.backend.launches).toHaveLength(2);
    expect(urls(app.backend.launches[1])).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('are kept when the app is closed, for the next time', async () => {
    const app = createTestManager({ store: 'file' });
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    await waitForStatus(app.manager, created.id, 'running');
    await app.backend.launches[0].remote.openTab('https://two.example');
    await app.close({ keepData: true });

    const again = createTestManager({ store: 'file', dataDir: app.dataDir });
    apps.push(again);
    await again.manager.startSession(created.id);
    await waitForStatus(again.manager, created.id, 'running');
    expect(urls(again.backend.launches[0])).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });
});

describe('the live browser', () => {
  it('is only available while the session runs', async () => {
    const app = setup();
    const session = await runningSession(app);
    expect(app.manager.remote(session.id)).toBe(app.backend.launches[0].remote);

    await app.manager.stopSession(session.id);
    await waitForStatus(app.manager, session.id, 'stopped');
    const refusal = await refusalOf(() => app.manager.remote(session.id));
    expect([refusal.status, refusal.code]).toEqual([
      409,
      'session_not_running',
    ]);
    expect(refusal.message).toBe('Session a is not running. Start it first.');
    const missing = await refusalOf(() => app.manager.remote(999));
    expect([missing.status, missing.code]).toEqual([404, 'session_not_found']);
  });

  it('is not available while the session starts or stops', async () => {
    const app = setup();
    addProxy(app.manager, '192.0.2.1:8080');
    const created = await createSession(app.manager, 'a');
    expect((await refusalOf(() => app.manager.remote(created.id))).code).toBe(
      'session_not_running',
    );
    await waitForStatus(app.manager, created.id, 'running');

    // The browser takes its time to close.
    const [browser] = app.backend.launches;
    const closed = browser.close.bind(browser);
    const closing = Promise.withResolvers<void>();
    vi.spyOn(browser, 'close').mockImplementation(async () => {
      await closing.promise;
      await closed();
    });
    await app.manager.stopSession(created.id);
    expect(app.manager.session(created.id).status).toBe('stopping');
    expect((await refusalOf(() => app.manager.remote(created.id))).code).toBe(
      'session_not_running',
    );
    closing.resolve();
    await waitForStatus(app.manager, created.id, 'stopped');
  });
});
