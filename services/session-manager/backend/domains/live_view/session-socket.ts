// One viewer's connection to a running session's browser: the tabs, pictures
// and events go out, the mouse and keyboard come in (the protocol is in
// `lib/live-view.ts`). Nothing here knows a runtime: the socket is anything
// that can `send` and `close`, so tests need no network.

import { isRecord } from '../../../lib/is-record.ts';
import {
  MAX_CLICKS,
  MAX_TAB_TITLE,
  MAX_TAB_URL,
  URGENT_MESSAGES,
  clampText,
  clientMessageSchema,
} from '../../../lib/live-view.ts';
import type { ClientMessage, ServerMessage } from '../../../lib/live-view.ts';
import { debugLog } from '../../lib/debug.ts';
import { addressBarUrl } from '../../lib/web-url.ts';
import { RemoteError } from '../browser/remote.ts';
import type {
  MouseButton,
  PageDialog,
  Remote,
  RemoteEvent,
  SelectMenu,
  Tab,
  Watcher,
} from '../browser/remote.ts';
import { Inputs } from './inputs.ts';
import { Outbox } from './outbox.ts';

/** What `SessionSocket` needs of a WebSocket: Bun's `ServerWebSocket` is one. */
export interface SocketLike {
  /**
   * Bun's `ServerWebSocket.send`: the bytes sent, -1 when the message waits
   * behind a full buffer (`SessionSocket.drain` says when it can take more),
   * 0 when it was dropped. A socket that answers nothing is never busy.
   */
  send(data: string | Uint8Array): number | void;
  close(code?: number, reason?: string): void;
}

const NORMAL_CLOSURE = 1000;
const INTERNAL_ERROR = 1011;
/** "Try again later": the viewer did not read what it was sent (see `Outbox`). */
const TRY_AGAIN_LATER = 1013;
/** The keys that turn another key into a shortcut: Delete under either of them deletes nothing. */
const SHORTCUT_KEYS: ReadonlySet<string> = new Set(['Control', 'Meta']);

type TabMessage = Extract<ClientMessage, { t: 'tab' }>;
type GoMessage = Extract<ClientMessage, { t: 'go' }>;

// -- logging -------------------------------------------------------------------

/**
 * What is ignored on purpose, for whoever asks (`DEBUG=session-manager`).
 * Never the content of a message: it may be a password that was pasted.
 */
const debug = debugLog('live-view');

// -- messages to the client ----------------------------------------------------

/**
 * The text cut to `max` characters, never in the middle of an emoji; a title
 * ends in "…" where it was cut, an address is cut as it is (it is not an
 * address any more, and a mark would make it look like one).
 */
function clip(text: string, max: number, mark = ''): string {
  if (text.length <= max) return text;
  let end = max - mark.length;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // half of a pair
  return text.slice(0, end) + mark;
}

function tabsMessage(tabs: readonly Tab[]): ServerMessage {
  return {
    t: 'tabs',
    tabs: tabs.map((tab) => ({
      id: tab.id,
      url: clip(tab.url, MAX_TAB_URL),
      title: clip(tab.title, MAX_TAB_TITLE, '…'),
      loading: tab.loading,
      active: tab.active,
    })),
  };
}

function dialogMessage(dialog: PageDialog): ServerMessage {
  return {
    t: 'dialog',
    id: dialog.id,
    tab: dialog.tab,
    kind: dialog.kind,
    message: dialog.message,
    default: dialog.default,
  };
}

function selectMessage(menu: SelectMenu): ServerMessage {
  return {
    t: 'select',
    token: menu.token,
    x: menu.x,
    y: menu.y,
    width: menu.width,
    height: menu.height,
    options: menu.options.map((option) => ({
      label: option.label,
      selected: option.selected,
      disabled: option.disabled,
      group: option.group,
    })),
  };
}

/** The message for an event; `closed` is not one: the picture feed ends with it and says so. */
function eventMessage(
  event: Exclude<RemoteEvent, { type: 'closed' }>,
): ServerMessage {
  if (event.type === 'tabs') return tabsMessage(event.tabs);
  if (event.type === 'select') return selectMessage(event.menu);
  if (event.type === 'dialog') return dialogMessage(event.dialog);
  return { t: 'dialog_closed', id: event.id };
}

// -- messages from the client --------------------------------------------------

/** The message a client sent, or null for one that is ignored. */
function parseClientMessage(data: string | Uint8Array): ClientMessage | null {
  if (typeof data !== 'string') {
    debug('ignored a binary message from the web client');
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    debug('ignored a message from the web client that is not JSON');
    return null;
  }
  // A paste of more than `MAX_TEXT` characters still gets its beginning in
  // (the page cuts it too, so this is for other clients).
  if (isRecord(json) && json.t === 'text' && typeof json.text === 'string') {
    json = { ...json, text: clampText(json.text) };
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'message'}: ${issue.code}`)
      .join(', ');
    debug(`ignored a malformed message from the web client (${problems})`);
    return null;
  }
  return parsed.data;
}

/**
 * Where the address bar goes with this text (a search, if it is no address);
 * null when the bar is blank. An address that cannot be opened is refused: it
 * is not searched for (a pasted link may hold a token that does not belong in
 * a search engine).
 */
function address(text: string): string | null {
  if (text.trim() === '') return null;
  const url = addressBarUrl(text);
  if (url === null) {
    throw new RemoteError(
      'That address cannot be opened. Addresses start with http:// or https://.',
      'address_refused',
    );
  }
  return url;
}

// -- the connection ------------------------------------------------------------

export class SessionSocket {
  readonly #socket: SocketLike;
  readonly #remote: Remote;
  readonly #sessionId: number;
  readonly #outbox = new Outbox();
  readonly #inputs = new Inputs();
  /**
   * What this viewer holds down in the page, and where its pointer was last:
   * it is let go of when the connection ends. The page cannot do it for a
   * connection that is gone, and a key left down (Shift, Control) would stay
   * down in the browser of the session until somebody pressed it again.
   */
  readonly #heldKeys = new Set<string>();
  readonly #heldButtons = new Set<MouseButton>();
  #pointer = { x: 0, y: 0 };
  #unsubscribe: (() => void) | null = null;
  #watcher: Watcher | null = null;
  /** The connection is over (either side ended it): nothing is done any more. */
  #closed = false;
  /** The browser is gone: what was queued still goes out, then the connection ends. */
  #gone = false;
  /** Set while the sender waits for the socket to take more. */
  #resume: (() => void) | null = null;
  /**
   * The viewer was told that the browser has stopped taking the mouse. Every
   * move after that is refused for the same reason, and saying it once is
   * enough, until the mouse works again.
   */
  #toldInputStuck = false;

  constructor(socket: SocketLike, remote: Remote, sessionId: number) {
    this.#socket = socket;
    this.#remote = remote;
    this.#sessionId = sessionId;
  }

  /** Sends the tabs and the dialogs that wait, then the pictures. */
  start(): void {
    let watcher: Watcher;
    try {
      // Subscribed first and everything below runs without a pause, so no
      // event can come between the snapshot and the news.
      this.#unsubscribe = this.#remote.subscribe((event) => {
        this.#onEvent(event);
      });
      this.#queue(tabsMessage(this.#remote.tabs()));
      // A dialog that a page opened while nobody watched waits for an AI
      // assistant, or for a viewer who comes later.
      for (const dialog of this.#remote.dialogs()) {
        this.#queue(dialogMessage(dialog));
      }
      watcher = this.#remote.watch();
      this.#watcher = watcher;
    } catch (error) {
      this.#fault(error);
      return;
    }
    void this.#pump(watcher);
    void this.#sendLoop();
    void this.#applyLoop();
  }

  /** A message from the client. */
  receive(data: string | Uint8Array): void {
    if (this.#closed || this.#gone) return;
    const message = parseClientMessage(data);
    if (message === null) return;
    // The answers to what the browser asked must not wait for the input
    // before them: the click that made the page ask is still waiting for them.
    if (URGENT_MESSAGES.has(message.t)) void this.#run(message);
    else this.#inputs.put(message);
  }

  /** The socket can take more again (it said it was busy). */
  drain(): void {
    const resume = this.#resume;
    this.#resume = null;
    resume?.();
  }

  /**
   * The connection is over: lets go of the browser's watcher and listener, and
   * of the keys and mouse buttons the viewer held down. Safe to call twice.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#inputs.close();
    this.#outbox.finish();
    this.drain();
    this.#unsubscribe?.();
    this.#watcher?.close();
    void this.#letGo();
  }

  /** Releases what the viewer held down. The browser may be gone already: that is no failure. */
  async #letGo(): Promise<void> {
    const keys = [...this.#heldKeys];
    const buttons = [...this.#heldButtons];
    this.#heldKeys.clear();
    this.#heldButtons.clear();
    if (this.#gone) return;
    const { x, y } = this.#pointer;
    for (const button of buttons) {
      await this.#release(() =>
        this.#remote.mouse('up', x, y, { button, clicks: 1 }),
      );
    }
    for (const key of keys) {
      await this.#release(() => this.#remote.key('up', key));
    }
  }

  async #release(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      // The connection is over: a failure here is only worth a line for whoever asks.
      this.#fault(error);
    }
  }

  /**
   * Queues a message for the viewer. A viewer that has not read what it was
   * sent so far, to the allowance of the outbox, is sent away instead: it can
   * connect again and gets the state of the page as it is then.
   */
  #queue(message: ServerMessage): void {
    if (this.#outbox.send(message)) return;
    console.warn(
      `the viewer of session ${this.#sessionId} does not read what it is sent: ending its connection`,
    );
    this.#end(TRY_AGAIN_LATER, 'The viewer reads too slowly.');
  }

  /** Ends the connection from this side. */
  #end(code: number, reason?: string): void {
    if (this.#closed) return;
    this.close();
    this.#socket.close(code, reason);
  }

  #fault(error: unknown): void {
    if (this.#closed) {
      // Most likely something that was under way when the viewer left.
      debug(`failed after the connection ended: ${String(error)}`);
      return;
    }
    console.error(`the live view of session ${this.#sessionId} failed`, error);
    this.#end(INTERNAL_ERROR, 'The live view failed.');
  }

  #onEvent(event: RemoteEvent): void {
    if (event.type === 'closed') {
      this.#browserGone();
      return;
    }
    this.#queue(eventMessage(event));
  }

  /** Tells the viewer the browser is gone; the connection ends once what is queued has gone out. */
  #browserGone(): void {
    if (this.#closed || this.#gone) return;
    this.#gone = true;
    this.#inputs.close();
    this.#queue({ t: 'closed' });
    this.#outbox.finish();
  }

  // -- loops ---------------------------------------------------------------------

  async #pump(watcher: Watcher): Promise<void> {
    try {
      for (;;) this.#outbox.picture(await watcher.get());
    } catch (error) {
      if (this.#closed) return; // the watcher was closed by `close`
      // A watcher fails with a `RemoteError` when the browser is gone.
      if (error instanceof RemoteError) this.#browserGone();
      else this.#fault(error);
    }
  }

  async #sendLoop(): Promise<void> {
    try {
      for (;;) {
        const item = await this.#outbox.next();
        if (item === null || this.#closed) break;
        const status = this.#socket.send(
          item instanceof Uint8Array ? item : JSON.stringify(item),
        );
        // Dropped: the socket is gone, or too far behind to be worth keeping.
        if (status === 0) break;
        // A slow client skips pictures: only the newest is taken once it is ready.
        if (status === -1) await this.#untilDrained();
      }
    } catch (error) {
      this.#fault(error);
      return;
    }
    this.#end(NORMAL_CLOSURE);
  }

  #untilDrained(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#resume = resolve;
    });
  }

  async #applyLoop(): Promise<void> {
    for (;;) {
      const message = await this.#inputs.get();
      if (message === null) return;
      await this.#run(message);
    }
  }

  /** Does what the client asked; what cannot be done is told to it, not to the log. */
  async #run(message: ClientMessage): Promise<void> {
    try {
      await this.#handle(message);
      if (message.t === 'mouse' || message.t === 'wheel') {
        this.#toldInputStuck = false; // the mouse works (again)
      }
    } catch (error) {
      if (error instanceof RemoteError) this.#refused(error, message.t);
      else this.#fault(error);
    }
  }

  /** Tells the viewer what the browser could not do: that it takes no mouse, once. */
  #refused(error: RemoteError, what: string): void {
    if (this.#closed || this.#gone) return;
    if (error.notice === 'input_stuck') {
      if (this.#toldInputStuck) {
        debug(`ignored ${what}: the browser takes no mouse`);
        return;
      }
      this.#toldInputStuck = true;
    }
    this.#queue({
      t: 'error',
      message: error.message,
      notice: error.notice ?? 'action_failed',
    });
  }

  // -- the client's messages -------------------------------------------------------

  async #handle(message: ClientMessage): Promise<void> {
    const remote = this.#remote;
    switch (message.t) {
      case 'mouse':
        this.#pointer = { x: message.x, y: message.y };
        if (message.a === 'down') this.#heldButtons.add(message.b);
        else if (message.a === 'up') this.#heldButtons.delete(message.b);
        await remote.mouse(message.a, message.x, message.y, {
          button: message.b,
          clicks: Math.min(Math.max(message.n, 1), MAX_CLICKS),
        });
        return;
      case 'wheel':
        await remote.wheel(message.x, message.y, message.dx, message.dy);
        return;
      case 'key':
        // Noted before it is done: a connection that ends while the key is on
        // its way down must still let it go.
        if (message.a === 'down') this.#heldKeys.add(message.k);
        else this.#heldKeys.delete(message.k);
        await remote.key(message.a, message.k);
        return;
      case 'text':
        await remote.insertText(message.text);
        return;
      case 'copy': {
        const text = await remote.selectedText();
        this.#queue({ t: 'selection', text, cut: message.cut });
        // Cutting deletes what was selected.
        if (message.cut && text !== '') await this.#deleteSelection();
        return;
      }
      case 'tab':
        await this.#handleTab(message);
        return;
      case 'go':
        this.#handleGo(message);
        return;
      case 'pick':
        await remote.pickOption(message.token, message.index);
        return;
      case 'answer':
        await remote.answerDialog(message.id, {
          accept: message.accept,
          text: message.text ?? null,
        });
        return;
    }
  }

  /**
   * Deletes what the page has selected, for a cut. A viewer cuts with a
   * shortcut, so Ctrl or Command is down in the page right now, and a Delete
   * pressed under it is the shortcut for something else, which deletes
   * nothing: the key is let go for the Delete and held again after it, as the
   * viewer holds it (its own release comes later and finds it held).
   */
  async #deleteSelection(): Promise<void> {
    const shortcut = [...this.#heldKeys].filter((key) =>
      SHORTCUT_KEYS.has(key),
    );
    for (const key of shortcut) await this.#remote.key('up', key);
    try {
      await this.#remote.key('press', 'Delete');
    } finally {
      for (const key of shortcut) await this.#remote.key('down', key);
    }
  }

  async #handleTab(message: TabMessage): Promise<void> {
    const remote = this.#remote;
    if (message.a === 'open') {
      // No address: the start page.
      const url = message.url ? address(message.url) : null;
      if (message.url && url === null) {
        debug('ignored a new tab with a blank address');
        return;
      }
      await remote.openTab(url);
      return;
    }
    if (message.id === undefined) {
      debug(`ignored a tab to ${message.a} without its id`);
      return;
    }
    if (message.a === 'close') await remote.closeTab(message.id);
    else await remote.activateTab(message.id);
  }

  /** Navigation can take a while (a slow proxy): it must not hold up the input behind it. */
  #handleGo(message: GoMessage): void {
    let work: Promise<void>;
    if (message.a === 'goto') {
      const url = message.url === undefined ? null : address(message.url);
      if (url === null) {
        debug('ignored a navigation to a blank address');
        return;
      }
      work = this.#remote.goto(url);
    } else {
      work = this.#remote.history(message.a);
    }
    void this.#navigating(work);
  }

  async #navigating(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch (error) {
      if (!(error instanceof RemoteError)) {
        this.#fault(error);
      } else if (error.notice === 'input_stuck') {
        // A reload waits for the mouse, which the browser no longer takes.
        this.#refused(error, 'a reload');
      } else {
        // The page shows its own error when a navigation fails.
        debug(`a navigation failed: ${error.message}`);
      }
    }
  }
}
