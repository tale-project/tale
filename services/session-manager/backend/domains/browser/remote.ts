// What can be done with a running browser from outside: look at its tabs,
// read a page, use mouse and keyboard on it, bring it to the front.
//
// The person uses the browser in its own window; the MCP tools, typing a
// secret from the web page and the tests work through `Remote`
// (`playwright-remote.ts` has the real one, `../../testing` a fake). Durations
// are milliseconds.

export type KeyAction = 'down' | 'up' | 'press';
export type HistoryAction = 'back' | 'forward' | 'reload';
export type Navigation = 'commit' | 'domcontentloaded' | 'load';
export type MouseButton = 'left' | 'middle' | 'right';

/**
 * An action that cannot be done (no such tab, the page is gone, a navigation
 * failed). The message says why, in English: an AI assistant reads it as it
 * is, and the web page shows it as a quoted detail.
 */
export class RemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** The page did not answer in time: most often a dialog waits for an answer. */
export class PageNotRespondingError extends RemoteError {
  constructor(message: string) {
    super(message);
    this.name = 'PageNotRespondingError';
  }
}

export interface Tab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  active: boolean;
}

export interface PageDialog {
  id: number;
  tab: number;
  /** alert, confirm, prompt or beforeunload */
  kind: string;
  message: string;
  default: string;
}

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

export interface Remote {
  /** The tabs as last seen. */
  tabs(): readonly Tab[];

  /** The tabs with up to date titles (`tabs` has the ones last seen). */
  listTabs(): Promise<readonly Tab[]>;

  /**
   * The active tab forward in its window: the one the person last clicked or
   * typed in. The window itself is the system's to raise (see
   * `BrowserHandle.show`).
   */
  toFront(): Promise<void>;

  /**
   * An AI assistant is working in the session for the next `ms`: dialogs wait
   * for its answer (in a window the person can answer them too).
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
  /**
   * Whether what has the focus in the active tab takes typed text: a field, an
   * editor or a frame. A page that does not answer (a dialog waits) rejects
   * with a `RemoteError`.
   */
  takesText(): Promise<boolean>;
  selectedText(): Promise<string>;

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
