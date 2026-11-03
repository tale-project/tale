// What can be done with a running browser from outside: look at its tabs,
// watch the active one, use mouse and keyboard.
//
// The web client's stream, the MCP tools and the tests all work through
// `Remote` (`playwright-remote.ts` has the real one, `../../testing` a fake).
// The browser runs without a window, so everything a person would see or do in
// a window goes through here. Durations are milliseconds.

import type { NoticeCode } from '../../../lib/live-view.ts';

export type MouseAction = 'move' | 'down' | 'up';
export type KeyAction = 'down' | 'up' | 'press';
export type HistoryAction = 'back' | 'forward' | 'reload';
export type Navigation = 'commit' | 'domcontentloaded' | 'load';
export type MouseButton = 'left' | 'middle' | 'right';

/**
 * An action that cannot be done (no such tab, the page is gone, a navigation
 * failed). The message is for the person using the app, in English: the web
 * client words the `notice`, when there is one, in the person's own language
 * and shows the message as a quoted detail.
 */
export class RemoteError extends Error {
  readonly notice: NoticeCode | undefined;

  constructor(message: string, notice?: NoticeCode) {
    super(message);
    this.name = 'RemoteError';
    this.notice = notice;
  }
}

export interface Tab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  active: boolean;
}

/**
 * A picture of the active tab. `width` and `height` are the size of the
 * picture in the CSS pixels of the page, from its top left corner: the space
 * that mouse coordinates are in. It is the page's viewport, or the room the
 * page really has in its window where that is less than the viewport it
 * reports (a headless window on macOS keeps the room of a toolbar).
 */
export interface Frame {
  tab: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
}

export interface SelectOption {
  label: string;
  selected: boolean;
  disabled: boolean;
  group: string | null;
}

/** A drop-down list the browser would draw outside the page. */
export interface SelectMenu {
  token: number;
  /** The `<select>` element's rectangle in the viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
  options: readonly SelectOption[];
}

export interface PageDialog {
  id: number;
  tab: number;
  /** alert, confirm, prompt or beforeunload */
  kind: string;
  message: string;
  default: string;
}

export type RemoteEvent =
  | { type: 'tabs'; tabs: readonly Tab[] }
  | { type: 'select'; menu: SelectMenu }
  | { type: 'dialog'; dialog: PageDialog }
  | { type: 'dialog_closed'; id: number }
  /** The browser is gone. */
  | { type: 'closed' };

/** Something on a page to click or fill in. `ref` works until the page is read again. */
export interface PageElement {
  ref: number;
  role: string;
  name: string;
  value: string | null;
  href: string | null;
  /** E.g. "checked", "disabled". */
  state: string | null;
  /** Centre, in viewport pixels. */
  x: number;
  y: number;
}

export interface PageReading {
  url: string;
  title: string;
  /** The visible text, shortened. */
  text: string;
  /** What is in view and can be used. */
  elements: readonly PageElement[];
  /** E.g. "0-900 of 4200". */
  scroll: string;
  /** Why the page did not load, if it did not. */
  problem: string | null;
}

/**
 * A viewer's feed of pictures. Only the newest one matters: a slow viewer skips
 * frames. Call `close` when done, it stops the pictures once nobody watches.
 */
export interface Watcher {
  /** The next picture. Rejects with a `RemoteError` when the browser is gone. */
  get(): Promise<Frame>;
  close(): void;
}

export interface Remote {
  /** The tabs as last seen. */
  tabs(): readonly Tab[];

  /**
   * The tabs with up to date titles (`tabs` has the ones last seen: they are
   * only kept current while the session is watched).
   */
  listTabs(): Promise<readonly Tab[]>;

  /**
   * Call `listener` on every change; returns the function that unsubscribes.
   * While somebody listens, dialogs wait for an answer instead of being
   * dismissed.
   */
  subscribe(listener: (event: RemoteEvent) => void): () => void;

  /**
   * Pictures of the active tab (they are only taken while somebody watches).
   */
  watch(): Watcher;

  /**
   * Somebody without a viewer (an AI assistant) is working in the session for
   * the next `ms`: dialogs wait for its answer, as they do for a viewer.
   */
  attend(ms: number): void;

  /** The dialogs that wait for an answer (the page does not respond meanwhile). */
  dialogs(): readonly PageDialog[];

  /**
   * The oldest dialog that waits for an answer, once there is one; `null` if
   * none comes within `timeoutMs`.
   */
  waitForDialog(timeoutMs: number): Promise<PageDialog | null>;

  openTab(url?: string | null): Promise<Tab>;
  closeTab(tab: number): Promise<void>;
  activateTab(tab: number): Promise<void>;
  goto(url: string, tab?: number | null, wait?: Navigation): Promise<void>;
  history(action: HistoryAction, tab?: number | null): Promise<void>;

  /** A JPEG of the viewport. */
  screenshot(tab?: number | null): Promise<Uint8Array>;

  mouse(
    action: MouseAction,
    x: number,
    y: number,
    options?: { button?: MouseButton; clicks?: number },
  ): Promise<void>;
  wheel(x: number, y: number, dx: number, dy: number): Promise<void>;

  /**
   * Scroll like a mouse wheel at a place in the viewport (the middle of the
   * page without one).
   */
  scroll(
    dx: number,
    dy: number,
    x?: number | null,
    y?: number | null,
  ): Promise<void>;

  /**
   * Click (`count` 2: double click). A drop-down list cannot be clicked open
   * (nothing shows its options): that rejects with a `RemoteError` that says
   * so.
   */
  clickAt(
    x: number,
    y: number,
    options?: { button?: MouseButton; count?: number },
  ): Promise<void>;
  hover(x: number, y: number): Promise<void>;

  /** Press the mouse button at the first place, move to the second and release it. */
  drag(x1: number, y1: number, x2: number, y2: number): Promise<void>;

  key(action: KeyAction, key: string): Promise<void>;
  insertText(text: string): Promise<void>;
  selectedText(): Promise<string>;

  /** The answer to a `select` event: the chosen option, or `null` if the list was dismissed. */
  pickOption(token: number, index: number | null): Promise<void>;
  answerDialog(
    dialogId: number,
    options: { accept: boolean; text?: string | null },
  ): Promise<void>;

  readPage(tab?: number | null): Promise<PageReading>;
  clickElement(ref: number): Promise<void>;
  fillElement(
    ref: number,
    text: string,
    options?: { submit?: boolean },
  ): Promise<void>;
}
