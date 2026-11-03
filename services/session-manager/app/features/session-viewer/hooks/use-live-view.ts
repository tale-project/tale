import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { z } from 'zod';

import {
  serverMessageSchema,
  type clientMessageSchema,
  type NoticeCode,
  type ServerMessage,
  type TabInfo,
} from '@/lib/live-view';

import { HeldKeys } from '../lib/keys';
import {
  liveReducer,
  startingSnapshot,
  type LiveEnd,
  type LiveState,
  type PageDialogInfo,
  type SelectMenuInfo,
  type ViewInfo,
} from '../lib/live-state';
import { reconnectDelay, streamUrl } from '../lib/stream-url';

/** A message to the session's browser, as the page writes it (the defaults are the server's). */
export type ClientMessageInput = z.input<typeof clientMessageSchema>;

export type FrameListener = (jpeg: ArrayBuffer) => void;
export type SelectionListener = (selection: {
  text: string;
  cut: boolean;
}) => void;

/** One thing the viewer asked for that the browser could not do. */
export interface LiveNotice {
  /** What it is about: the page words it in the language of the person. */
  code: NoticeCode;
  /** The browser layer's own sentence, in English: only a quoted detail. */
  message: string;
}

export interface LiveViewOptions {
  /** Connect while this is true: the session runs. */
  enabled: boolean;
  /** The server says the browser is gone. */
  onClosed?: () => void;
  /** The server refuses the connection (the session is not running): there is nothing to watch. */
  onRefused?: () => void;
  /** The browser could not do what the page asked; the connection goes on. */
  onNotice?: (notice: LiveNotice) => void;
}

export interface LiveView {
  state: LiveState;
  /** Connections that failed in a row: the page waits longer after each. */
  failures: number;
  /** Set when the page stopped trying: the browser closed, or the server refused. */
  end: LiveEnd | null;
  /** The open tabs as last seen; they stay while the connection is made again. */
  tabs: readonly TabInfo[];
  view: ViewInfo | null;
  dialogs: readonly PageDialogInfo[];
  selectMenu: SelectMenuInfo | null;
  /** Sends a message to the browser; false when the connection is not open. */
  send: (message: ClientMessageInput) => boolean;
  /** Calls `listener` with every picture (a JPEG of the active tab); returns what stops it. */
  onFrame: (listener: FrameListener) => () => void;
  /** Calls `listener` with the page's selection when the browser answers a copy. */
  onSelection: (listener: SelectionListener) => () => void;
  /** Answers a dialog of the page. */
  answerDialog: (id: number, accept: boolean, text: string | null) => void;
  /** Answers the list of a `<select>`: the option, or null for none. */
  pickOption: (token: number, index: number | null) => void;
  /** The keys held down in the page; they are let go when the connection ends. */
  heldKeys: HeldKeys;
  /** Connects again at once, also after the server refused or the browser closed. */
  retry: () => void;
}

function isBinary(data: unknown): data is ArrayBuffer {
  return (
    data instanceof ArrayBuffer ||
    Object.prototype.toString.call(data) === '[object ArrayBuffer]'
  );
}

/** A text message of the server; one the page cannot read is dropped and logged (without its content). */
function parseServerMessage(text: string): ServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.warn('live view: dropped a message that is not JSON');
    return null;
  }
  const parsed = serverMessageSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(
      'live view: dropped a message the page does not know',
      parsed.error.issues.map((issue) => issue.message),
    );
    return null;
  }
  return parsed.data;
}

/**
 * The live view of a running session: the WebSocket to its browser and what
 * comes over it. The server sends the tabs, the size of the page, lists and
 * dialogs of the page as JSON messages and the pictures of the active tab as
 * JPEGs; the page sends the mouse and keyboard back (see `lib/live-view.ts`).
 *
 * Pictures do not pass through React state, there are dozens a second:
 * `onFrame` hands them to whoever draws them. The connection is made while
 * `enabled`; one that is lost is made again after a wait that grows, except
 * when the server said there is nothing to connect to (the browser closed, or
 * the session is not running). It closes, after letting go of the keys held
 * down, when the hook unmounts, is disabled or is given another session.
 */
export function useLiveView(
  sessionId: number,
  options: LiveViewOptions,
): LiveView {
  const { enabled } = options;
  const [snapshot, dispatch] = useReducer(
    liveReducer,
    enabled,
    startingSnapshot,
  );
  const [frameListeners] = useState(() => new Set<FrameListener>());
  const [selectionListeners] = useState(() => new Set<SelectionListener>());
  const [heldKeys] = useState(() => new HeldKeys());
  const socketRef = useRef<WebSocket | null>(null);
  // Connects at once, whatever the wait: set by the connection that is open.
  const reconnectRef = useRef<(() => void) | null>(null);
  // The connection reads the callbacks as they are now, not as they were when
  // it was made.
  const handlersRef = useRef(options);
  useLayoutEffect(() => {
    handlersRef.current = options;
  });

  const send = useCallback((message: ClientMessageInput): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Failed tries in a row: the wait before the next one grows with it.
    let failures = 0;
    // The server said there is nothing to connect to.
    let over = false;

    const handleMessage = (message: ServerMessage) => {
      switch (message.t) {
        case 'selection':
          for (const listener of selectionListeners) {
            listener({ text: message.text, cut: message.cut });
          }
          return;
        case 'error':
          if (message.code) {
            over = true;
            dispatch({
              type: 'ended',
              end: {
                reason: 'refused',
                code: message.code,
                message: message.message,
              },
            });
            handlersRef.current.onRefused?.();
          } else {
            handlersRef.current.onNotice?.({
              code: message.notice ?? 'action_failed',
              message: message.message,
            });
          }
          return;
        case 'closed':
          over = true;
          dispatch({ type: 'ended', end: { reason: 'closed' } });
          handlersRef.current.onClosed?.();
          return;
        default:
          dispatch({ type: 'message', message });
      }
    };

    const connect = () => {
      dispatch({ type: 'connecting' });
      const next = new WebSocket(streamUrl(sessionId));
      next.binaryType = 'arraybuffer';
      socket = next;
      socketRef.current = next;
      next.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (socket !== next) return;
        if (typeof event.data === 'string') {
          const message = parseServerMessage(event.data);
          if (message !== null) handleMessage(message);
        } else if (isBinary(event.data)) {
          // A picture is the proof that the connection works.
          failures = 0;
          dispatch({ type: 'picture' });
          for (const listener of frameListeners) listener(event.data);
        }
      });
      next.addEventListener('close', () => {
        if (socket !== next) return;
        socket = null;
        socketRef.current = null;
        // The server cannot hear a key being let go any more.
        heldKeys.clear();
        dispatch({ type: 'lost' });
        if (!over) timer = setTimeout(connect, reconnectDelay(failures++));
      });
    };

    reconnectRef.current = () => {
      clearTimeout(timer);
      over = false;
      failures = 0;
      const current = socket;
      socket = null;
      socketRef.current = null;
      current?.close();
      dispatch({ type: 'reset' });
      connect();
    };

    connect();

    return () => {
      reconnectRef.current = null;
      clearTimeout(timer);
      const current = socket;
      socket = null;
      socketRef.current = null;
      if (current !== null) {
        if (current.readyState === WebSocket.OPEN) {
          // While the server can still hear it: a key left down would stay down in the page.
          for (const key of heldKeys.releaseAll()) {
            current.send(JSON.stringify({ t: 'key', a: 'up', k: key }));
          }
        }
        current.close();
      }
      heldKeys.clear();
      dispatch({ type: 'reset' });
    };
  }, [enabled, sessionId, frameListeners, selectionListeners, heldKeys]);

  const onFrame = useCallback(
    (listener: FrameListener) => {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    [frameListeners],
  );

  const onSelection = useCallback(
    (listener: SelectionListener) => {
      selectionListeners.add(listener);
      return () => {
        selectionListeners.delete(listener);
      };
    },
    [selectionListeners],
  );

  const answerDialog = useCallback(
    (id: number, accept: boolean, text: string | null) => {
      send({ t: 'answer', id, accept, text });
      dispatch({ type: 'dialog-answered', id });
    },
    [send],
  );

  const pickOption = useCallback(
    (token: number, index: number | null) => {
      send({ t: 'pick', token, index });
      dispatch({ type: 'list-answered' });
    },
    [send],
  );

  const retry = useCallback(() => reconnectRef.current?.(), []);

  return {
    ...snapshot,
    send,
    onFrame,
    onSelection,
    answerDialog,
    pickOption,
    heldKeys,
    retry,
  };
}
