import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import { queryKeys } from '@/app/lib/api/keys';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi, list } from '@/tests/utils/fake-api';
import { FakeWebSocket } from '@/tests/utils/fake-websocket';
import {
  meta,
  runningSession,
  secret,
  secretSummary,
} from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/5');
});

import {
  jpegBytes,
  stubDrawing,
  stubRoom,
  type Drawing,
} from '@/tests/utils/live-view';

import { LiveStage } from './live-stage';

const tabs = [
  {
    id: 1,
    url: 'https://shop.example.com/cart',
    title: 'Your cart',
    loading: false,
    active: true,
  },
  {
    id: 2,
    url: 'https://mail.example.com/',
    title: 'Mail',
    loading: false,
    active: false,
  },
];

let drawing: Drawing;

beforeEach(() => {
  FakeWebSocket.install();
  drawing = stubDrawing();
  stubRoom(1000, 700);
});

afterEach(() => {
  drawing.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(
  session: Session = runningSession({ id: 5, name: 'Shop' }),
  onFocusLost: () => void = () => {},
) {
  const api = installFakeApi({
    'GET /meta': meta(),
    'GET /secrets': [
      secretSummary({ id: 1, title: 'Example login', preview: 'ada' }),
    ],
    'GET /secrets/:id': secret({
      id: 1,
      fields: [{ label: 'Username', value: 'ada', hidden: false }],
    }),
  });
  const view = renderApp(
    <ProxyFlowProvider>
      <main>
        <LiveStage session={session} onFocusLost={onFocusLost} />
        <ToastList />
      </main>
    </ProxyFlowProvider>,
  );
  const socket = FakeWebSocket.last;
  return { ...view, api, socket };
}

/** The server accepts the connection, sends the tabs and the first picture. */
function serve(socket: FakeWebSocket) {
  act(() => {
    socket.emitOpen();
    socket.emitMessage({ t: 'tabs', tabs });
    socket.emitMessage({ t: 'view', tab: 1, w: 1280, h: 800 });
    socket.emitMessage(jpegBytes(1));
  });
}

const address = () =>
  screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' });
const keyboardField = () =>
  screen.getByRole('textbox', { name: 'Keyboard input for the page' });
/** What the page says of the connection: the loading overlay, and the hint of the keyboard. */
const said = () =>
  screen
    .getAllByRole('status')
    .map((status) => status.textContent)
    .join(' ');

describe('LiveStage connecting', () => {
  it('connects to the live view of its session, and says so while it waits for the first picture', () => {
    const { socket } = setup();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.url).toMatch(/\/api\/sessions\/5\/stream$/);
    expect(said()).toContain('Connecting to the browser…');
    // Nothing to use yet.
    expect(screen.getByRole('textbox', { name: 'Address' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New tab' })).toBeDisabled();
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('shows the tabs, the address of the active one and the picture once they came', async () => {
    const { socket } = setup();
    serve(socket);
    await screen.findByRole('application');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Your cart',
      'Mail',
    ]);
    expect(address()).toHaveValue('https://shop.example.com/cart');
    expect(address()).toBeEnabled();
    expect(said()).toBe('');
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));
  });

  it('closes the connection when it goes', () => {
    const { socket, unmount } = setup();
    serve(socket);
    unmount();
    expect(socket.closeCalls).toHaveLength(1);
  });

  it('does not connect twice for one session', () => {
    setup();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('LiveStage losing the connection', () => {
  it('says that the connection is lost and connects again, with the last picture and the tabs still there', async () => {
    const { socket } = setup();
    serve(socket);
    await screen.findByRole('application');
    // Time is the page's from here: it waits to connect again.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => socket.emitClose());
    expect(said()).toContain("Can't reach the browser. Reconnecting…");
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('application')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(address()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Still the same sentence while the new connection is made: it has not
    // worked yet, and the overlay is a live region.
    expect(said()).toContain("Can't reach the browser. Reconnecting…");
    expect(said()).not.toContain('Connecting to the browser…');
    serve(FakeWebSocket.last);
    expect(said()).toBe('');
    expect(address()).toBeEnabled();
  });

  // The overlay is a polite live region: a text that flips between "connecting"
  // and "can't reach it" at every attempt is read out twice for each of them,
  // for as long as the server is down.
  it('says the same thing at every attempt while the browser cannot be reached, so that it is announced once', async () => {
    const { socket } = setup();
    serve(socket);
    await screen.findByRole('application');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const heard: string[] = [];
    const listen = () => {
      const now = said();
      if (heard.at(-1) !== now) heard.push(now);
    };
    act(() => socket.emitClose());
    listen();

    // Each attempt is made and closed again at once, as by a server that is down.
    for (const wait of [1000, 2000, 4000, 8000, 10_000, 10_000]) {
      act(() => {
        vi.advanceTimersByTime(wait);
      });
      listen();
      act(() => FakeWebSocket.last.emitClose());
      listen();
    }

    expect(FakeWebSocket.instances).toHaveLength(7);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toContain("Can't reach the browser. Reconnecting…");
  });

  it('starts with the plain connecting message on the first connection, and says it cannot be reached once that failed', () => {
    const { socket } = setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(said()).toContain('Connecting to the browser…');

    act(() => socket.emitClose());
    expect(said()).toContain("Can't reach the browser. Reconnecting…");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(said()).toContain("Can't reach the browser. Reconnecting…");
  });

  it('puts the tabs out of use while the connection is not live: they take no click and no arrow key', async () => {
    const { socket, user } = setup();
    serve(socket);
    await screen.findByRole('application');
    act(() => socket.emitClose());
    socket.sent.length = 0;
    await user.click(screen.getByRole('tab', { name: 'Mail' }));
    screen.getByRole('tab', { name: 'Your cart' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(socket.messages).toEqual([]);
    expect(screen.getByRole('tab', { name: 'Mail' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('lets a person who does not want to wait connect at once, once the connection failed twice', async () => {
    const { socket, user } = setup();
    serve(socket);
    await screen.findByRole('application');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => socket.emitClose());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => FakeWebSocket.last.emitClose());
    const retry = screen.getByRole('button', { name: 'Try again' });
    vi.useRealTimers();
    await user.click(retry);
    // A new connection was made without the wait.
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(said()).toContain('Connecting to the browser…');
  });

  it('says why the connection was refused, and tries again when asked', async () => {
    const { user, socket } = setup();
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'not running',
      });
      socket.emitClose(1000);
    });
    expect(
      screen.getByRole('heading', { name: "Can't show the browser" }),
    ).toBeVisible();
    expect(
      screen.getByText("This session isn't running. Start it first."),
    ).toBeVisible();
    // The picture and the connecting message are gone: there is nothing to wait for.
    expect(said()).toBe('');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(said()).toContain('Connecting to the browser…');
  });

  it('asks the session again when the connection was refused, so that the page stops contradicting itself', () => {
    const { socket, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'not running',
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sessions });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.meta });
  });

  it('has the generic line, not the sentence of the server, when the app has no words for the code', () => {
    const { socket } = setup();
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        t: 'error',
        code: 'brand_new_code',
        message: 'The browser is busy dying.',
      });
    });
    expect(screen.getByText('Something went wrong. Try again.')).toBeVisible();
    expect(screen.queryByText('The browser is busy dying.')).toBeNull();
  });

  it('shows a card, and asks the session again, when the browser closed', async () => {
    const { socket, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    serve(socket);
    await screen.findByRole('application');
    act(() => {
      socket.emitMessage({ t: 'closed' });
      socket.emitClose(1000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'The browser has closed',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sessions });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('says where the keyboard goes when the browser closes while the page has it', async () => {
    const onFocusLost = vi.fn();
    const { socket } = setup(
      runningSession({ id: 5, name: 'Shop' }),
      onFocusLost,
    );
    serve(socket);
    await screen.findByRole('application');
    act(() => keyboardField().focus());

    act(() => {
      socket.emitMessage({ t: 'closed' });
      socket.emitClose(1000);
    });

    await waitFor(() => expect(onFocusLost).toHaveBeenCalledTimes(1));
  });

  it('keeps quiet about the keyboard when the browser closes and the page did not have it', async () => {
    const onFocusLost = vi.fn();
    const { socket } = setup(
      runningSession({ id: 5, name: 'Shop' }),
      onFocusLost,
    );
    serve(socket);
    await screen.findByRole('application');

    act(() => {
      socket.emitMessage({ t: 'closed' });
      socket.emitClose(1000);
    });

    await screen.findByText('The browser has closed');
    expect(onFocusLost).not.toHaveBeenCalled();
  });

  it('connects again when the session was started anew, also after its browser closed', async () => {
    const first = runningSession({
      id: 5,
      lastStartedAt: '2026-11-01T10:00:00+00:00',
    });
    const { socket, rerender } = setup(first);
    serve(socket);
    act(() => {
      socket.emitMessage({ t: 'closed' });
      socket.emitClose(1000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'The browser has closed',
    );
    // The page keys the stage by the start of the browser (see SessionPage).
    rerender(
      <main>
        <LiveStage
          key="restarted"
          session={{ ...first, lastStartedAt: '2026-11-01T10:05:00+00:00' }}
          onFocusLost={() => {}}
        />
        <ToastList />
      </main>,
    );
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(said()).toContain('Connecting to the browser…');
  });
});

describe('LiveStage tabs and address bar', () => {
  async function live() {
    const harness = setup();
    serve(harness.socket);
    await screen.findByRole('application');
    harness.socket.sent.length = 0;
    return harness;
  }

  it('activates a tab that is clicked, and gives the keyboard to the page', async () => {
    const { user, socket } = await live();
    await user.click(screen.getByRole('tab', { name: 'Mail' }));
    expect(socket.messages).toEqual([{ t: 'tab', a: 'activate', id: 2 }]);
    expect(keyboardField()).toHaveFocus();
  });

  it('moves between tabs with the arrow keys, keeping the keyboard on the tabs', async () => {
    const { user, socket } = await live();
    screen.getByRole('tab', { name: 'Your cart' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(socket.messages).toEqual([{ t: 'tab', a: 'activate', id: 2 }]);
    expect(screen.getByRole('tab', { name: 'Mail' })).toHaveFocus();
  });

  it('closes a tab', async () => {
    const { user, socket } = await live();
    await user.click(screen.getByRole('button', { name: 'Close tab "Mail"' }));
    expect(socket.messages).toEqual([{ t: 'tab', a: 'close', id: 2 }]);
  });

  it('says that closing the last tab stops the session', async () => {
    const { socket } = await live();
    act(() => socket.emitMessage({ t: 'tabs', tabs: [tabs[0]] }));
    expect(
      await screen.findByRole('button', {
        name: 'Close tab "Your cart" and stop the session',
      }),
    ).toBeVisible();
  });

  it('opens a new tab and takes the keyboard to the address bar, to type in', async () => {
    const { user, socket } = await live();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(socket.messages).toEqual([{ t: 'tab', a: 'open' }]);
    expect(address()).toHaveFocus();
  });

  it('sends what is entered in the address bar, and gives the keyboard to the page', async () => {
    const { user, socket } = await live();
    await user.click(address());
    await user.keyboard('cute cats{Enter}');
    expect(socket.messages).toEqual([{ t: 'go', a: 'goto', url: 'cute cats' }]);
    expect(keyboardField()).toHaveFocus();
    // What was typed stays until the page arrives.
    expect(address()).toHaveValue('cute cats');
    act(() => {
      socket.emitMessage({
        t: 'tabs',
        tabs: [
          { ...tabs[0], url: 'https://search.example.com/?q=cute+cats' },
          tabs[1],
        ],
      });
    });
    expect(address()).toHaveValue('https://search.example.com/?q=cute+cats');
  });

  it('goes back, forward and reloads', async () => {
    const { user, socket } = await live();
    await user.click(
      screen.getByRole('button', { name: 'Go to previous page' }),
    );
    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    await user.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(socket.messages).toEqual([
      { t: 'go', a: 'back' },
      { t: 'go', a: 'forward' },
      { t: 'go', a: 'reload' },
    ]);
  });

  it('gives the page the keyboard back when the address bar is left with Escape', async () => {
    const { user, socket } = await live();
    await user.click(address());
    await user.keyboard('abc{Escape}');
    expect(socket.messages).toEqual([]);
    expect(keyboardField()).toHaveFocus();
  });

  it('goes to the address bar from the page with Ctrl+L', async () => {
    const { socket } = await live();
    keyboardField().focus();
    fireEvent.keyDown(keyboardField(), {
      key: 'l',
      code: 'KeyL',
      ctrlKey: true,
    });
    expect(address()).toHaveFocus();
    expect(socket.messages).toEqual([]);
  });
});

describe('LiveStage page and keyboard', () => {
  async function live() {
    const harness = setup();
    serve(harness.socket);
    await screen.findByRole('application');
    harness.socket.sent.length = 0;
    return harness;
  }

  it('sends the keys typed in the page to its browser', async () => {
    const { user, socket } = await live();
    await user.tab();
    await user.tab({ shift: true });
    keyboardField().focus();
    await user.keyboard('hi');
    expect(socket.messages.filter((message) => message.a === 'down')).toEqual([
      { t: 'key', a: 'down', k: 'h' },
      { t: 'key', a: 'down', k: 'i' },
    ]);
  });

  it('puts what the page selected on the clipboard of this computer', async () => {
    const { socket } = await live();
    act(() => {
      socket.emitMessage({ t: 'selection', text: 'copied text', cut: false });
    });
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe('copied text'),
    );
  });

  it('asks for the selection on Ctrl+C', async () => {
    const { socket } = await live();
    fireEvent.keyDown(keyboardField(), {
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
    });
    expect(socket.messages).toEqual([{ t: 'copy', cut: false }]);
  });

  it('tells an address that cannot be opened in the words of the app, and keeps the connection', async () => {
    const { socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'error',
        message:
          'That address cannot be opened. Addresses start with http:// or https://.',
        notice: 'address_refused',
      });
    });
    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          title: "Couldn't do that in the browser",
          description:
            "That address can't be opened. Use one that starts with http:// or https://.",
        },
      ]),
    );
    // One failure, one toast, and the page goes on.
    expect(said()).toBe('');
    expect(address()).toBeEnabled();
  });

  it('tells a closed tab as it is', async () => {
    const { socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'error',
        message: 'There is no such tab.',
        notice: 'tab_gone',
      });
    });
    await waitFor(() =>
      expect(shownToasts()).toEqual([
        {
          title: "Couldn't do that in the browser",
          description: 'That tab is already closed.',
        },
      ]),
    );
  });

  it('quotes what the browser said, where it is the only word on what went wrong', async () => {
    const { socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'error',
        message: 'Something the browser said',
      });
    });
    await waitFor(() =>
      expect(shownToasts().map((toast) => toast.description)).toEqual([
        'The browser said: "Something the browser said".',
      ]),
    );
    act(() => {
      socket.emitMessage({
        t: 'error',
        message: 'Could not press F13: Unknown key',
        notice: 'key_failed',
      });
    });
    await waitFor(() =>
      expect(shownToasts().map((toast) => toast.description)).toEqual([
        'Couldn\'t send that key to the page: "Could not press F13: Unknown key".',
      ]),
    );
  });

  it('words a notice in the language of the person, with the quotes of the language', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    try {
      const { socket } = await live();
      act(() => {
        socket.emitMessage({
          t: 'error',
          message: 'Something the browser said',
          notice: 'action_failed',
        });
      });
      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: 'Aktion im Browser nicht möglich',
        description: 'Der Browser meldet: „Something the browser said“.',
      });
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('shows a dialog of the page, and answers it', async () => {
    const { user, socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'dialog',
        id: 8,
        tab: 1,
        kind: 'prompt',
        message: 'Your name?',
        default: 'Ada',
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'The page says' });
    // What the page asks is what the dialog is described by; who asks is the host of the tab.
    expect(dialog).toHaveAccessibleDescription('Your name?');
    expect(within(dialog).getByText('shop.example.com')).toBeVisible();
    await user.clear(
      within(dialog).getByRole('textbox', { name: 'Your name?' }),
    );
    await user.keyboard('Grace{Enter}');
    expect(socket.messagesOf('answer')).toEqual([
      { t: 'answer', id: 8, accept: true, text: 'Grace' },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(keyboardField()).toHaveFocus());
  });

  it('takes a dialog away when the page closed it itself', async () => {
    const { socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'dialog',
        id: 9,
        tab: 1,
        kind: 'alert',
        message: 'Hello',
        default: '',
      });
    });
    await screen.findByRole('dialog');
    act(() => socket.emitMessage({ t: 'dialog_closed', id: 9 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(socket.messagesOf('answer')).toEqual([]);
  });

  it('shows the list of a select, and sends the option chosen', async () => {
    const { user, socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'select',
        token: 3,
        x: 200,
        y: 200,
        width: 150,
        height: 30,
        options: [
          { label: 'Red', selected: true, disabled: false, group: null },
          { label: 'Green', selected: false, disabled: false, group: null },
        ],
      });
    });
    await user.click(await screen.findByRole('option', { name: 'Green' }));
    expect(socket.messagesOf('pick')).toEqual([
      { t: 'pick', token: 3, index: 1 },
    ]);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(keyboardField()).toHaveFocus();
  });

  it('dismisses the list of a select with Escape, telling the page that nothing was chosen', async () => {
    const { user, socket } = await live();
    act(() => {
      socket.emitMessage({
        t: 'select',
        token: 4,
        x: 200,
        y: 200,
        width: 150,
        height: 30,
        options: [
          { label: 'Red', selected: true, disabled: false, group: null },
        ],
      });
    });
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(socket.messagesOf('pick')).toEqual([
      { t: 'pick', token: 4, index: null },
    ]);
  });

  it('types a secret into the page as text, and nothing else carries it', async () => {
    const { user, socket } = await live();
    await user.click(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    );
    await user.click(
      await screen.findByRole('button', { name: /Example login/ }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: 'Type Username into the page',
      }),
    );
    expect(socket.messages).toEqual([{ t: 'text', text: 'ada' }]);
    await waitFor(() => expect(keyboardField()).toHaveFocus());
  });

  it('keeps the browser running while a secret is added for the session, in a form over the page', async () => {
    const { user, socket, api } = await live();
    api.on('GET /sessions', list([]));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Add secret for "Shop"' }),
    );
    const form = await screen.findByRole('dialog', { name: 'Add secret' });

    // Nobody went anywhere: the socket is the same one, open, and still draws.
    act(() => socket.emitMessage(jpegBytes(2)));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(2));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(socket.closeCalls).toHaveLength(0);

    // Nothing the person types into the form reaches the page in the session.
    await user.type(
      within(form).getByRole('textbox', { name: 'Title' }),
      'abc',
    );
    expect(socket.messages).toEqual([]);

    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add secret' })).toBeNull(),
    );
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toBeEnabled();
    expect(address()).toBeEnabled();
    expect(socket.closeCalls).toHaveLength(0);
  });
});

describe('LiveStage place', () => {
  it('warns when the proxy exits through another IP, under the toolbar', async () => {
    setup(
      runningSession({
        id: 5,
        location: { ...runningSession().location!, inSync: false },
        proxy: {
          id: 1,
          display: 'http://198.51.100.4:8080',
          exitIp: '203.0.113.99',
          country: 'FR',
          checkStatus: 'ok',
        },
      }),
    );
    const bar = screen.getByRole('alert');
    expect(bar).toHaveTextContent('203.0.113.99');
    // What the bar says and how it words its button is the session header's business, not the stage's.
    expect(within(bar).getByRole('button')).toBeVisible();
  });

  it('has no warning while the place matches', () => {
    setup();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LiveStage accessibility', () => {
  it('has no violations while it connects', async () => {
    const view = setup();
    await checkAccessibility(view);
  });

  it('has no violations with the browser shown', async () => {
    const view = setup();
    serve(view.socket);
    await screen.findByRole('application');
    await checkAccessibility(view);
  });

  it('has no violations when the connection is lost', async () => {
    const view = setup();
    serve(view.socket);
    await screen.findByRole('application');
    act(() => view.socket.emitClose());
    await checkAccessibility(view);
  });

  it('has no violations when the connection has failed again and again', async () => {
    const view = setup();
    serve(view.socket);
    await screen.findByRole('application');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => view.socket.emitClose());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => FakeWebSocket.last.emitClose());
    vi.useRealTimers();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    await checkAccessibility(view);
  });

  it('has no violations when the connection was refused', async () => {
    const view = setup();
    act(() => {
      view.socket.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'x',
      });
    });
    await checkAccessibility(view);
  });

  it('has no violations with the out-of-sync warning', async () => {
    const view = setup(
      runningSession({
        id: 5,
        location: { ...runningSession().location!, inSync: false },
      }),
    );
    serve(view.socket);
    await screen.findByRole('application');
    await checkAccessibility(view);
  });
});
