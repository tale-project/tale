import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_TAB_TITLE,
  MAX_TAB_URL,
  MAX_TEXT,
  serverMessageSchema,
} from '../../../lib/live-view.ts';
import type { ServerMessage } from '../../../lib/live-view.ts';
import {
  FakeRemote,
  Gate,
  fakeLaunchSpec,
} from '../../testing/fake-browser.ts';
import { settle } from '../../testing/promises.ts';
import type { LaunchSpec } from '../browser/backend.ts';
import { RemoteError } from '../browser/remote.ts';
import type { PageDialog } from '../browser/remote.ts';
import { MAX_QUEUED_BYTES } from './outbox.ts';
import { SessionSocket } from './session-socket.ts';
import type { SocketLike } from './session-socket.ts';

const decoder = new TextDecoder();

/** A WebSocket that records what is sent; `statuses` are the answers of the next sends. */
class FakeSocket implements SocketLike {
  readonly sent: (ServerMessage | Uint8Array)[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];
  readonly statuses: number[] = [];

  send(data: string | Uint8Array): number | undefined {
    // The server only ever says what the protocol knows.
    this.sent.push(
      typeof data === 'string'
        ? serverMessageSchema.parse(JSON.parse(data))
        : data,
    );
    return this.statuses.shift();
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  /** The JSON messages, in order. */
  messages(): ServerMessage[] {
    return this.sent.filter(
      (item): item is ServerMessage => !(item instanceof Uint8Array),
    );
  }

  messagesOf<T extends ServerMessage['t']>(
    type: T,
  ): Extract<ServerMessage, { t: T }>[] {
    return this.messages().filter(
      (message): message is Extract<ServerMessage, { t: T }> =>
        message.t === type,
    );
  }

  /** The pictures, as the text the fake browser draws them from. */
  pictures(): string[] {
    return this.sent
      .filter((item): item is Uint8Array => item instanceof Uint8Array)
      .map((jpeg) => decoder.decode(jpeg));
  }

  /** Everything, pictures as their text. */
  everything(): (ServerMessage | string)[] {
    return this.sent.map((item) =>
      item instanceof Uint8Array ? decoder.decode(item) : item,
    );
  }
}

/** Turns of the event loop that carry a message through every loop of the connection (they are promise chains). */
const LOOPS = 6;

const open: SessionSocket[] = [];

function connect(overrides: Partial<LaunchSpec> = {}) {
  const remote = new FakeRemote(fakeLaunchSpec(overrides));
  const socket = new FakeSocket();
  const connection = new SessionSocket(socket, remote, 7);
  open.push(connection);
  connection.start();
  return { remote, socket, connection };
}

function sendJson(connection: SessionSocket, message: unknown): void {
  connection.receive(JSON.stringify(message));
}

afterEach(() => {
  for (const connection of open.splice(0)) connection.close();
  vi.restoreAllMocks();
  delete process.env.DEBUG;
});

describe('what the viewer is sent', () => {
  it('starts with the tabs, then the size of the page, then the first picture', async () => {
    const { remote, socket } = connect();
    await settle(LOOPS);
    expect(socket.everything()).toEqual([
      {
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
      },
      { t: 'view', tab: 1, w: 800, h: 600 }, // said once per size
      'jpeg-1',
    ]);

    remote.showNewPicture();
    await settle(LOOPS);
    expect(socket.pictures()).toEqual(['jpeg-1', 'jpeg-2']); // no new "view": nothing changed
    expect(socket.messagesOf('view')).toHaveLength(1);
  });

  it('pushes the tabs whenever they change', async () => {
    const { remote, socket } = connect();
    await remote.openTab('https://two.example');
    await settle(LOOPS);
    const pushed = socket.messagesOf('tabs').at(-1);
    expect(pushed?.tabs.map((tab) => [tab.url, tab.active])).toEqual([
      ['https://www.google.com', false],
      ['https://two.example', true],
    ]);
  });

  it('draws a drop-down list and a dialog of the page, and says when the dialog is over', async () => {
    const { remote, socket } = connect();
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
    const dialog = remote.openDialog('prompt', 'Your name?', 'Anna');
    await settle(LOOPS);
    expect(socket.messagesOf('select')).toEqual([
      {
        t: 'select',
        token: 7,
        x: 1,
        y: 2,
        width: 30,
        height: 20,
        options: [
          { label: 'Swiss', selected: true, disabled: false, group: null },
          { label: 'German', selected: false, disabled: true, group: 'EU' },
        ],
      },
    ]);
    expect(socket.messagesOf('dialog')).toEqual([
      {
        t: 'dialog',
        id: dialog.id,
        tab: 1,
        kind: 'prompt',
        message: 'Your name?',
        default: 'Anna',
      },
    ]);

    remote.emit({ type: 'dialog_closed', id: dialog.id });
    await settle(LOOPS);
    expect(socket.messagesOf('dialog_closed')).toEqual([
      { t: 'dialog_closed', id: dialog.id },
    ]);
  });

  it('shows a dialog that waits for an assistant to a viewer that comes later', async () => {
    const remote = new FakeRemote(fakeLaunchSpec());
    const opened: PageDialog = remote.openDialog(
      'confirm',
      'Delete everything?',
    ); // opened while nobody watched
    const socket = new FakeSocket();
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);

    expect(socket.messages().map((message) => message.t)).toEqual([
      'tabs',
      'dialog', // after the tabs, before the pictures
      'view',
    ]);
    expect(socket.messagesOf('dialog')[0]).toMatchObject({
      id: opened.id,
      kind: 'confirm',
      message: 'Delete everything?',
    });

    sendJson(connection, {
      t: 'answer',
      id: opened.id,
      accept: true,
      text: null,
    });
    await settle(LOOPS);
    expect(socket.messagesOf('dialog_closed')).toEqual([
      { t: 'dialog_closed', id: opened.id },
    ]);
    expect(remote.events).toContainEqual(['answer', opened.id, true, null]);
  });

  it('answers a copy with the selected text, and cutting also deletes it', async () => {
    const { remote, socket, connection } = connect();
    remote.selection = 'chosen words';
    sendJson(connection, { t: 'copy' });
    await settle(LOOPS);
    expect(socket.messagesOf('selection')).toEqual([
      { t: 'selection', text: 'chosen words', cut: false },
    ]);
    expect(remote.events).toEqual([]);

    sendJson(connection, { t: 'copy', cut: true });
    await settle(LOOPS);
    expect(socket.messagesOf('selection').at(-1)).toEqual({
      t: 'selection',
      text: 'chosen words',
      cut: true,
    });
    expect(remote.events).toEqual([['key', 'press', 'Delete']]);
  });

  it.each(['Control', 'Meta'])(
    'lets go of %s for the Delete of a cut, which it would turn into no deletion, and holds it again',
    async (modifier) => {
      const { remote, connection } = connect();
      remote.selection = 'chosen words';
      // A viewer cuts with the shortcut: its modifier is down in the page
      // while the page is asked to cut.
      sendJson(connection, { t: 'key', a: 'down', k: modifier });
      sendJson(connection, { t: 'copy', cut: true });
      await settle(LOOPS);
      expect(remote.events).toEqual([
        ['key', 'down', modifier],
        ['key', 'up', modifier],
        ['key', 'press', 'Delete'],
        ['key', 'down', modifier],
      ]);

      // The viewer lets it go as it always does: it stays a key held until then.
      sendJson(connection, { t: 'key', a: 'up', k: modifier });
      await settle(LOOPS);
      expect(remote.events.at(-1)).toEqual(['key', 'up', modifier]);
    },
  );

  it('keeps the other keys held while a cut deletes', async () => {
    const { remote, connection } = connect();
    remote.selection = 'chosen words';
    sendJson(connection, { t: 'key', a: 'down', k: 'Shift' });
    sendJson(connection, { t: 'copy', cut: true });
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['key', 'down', 'Shift'],
      ['key', 'press', 'Delete'],
    ]);
  });

  it('does not delete anything when a cut finds nothing selected', async () => {
    const { remote, socket, connection } = connect();
    remote.selection = '';
    sendJson(connection, { t: 'copy', cut: true });
    sendJson(connection, { t: 'key', a: 'down', k: 'x' }); // the marker: it is applied after the copy
    await settle(LOOPS);
    expect(socket.messagesOf('selection')).toEqual([
      { t: 'selection', text: '', cut: true },
    ]);
    expect(remote.events).toEqual([['key', 'down', 'x']]);
  });
});

describe('what the viewer does', () => {
  it('lets mouse, keyboard and text reach the browser, in order', async () => {
    const { remote, connection } = connect();
    for (const message of [
      { t: 'mouse', a: 'move', x: 10, y: 20.5 },
      { t: 'mouse', a: 'down', x: 10, y: 20, b: 'right', n: 2 },
      { t: 'mouse', a: 'up', x: 10, y: 20, b: 'right', n: 99 }, // a click count of 99 means 3
      { t: 'mouse', a: 'down', x: 1, y: 1, n: 0 }, // and 0 means 1
      { t: 'wheel', x: 5, y: 6, dx: 0, dy: 120 },
      { t: 'key', a: 'down', k: 'a' },
      { t: 'key', a: 'up', k: 'a' },
      { t: 'text', text: 'ü€ paste' },
    ]) {
      sendJson(connection, message);
    }
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['mouse', 'move', 10, 20.5, 'left', 1],
      ['mouse', 'down', 10, 20, 'right', 2],
      ['mouse', 'up', 10, 20, 'right', 3],
      ['mouse', 'down', 1, 1, 'left', 1],
      ['wheel', 5, 6, 0, 120],
      ['key', 'down', 'a'],
      ['key', 'up', 'a'],
      ['text', 'ü€ paste'],
    ]);
  });

  it('keeps the input and the tab changes in the order they came', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'a' });
    sendJson(connection, { t: 'tab', a: 'open', url: 'https://two.example' });
    sendJson(connection, { t: 'key', a: 'down', k: 'b' });
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['key', 'down', 'a'],
      ['key', 'down', 'b'],
    ]);
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('opens, activates and closes tabs, and goes where the address bar says', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'tab', a: 'open', url: 'example.org' });
    sendJson(connection, { t: 'tab', a: 'open' });
    sendJson(connection, { t: 'tab', a: 'open', url: '' }); // nothing typed: the start page too
    await settle(LOOPS);
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://www.google.com',
      'https://example.org',
      'https://www.google.com',
      'https://www.google.com',
    ]);

    sendJson(connection, { t: 'tab', a: 'activate', id: 2 });
    sendJson(connection, { t: 'go', a: 'goto', url: 'best pizza' }); // not an address: a search
    sendJson(connection, { t: 'go', a: 'back' });
    sendJson(connection, { t: 'go', a: 'forward' });
    sendJson(connection, { t: 'go', a: 'reload' });
    sendJson(connection, { t: 'go', a: 'goto', url: ' example.com/page ' });
    sendJson(connection, { t: 'tab', a: 'close', id: 4 });
    sendJson(connection, { t: 'tab', a: 'close', id: 3 });
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['goto', 'https://www.google.com/search?q=best+pizza', null, 'commit'],
      ['history', 'back', null],
      ['history', 'forward', null],
      ['history', 'reload', null],
      ['goto', 'https://example.com/page', null, 'commit'],
    ]);
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('refuses an address it cannot open, and tells the viewer', async () => {
    const { remote, socket, connection } = connect();
    sendJson(connection, {
      t: 'go',
      a: 'goto',
      url: 'ftp://files.example/readme',
    });
    sendJson(connection, {
      t: 'tab',
      a: 'open',
      url: 'file:///etc/passwd',
    });
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([
      {
        t: 'error',
        message:
          'That address cannot be opened. Addresses start with http:// or https://.',
        notice: 'address_refused',
      },
      {
        t: 'error',
        message:
          'That address cannot be opened. Addresses start with http:// or https://.',
        notice: 'address_refused',
      },
    ]);
    expect(remote.events).toEqual([]);
    expect(remote.tabs()).toHaveLength(1);
  });

  it('tells the viewer when the browser cannot do what was asked and goes on', async () => {
    const { remote, socket, connection } = connect();
    sendJson(connection, { t: 'tab', a: 'activate', id: 99 });
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([
      { t: 'error', message: 'There is no such tab.', notice: 'tab_gone' },
    ]);

    sendJson(connection, { t: 'text', text: 'still here' });
    await settle(LOOPS);
    expect(remote.events).toEqual([['text', 'still here']]);
    expect(socket.closes).toEqual([]);
  });

  it('gives the viewer the notice a failure of the browser carries, so that the page can word it', async () => {
    const { remote, socket, connection } = connect();
    vi.spyOn(remote, 'key').mockRejectedValueOnce(
      new RemoteError('Could not press F13: Unknown key', 'key_failed'),
    );
    vi.spyOn(remote, 'openTab').mockRejectedValueOnce(
      new RemoteError('Could not open a tab: crashed', 'tab_not_opened'),
    );
    sendJson(connection, { t: 'key', a: 'down', k: 'F13' });
    sendJson(connection, { t: 'tab', a: 'open' });
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([
      {
        t: 'error',
        message: 'Could not press F13: Unknown key',
        notice: 'key_failed',
      },
      {
        t: 'error',
        message: 'Could not open a tab: crashed',
        notice: 'tab_not_opened',
      },
    ]);
  });

  it('calls a failure that has no notice of its own an action that failed, and never a refusal', async () => {
    const { remote, socket, connection } = connect();
    vi.spyOn(remote, 'insertText').mockRejectedValueOnce(
      new RemoteError('Something the browser said'),
    );
    sendJson(connection, { t: 'text', text: 'abc' });
    await settle(LOOPS);
    const [error, ...more] = socket.messagesOf('error');
    expect(more).toEqual([]);
    expect(error).toEqual({
      t: 'error',
      message: 'Something the browser said',
      notice: 'action_failed',
    });
    // A refusal carries a code and stops the page from trying again.
    expect(error).not.toHaveProperty('code');
    expect(socket.closes).toEqual([]);
  });

  it('answers a list and a dialog at once', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'pick', token: 7, index: 0 });
    sendJson(connection, { t: 'pick', token: 8, index: null });
    sendJson(connection, { t: 'answer', id: 3, accept: true, text: 'Bo' });
    sendJson(connection, { t: 'answer', id: 4, accept: false });
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['pick', 7, 0],
      ['pick', 8, null],
      ['answer', 3, true, 'Bo'],
      ['answer', 4, false, null],
    ]);
  });

  it('does not hold an answer up behind the click that waits for it', async () => {
    // A click that makes a page call confirm() does not return before the
    // dialog is answered.
    const { remote, connection } = connect();
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

    sendJson(connection, { t: 'mouse', a: 'down', x: 1, y: 1 });
    sendJson(connection, { t: 'mouse', a: 'up', x: 1, y: 1 });
    await settle(LOOPS);
    expect(remote.events).toHaveLength(2); // the click is under way, and stuck
    sendJson(connection, { t: 'mouse', a: 'move', x: 5, y: 5 }); // waits behind the click
    sendJson(connection, { t: 'mouse', a: 'move', x: 6, y: 6 }); // ...and replaces the move before it
    sendJson(connection, { t: 'answer', id: 1, accept: true, text: null });
    await settle(LOOPS);

    expect(remote.events).toEqual([
      ['mouse', 'down', 1, 1, 'left', 1],
      ['mouse', 'up', 1, 1, 'left', 1],
      ['answer', 1, true, null],
      ['mouse', 'move', 6, 6, 'left', 1],
    ]);
  });

  it('adds up the scrolls that wait behind a slow call, so none is lost', async () => {
    const { remote, connection } = connect();
    const released = new Gate();
    const mouse = remote.mouse.bind(remote);
    vi.spyOn(remote, 'mouse').mockImplementation(async (...args) => {
      await released.wait();
      await mouse(...args);
    });
    sendJson(connection, { t: 'mouse', a: 'move', x: 1, y: 1 }); // holds up what comes behind it
    await settle(LOOPS);
    for (let tick = 0; tick < 40; tick++) {
      sendJson(connection, { t: 'wheel', x: 5, y: 6, dx: 0, dy: 100 });
    }
    await settle(LOOPS);
    expect(remote.events).toEqual([]); // all of it has arrived and waits

    released.open();
    await settle(LOOPS);
    const scrolls = remote.events.filter((event) => event[0] === 'wheel');
    expect(scrolls).toEqual([['wheel', 5, 6, 0, 4000]]);
  });

  it('does not let a slow navigation hold up the input behind it', async () => {
    const { remote, socket, connection } = connect();
    const arrived = new Gate();
    const goto = vi.spyOn(remote, 'goto').mockImplementation(async () => {
      await arrived.wait();
    });
    sendJson(connection, { t: 'go', a: 'goto', url: 'https://slow.example' });
    sendJson(connection, { t: 'key', a: 'down', k: 'a' });
    await settle(LOOPS);
    expect(goto).toHaveBeenCalledWith('https://slow.example');
    expect(remote.events).toEqual([['key', 'down', 'a']]);

    arrived.open();
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([]);
  });

  it('leaves it to the page to show that a navigation failed', async () => {
    const { remote, socket, connection } = connect();
    vi.spyOn(remote, 'goto').mockRejectedValue(
      new RemoteError('net::ERR_NAME_NOT_RESOLVED'),
    );
    vi.spyOn(remote, 'history').mockRejectedValue(
      new RemoteError('The page is gone.'),
    );
    sendJson(connection, {
      t: 'go',
      a: 'goto',
      url: 'https://nowhere.example',
    });
    sendJson(connection, { t: 'go', a: 'back' });
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([]);
    expect(socket.closes).toEqual([]);
  });

  it('inserts no more than MAX_TEXT characters of a paste, and no half of one', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'text', text: 'a'.repeat(MAX_TEXT + 50) });
    sendJson(connection, {
      t: 'text',
      text: `${'b'.repeat(MAX_TEXT - 1)}😀 and the rest`,
    });
    sendJson(connection, { t: 'text', text: 'c'.repeat(MAX_TEXT) });
    await settle(LOOPS);
    const typed = remote.events.flatMap((event) =>
      event[0] === 'text' ? [event[1]] : [],
    );
    expect(typed).toHaveLength(3);
    expect(typed[0]).toBe('a'.repeat(MAX_TEXT));
    expect(typed[1]).toBe('b'.repeat(MAX_TEXT - 1)); // the emoji would have been cut in two
    expect(typed[1]?.isWellFormed()).toBe(true); // no lone surrogate
    expect(typed[2]).toBe('c'.repeat(MAX_TEXT));
  });
});

describe('what is not a message', () => {
  const JUNK: string[] = [
    'not json',
    '',
    '[]',
    '5',
    'null',
    '"mouse"',
    '{"x": 1}',
    '{"t": "nonsense"}',
    '{"t": "mouse"}',
    '{"t": "mouse", "a": "explode", "x": 1, "y": 1}',
    '{"t": "mouse", "a": "move", "x": "NaN", "y": 1}',
    '{"t": "mouse", "a": "move", "x": "oops", "y": 1}',
    '{"t": "mouse", "a": "move", "x": 1e999, "y": 1}',
    '{"t": "mouse", "a": "move", "x": 1, "y": 1, "b": "thumb"}',
    '{"t": "mouse", "a": "move", "x": 1, "y": 1, "n": 1.5}',
    '{"t": "wheel", "x": 1, "y": 1, "dx": "a", "dy": 5}',
    '{"t": "key", "a": "tap", "k": "a"}',
    `{"t": "key", "a": "down", "k": "${'k'.repeat(41)}"}`,
    '{"t": "text", "text": 5}',
    '{"t": "tab", "a": "fly"}',
    '{"t": "tab", "a": "close"}',
    '{"t": "tab", "a": "activate", "id": "two"}',
    '{"t": "tab", "a": "open", "url": "   "}',
    '{"t": "go", "a": "goto"}',
    '{"t": "go", "a": "goto", "url": ""}',
    '{"t": "go", "a": "goto", "url": "  "}',
    '{"t": "go", "a": "sideways"}',
    '{"t": "pick", "token": "x"}',
    '{"t": "answer", "id": 1}',
  ];

  it('is ignored, and the connection stays usable', async () => {
    const { remote, socket, connection } = connect();
    for (const junk of JUNK) connection.receive(junk);
    connection.receive(new TextEncoder().encode('binary junk'));
    sendJson(connection, { t: 'key', a: 'down', k: 'x' });
    await settle(LOOPS);
    expect(remote.events).toEqual([['key', 'down', 'x']]); // still alive
    expect(remote.tabs()).toHaveLength(1);
    expect(socket.messagesOf('error')).toEqual([]);
    expect(socket.closes).toEqual([]);
  });

  it('is logged for whoever asks, and never with what it said', async () => {
    process.env.DEBUG = 'session-manager';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { connection } = connect();
    connection.receive('{"t": "text", "text": 5, "password": "hunter2"}');
    connection.receive('hunter2 is not json');
    await settle(LOOPS);
    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug.mock.calls.flat().join('\n')).not.toContain('hunter2');
    expect(debug.mock.calls[0]?.[0]).toContain('text: invalid_type');
  });

  it('is not logged unless asked', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { connection } = connect();
    connection.receive('not json');
    await settle(LOOPS);
    expect(debug).not.toHaveBeenCalled();
  });
});

describe('when the browser ends', () => {
  it('says so and ends the connection once what was queued is sent', async () => {
    const { remote, socket } = connect();
    await settle(LOOPS);
    remote.close();
    await settle(LOOPS);
    expect(socket.messages().at(-1)).toEqual({ t: 'closed' });
    expect(socket.messagesOf('closed')).toHaveLength(1);
    expect(socket.closes).toEqual([{ code: 1000, reason: undefined }]);
    expect(remote.watchers).toHaveLength(0);
    expect(remote.listeners).toHaveLength(0);
  });

  it('says so when only the event tells it', async () => {
    const { remote, socket } = connect();
    await settle(LOOPS);
    remote.emit({ type: 'closed' });
    await settle(LOOPS);
    expect(socket.messagesOf('closed')).toHaveLength(1);
    expect(socket.closes).toEqual([{ code: 1000, reason: undefined }]);
    expect(remote.watchers).toHaveLength(0);
  });

  it('says so when only the pictures stop', async () => {
    const { remote, socket } = connect();
    await settle(LOOPS);
    remote.watchers[0]?.browserClosed();
    await settle(LOOPS);
    expect(socket.messagesOf('closed')).toHaveLength(1);
    expect(socket.closes).toEqual([{ code: 1000, reason: undefined }]);
  });

  it('does not act on what the viewer sends afterwards', async () => {
    const { remote, socket, connection } = connect();
    remote.close();
    await settle(LOOPS);
    sendJson(connection, { t: 'text', text: 'too late' });
    await settle(LOOPS);
    expect(remote.events).toEqual([]);
    expect(socket.messagesOf('error')).toEqual([]);
  });
});

describe('when the viewer leaves', () => {
  it('lets go of the browser: no listener, no watcher', async () => {
    const { remote, socket, connection } = connect();
    await settle(LOOPS);
    expect(remote.listeners).toHaveLength(1);
    expect(remote.watchers).toHaveLength(1);

    connection.close();
    await settle(LOOPS);
    expect(remote.listeners).toHaveLength(0);
    expect(remote.watchers).toHaveLength(0);
    expect(socket.closes).toEqual([]); // the viewer closed it, not the server
  });

  it('sends nothing more, and can be closed twice', async () => {
    const { remote, socket, connection } = connect();
    await settle(LOOPS);
    const before = socket.sent.length;
    connection.close();
    connection.close();
    await remote.openTab('https://two.example');
    remote.showNewPicture();
    sendJson(connection, { t: 'key', a: 'down', k: 'a' });
    await settle(LOOPS);
    expect(socket.sent).toHaveLength(before);
    expect(remote.events).toEqual([]);
  });

  it('does not let a dialog event reach a viewer that is gone', async () => {
    const { remote, socket, connection } = connect();
    await settle(LOOPS);
    connection.close();
    remote.openDialog();
    await settle(LOOPS);
    expect(socket.messagesOf('dialog')).toEqual([]);
  });

  it('lets go of the keys the viewer held down, or they would stay down in the page', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'Shift' });
    sendJson(connection, { t: 'key', a: 'down', k: 'Control' });
    sendJson(connection, { t: 'key', a: 'down', k: 'a' });
    sendJson(connection, { t: 'key', a: 'up', k: 'a' });
    await settle(LOOPS);
    remote.events.length = 0;

    connection.close();
    await settle(LOOPS);
    expect(remote.events).toEqual([
      ['key', 'up', 'Shift'],
      ['key', 'up', 'Control'],
    ]);
  });

  it('lets go of a key once, however often its repeat sent it down', async () => {
    const { remote, connection } = connect();
    for (let repeat = 0; repeat < 4; repeat++) {
      sendJson(connection, { t: 'key', a: 'down', k: 'ArrowDown' });
    }
    await settle(LOOPS);
    remote.events.length = 0;

    connection.close();
    await settle(LOOPS);
    expect(remote.events).toEqual([['key', 'up', 'ArrowDown']]);
  });

  it('lets go of a mouse button where the pointer was last', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'mouse', a: 'down', x: 10, y: 20, b: 'left' });
    sendJson(connection, { t: 'mouse', a: 'move', x: 30, y: 40 });
    sendJson(connection, {
      t: 'mouse',
      a: 'down',
      x: 30,
      y: 40,
      b: 'right',
      n: 2,
    });
    sendJson(connection, { t: 'mouse', a: 'up', x: 30, y: 40, b: 'right' });
    await settle(LOOPS);
    remote.events.length = 0;

    connection.close();
    await settle(LOOPS);
    expect(remote.events).toEqual([['mouse', 'up', 30, 40, 'left', 1]]);
  });

  it('lets go of nothing when nothing is held, and does it once when it is closed twice', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'a' });
    sendJson(connection, { t: 'key', a: 'up', k: 'a' });
    sendJson(connection, { t: 'mouse', a: 'down', x: 1, y: 1 });
    sendJson(connection, { t: 'mouse', a: 'up', x: 1, y: 1 });
    await settle(LOOPS);
    const before = remote.events.length;

    connection.close();
    connection.close();
    await settle(LOOPS);
    expect(remote.events).toHaveLength(before);

    const held = connect();
    sendJson(held.connection, { t: 'key', a: 'down', k: 'Shift' });
    await settle(LOOPS);
    held.remote.events.length = 0;
    held.connection.close();
    held.connection.close();
    await settle(LOOPS);
    expect(held.remote.events).toEqual([['key', 'up', 'Shift']]);
  });

  it('lets go of what the connection held when the server ends it', async () => {
    const { remote, socket, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'Shift' });
    await settle(LOOPS);
    remote.events.length = 0;
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('the socket cannot be written to');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    remote.showNewPicture(); // the next write fails: the server ends the connection
    await settle(LOOPS);
    expect(socket.closes).toHaveLength(1);
    expect(remote.events).toEqual([['key', 'up', 'Shift']]);
  });

  it('does not let go of what another viewer of the same browser holds', async () => {
    const remote = new FakeRemote(fakeLaunchSpec());
    const first = new SessionSocket(new FakeSocket(), remote, 7);
    const second = new SessionSocket(new FakeSocket(), remote, 7);
    open.push(first, second);
    first.start();
    second.start();
    sendJson(first, { t: 'key', a: 'down', k: 'Shift' });
    sendJson(second, { t: 'key', a: 'down', k: 'Control' });
    await settle(LOOPS);
    remote.events.length = 0;

    second.close();
    await settle(LOOPS);
    expect(remote.events).toEqual([['key', 'up', 'Control']]);
  });

  it('does not touch a browser that is gone, and does not fail for it', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'Shift' });
    await settle(LOOPS);
    remote.events.length = 0;

    remote.close();
    await settle(LOOPS);
    connection.close();
    await settle(LOOPS);
    expect(remote.events).toEqual([]);
  });

  it('keeps going when letting go of a key fails', async () => {
    const { remote, connection } = connect();
    sendJson(connection, { t: 'key', a: 'down', k: 'Shift' });
    sendJson(connection, { t: 'key', a: 'down', k: 'Control' });
    await settle(LOOPS);
    remote.events.length = 0;
    vi.spyOn(remote, 'key').mockRejectedValueOnce(
      new RemoteError('Could not press Shift: gone', 'key_failed'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    connection.close();
    await settle(LOOPS);
    // The other key is let go of nevertheless, and nothing is logged as a failure of the live view.
    expect(remote.events).toEqual([['key', 'up', 'Control']]);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('a client that cannot keep up', () => {
  it('waits for the socket to drain and then sends only the newest picture', async () => {
    const socket = new FakeSocket();
    socket.statuses.push(-1); // the tabs fill the buffer
    const remote = new FakeRemote(fakeLaunchSpec());
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);
    expect(socket.messages().map((message) => message.t)).toEqual(['tabs']);

    remote.showNewPicture();
    remote.showNewPicture();
    await settle(LOOPS);
    expect(socket.sent).toHaveLength(1); // still waiting, the pictures pile up behind

    connection.drain();
    await settle(LOOPS);
    expect(socket.everything().slice(1)).toEqual([
      { t: 'view', tab: 1, w: 800, h: 600 },
      'jpeg-3',
    ]);
  });

  it('is released when the connection ends while it waits', async () => {
    const socket = new FakeSocket();
    socket.statuses.push(-1);
    const remote = new FakeRemote(fakeLaunchSpec());
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);
    connection.close();
    await settle(LOOPS);
    expect(remote.watchers).toHaveLength(0);
    expect(socket.sent).toHaveLength(1);
    // A late drain event is harmless.
    connection.drain();
  });

  it('ends the connection when the socket dropped a message', async () => {
    const socket = new FakeSocket();
    socket.statuses.push(0);
    const remote = new FakeRemote(fakeLaunchSpec());
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);
    expect(socket.closes).toEqual([{ code: 1000, reason: undefined }]);
    expect(remote.watchers).toHaveLength(0);
    expect(remote.listeners).toHaveLength(0);
  });
});

/** A page whose tab has this address and title; the viewer sees them in the tab bar. */
function showing(remote: FakeRemote, url: string, title: string): void {
  remote.emit({
    type: 'tabs',
    tabs: [{ id: 1, url, title, loading: false, active: true }],
  });
}

describe('a viewer that does not read', () => {
  /** A connection whose socket is full at the first message and never drains. */
  function stalled() {
    const socket = new FakeSocket();
    socket.statuses.push(-1);
    const remote = new FakeRemote(fakeLaunchSpec());
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    return { socket, remote, connection };
  }

  it('is told the newest tabs when it reads again, not every change it missed', async () => {
    const { socket, remote, connection } = stalled();
    await settle(LOOPS);
    expect(socket.messagesOf('tabs')).toHaveLength(1); // the socket is full now

    // A page that changes its address a thousand times with an address of 200 KB.
    for (let n = 1; n <= 1000; n += 1) {
      showing(
        remote,
        `https://page.example/#${n}${'x'.repeat(200_000)}`,
        `Page ${n}`,
      );
    }
    await settle(LOOPS);
    expect(socket.messagesOf('tabs')).toHaveLength(1); // nothing was sent: it waits

    connection.drain();
    await settle(LOOPS);
    const told = socket.messagesOf('tabs');
    expect(told).toHaveLength(2);
    expect(told[1]?.tabs[0]?.title).toBe('Page 1000');
    expect(
      told[1]?.tabs[0]?.url.startsWith('https://page.example/#1000x'),
    ).toBe(true);
    expect(socket.closes).toEqual([]);
  });

  it('is sent the address of a tab as far as an address bar can use, and the title likewise', async () => {
    const { socket, remote } = connect();
    await settle(LOOPS);
    showing(
      remote,
      `https://page.example/${'a'.repeat(100_000)}`,
      'T'.repeat(100_000),
    );
    await settle(LOOPS);
    const tab = socket.messagesOf('tabs').at(-1)?.tabs[0];
    expect(tab?.url).toBe(
      `https://page.example/${'a'.repeat(100_000)}`.slice(0, MAX_TAB_URL),
    );
    expect(tab?.url).toHaveLength(MAX_TAB_URL);
    expect(tab?.title).toBe(`${'T'.repeat(MAX_TAB_TITLE - 1)}…`);
  });

  it('keeps the address and the title of an ordinary page as they are', async () => {
    const { socket, remote } = connect();
    await settle(LOOPS);
    const url = `https://page.example/${'a'.repeat(MAX_TAB_URL - 21)}`;
    expect(url).toHaveLength(MAX_TAB_URL);
    showing(remote, url, 'Ü'.repeat(MAX_TAB_TITLE));
    await settle(LOOPS);
    const tab = socket.messagesOf('tabs').at(-1)?.tabs[0];
    expect(tab?.url).toBe(url);
    expect(tab?.title).toBe('Ü'.repeat(MAX_TAB_TITLE));
  });

  it('is not sent half an emoji where an address or a title is cut', async () => {
    const { socket, remote } = connect();
    await settle(LOOPS);
    showing(
      remote,
      `${'a'.repeat(MAX_TAB_URL - 1)}😀😀`,
      `${'b'.repeat(MAX_TAB_TITLE - 2)}😀😀`,
    );
    await settle(LOOPS);
    const tab = socket.messagesOf('tabs').at(-1)?.tabs[0];
    expect(tab?.url).toBe('a'.repeat(MAX_TAB_URL - 1));
    expect(tab?.title).toBe(`${'b'.repeat(MAX_TAB_TITLE - 2)}…`);
    expect(JSON.stringify(tab)).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])/,
    );
  });

  it('is sent away with 1013 when what it has not read grows past the allowance, and nothing more is queued', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { socket, remote, connection } = stalled();
    remote.selection = 'x'.repeat(1_000_000);
    await settle(LOOPS);
    // The viewer asks for the selection again and again, and reads none of it.
    const copies = Math.ceil(MAX_QUEUED_BYTES / 1_000_000) + 3;
    for (let n = 0; n < copies; n += 1) {
      sendJson(connection, { t: 'copy' });
      await settle(LOOPS);
    }
    expect(socket.closes).toEqual([
      { code: 1013, reason: 'The viewer reads too slowly.' },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    // The queue was let go of: when the socket drains, nothing is left to send.
    const sentBefore = socket.sent.length;
    connection.drain();
    await settle(LOOPS);
    expect(socket.sent).toHaveLength(sentBefore);
    expect(socket.closes).toHaveLength(1);
    // And the browser is let go of too.
    expect(remote.watchers).toHaveLength(0);
    expect(remote.listeners).toHaveLength(0);
  });

  it('does not lose a large selection that a viewer who reads asks for', async () => {
    const { socket, remote, connection } = connect();
    remote.selection = 'y'.repeat(MAX_QUEUED_BYTES + 1000);
    await settle(LOOPS);
    sendJson(connection, { t: 'copy' });
    await settle(LOOPS);
    expect(socket.messagesOf('selection')[0]?.text).toHaveLength(
      MAX_QUEUED_BYTES + 1000,
    );
    expect(socket.closes).toEqual([]);
  });
});

describe('when something fails that should not', () => {
  it('ends the connection, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { remote, socket, connection } = connect();
    vi.spyOn(remote, 'insertText').mockRejectedValue(new TypeError('bug'));
    sendJson(connection, { t: 'text', text: 'x' });
    await settle(LOOPS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('session 7');
    expect(socket.closes).toEqual([
      { code: 1011, reason: 'The live view failed.' },
    ]);
    expect(remote.watchers).toHaveLength(0);
    expect(remote.listeners).toHaveLength(0);
  });

  it('ends the connection when a navigation fails for no reason the page can show', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { remote, socket, connection } = connect();
    vi.spyOn(remote, 'history').mockRejectedValue(new TypeError('bug'));
    sendJson(connection, { t: 'go', a: 'reload' });
    await settle(LOOPS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(socket.closes.map((close) => close.code)).toEqual([1011]);
  });

  it('ends the connection when the socket cannot be written to', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const socket = new FakeSocket();
    vi.spyOn(socket, 'send').mockImplementation(() => {
      throw new Error('the socket is closed');
    });
    const remote = new FakeRemote(fakeLaunchSpec());
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(socket.closes.map((close) => close.code)).toEqual([1011]);
    expect(remote.watchers).toHaveLength(0);
    expect(remote.listeners).toHaveLength(0);
  });

  it('ends the connection when the pictures fail for no reason a browser has', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { remote, socket } = connect();
    await settle(LOOPS);
    const watcher = remote.watchers[0];
    expect(watcher).toBeDefined();
    // The next picture cannot be taken: not a RemoteError.
    vi.spyOn(watcher, 'get').mockRejectedValue(new TypeError('bug'));
    remote.showNewPicture();
    // The pump asks for the next picture only after the one that is on its way.
    await settle(LOOPS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(socket.closes.map((close) => close.code)).toEqual([1011]);
  });

  it('ends the connection when it cannot start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const remote = new FakeRemote(fakeLaunchSpec());
    vi.spyOn(remote, 'watch').mockImplementation(() => {
      throw new TypeError('bug');
    });
    const socket = new FakeSocket();
    const connection = new SessionSocket(socket, remote, 7);
    open.push(connection);
    connection.start();
    await settle(LOOPS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(socket.closes.map((close) => close.code)).toEqual([1011]);
    expect(remote.listeners).toHaveLength(0);
  });

  it('only logs a failure that comes after the viewer left', async () => {
    process.env.DEBUG = 'session-manager';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { remote, socket, connection } = connect();
    const released = new Gate();
    vi.spyOn(remote, 'insertText').mockImplementation(async () => {
      await released.wait();
      throw new TypeError('bug');
    });
    sendJson(connection, { t: 'text', text: 'x' });
    await settle(LOOPS);
    connection.close();
    released.open();
    await settle(LOOPS);
    expect(error).not.toHaveBeenCalled();
    expect(debug.mock.calls.flat().join('\n')).toContain(
      'failed after the connection ended',
    );
    expect(socket.closes).toEqual([]);
  });

  it('says nothing to the viewer of a failed action once the browser is gone', async () => {
    const { remote, socket, connection } = connect();
    const released = new Gate();
    vi.spyOn(remote, 'insertText').mockImplementation(async () => {
      await released.wait();
      throw new RemoteError('The browser has closed.');
    });
    sendJson(connection, { t: 'text', text: 'x' });
    await settle(LOOPS);
    remote.close();
    released.open();
    await settle(LOOPS);
    expect(socket.messagesOf('error')).toEqual([]);
  });
});
