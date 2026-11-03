// The live view of the sessions of the real manager (over the fake browser),
// with the real checks of `security.ts` on the handshake.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { websocketRefusal } from '../../security.ts';
import {
  addProxy,
  createSession,
  createTestManager,
  waitForStatus,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';
import {
  Viewer,
  closeLiveView,
  serveLiveView,
  until,
} from '../../testing/live-view-client.ts';
import type { LiveServer } from '../../testing/live-view-client.ts';

let harness: TestManager;
let live: LiveServer;

beforeEach(() => {
  harness = createTestManager();
  live = serveLiveView(harness.manager, websocketRefusal);
});

afterEach(async () => {
  await closeLiveView();
  await harness.close();
});

/** A running session "a" with a proxy of its own; its fake browser is `harness.backend.latest().remote`. */
async function runningSession(name = 'a') {
  addProxy(
    harness.manager,
    `192.0.2.${harness.manager.countProxies() + 1}:8080`,
  );
  const created = await createSession(harness.manager, name);
  await waitForStatus(harness.manager, created.id, 'running');
  return created.id;
}

describe('the stream of a running session', () => {
  it('starts with the tabs of its browser and the first picture', async () => {
    const id = await runningSession();
    const viewer = await Viewer.open(live.streamUrl(id));
    expect(await viewer.next()).toMatchObject({
      t: 'tabs',
      tabs: [{ id: 1, url: 'https://www.google.com', active: true }],
    });
    expect(await viewer.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 });
    expect(await viewer.next()).toBe('jpeg-1');
  });

  it('lets the viewer use the browser', async () => {
    const id = await runningSession();
    const { remote } = harness.backend.latest();
    const viewer = await Viewer.open(live.streamUrl(id));
    await viewer.nextOf('tabs');
    viewer.send({ t: 'mouse', a: 'down', x: 10, y: 20 });
    viewer.send({ t: 'mouse', a: 'up', x: 10, y: 20 });
    viewer.send({ t: 'text', text: 'hello' });
    viewer.send({ t: 'tab', a: 'open', url: 'example.org' });
    await until(
      () => remote.events.length >= 3 && remote.tabs().length === 2,
      'the input',
    );
    expect(remote.events).toEqual([
      ['mouse', 'down', 10, 20, 'left', 1],
      ['mouse', 'up', 10, 20, 'left', 1],
      ['text', 'hello'],
    ]);
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://example.org',
    ]);
    expect((await viewer.nextOf('tabs')).tabs).toHaveLength(2);
  });

  it('tells the viewer what it asked in vain with a notice, and the connection goes on', async () => {
    const id = await runningSession();
    const { remote } = harness.backend.latest();
    const viewer = await Viewer.open(live.streamUrl(id));
    await viewer.nextOf('tabs');
    viewer.send({ t: 'go', a: 'goto', url: 'file:///etc/passwd' });
    const error = await viewer.nextOf('error');
    expect(error.notice).toBe('address_refused');
    // A notice is not a refusal: there is no code, so the page keeps the connection.
    expect(error.code).toBeUndefined();
    viewer.send({ t: 'text', text: 'still here' });
    await until(() => remote.events.length === 1, 'the input after the notice');
    expect(viewer.open).toBe(true);
  });

  it('lets go of the keys a viewer held down when it leaves, so that none stays down in the page', async () => {
    const id = await runningSession();
    const { remote } = harness.backend.latest();
    const viewer = await Viewer.open(live.streamUrl(id));
    await viewer.nextOf('tabs');
    viewer.send({ t: 'key', a: 'down', k: 'Shift' });
    viewer.send({ t: 'mouse', a: 'down', x: 3, y: 4, b: 'left' });
    await until(() => remote.events.length === 2, 'the keys down');
    viewer.close();
    await until(() => remote.events.length === 4, 'the release');
    expect(remote.events).toEqual([
      ['key', 'down', 'Shift'],
      ['mouse', 'down', 3, 4, 'left', 1],
      ['mouse', 'up', 3, 4, 'left', 1],
      ['key', 'up', 'Shift'],
    ]);
  });

  it('says so when the session is stopped, and closes', async () => {
    const id = await runningSession();
    const viewer = await Viewer.open(live.streamUrl(id));
    await viewer.nextOf('tabs');
    await harness.manager.stopSession(id);
    expect(await viewer.nextOf('closed')).toEqual({ t: 'closed' });
    expect((await viewer.closed).code).toBe(1000);
    await waitForStatus(harness.manager, id, 'stopped');
  });

  it('says so when the browser dies', async () => {
    const id = await runningSession();
    const viewer = await Viewer.open(live.streamUrl(id));
    await viewer.nextOf('tabs');
    harness.backend.latest().crash();
    expect(await viewer.nextOf('closed')).toEqual({ t: 'closed' });
    expect((await viewer.closed).code).toBe(1000);
  });

  it('says so to every viewer when the app shuts down', async () => {
    const id = await runningSession();
    const first = await Viewer.open(live.streamUrl(id));
    const second = await Viewer.open(live.streamUrl(id));
    await first.nextOf('tabs');
    await second.nextOf('tabs');
    await harness.manager.close();
    expect(await first.nextOf('closed')).toEqual({ t: 'closed' });
    expect(await second.nextOf('closed')).toEqual({ t: 'closed' });
    await first.closed;
    await second.closed;
  });

  it('starts anew with the browser of a session that was restarted', async () => {
    const id = await runningSession();
    const before = await Viewer.open(live.streamUrl(id));
    await before.nextOf('tabs');
    await harness.manager.restartSession(id);
    await before.nextOf('closed');
    await waitForStatus(harness.manager, id, 'running');

    const after = await Viewer.open(live.streamUrl(id));
    expect(await after.nextOf('tabs')).toMatchObject({ t: 'tabs' });
    expect(harness.backend.launches).toHaveLength(2);
  });

  it('shows a dialog that waited for an assistant to a viewer that comes later', async () => {
    const id = await runningSession();
    const { remote } = harness.backend.latest();
    remote.openDialog('confirm', 'Delete everything?');
    const viewer = await Viewer.open(live.streamUrl(id));
    const dialog = await viewer.nextOf('dialog');
    expect([dialog.kind, dialog.message]).toEqual([
      'confirm',
      'Delete everything?',
    ]);
    viewer.send({ t: 'answer', id: dialog.id, accept: true, text: null });
    expect((await viewer.nextOf('dialog_closed')).id).toBe(dialog.id);
    expect(remote.events).toContainEqual(['answer', dialog.id, true, null]);
  });
});

describe('a session that cannot be watched', () => {
  it('has no stream when it is not running: the viewer is told why and the connection closes', async () => {
    const id = await runningSession('a');
    await harness.manager.stopSession(id);
    await waitForStatus(harness.manager, id, 'stopped');
    const viewer = await Viewer.open(live.streamUrl(id));
    const error = await viewer.nextOf('error');
    expect(error.code).toBe('session_not_running');
    expect(error.message).toContain('Session a is not running');
    expect((await viewer.closed).code).toBe(1000);
  });

  it('has no stream when there is no such session', async () => {
    const viewer = await Viewer.open(live.streamUrl(999));
    const error = await viewer.nextOf('error');
    expect(error.code).toBe('session_not_found');
    expect((await viewer.closed).code).toBe(1000);
  });
});

describe('the handshake, judged by the checks of the app', () => {
  it('lets the app’s own page and programs through, by either name of the host', async () => {
    const id = await runningSession();
    const own = await Viewer.open(live.streamUrl(id), {
      Origin: `http://127.0.0.1:${live.port}`,
    });
    expect(await own.next()).toMatchObject({ t: 'tabs' });
    const byName = await Viewer.open(live.streamUrl(id, 'localhost'), {
      Origin: `http://localhost:${live.port}`,
    });
    expect(await byName.next()).toMatchObject({ t: 'tabs' });
    const program = await Viewer.open(live.streamUrl(id)); // sends no Origin
    expect(await program.next()).toMatchObject({ t: 'tabs' });
  });

  it('keeps other websites out, and no browser is touched', async () => {
    const id = await runningSession();
    const { remote } = harness.backend.latest();
    for (const origin of [
      'http://evil.example',
      'http://127.0.0.1:1',
      'https://127.0.0.1',
      'null',
    ]) {
      await expect(
        Viewer.open(live.streamUrl(id), { Origin: origin }),
        origin,
      ).rejects.toThrow('refused');
    }
    await expect(
      Viewer.open(live.streamUrl(id), { Host: 'evil.example' }),
    ).rejects.toThrow('refused');
    expect(remote.listeners).toHaveLength(0);
    expect(remote.watchers).toHaveLength(0);
  });
});
