import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeWebSocket } from '@/tests/utils/fake-websocket';

import {
  useLiveView,
  type LiveView,
  type LiveViewOptions,
} from './use-live-view';

const tab = {
  id: 1,
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  active: true,
};

/** Bytes that start like a JPEG: the hook never looks inside. */
const picture = (...bytes: number[]) => new Uint8Array([0xff, 0xd8, ...bytes]);

interface Props extends LiveViewOptions {
  id: number;
}

function setup(initial: Partial<Props> = {}) {
  const callbacks = {
    onClosed: vi.fn(),
    onRefused: vi.fn(),
    onNotice: vi.fn(),
  };
  const view = renderHook<LiveView, Props>(
    ({ id, ...options }) => useLiveView(id, options),
    { initialProps: { id: 7, enabled: true, ...callbacks, ...initial } },
  );
  return { ...view, ...callbacks };
}

/** Plays a server that accepts the connection and sends the first picture. */
function serve(socket = FakeWebSocket.last) {
  act(() => {
    socket.emitOpen();
    socket.emitMessage({ t: 'tabs', tabs: [tab] });
    socket.emitMessage({ t: 'view', tab: 1, w: 1920, h: 1080 });
    socket.emitMessage(picture(1));
  });
  return socket;
}

/** Lets time pass for the timers of the hook. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  FakeWebSocket.install();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useLiveView connecting', () => {
  it('stays idle and opens nothing while disabled', () => {
    const { result } = setup({ enabled: false });
    expect(result.current.state).toBe('idle');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('opens the stream of the session on the host of the page, for pictures as array buffers', () => {
    const { result } = setup();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.url).toBe(
      `ws://${window.location.host}/api/sessions/7/stream`,
    );
    expect(FakeWebSocket.last.binaryType).toBe('arraybuffer');
    expect(result.current.state).toBe('connecting');
  });

  it('is live with the first picture, not when the connection opens', () => {
    const { result } = setup();
    act(() => FakeWebSocket.last.emitOpen());
    expect(result.current.state).toBe('connecting');
    act(() => FakeWebSocket.last.emitMessage({ t: 'tabs', tabs: [tab] }));
    expect(result.current.state).toBe('connecting');
    act(() => FakeWebSocket.last.emitMessage(picture(1)));
    expect(result.current.state).toBe('live');
  });

  it('connects when the session starts running', () => {
    const { result, rerender } = setup({ enabled: false });
    rerender({ id: 7, enabled: true });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.state).toBe('connecting');
  });
});

describe('useLiveView messages', () => {
  it('shows the tabs and the size of the page as they came, the newest last', () => {
    const { result } = setup();
    serve();
    expect(result.current.tabs).toEqual([tab]);
    expect(result.current.view).toEqual({ tab: 1, w: 1920, h: 1080 });
    act(() => {
      FakeWebSocket.last.emitMessage({
        t: 'tabs',
        tabs: [{ ...tab, loading: true }],
      });
      FakeWebSocket.last.emitMessage({ t: 'view', tab: 1, w: 1280, h: 720 });
    });
    expect(result.current.tabs[0]?.loading).toBe(true);
    expect(result.current.view).toEqual({ tab: 1, w: 1280, h: 720 });
  });

  it('hands every picture to the listeners, in order, with the bytes as they came', () => {
    const { result } = setup();
    const first = vi.fn<(jpeg: ArrayBuffer) => void>();
    const second = vi.fn<(jpeg: ArrayBuffer) => void>();
    act(() => {
      result.current.onFrame(first);
      result.current.onFrame(second);
    });
    serve();
    act(() => FakeWebSocket.last.emitMessage(picture(2, 3)));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    const bytes = first.mock.calls.map(([data]) =>
      Array.from(new Uint8Array(data)),
    );
    expect(bytes).toEqual([
      [0xff, 0xd8, 1],
      [0xff, 0xd8, 2, 3],
    ]);
  });

  it('stops handing pictures to a listener that unsubscribed', () => {
    const { result } = setup();
    const listener = vi.fn();
    let stop = () => {};
    act(() => {
      stop = result.current.onFrame(listener);
    });
    serve();
    stop();
    act(() => FakeWebSocket.last.emitMessage(picture(9)));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands the picture that made it live to the listeners too', () => {
    const { result } = setup();
    const listener = vi.fn();
    act(() => {
      result.current.onFrame(listener);
    });
    act(() => {
      FakeWebSocket.last.emitOpen();
      FakeWebSocket.last.emitMessage({ t: 'view', tab: 1, w: 10, h: 10 });
      FakeWebSocket.last.emitMessage(picture());
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('live');
    expect(result.current.view).toMatchObject({ w: 10 });
  });

  it('drops a message that is not JSON, and goes on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();
    serve();
    act(() => FakeWebSocket.last.emitMessage('{not json'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('live');
    expect(result.current.tabs).toEqual([tab]);
    act(() => FakeWebSocket.last.emitMessage({ t: 'tabs', tabs: [] }));
    expect(result.current.tabs).toEqual([]);
  });

  it('drops a message the page does not know or that is malformed, without printing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup();
    serve();
    act(() => {
      FakeWebSocket.last.emitMessage({ t: 'teleport', secret: 'hunter2' });
      FakeWebSocket.last.emitMessage({ t: 'view', tab: 'one', w: 1, h: 1 });
      FakeWebSocket.last.emitMessage(null);
    });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
    expect(result.current.view).toEqual({ tab: 1, w: 1920, h: 1080 });
    expect(result.current.state).toBe('live');
  });

  it('takes what is neither text nor an array buffer for nothing', () => {
    const { result } = setup();
    serve();
    const listener = vi.fn();
    act(() => {
      result.current.onFrame(listener);
      // The page asked for array buffers; a Blob would be the server's mistake.
      FakeWebSocket.last.dispatchEvent(
        new MessageEvent('message', { data: new Blob([picture()]) }),
      );
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('hands the selection to whoever asked for a copy', () => {
    const { result } = setup();
    const listener = vi.fn();
    act(() => {
      result.current.onSelection(listener);
    });
    serve();
    act(() =>
      FakeWebSocket.last.emitMessage({
        t: 'selection',
        text: 'hello',
        cut: true,
      }),
    );
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      text: 'hello',
      cut: true,
    });
  });

  it('tells a failure with a notice to the page as that notice, and keeps the connection', () => {
    const { result, onNotice } = setup();
    serve();
    act(() =>
      FakeWebSocket.last.emitMessage({
        t: 'error',
        message: 'That address cannot be opened.',
        notice: 'address_refused',
      }),
    );
    expect(onNotice).toHaveBeenCalledExactlyOnceWith({
      code: 'address_refused',
      message: 'That address cannot be opened.',
    });
    expect(result.current.end).toBeNull();
    expect(result.current.state).toBe('live');
  });

  it('calls a failure with neither a code nor a notice an action that failed, and keeps the connection', () => {
    const { result, onNotice } = setup();
    serve();
    act(() =>
      FakeWebSocket.last.emitMessage({
        t: 'error',
        message: 'Something the browser said',
      }),
    );
    expect(onNotice).toHaveBeenCalledExactlyOnceWith({
      code: 'action_failed',
      message: 'Something the browser said',
    });
    expect(result.current.end).toBeNull();
    expect(result.current.state).toBe('live');
  });

  it('does not take a notice for a refusal: only a code stops the page from trying again', () => {
    vi.useFakeTimers();
    const { result } = setup();
    const socket = serve();
    act(() =>
      socket.emitMessage({
        t: 'error',
        message: 'There is no such tab.',
        notice: 'tab_gone',
      }),
    );
    act(() => socket.emitClose());
    advance(1000);
    expect(result.current.end).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('useLiveView sending', () => {
  it('cannot send before the connection is open', () => {
    const { result } = setup();
    let sent = true;
    act(() => {
      sent = result.current.send({ t: 'go', a: 'back' });
    });
    expect(sent).toBe(false);
    expect(FakeWebSocket.last.sent).toEqual([]);
  });

  it('sends a message as JSON text once the connection is open', () => {
    const { result } = setup();
    serve();
    let sent = false;
    act(() => {
      sent = result.current.send({ t: 'mouse', a: 'move', x: 1.5, y: 2 });
    });
    expect(sent).toBe(true);
    expect(FakeWebSocket.last.messages).toEqual([
      { t: 'mouse', a: 'move', x: 1.5, y: 2 },
    ]);
  });

  it('cannot send once the connection is lost', () => {
    const { result } = setup();
    const socket = serve();
    act(() => socket.emitClose());
    let sent = true;
    act(() => {
      sent = result.current.send({ t: 'go', a: 'reload' });
    });
    expect(sent).toBe(false);
  });
});

describe('useLiveView reconnecting', () => {
  it('connects again after a second, then waits twice as long, up to ten seconds', () => {
    vi.useFakeTimers();
    const { result } = setup();
    // Every try ends before a picture came: the wait grows.
    const waits = [1000, 2000, 4000, 8000, 10_000, 10_000];
    for (const wait of waits) {
      const count = FakeWebSocket.instances.length;
      act(() => FakeWebSocket.last.emitClose());
      expect(result.current.state).toBe('lost');
      advance(wait - 1);
      expect(FakeWebSocket.instances).toHaveLength(count);
      advance(1);
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
      expect(result.current.state).toBe('connecting');
    }
  });

  it('starts the waits over once a picture proved the connection works', () => {
    vi.useFakeTimers();
    setup();
    act(() => FakeWebSocket.last.emitClose());
    advance(1000);
    act(() => FakeWebSocket.last.emitClose());
    advance(2000);
    serve();
    const count = FakeWebSocket.instances.length;
    act(() => FakeWebSocket.last.emitClose());
    advance(1000);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
  });

  it('keeps the tabs and the size of the page while it connects again, and drops what hangs on the connection', () => {
    vi.useFakeTimers();
    const { result } = setup();
    const socket = serve();
    act(() => {
      socket.emitMessage({
        t: 'dialog',
        id: 1,
        tab: 1,
        kind: 'alert',
        message: 'x',
        default: '',
      });
      socket.emitMessage({
        t: 'select',
        token: 1,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        options: [],
      });
    });
    expect(result.current.dialogs).toHaveLength(1);
    act(() => socket.emitClose());
    expect(result.current).toMatchObject({
      state: 'lost',
      dialogs: [],
      selectMenu: null,
      view: { w: 1920 },
    });
    expect(result.current.tabs).toHaveLength(1);
  });

  it('does not connect again when the server answered with an error code', () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => {
      FakeWebSocket.last.emitOpen();
      FakeWebSocket.last.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'This session is not running.',
      });
      FakeWebSocket.last.emitClose(1000);
    });
    expect(result.current.end).toEqual({
      reason: 'refused',
      code: 'session_not_running',
      message: 'This session is not running.',
    });
    advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.state).toBe('lost');
  });

  it('tells the page that the server refused, once, so that it can ask what became of the session', () => {
    const { onRefused, onClosed, onNotice } = setup();
    act(() => {
      FakeWebSocket.last.emitOpen();
      FakeWebSocket.last.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'This session is not running.',
      });
      FakeWebSocket.last.emitClose(1000);
    });
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('counts the connections that failed in a row, and starts over with the first picture', () => {
    vi.useFakeTimers();
    const { result } = setup();
    expect(result.current.failures).toBe(0);
    act(() => FakeWebSocket.last.emitClose());
    expect(result.current.failures).toBe(1);
    advance(1000);
    act(() => FakeWebSocket.last.emitClose());
    expect(result.current.failures).toBe(2);
    advance(2000);
    serve(FakeWebSocket.last);
    expect(result.current.failures).toBe(0);
  });

  it('does not connect again when the browser closed, and says so', () => {
    vi.useFakeTimers();
    const { result, onClosed } = setup();
    const socket = serve();
    act(() => {
      socket.emitMessage({ t: 'closed' });
      socket.emitClose(1000);
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(result.current.end).toEqual({ reason: 'closed' });
    advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('connects at once when asked to retry, after the server refused', () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => {
      FakeWebSocket.last.emitMessage({
        t: 'error',
        code: 'session_not_running',
        message: 'x',
      });
      FakeWebSocket.last.emitClose();
    });
    expect(result.current.end).not.toBeNull();
    act(() => result.current.retry());
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.end).toBeNull();
    expect(result.current.state).toBe('connecting');
  });

  it('forgets the keys held down when the connection is lost: the server cannot hear them let go', () => {
    const { result } = setup();
    const socket = serve();
    act(() => {
      result.current.heldKeys.press('ShiftLeft', 'Shift');
      socket.emitClose();
    });
    expect(result.current.heldKeys.size).toBe(0);
    expect(socket.sent).toEqual([]);
  });

  it('sends nothing of a key that went down on the connection that was lost, once the next one is open', () => {
    vi.useFakeTimers();
    const { result } = setup();
    const first = serve();
    act(() => {
      result.current.heldKeys.press('ShiftLeft', 'Shift');
      first.emitClose();
    });
    advance(1000);
    const second = serve(FakeWebSocket.last);
    // The person lets go of the key now: the new connection never heard it go down, and the
    // server let go of it when the old one ended.
    expect(result.current.heldKeys.release('ShiftLeft')).toBeUndefined();
    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual([]);
  });
});

describe('useLiveView closing', () => {
  it('closes the connection when it unmounts, and does not connect again', () => {
    vi.useFakeTimers();
    const { unmount } = setup();
    const socket = serve();
    unmount();
    expect(socket.closeCalls).toHaveLength(1);
    act(() => socket.emitClose(1000));
    advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('lets go of the keys held down while the server can still hear it', () => {
    const { result, unmount } = setup();
    const socket = serve();
    act(() => {
      result.current.heldKeys.press('ShiftLeft', 'Shift');
      result.current.heldKeys.press('KeyH', 'H');
    });
    unmount();
    expect(socket.messages).toEqual([
      { t: 'key', a: 'up', k: 'Shift' },
      { t: 'key', a: 'up', k: 'H' },
    ]);
    expect(socket.closeCalls).toHaveLength(1);
  });

  it('does not wait for a connection that was never made when it unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = setup();
    act(() => FakeWebSocket.last.emitClose());
    unmount();
    advance(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes the connection and forgets everything when the session stops running', () => {
    const { result, rerender } = setup();
    const socket = serve();
    rerender({ id: 7, enabled: false });
    expect(socket.closeCalls).toHaveLength(1);
    expect(result.current).toMatchObject({
      state: 'idle',
      tabs: [],
      view: null,
      end: null,
    });
  });

  it('moves to the other session: closes the old connection and opens the new one', () => {
    const { result, rerender } = setup();
    const first = serve();
    rerender({ id: 9, enabled: true });
    expect(first.closeCalls).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.url).toMatch(/\/api\/sessions\/9\/stream$/);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.state).toBe('connecting');
  });

  it('ignores what a connection that was closed still delivers', () => {
    const { result, rerender } = setup();
    const first = serve();
    rerender({ id: 9, enabled: true });
    act(() => {
      first.emitMessage({ t: 'tabs', tabs: [tab] });
      first.emitClose();
    });
    expect(result.current.tabs).toEqual([]);
    expect(result.current.state).toBe('connecting');
  });
});

describe('useLiveView dialogs and lists', () => {
  const dialog = {
    t: 'dialog',
    id: 4,
    tab: 1,
    kind: 'prompt',
    message: 'Your name?',
    default: 'Ada',
  };

  it('collects the dialogs of the page and removes one the page closed', () => {
    const { result } = setup();
    serve();
    act(() => {
      FakeWebSocket.last.emitMessage(dialog);
      FakeWebSocket.last.emitMessage({ ...dialog, id: 5, kind: 'alert' });
    });
    expect(result.current.dialogs.map((item) => item.id)).toEqual([4, 5]);
    act(() => FakeWebSocket.last.emitMessage({ t: 'dialog_closed', id: 4 }));
    expect(result.current.dialogs.map((item) => item.id)).toEqual([5]);
  });

  it('answers a dialog and removes it', () => {
    const { result } = setup();
    serve();
    act(() => FakeWebSocket.last.emitMessage(dialog));
    act(() => result.current.answerDialog(4, true, 'Grace'));
    expect(result.current.dialogs).toEqual([]);
    expect(FakeWebSocket.last.messagesOf('answer')).toEqual([
      { t: 'answer', id: 4, accept: true, text: 'Grace' },
    ]);
  });

  it('shows the list of a select and answers it with an option or with none', () => {
    const { result } = setup();
    serve();
    const select = (token: number) => ({
      t: 'select',
      token,
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      options: [
        { label: 'One', selected: true, disabled: false, group: null },
        { label: 'Two', selected: false, disabled: false, group: 'Group' },
      ],
    });
    act(() => FakeWebSocket.last.emitMessage(select(3)));
    expect(result.current.selectMenu).toMatchObject({ token: 3, width: 100 });
    expect(result.current.selectMenu?.options).toHaveLength(2);
    act(() => result.current.pickOption(3, 1));
    expect(result.current.selectMenu).toBeNull();

    act(() => FakeWebSocket.last.emitMessage(select(4)));
    act(() => result.current.pickOption(4, null));
    expect(FakeWebSocket.last.messagesOf('pick')).toEqual([
      { t: 'pick', token: 3, index: 1 },
      { t: 'pick', token: 4, index: null },
    ]);
  });
});
