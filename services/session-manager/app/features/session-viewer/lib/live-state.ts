import type { SelectOptionInfo, ServerMessage, TabInfo } from '@/lib/live-view';

/**
 * Where the connection to the session's browser stands: not asked for yet or
 * closed (`idle`), being made (`connecting`), delivering pictures (`live`), or
 * lost and waiting to be made again (`lost`).
 */
export type LiveState = 'idle' | 'connecting' | 'live' | 'lost';

/** The tab whose pictures come, and the size of its viewport in CSS pixels. */
export interface ViewInfo {
  tab: number;
  w: number;
  h: number;
}

/** A drop-down list of the page, which the browser would draw outside it. */
export interface SelectMenuInfo {
  token: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options: readonly SelectOptionInfo[];
}

/** An `alert()`, `confirm()`, `prompt()` or `beforeunload` that waits for an answer. */
export interface PageDialogInfo {
  id: number;
  tab: number;
  kind: string;
  message: string;
  default: string;
}

/** Why the page stops trying to connect. */
export type LiveEnd =
  /** The server said the browser is gone. */
  | { reason: 'closed' }
  /** The server refused with an error code (the session is not running). */
  | { reason: 'refused'; code: string; message: string };

export interface LiveSnapshot {
  state: LiveState;
  /** Connections that failed in a row; a picture, which proves one works, starts the count over. */
  failures: number;
  end: LiveEnd | null;
  tabs: readonly TabInfo[];
  view: ViewInfo | null;
  dialogs: readonly PageDialogInfo[];
  selectMenu: SelectMenuInfo | null;
}

export const IDLE: LiveSnapshot = {
  state: 'idle',
  failures: 0,
  end: null,
  tabs: [],
  view: null,
  dialogs: [],
  selectMenu: null,
};

export function startingSnapshot(connect: boolean): LiveSnapshot {
  return connect ? { ...IDLE, state: 'connecting' } : IDLE;
}

export type LiveAction =
  /** Nothing is connected any more, nothing is remembered. */
  | { type: 'reset' }
  | { type: 'connecting' }
  /** The first picture came: the connection works. */
  | { type: 'picture' }
  /** The connection ended; the tabs and the last view stay, what hangs on the connection goes. */
  | { type: 'lost' }
  | { type: 'ended'; end: LiveEnd }
  /** A message of the server that changes what is shown. */
  | { type: 'message'; message: ServerMessage }
  /** The list was answered or dismissed. */
  | { type: 'list-answered' }
  | { type: 'dialog-answered'; id: number };

export function liveReducer(
  snapshot: LiveSnapshot,
  action: LiveAction,
): LiveSnapshot {
  switch (action.type) {
    case 'reset':
      return IDLE;
    case 'connecting':
      return snapshot.state === 'connecting'
        ? snapshot
        : { ...snapshot, state: 'connecting' };
    case 'picture':
      return snapshot.state === 'live'
        ? snapshot
        : { ...snapshot, state: 'live', failures: 0 };
    case 'lost':
      // A list or dialog was a question of that connection; the server asks a
      // dialog again when the page connects anew.
      return {
        ...snapshot,
        state: 'lost',
        failures: snapshot.failures + 1,
        dialogs: [],
        selectMenu: null,
      };
    case 'ended':
      return { ...snapshot, end: action.end };
    case 'list-answered':
      return snapshot.selectMenu === null
        ? snapshot
        : { ...snapshot, selectMenu: null };
    case 'dialog-answered':
      return withoutDialog(snapshot, action.id);
    case 'message':
      return applyMessage(snapshot, action.message);
    default:
      return unreachable(snapshot, action);
  }
}

/** A case the switch forgot is a type error here. */
function unreachable(snapshot: LiveSnapshot, _action: never): LiveSnapshot {
  return snapshot;
}

function withoutDialog(snapshot: LiveSnapshot, id: number): LiveSnapshot {
  if (!snapshot.dialogs.some((dialog) => dialog.id === id)) return snapshot;
  return {
    ...snapshot,
    dialogs: snapshot.dialogs.filter((dialog) => dialog.id !== id),
  };
}

function applyMessage(
  snapshot: LiveSnapshot,
  message: ServerMessage,
): LiveSnapshot {
  switch (message.t) {
    case 'tabs':
      return { ...snapshot, tabs: message.tabs };
    case 'view':
      return {
        ...snapshot,
        view: { tab: message.tab, w: message.w, h: message.h },
      };
    case 'select':
      return {
        ...snapshot,
        selectMenu: {
          token: message.token,
          x: message.x,
          y: message.y,
          width: message.width,
          height: message.height,
          options: message.options,
        },
      };
    case 'dialog':
      return {
        ...snapshot,
        dialogs: [
          ...snapshot.dialogs.filter((dialog) => dialog.id !== message.id),
          {
            id: message.id,
            tab: message.tab,
            kind: message.kind,
            message: message.message,
            default: message.default,
          },
        ],
      };
    case 'dialog_closed':
      return withoutDialog(snapshot, message.id);
    // Answers to a request and the end of the browser are not part of what is
    // shown: the hook hands them to whoever asked.
    case 'selection':
    case 'closed':
    case 'error':
      return snapshot;
    default:
      return unreachable(snapshot, message);
  }
}
