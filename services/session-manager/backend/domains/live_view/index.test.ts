// The live view over a real server: a `Bun.serve` that does what
// `startReactServer` does with a `websocket` option (judge the handshake,
// upgrade, hand the connection to Bun's handler) and a real `WebSocket`
// client.

import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors.ts';
import type { Refusal } from '../../security.ts';
import {
  FakeRemote,
  Gate,
  fakeLaunchSpec,
} from '../../testing/fake-browser.ts';
import {
  Viewer,
  closeLiveView,
  serveLiveView,
  until,
} from '../../testing/live-view-client.ts';
import { stubManager } from '../../testing/mcp-stub-manager.ts';
import { settle } from '../../testing/promises.ts';
import type { Remote } from '../browser/remote.ts';
import type { Manager } from '../sessions/manager.ts';

/** What `security.ts` decides (the real one is in `index.flow.test.ts`): the app's own host, no foreign origin. */
function ownPageOnly(
  headers: Headers,
  hosts: ReadonlySet<string>,
): Refusal | null {
  const host = (headers.get('host') ?? '').toLowerCase();
  const origin = headers.get('origin');
  if (!hosts.has(host)) return FOREIGN_HOST;
  return origin === null || origin === `http://${host}` ? null : FOREIGN_ORIGIN;
}

const FOREIGN_HOST: Refusal = {
  code: 'forbidden_host',
  message: 'Requests must address the app as 127.0.0.1 or localhost.',
};
const FOREIGN_ORIGIN: Refusal = {
  code: 'forbidden_origin',
  message: 'Cross-site requests are not allowed.',
};

function serve(
  manager: Manager,
  websocketRefusal: (
    headers: Headers,
    hosts: ReadonlySet<string>,
  ) => Refusal | null = ownPageOnly,
) {
  return serveLiveView(manager, websocketRefusal);
}

/** A manager whose session 1 runs `remote`; session 2 is stopped, any other one does not exist. */
function managerOf(remote: Remote): Manager {
  return stubManager({
    remote(sessionId) {
      if (sessionId === 1) return remote;
      if (sessionId === 2) {
        throw new AppError(
          409,
          'session_not_running',
          'That session is not running.',
        );
      }
      throw new AppError(404, 'session_not_found', 'There is no such session.');
    },
  });
}

function newRemote(): FakeRemote {
  return new FakeRemote(fakeLaunchSpec());
}

afterEach(async () => {
  await closeLiveView();
  vi.restoreAllMocks();
});

// -- the handshake --------------------------------------------------------------

describe('the handshake', () => {
  it('only takes the address of a stream into account', async () => {
    const { live } = serve(managerOf(newRemote()));
    for (const path of [
      '/',
      '/stream',
      '/api/sessions',
      '/api/sessions/1',
      '/api/sessions/1/start',
      '/api/sessions/1/stream/',
      '/api/sessions/1/streams',
      '/api/sessions/abc/stream',
      '/api/sessions/-1/stream',
      '/api/sessions//stream',
      '/api/sessions/1.5/stream',
      '/api/session/1/stream',
      '/api/sessions/1/stream/extra',
      '/api/sessions/1234567890123456/stream', // more digits than any id has
    ]) {
      const address = `http://127.0.0.1:3004${path}`;
      expect(
        await live.upgrade(new Request(address), new URL(address)),
        path,
      ).toBeNull();
    }
  });

  it('upgrades the address of a stream with the session it names', async () => {
    const { live } = serve(managerOf(newRemote()), () => null);
    const request = new Request('http://127.0.0.1:3004/api/sessions/12/stream');
    expect(await live.upgrade(request, new URL(request.url))).toEqual({
      data: { sessionId: 12 },
    });
  });

  it('asks whether the handshake comes from the app, with its headers and the allowed hosts', async () => {
    const websocketAllowed = vi.fn(
      (_headers: Headers, _hosts: ReadonlySet<string>): Refusal | null => null,
    );
    const { live, port } = serve(managerOf(newRemote()), websocketAllowed);
    const request = new Request('http://127.0.0.1:3004/api/sessions/1/stream', {
      headers: { Origin: 'http://127.0.0.1:3004' },
    });
    await live.upgrade(request, new URL(request.url));
    expect(websocketAllowed).toHaveBeenCalledOnce();
    const [headers, hosts] = websocketAllowed.mock.calls[0] ?? [];
    expect(headers).toBe(request.headers);
    expect(hosts).toEqual(new Set([`127.0.0.1:${port}`, `localhost:${port}`]));
  });

  it.each([
    ['another site', FOREIGN_ORIGIN],
    ['another host name', FOREIGN_HOST],
  ])(
    'refuses a handshake that is not from the app (%s) with a 403 and the code of the check it failed, before any socket exists',
    async (_why, refused) => {
      const { live } = serve(managerOf(newRemote()), () => refused);
      const request = new Request(
        'http://127.0.0.1:3004/api/sessions/1/stream',
      );
      const refusal = await live.upgrade(request, new URL(request.url));
      if (!(refusal instanceof Response)) throw new Error('not refused');
      expect(refusal.status).toBe(403);
      expect(await refusal.json()).toEqual({
        error: refused.code,
        message: refused.message,
      });
    },
  );

  it('names the host when the handshake comes by the wrong host name, as every other request does', async () => {
    const { live } = serve(managerOf(newRemote()));
    const request = new Request('http://rebind.example/api/sessions/1/stream', {
      headers: {
        Host: 'rebind.example:3004',
        Origin: 'http://rebind.example:3004',
      },
    });
    const refusal = await live.upgrade(request, new URL(request.url));
    if (!(refusal instanceof Response)) throw new Error('not refused');
    expect(refusal.status).toBe(403);
    expect(await refusal.json()).toMatchObject({ error: 'forbidden_host' });
  });

  it('does not judge an address that is no stream', async () => {
    const websocketAllowed = vi.fn((): Refusal | null => FOREIGN_ORIGIN);
    const { live } = serve(managerOf(newRemote()), websocketAllowed);
    const request = new Request('http://127.0.0.1:3004/api/sessions');
    expect(await live.upgrade(request, new URL(request.url))).toBeNull();
    expect(websocketAllowed).not.toHaveBeenCalled();
  });

  it('keeps other websites from opening the stream', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    for (const origin of [
      'http://evil.example',
      'http://127.0.0.1:1',
      'https://127.0.0.1',
      'null',
    ]) {
      await expect(
        Viewer.open(live.streamUrl(1), { Origin: origin }),
        origin,
      ).rejects.toThrow('refused');
      // What the server answers, as a program that reads it sees it.
      const response = await fetch(live.httpUrl(1), {
        headers: {
          Origin: origin,
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      });
      expect(response.status, origin).toBe(403);
    }
    expect(remote.listeners).toHaveLength(0); // nothing was ever connected
    expect(remote.watchers).toHaveLength(0);

    const own = await Viewer.open(live.streamUrl(1), {
      Origin: `http://127.0.0.1:${live.port}`, // the app's own page
    });
    expect(await own.next()).toMatchObject({ t: 'tabs' });
    const byName = await Viewer.open(live.streamUrl(1, 'localhost'));
    expect(await byName.next()).toMatchObject({ t: 'tabs' });
  });

  it('keeps a request for another host name from opening the stream', async () => {
    const live = serve(managerOf(newRemote()));
    await expect(
      Viewer.open(live.streamUrl(1), { Host: 'evil.example' }),
    ).rejects.toThrow('refused');
  });

  it('leaves addresses that are no stream to the rest of the server', async () => {
    const live = serve(managerOf(newRemote()));
    await expect(
      Viewer.open(`ws://127.0.0.1:${live.port}/api/sessions/1`),
    ).rejects.toThrow('refused');
    const response = await fetch(
      `http://127.0.0.1:${live.port}/api/sessions/1`,
    );
    expect(response.status).toBe(404);
  });
});

// -- the stream -------------------------------------------------------------------

describe('the stream', () => {
  it('starts with the tabs and the first picture', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    expect(await viewer.next()).toEqual({
      t: 'tabs',
      tabs: [
        {
          id: 1,
          url: 'https://www.google.com',
          title: 'Title of https://www.google.com',
          loading: false,
          active: true,
        },
      ],
    });
    expect(await viewer.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 }); // said once per size
    expect(await viewer.next()).toBe('jpeg-1');
    remote.showNewPicture();
    expect(await viewer.next()).toBe('jpeg-2'); // no new "view": nothing changed
  });

  it('pushes the changes of the tabs', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    await viewer.nextOf('tabs');
    await remote.openTab('https://two.example');
    const pushed = await viewer.nextOf('tabs');
    expect(pushed.tabs.map((tab) => [tab.url, tab.active])).toEqual([
      ['https://www.google.com', false],
      ['https://two.example', true],
    ]);
  });

  it('serves several viewers of one session, and one leaving does not end the others', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const first = await Viewer.open(live.streamUrl(1));
    const second = await Viewer.open(live.streamUrl(1));
    await first.nextOf('tabs');
    await second.nextOf('tabs');
    expect(remote.watchers).toHaveLength(2);

    first.close();
    await first.closed;
    await until(
      () => remote.watchers.length === 1,
      'the first viewer to be gone',
    );
    await remote.openTab('https://two.example');
    expect((await second.nextOf('tabs')).tabs).toHaveLength(2);
  });

  it('lets go of the browser when the viewer leaves', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    await viewer.nextOf('tabs');
    expect(remote.listeners).toHaveLength(1);
    expect(remote.watchers).toHaveLength(1);

    viewer.close();
    await until(
      () => remote.listeners.length === 0 && remote.watchers.length === 0,
      'the viewer to be forgotten',
    );
  });
});

describe('the input', () => {
  async function connected() {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    await viewer.nextOf('tabs');
    return { remote, live, viewer };
  }

  it('reaches the browser, in order', async () => {
    const { remote, viewer } = await connected();
    for (const message of [
      { t: 'mouse', a: 'move', x: 10, y: 20.5 },
      { t: 'mouse', a: 'down', x: 10, y: 20, b: 'right', n: 2 },
      { t: 'mouse', a: 'up', x: 10, y: 20, b: 'right', n: 99 }, // a click count of 99 means 3
      { t: 'wheel', x: 5, y: 6, dx: 0, dy: 120 },
      { t: 'key', a: 'down', k: 'a' },
      { t: 'key', a: 'up', k: 'a' },
      { t: 'text', text: 'ü€ paste' },
    ]) {
      viewer.send(message);
    }
    await until(() => remote.events.length >= 7, 'the input');
    expect(remote.events).toEqual([
      ['mouse', 'move', 10, 20.5, 'left', 1],
      ['mouse', 'down', 10, 20, 'right', 2],
      ['mouse', 'up', 10, 20, 'right', 3],
      ['wheel', 5, 6, 0, 120],
      ['key', 'down', 'a'],
      ['key', 'up', 'a'],
      ['text', 'ü€ paste'],
    ]);
  });

  it('keeps the order of the keys and the tab changes', async () => {
    const { remote, viewer } = await connected();
    viewer.send({ t: 'key', a: 'down', k: 'a' });
    viewer.send({ t: 'tab', a: 'open', url: 'https://two.example' });
    viewer.send({ t: 'key', a: 'down', k: 'b' });
    await until(
      () => remote.events.length >= 2 && remote.tabs().length >= 2,
      'the input',
    );
    expect(remote.events).toEqual([
      ['key', 'down', 'a'],
      ['key', 'down', 'b'],
    ]);
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('opens tabs and goes to addresses', async () => {
    const { remote, viewer } = await connected();
    viewer.send({ t: 'tab', a: 'open', url: 'example.org' });
    viewer.send({ t: 'tab', a: 'open' });
    await until(() => remote.tabs().length >= 3, 'two new tabs');
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://example.org',
      'https://www.google.com',
    ]);

    viewer.send({ t: 'tab', a: 'activate', id: 2 });
    viewer.send({ t: 'go', a: 'goto', url: 'best pizza' }); // not an address: a search
    viewer.send({ t: 'go', a: 'back' });
    viewer.send({ t: 'tab', a: 'close', id: 3 });
    await until(
      () => remote.events.length >= 2 && remote.tabs().length <= 2,
      'the commands',
    );
    expect(remote.events).toContainEqual([
      'goto',
      'https://www.google.com/search?q=best+pizza',
      null,
      'commit',
    ]);
    expect(remote.events).toContainEqual(['history', 'back', null]);
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('answers a copy with the selected text', async () => {
    const { remote, viewer } = await connected();
    remote.selection = 'chosen words';
    viewer.send({ t: 'copy' });
    expect(await viewer.nextOf('selection')).toEqual({
      t: 'selection',
      text: 'chosen words',
      cut: false,
    });
    viewer.send({ t: 'copy', cut: true });
    expect((await viewer.nextOf('selection')).cut).toBe(true);
    await until(
      () => remote.events.some((event) => event[0] === 'key'),
      'the cut to delete',
    );
    expect(remote.events).toEqual([['key', 'press', 'Delete']]);
  });

  it('goes both ways for lists and dialogs', async () => {
    const { remote, viewer } = await connected();
    remote.openSelect({
      token: 7,
      x: 1,
      y: 2,
      width: 30,
      height: 20,
      options: [
        { label: 'Swiss', selected: true, disabled: false, group: null },
        { label: 'German', selected: false, disabled: true, group: 'EU' },
      ],
    });
    const opened = await viewer.nextOf('select');
    expect([opened.token, opened.x, opened.width]).toEqual([7, 1, 30]);
    expect(opened.options[1]).toEqual({
      label: 'German',
      selected: false,
      disabled: true,
      group: 'EU',
    });
    viewer.send({ t: 'pick', token: 7, index: 0 });
    viewer.send({ t: 'pick', token: 8, index: null });
    await until(() => remote.events.length >= 2, 'the picks');
    expect(remote.events).toEqual([
      ['pick', 7, 0],
      ['pick', 8, null],
    ]);

    const dialog = remote.openDialog('prompt', 'Your name?', 'Anna');
    expect(await viewer.nextOf('dialog')).toEqual({
      t: 'dialog',
      id: dialog.id,
      tab: 1,
      kind: 'prompt',
      message: 'Your name?',
      default: 'Anna',
    });
    viewer.send({ t: 'answer', id: dialog.id, accept: true, text: 'Bo' });
    expect(await viewer.nextOf('dialog_closed')).toEqual({
      t: 'dialog_closed',
      id: dialog.id,
    });
    expect(remote.events.at(-1)).toEqual(['answer', dialog.id, true, 'Bo']);
  });

  it('shows a dialog that waited for an assistant to a viewer that comes later', async () => {
    const remote = newRemote();
    remote.openDialog('confirm', 'Delete everything?'); // opened while nobody watched
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    const dialog = await viewer.nextOf('dialog');
    expect([dialog.kind, dialog.message]).toEqual([
      'confirm',
      'Delete everything?',
    ]);
    viewer.send({ t: 'answer', id: dialog.id, accept: true, text: null });
    expect((await viewer.nextOf('dialog_closed')).id).toBe(dialog.id);
    expect(remote.events).toContainEqual(['answer', dialog.id, true, null]);
  });

  it('reports a wrong tab and goes on', async () => {
    const { remote, viewer } = await connected();
    viewer.send({ t: 'tab', a: 'activate', id: 99 });
    expect(await viewer.nextOf('error')).toEqual({
      t: 'error',
      message: 'There is no such tab.',
      notice: 'tab_gone',
    });
    viewer.send({ t: 'text', text: 'still here' });
    await until(() => remote.events.length >= 1, 'the text');
    expect(remote.events).toEqual([['text', 'still here']]);
    expect(viewer.open).toBe(true);
  });

  it('ignores what is not a message, and stays usable', async () => {
    const { remote, viewer } = await connected();
    for (const junk of [
      'not json',
      '[]',
      '5',
      '{"x": 1}',
      '{"t": "mouse"}',
      '{"t": "mouse", "a": "explode", "x": 1, "y": 1}',
      '{"t": "mouse", "a": "move", "x": "NaN", "y": 1}',
      '{"t": "mouse", "a": "move", "x": "oops", "y": 1}',
      '{"t": "mouse", "a": "move", "x": 1, "y": 1, "b": "thumb"}',
      '{"t": "key", "a": "tap", "k": "a"}',
      '{"t": "tab", "a": "fly"}',
      '{"t": "go", "a": "goto", "url": ""}',
      '{"t": "pick", "token": "x"}',
    ]) {
      viewer.send(junk);
    }
    viewer.socket.send(new TextEncoder().encode('binary junk'));
    viewer.send({ t: 'key', a: 'down', k: 'x' });
    await until(() => remote.events.length >= 1, 'the key');
    expect(remote.events).toEqual([['key', 'down', 'x']]); // still alive
    expect(viewer.open).toBe(true);
  });

  it('closes a connection that sends more than a message can be', async () => {
    const { viewer } = await connected();
    viewer.send({ t: 'text', text: 'x'.repeat(2 * 1024 * 1024) });
    const closed = await viewer.closed;
    expect(closed.code).not.toBe(1000);
  });

  it('does not hold an answer up behind the click that waits for it', async () => {
    // A click that makes a page call confirm() does not return before the
    // dialog is answered.
    const { remote, viewer } = await connected();
    const released = new Gate();
    const mouse = remote.mouse.bind(remote);
    vi.spyOn(remote, 'mouse').mockImplementation(async (...args) => {
      await mouse(...args);
      if (args[0] === 'up') await released.wait();
    });
    const answerDialog = remote.answerDialog.bind(remote);
    vi.spyOn(remote, 'answerDialog').mockImplementation(async (...args) => {
      await answerDialog(...args);
      released.open(); // answering lets the click return
    });

    viewer.send({ t: 'mouse', a: 'down', x: 1, y: 1 });
    viewer.send({ t: 'mouse', a: 'up', x: 1, y: 1 });
    await until(() => remote.events.length >= 2, 'the click');
    viewer.send({ t: 'mouse', a: 'move', x: 5, y: 5 }); // waits behind the click
    viewer.send({ t: 'mouse', a: 'move', x: 6, y: 6 }); // ...and replaces the move before it
    viewer.send({ t: 'answer', id: 1, accept: true, text: null });
    await until(() => remote.events.length >= 4, 'the answer and the move');
    expect(remote.events).toEqual([
      ['mouse', 'down', 1, 1, 'left', 1],
      ['mouse', 'up', 1, 1, 'left', 1],
      ['answer', 1, true, null],
      ['mouse', 'move', 6, 6, 'left', 1],
    ]);
  });

  it('adds up the scrolls that arrive faster than the browser follows', async () => {
    const { remote, viewer } = await connected();
    const released = new Gate();
    const mouse = remote.mouse.bind(remote);
    vi.spyOn(remote, 'mouse').mockImplementation(async (...args) => {
      await released.wait();
      await mouse(...args);
    });
    viewer.send({ t: 'mouse', a: 'move', x: 1, y: 1 }); // holds up what comes behind it
    for (let tick = 0; tick < 40; tick++) {
      viewer.send({ t: 'wheel', x: 5, y: 6, dx: 0, dy: 100 });
    }
    // An answer is handled the moment it is read, and messages are read in
    // order: when it has been, the ticks have all arrived.
    viewer.send({ t: 'pick', token: 1, index: null });
    await until(
      () => remote.events.some((event) => event[0] === 'pick'),
      'the ticks to arrive',
    );
    released.open();
    await until(
      () => remote.events.some((event) => event[0] === 'wheel'),
      'the scroll',
    );
    const scrolled = remote.events
      .filter((event) => event[0] === 'wheel')
      .reduce((sum, event) => sum + (event[0] === 'wheel' ? event[4] : 0), 0);
    expect(scrolled).toBe(4000);
    expect(
      remote.events.filter((event) => event[0] === 'wheel').length,
    ).toBeLessThan(40);
  });
});

// -- a client that cannot keep up --------------------------------------------------

/** One frame of what the server sends, as the WebSocket protocol (RFC 6455) frames it. */
interface Frame {
  opcode: number;
  payload: Uint8Array;
}

/**
 * A client that speaks just enough WebSocket to read at its own pace: it can
 * stop reading, which a real `WebSocket` does not let a test do.
 */
class SlowViewer {
  readonly frames: Frame[] = [];
  readonly #socket: ReturnType<typeof connect>;
  #pending: Buffer = Buffer.alloc(0);
  #shaken = false;

  private constructor(port: number, sessionId: number) {
    this.#socket = connect(port, '127.0.0.1');
    this.#socket.write(
      [
        `GET /api/sessions/${sessionId}/stream HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'),
    );
    this.#socket.on('data', (chunk: Buffer) => {
      this.#pending = Buffer.concat([this.#pending, chunk]);
      if (!this.#shaken) {
        const end = this.#pending.indexOf('\r\n\r\n');
        if (end < 0) return;
        this.#pending = this.#pending.subarray(end + 4);
        this.#shaken = true;
      }
      this.#readFrames();
    });
  }

  static start(port: number, sessionId: number): SlowViewer {
    const viewer = new SlowViewer(port, sessionId);
    slowViewers.push(viewer);
    return viewer;
  }

  #readFrames(): void {
    for (;;) {
      const head = this.#pending;
      if (head.length < 2) return;
      const opcode = (head[0] ?? 0) & 0x0f;
      let length = (head[1] ?? 0) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (head.length < 4) return;
        length = head.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (head.length < 10) return;
        length = Number(head.readBigUInt64BE(2));
        offset = 10;
      }
      if (head.length < offset + length) return;
      this.frames.push({
        opcode,
        payload: Uint8Array.from(head.subarray(offset, offset + length)),
      });
      this.#pending = head.subarray(offset + length);
    }
  }

  /** The pictures received so far: the number the fake browser put into each. */
  pictures(): number[] {
    return this.frames
      .filter((frame) => frame.opcode === 2)
      .map((frame) => frame.payload[0] ?? 0);
  }

  pause(): void {
    this.#socket.pause();
  }

  resume(): void {
    this.#socket.resume();
  }

  destroy(): void {
    this.#socket.destroy();
  }
}

const slowViewers: SlowViewer[] = [];

describe('a client that cannot keep up', () => {
  afterEach(() => {
    for (const viewer of slowViewers.splice(0)) viewer.destroy();
  });

  it('skips pictures, and gets the newest one once it reads again', async () => {
    const remote = newRemote();
    // Pictures of half a megabyte; the first byte tells which one it is.
    let drawn = 0;
    vi.spyOn(remote, 'picture').mockImplementation(() => {
      drawn += 1;
      const jpeg = new Uint8Array(512 * 1024);
      jpeg[0] = drawn;
      return { tab: 1, width: 800, height: 600, jpeg };
    });
    const live = serve(managerOf(remote));
    const viewer = SlowViewer.start(live.port, 1);
    await until(() => viewer.pictures().length >= 1, 'the first picture');
    viewer.pause();

    const PICTURES = 120;
    for (let index = 1; index < PICTURES; index++) {
      remote.showNewPicture();
      // Let the server take the picture and write it.
      await settle();
    }
    expect(drawn).toBe(PICTURES);

    viewer.resume();
    await until(
      () => viewer.pictures().at(-1) === PICTURES,
      'the newest picture',
      10_000,
    );
    const seen = viewer.pictures();
    // Some were written before the connection filled up; the rest were skipped.
    expect(seen.length).toBeLessThan(PICTURES / 2);
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // in order
    expect(new Set(seen).size).toBe(seen.length);
  });
});

// -- the end ----------------------------------------------------------------------

describe('the end of the stream', () => {
  it('says so when the browser ends, and closes the connection', async () => {
    const remote = newRemote();
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    await viewer.nextOf('tabs');
    remote.close();
    expect(await viewer.nextOf('closed')).toEqual({ t: 'closed' });
    const closed = await viewer.closed;
    expect(closed.code).toBe(1000);
    expect(remote.watchers).toHaveLength(0);
  });

  it('tells a viewer of a session that is not running why there is nothing to watch', async () => {
    const live = serve(managerOf(newRemote()));
    const viewer = await Viewer.open(live.streamUrl(2));
    expect(await viewer.next()).toEqual({
      t: 'error',
      code: 'session_not_running',
      message: 'That session is not running.',
    });
    expect((await viewer.closed).code).toBe(1000);

    const missing = await Viewer.open(live.streamUrl(999));
    const error = await missing.nextOf('error');
    expect(error.code).toBe('session_not_found');
    expect((await missing.closed).code).toBe(1000);
  });

  it('closes the connection and logs it when the session cannot be looked up for no reason a client could act on', async () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    const live = serve(
      stubManager({
        remote() {
          throw new TypeError('the store is closed');
        },
      }),
    );
    const viewer = await Viewer.open(live.streamUrl(1));
    const closed = await viewer.closed;
    expect(closed.code).toBe(1011);
    expect(failure).toHaveBeenCalledOnce();
    expect(viewer.inbox).toEqual([]);
  });

  it('ends a connection whose browser failed to answer in a way no browser does', async () => {
    const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
    const remote = newRemote();
    vi.spyOn(remote, 'selectedText').mockRejectedValue(new TypeError('bug'));
    const live = serve(managerOf(remote));
    const viewer = await Viewer.open(live.streamUrl(1));
    await viewer.nextOf('tabs');
    viewer.send({ t: 'copy' });
    expect((await viewer.closed).code).toBe(1011);
    expect(failure).toHaveBeenCalledOnce();
    await until(() => remote.watchers.length === 0, 'the watcher to be closed');
  });
});
