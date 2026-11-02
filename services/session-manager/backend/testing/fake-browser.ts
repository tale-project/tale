// In-memory stand-ins for the browser layer, for tests (port of the browser
// parts of the old app's `tests/fakes.py`). Nothing here starts a process or
// opens a socket. Durations are milliseconds; every name is camelCase.
//
// ## FakeBackend (implements `BrowserBackend`)
//
// State a test sets:
//   browserVersion          what `browserVersion` says
//   installed               `browserInstalled()` (default true)
//   install                 `browserInstall()` ({ installing: false, error: null })
//   installGate/installError  what `warmUp()` does while `installed` is false:
//                           `install.installing` is true until `installGate` (if
//                           any) opens, then the install fails with
//                           `installError`, or succeeds (`installed` turns true)
//   geo                     the `GeoInfo` of every lookup (default `NEW_YORK`)
//   geoByIp                 per-IP answers: a `GeoInfo`, or a `GeoLookupError`
//                           that the lookup rejects with
//   geoFor                  a function that answers every lookup instead
//   identityError           `createIdentity` rejects with it
//   launchError             `launch` rejects with it (until it is set to null)
//   launchGate              `launch` waits for it to open (a `Gate`)
//   launchDelayMs           `launch` waits this long (after the gate)
//
// State it keeps:
//   launches                the `FakeBrowser`s launched, in order
//   attempts                every `LaunchSpec` launched, failed attempts too
//   lookups                 the IPs `lookupGeo` was asked about
//   identities              every `GeneratedIdentity` drawn
//   identityRequests        the `os` and `taken` of every `createIdentity`
//   warmUps, closeCalls     how often `warmUp()` and `close()` were called
//   latest()                the browser launched last (throws if none was)
//
// `createIdentity` is deterministic: the nth identity has user agent
// "FakeAgent/<n>", platform "Win32", screen "1920x1080", GPU "Fake GPU" and the
// signatures "visible-<n>" and "full-<n>" (n counts from 1, and skips numbers
// whose signatures are in `taken`). The OS "random" gets a windows identity.
//
// ## FakeBrowser (implements `BrowserHandle`)
//
//   spec, remote, closeCalls, closed
//   close()                 closes the remote and ends the session
//   crash()                 the browser dies: the same, without a `close()` call
//   closeAllTabs()          the user closes every tab (the last one ends the
//                           session and makes it forget its tabs)
//
// ## FakeRemote (implements `Remote`)
//
// Tabs, pictures and input in memory (`new FakeRemote(spec, onEmpty?)`; a
// `FakeBrowser` makes one). Tab ids count from 1, a tab's title is
// "Title of <url>", a new tab opens `spec.startPage`, and `spec.onLayout` hears
// about the restorable tabs (as the real browser reports them: once at the
// start, then on every change). Closing the last tab reports an empty layout
// and ends the session (`onEmpty`).
//
//   events                  the input it got, in order, as tuples (`FakeInput`):
//     ['goto', url, tab | null, wait]        ['history', action, tab | null]
//     ['mouse', action, x, y, button, clicks] ['wheel', x, y, dx, dy]
//     ['scroll', dx, dy] or ['scroll', dx, dy, x, y]
//     ['clickAt', x, y, button, count]       ['hover', x, y]
//     ['drag', x1, y1, x2, y2]               ['key', action, key]
//     ['text', text]                          ['pick', token, index | null]
//     ['answer', dialogId, accept, text | null]
//     ['clickElement', ref]                   ['fillElement', ref, text, submit]
//   selection               what `selectedText()` answers
//   attended                the milliseconds of every `attend()`
//   pending                 the dialogs that wait for an answer
//   dialogOnClick           [kind, message]: the next `clickAt` or
//                           `clickElement` opens this dialog and does not return
//                           before it is answered (the real browser's click
//                           waits for `alert()` and `confirm()` too)
//   problem                 `readPage().problem`
//   listeners, watchers     who subscribed, who watches
//   closed                  true once `close()` was called
//   emit(event)             deliver any `RemoteEvent` to the listeners
//   openDialog(...)         a page opens a dialog (it waits in `pending`)
//   openSelect(...)         a page opens a drop-down list
//   showNewPicture()        the page changed: every watcher gets a new picture
//                           (a change of the tabs does it: open, close, choose,
//                           navigate; a real screencast sends one as well)
//   closeAllTabs()          see above
//   close()                 the browser is gone: `closed` event, watchers fail
//
// Pictures are `Frame`s of tab <active> at 800x600 whose bytes read
// "jpeg-<n>" (n counts from 1; `watch()` pushes the first one at once);
// `screenshot()` is `fakeJpeg('screenshot')`.
//
// A `FakeWatcher` queues every picture (the real one keeps only the newest).
// Its `get()` hands out the queued pictures first, then rejects with a
// `RemoteError` once the browser is closed or the watcher itself is.
//
// ## Doubles for CamoufoxSession and CamoufoxBackend
//
//   FakeSessionContext      a persistent context (EventEmitter): `pages()`,
//                           `openPage()`, `die()` (the browser exits: its pages
//                           close, then the context says "close") and a `close()`
//                           that does what `closeBehaviour` says: 'closes' (the
//                           default), 'hangs' or 'fails'; `closeCalls`
//   FakeSessionPage         its pages; `close()` is the user closing the tab
//   FakeRemoteLifecycle     a `FakeRemote` that also has what a session winds up
//                           (`restore`, `forgetLayout`, `freeze`, `aclose`); `calls`
//                           lists them in order ("restore <urls> <active>",
//                           "freeze flush=<bool>", "forgetLayout", "aclose"),
//                           `restoreError` and `acloseError` make them fail
//
// ## Helpers
//
//   Gate                    a latch: `await gate.wait()` returns once somebody
//                           called `gate.open()` (and at once while it is open)
//   fakeLaunchSpec(...)     a complete `LaunchSpec`, with overrides
//   fakeIdentity(...), fakeGeneratedIdentity(...), fakeLocation(...)
//   NEW_YORK                the default `GeoInfo`
//   fakeJpeg(label)         the bytes "jpeg-<label>"
//
// Tests may replace a method of a fake to hold something up (`vi.spyOn`).

import { EventEmitter } from 'node:events';

import type {
  BrowserBackend,
  BrowserHandle,
  BrowserInstall,
  LaunchSpec,
} from '../domains/browser/backend.ts';
import type {
  RemoteLifecycle,
  SessionContext,
  SessionPage,
} from '../domains/browser/camoufox-session.ts';
import { RemoteError } from '../domains/browser/remote.ts';
import type {
  Frame,
  HistoryAction,
  KeyAction,
  MouseAction,
  MouseButton,
  Navigation,
  PageDialog,
  PageReading,
  Remote,
  RemoteEvent,
  SelectMenu,
  SelectOption,
  Tab,
  Watcher,
} from '../domains/browser/remote.ts';
import { IdentityError, identitySchema } from '../domains/identity/types.ts';
import type {
  GeneratedIdentity,
  GeoInfo,
  GeoLookupError,
  Identity,
  IdentityOs,
  Location,
  Summary,
} from '../domains/identity/types.ts';
import {
  DEFAULT_START_PAGE,
  EMPTY_LAYOUT,
  restorableUrl,
} from '../lib/web-url.ts';
import type { TabLayout } from '../lib/web-url.ts';

export const NEW_YORK: GeoInfo = {
  country: 'US',
  locale: 'en-US',
  timezone: 'America/New_York',
  latitude: 40.71,
  longitude: -74.0,
};

const encoder = new TextEncoder();

/** The bytes of a fake JPEG: the text "jpeg-<label>". */
export function fakeJpeg(label: string | number): Uint8Array {
  return encoder.encode(`jpeg-${label}`);
}

// -- helpers ------------------------------------------------------------------

/** A latch: `wait()` returns once the gate is open, and at once while it is. */
export class Gate {
  #isOpen = false;
  #waiting: (() => void)[] = [];

  get isOpen(): boolean {
    return this.#isOpen;
  }

  open(): void {
    this.#isOpen = true;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const resolve of waiting) resolve();
  }

  /** Closes the gate again: the next `wait()` waits. */
  reset(): void {
    this.#isOpen = false;
  }

  wait(): Promise<void> {
    if (this.#isOpen) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }
}

/** Wakes everybody who waits for the next change. */
class Changes {
  #waiting: (() => void)[] = [];

  next(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  notify(): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const resolve of waiting) resolve();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isIdentityOs(value: string): value is IdentityOs {
  return value === 'windows' || value === 'macos' || value === 'linux';
}

// -- identities, locations, launch specs --------------------------------------

/** The nth fake identity: unique, and the same for the same arguments. */
export function fakeIdentity(os: IdentityOs = 'windows', n = 1): Identity {
  // The schema takes any record as the fingerprint, as the old fake did.
  return identitySchema.parse({
    schema: 1,
    os,
    fingerprint: { n },
    pinned: {},
    webgl: ['Fake Vendor', 'Fake GPU'],
    maxScreen: [1920, 1080],
    locale: null,
  });
}

export function fakeGeneratedIdentity(
  os: IdentityOs = 'windows',
  n = 1,
): GeneratedIdentity {
  const summary: Summary = {
    userAgent: `FakeAgent/${n}`,
    platform: 'Win32',
    screen: '1920x1080',
    gpu: 'Fake GPU',
  };
  return {
    identity: fakeIdentity(os, n),
    visibleSignature: `visible-${n}`,
    fullSignature: `full-${n}`,
    summary,
  };
}

/** Where a session started with `ip` says it is: New York, unless overridden. */
export function fakeLocation(
  ip = '203.0.113.1',
  overrides: Partial<Location> = {},
): Location {
  return {
    ip,
    country: NEW_YORK.country,
    timezone: NEW_YORK.timezone,
    latitude: NEW_YORK.latitude,
    longitude: NEW_YORK.longitude,
    ...overrides,
  };
}

/** A complete `LaunchSpec` (no tabs to reopen), with overrides. */
export function fakeLaunchSpec(
  overrides: Partial<LaunchSpec> = {},
): LaunchSpec {
  return {
    profileDir: '/tmp/session-manager-fake-profile',
    name: '0001',
    identity: fakeIdentity(),
    proxy: { server: 'http://192.0.2.1:8080' },
    location: fakeLocation(),
    tabs: EMPTY_LAYOUT,
    startPage: DEFAULT_START_PAGE,
    ...overrides,
  };
}

// -- the remote -----------------------------------------------------------------

/** The input a `FakeRemote` got, as it logs it in `events`. */
export type FakeInput =
  | readonly ['goto', url: string, tab: number | null, wait: Navigation]
  | readonly ['history', action: HistoryAction, tab: number | null]
  | readonly [
      'mouse',
      action: MouseAction,
      x: number,
      y: number,
      button: MouseButton,
      clicks: number,
    ]
  | readonly ['wheel', x: number, y: number, dx: number, dy: number]
  | readonly ['scroll', dx: number, dy: number]
  | readonly ['scroll', dx: number, dy: number, x: number, y: number]
  | readonly [
      'clickAt',
      x: number,
      y: number,
      button: MouseButton,
      count: number,
    ]
  | readonly ['hover', x: number, y: number]
  | readonly ['drag', x1: number, y1: number, x2: number, y2: number]
  | readonly ['key', action: KeyAction, key: string]
  | readonly ['text', text: string]
  | readonly ['pick', token: number, index: number | null]
  | readonly ['answer', dialogId: number, accept: boolean, text: string | null]
  | readonly ['clickElement', ref: number]
  | readonly ['fillElement', ref: number, text: string, submit: boolean];

class FakeWatcher implements Watcher {
  readonly #remote: FakeRemote;
  readonly #onClose: () => void;
  readonly #frames: Frame[] = [];
  #getters: {
    resolve: (frame: Frame) => void;
    reject: (error: RemoteError) => void;
  }[] = [];
  #closed = false;

  constructor(remote: FakeRemote, onClose: () => void) {
    this.#remote = remote;
    this.#onClose = onClose;
  }

  push(frame: Frame): void {
    if (this.#closed) return;
    const getter = this.#getters.shift();
    if (getter === undefined) this.#frames.push(frame);
    else getter.resolve(frame);
  }

  get(): Promise<Frame> {
    if (this.#closed) {
      return Promise.reject(new RemoteError('The watcher is closed.'));
    }
    const frame = this.#frames.shift();
    if (frame !== undefined) return Promise.resolve(frame);
    if (this.#remote.closed) {
      return Promise.reject(new RemoteError('The browser has closed.'));
    }
    return new Promise<Frame>((resolve, reject) => {
      this.#getters.push({ resolve, reject });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onClose();
    this.#failGetters('The watcher is closed.');
  }

  /** The remote calls this once the browser is gone. */
  browserClosed(): void {
    this.#failGetters('The browser has closed.');
  }

  #failGetters(message: string): void {
    const getters = this.#getters;
    this.#getters = [];
    for (const getter of getters) getter.reject(new RemoteError(message));
  }
}

export class FakeRemote implements Remote {
  readonly startPage: string;
  readonly onLayout: ((layout: TabLayout) => void) | undefined;
  readonly onEmpty: () => void;
  readonly events: FakeInput[] = [];
  selection = '';
  readonly watchers: FakeWatcher[] = [];
  readonly listeners: ((event: RemoteEvent) => void)[] = [];
  /** The milliseconds of every `attend()`. */
  readonly attended: number[] = [];
  /** The dialogs that wait for an answer. */
  readonly pending: PageDialog[] = [];
  /** `[kind, message]`: the next click opens this dialog and waits for its answer. */
  dialogOnClick: readonly [kind: string, message: string] | null = null;
  /** Why the page shows as not loaded. */
  problem: string | null = null;
  /** The bytes of a picture: `jpeg-<n>` unless a test wants a picture a real browser can draw. */
  pictureOf: (n: number, tab: number) => Uint8Array = (n) => fakeJpeg(n);

  readonly #urls = new Map<number, string>();
  readonly #dialogChanged = new Changes();
  #active: number | null = null;
  #lastId = 0;
  #lastDialogId = 0;
  #lastMenuToken = 0;
  #lastPicture = 0;
  #closed = false;

  constructor(spec: LaunchSpec, onEmpty: () => void = () => {}) {
    this.startPage = spec.startPage;
    this.onLayout = spec.onLayout;
    this.onEmpty = onEmpty;
    const reopened = spec.tabs.urls.length > 0;
    for (const url of reopened ? spec.tabs.urls : [spec.startPage]) {
      this.#add(url);
    }
    if (reopened) {
      this.#active = [...this.#urls.keys()][spec.tabs.active] ?? this.#active;
    }
    this.#save(); // the real browser reports its tabs as soon as they have loaded
  }

  get closed(): boolean {
    return this.#closed;
  }

  #add(url: string): number {
    this.#lastId += 1;
    this.#urls.set(this.#lastId, url);
    this.#active = this.#lastId;
    return this.#lastId;
  }

  #save(): void {
    if (this.onLayout === undefined || this.#closed) return;
    const urls: string[] = [];
    let active = 0;
    for (const [id, url] of this.#urls) {
      const restorable = restorableUrl(url);
      if (restorable === null) continue;
      if (id === this.#active) active = urls.length;
      urls.push(restorable);
    }
    if (urls.length > 0) this.onLayout({ urls, active });
  }

  #changed(): void {
    this.#save();
    this.emit({ type: 'tabs', tabs: this.tabs() });
    // What the watchers look at changed (another tab, another page): they get a picture of it, as a real screencast sends one. Nobody watching: no picture is drawn, so that the numbering of the next one stays.
    if (this.watchers.length > 0) this.showNewPicture();
  }

  #require(tab: number | null | undefined): number {
    const target = tab ?? this.#active;
    if (target === null || !this.#urls.has(target)) {
      throw new RemoteError('There is no such tab.', 'tab_gone');
    }
    return target;
  }

  // -- tabs -----------------------------------------------------------------

  #tab(id: number, url: string): Tab {
    return {
      id,
      url,
      title: `Title of ${url}`,
      loading: false,
      active: id === this.#active,
    };
  }

  tabs(): readonly Tab[] {
    return [...this.#urls].map(([id, url]) => this.#tab(id, url));
  }

  async listTabs(): Promise<readonly Tab[]> {
    return this.tabs();
  }

  async openTab(url?: string | null): Promise<Tab> {
    const target = url || this.startPage;
    const id = this.#add(target);
    this.#changed();
    return this.#tab(id, target);
  }

  async closeTab(tab: number): Promise<void> {
    this.#require(tab);
    this.#urls.delete(tab);
    if (this.#urls.size === 0) {
      // The user closed the last tab: the session ends and forgets its tabs.
      this.onLayout?.(EMPTY_LAYOUT);
      this.onEmpty();
      return;
    }
    if (tab === this.#active) {
      this.#active = [...this.#urls.keys()].at(-1) ?? null;
    }
    this.#changed();
  }

  /** The user closes every tab, one by one. */
  async closeAllTabs(): Promise<void> {
    for (const tab of this.tabs()) await this.closeTab(tab.id);
  }

  async activateTab(tab: number): Promise<void> {
    this.#require(tab);
    this.#active = tab;
    this.#changed();
  }

  async goto(
    url: string,
    tab?: number | null,
    wait: Navigation = 'commit',
  ): Promise<void> {
    const target = this.#require(tab);
    this.events.push(['goto', url, tab ?? null, wait]);
    this.#urls.set(target, url);
    this.#changed();
  }

  async history(action: HistoryAction, tab?: number | null): Promise<void> {
    this.events.push(['history', action, tab ?? null]);
  }

  // -- events -----------------------------------------------------------------

  subscribe(listener: (event: RemoteEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  emit(event: RemoteEvent): void {
    // A listener may unsubscribe while it is called.
    for (const listener of this.listeners.slice()) listener(event);
  }

  attend(ms: number): void {
    this.attended.push(ms);
  }

  // -- dialogs and drop-down lists --------------------------------------------

  dialogs(): readonly PageDialog[] {
    return [...this.pending];
  }

  /** A page opens a dialog: it waits in `pending` until somebody answers it. */
  openDialog(
    kind = 'confirm',
    message = 'Sure?',
    defaultValue = '',
  ): PageDialog {
    this.#lastDialogId += 1;
    const dialog: PageDialog = {
      id: this.#lastDialogId,
      tab: this.#active ?? 0,
      kind,
      message,
      default: defaultValue,
    };
    this.pending.push(dialog);
    this.#dialogChanged.notify();
    this.emit({ type: 'dialog', dialog });
    return dialog;
  }

  /** A page opens a drop-down list (a `select` event). */
  openSelect(overrides: Partial<SelectMenu> = {}): SelectMenu {
    this.#lastMenuToken += 1;
    const options: readonly SelectOption[] = [
      { label: 'First', selected: true, disabled: false, group: null },
      { label: 'Second', selected: false, disabled: false, group: null },
    ];
    const menu: SelectMenu = {
      token: this.#lastMenuToken,
      x: 10,
      y: 20,
      width: 120,
      height: 24,
      options,
      ...overrides,
    };
    this.emit({ type: 'select', menu });
    return menu;
  }

  async waitForDialog(timeoutMs: number): Promise<PageDialog | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      while (this.pending.length === 0 && !this.#closed) {
        const outcome = await Promise.race([
          this.#dialogChanged.next().then(() => 'changed' as const),
          timedOut,
        ]);
        if (outcome === 'timeout') break;
      }
    } finally {
      clearTimeout(timer);
    }
    return this.pending[0] ?? null;
  }

  /** A click that makes the page open a dialog does not return before the dialog is answered. */
  async #blockedByClickDialog(): Promise<void> {
    const planned = this.dialogOnClick;
    if (planned === null) return;
    this.dialogOnClick = null;
    const dialog = this.openDialog(planned[0], planned[1]);
    while (this.pending.includes(dialog)) {
      if (this.#closed) throw new RemoteError('The browser has closed.');
      await this.#dialogChanged.next();
    }
  }

  async answerDialog(
    dialogId: number,
    options: { accept: boolean; text?: string | null },
  ): Promise<void> {
    this.events.push([
      'answer',
      dialogId,
      options.accept,
      options.text ?? null,
    ]);
    const index = this.pending.findIndex((dialog) => dialog.id === dialogId);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.emit({ type: 'dialog_closed', id: dialogId });
    }
    this.#dialogChanged.notify();
  }

  async pickOption(token: number, index: number | null): Promise<void> {
    this.events.push(['pick', token, index]);
  }

  // -- pictures -----------------------------------------------------------------

  /** The next picture of the active tab. */
  picture(): Frame {
    this.#lastPicture += 1;
    return {
      tab: this.#active ?? 0,
      width: 800,
      height: 600,
      jpeg: this.pictureOf(this.#lastPicture, this.#active ?? 0),
    };
  }

  /** The page changed: every watcher gets a new picture. */
  showNewPicture(): void {
    const frame = this.picture();
    for (const watcher of this.watchers) watcher.push(frame);
  }

  watch(): FakeWatcher {
    const watcher = new FakeWatcher(this, () => {
      const index = this.watchers.indexOf(watcher);
      if (index >= 0) this.watchers.splice(index, 1);
    });
    this.watchers.push(watcher);
    watcher.push(this.picture());
    return watcher;
  }

  async screenshot(_tab?: number | null): Promise<Uint8Array> {
    return fakeJpeg('screenshot');
  }

  // -- input ----------------------------------------------------------------------

  async mouse(
    action: MouseAction,
    x: number,
    y: number,
    options: { button?: MouseButton; clicks?: number } = {},
  ): Promise<void> {
    this.events.push([
      'mouse',
      action,
      x,
      y,
      options.button ?? 'left',
      options.clicks ?? 1,
    ]);
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    this.events.push(['wheel', x, y, dx, dy]);
  }

  async scroll(
    dx: number,
    dy: number,
    x?: number | null,
    y?: number | null,
  ): Promise<void> {
    this.events.push(
      x == null || y == null ? ['scroll', dx, dy] : ['scroll', dx, dy, x, y],
    );
  }

  async clickAt(
    x: number,
    y: number,
    options: { button?: MouseButton; count?: number } = {},
  ): Promise<void> {
    this.events.push([
      'clickAt',
      x,
      y,
      options.button ?? 'left',
      options.count ?? 1,
    ]);
    await this.#blockedByClickDialog();
  }

  async hover(x: number, y: number): Promise<void> {
    this.events.push(['hover', x, y]);
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    this.events.push(['drag', x1, y1, x2, y2]);
  }

  async key(action: KeyAction, key: string): Promise<void> {
    this.events.push(['key', action, key]);
  }

  async insertText(text: string): Promise<void> {
    this.events.push(['text', text]);
  }

  async selectedText(): Promise<string> {
    return this.selection;
  }

  // -- reading a page -------------------------------------------------------------

  async readPage(_tab?: number | null): Promise<PageReading> {
    const url =
      this.#active === null ? '' : (this.#urls.get(this.#active) ?? '');
    return {
      url,
      title: `Title of ${url}`,
      text: 'Fake page text',
      elements: [
        {
          ref: 1,
          role: 'textbox',
          name: 'Email',
          value: '',
          href: null,
          state: null,
          x: 120,
          y: 80,
        },
        {
          ref: 2,
          role: 'button',
          name: 'Go',
          value: null,
          href: null,
          state: null,
          x: 200,
          y: 80,
        },
      ],
      scroll: '0-600 of 600',
      problem: this.problem,
    };
  }

  async clickElement(ref: number): Promise<void> {
    this.events.push(['clickElement', ref]);
    await this.#blockedByClickDialog();
  }

  async fillElement(
    ref: number,
    text: string,
    options: { submit?: boolean } = {},
  ): Promise<void> {
    this.events.push(['fillElement', ref, text, options.submit ?? false]);
  }

  // -- the end ----------------------------------------------------------------------

  /** The browser is gone: listeners hear `closed` (once), watchers fail. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.emit({ type: 'closed' });
    this.listeners.length = 0;
    for (const watcher of this.watchers.slice()) watcher.browserClosed();
    this.#dialogChanged.notify();
  }
}

// -- the browser and its backend ------------------------------------------------

export class FakeBrowser implements BrowserHandle {
  readonly spec: LaunchSpec;
  readonly remote: FakeRemote;
  closeCalls = 0;

  readonly #ended = new Gate();

  constructor(spec: LaunchSpec) {
    this.spec = spec;
    this.remote = new FakeRemote(spec, () => {
      this.#ended.open();
    });
  }

  get closed(): boolean {
    return this.#ended.isOpen;
  }

  async waitClosed(): Promise<void> {
    await this.#ended.wait();
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.remote.close();
    this.#ended.open();
  }

  /** The browser dies (e.g. the user quit it): nobody called `close()`. */
  crash(): void {
    this.remote.close();
    this.#ended.open();
  }

  /** The user closes every tab: the session ends. */
  closeAllTabs(): Promise<void> {
    return this.remote.closeAllTabs();
  }
}

export class FakeBackend implements BrowserBackend {
  browserVersion = '0.0.0-fake';
  installed = true;
  install: BrowserInstall = { installing: false, error: null };
  /** What `warmUp()` does while `installed` is false (see the header). */
  installGate: Gate | null = null;
  installError: string | null = null;
  geo: GeoInfo = NEW_YORK;
  readonly geoByIp = new Map<string, GeoInfo | GeoLookupError>();
  geoFor: ((ip: string) => GeoInfo | Promise<GeoInfo>) | null = null;
  identityError: Error | null = null;
  launchError: Error | null = null;
  /** Launches wait for it to open when set. */
  launchGate: Gate | null = null;
  launchDelayMs = 0;
  /** What every browser it launches draws as a picture; `null`: `jpeg-<n>` bytes. */
  pictureOf: ((n: number, tab: number) => Uint8Array) | null = null;

  readonly launches: FakeBrowser[] = [];
  /** Every launch, failed ones too. */
  readonly attempts: LaunchSpec[] = [];
  /** The IPs the GeoIP database was asked about. */
  readonly lookups: string[] = [];
  readonly identities: GeneratedIdentity[] = [];
  readonly identityRequests: {
    os: string;
    taken: ReadonlySet<string>;
  }[] = [];
  warmUps = 0;
  closeCalls = 0;

  #drawn = 0;

  browserInstalled(): boolean {
    return this.installed;
  }

  browserInstall(): BrowserInstall {
    return this.install;
  }

  async warmUp(): Promise<void> {
    this.warmUps += 1;
    if (this.installed) return;
    this.install = { installing: true, error: null };
    await this.installGate?.wait();
    if (this.installError === null) {
      this.installed = true;
      this.install = { installing: false, error: null };
    } else {
      this.install = { installing: false, error: this.installError };
    }
  }

  async createIdentity(
    os: string,
    taken: ReadonlySet<string>,
  ): Promise<GeneratedIdentity> {
    this.identityRequests.push({ os, taken });
    if (this.identityError !== null) throw this.identityError;
    const target = os === 'random' ? 'windows' : os;
    if (!isIdentityOs(target)) throw new IdentityError(`Unknown OS "${os}".`);
    let n = this.#drawn;
    do {
      n += 1;
    } while (taken.has(`visible-${n}`) || taken.has(`full-${n}`));
    this.#drawn = n;
    const generated = fakeGeneratedIdentity(target, n);
    this.identities.push(generated);
    return generated;
  }

  async lookupGeo(ip: string): Promise<GeoInfo> {
    this.lookups.push(ip);
    if (this.geoFor !== null) return this.geoFor(ip);
    const scripted = this.geoByIp.get(ip);
    if (scripted instanceof Error) throw scripted;
    return scripted ?? this.geo;
  }

  async launch(spec: LaunchSpec): Promise<FakeBrowser> {
    this.attempts.push(spec);
    await this.launchGate?.wait();
    if (this.launchDelayMs > 0) await delay(this.launchDelayMs);
    if (this.launchError !== null) throw this.launchError;
    const browser = new FakeBrowser(spec);
    if (this.pictureOf !== null) browser.remote.pictureOf = this.pictureOf;
    this.launches.push(browser);
    return browser;
  }

  /** The browser launched last. */
  latest(): FakeBrowser {
    const browser = this.launches.at(-1);
    if (browser === undefined) throw new Error('no browser was launched');
    return browser;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

// -- doubles for CamoufoxSession and CamoufoxBackend -----------------------------

/** What `FakeSessionContext.close()` does. */
export type ContextClose = 'closes' | 'hangs' | 'fails';

/** A page of a `FakeSessionContext`. */
class FakeSessionPage extends EventEmitter implements SessionPage {
  readonly #context: FakeSessionContext;

  constructor(context: FakeSessionContext) {
    super();
    this.#context = context;
  }

  /** The user closes the tab. */
  close(): void {
    this.#context.forget(this);
    this.emit('close');
  }
}

/** A persistent context, as a `CamoufoxSession` sees it. */
export class FakeSessionContext extends EventEmitter implements SessionContext {
  /** What `close()` does. */
  closeBehaviour: ContextClose = 'closes';
  closeCalls = 0;
  /** The position `setGeolocation` gave the pages. */
  geolocation: { latitude: number; longitude: number } | null = null;
  /** `setGeolocation` rejects with it. */
  positionError: Error | null = null;

  readonly #pages: FakeSessionPage[] = [];
  #gone = false;

  /** The pages it starts with (Camoufox opens a blank one). */
  constructor(pages = 1) {
    super();
    for (let index = 0; index < pages; index++) {
      this.#pages.push(new FakeSessionPage(this));
    }
  }

  pages(): FakeSessionPage[] {
    return [...this.#pages];
  }

  async setGeolocation(position: {
    latitude: number;
    longitude: number;
  }): Promise<void> {
    if (this.positionError !== null) throw this.positionError;
    this.geolocation = { ...position };
  }

  /** The browser opens a page (it tells the context's "page" listeners). */
  openPage(): FakeSessionPage {
    const page = new FakeSessionPage(this);
    this.#pages.push(page);
    this.emit('page', page);
    return page;
  }

  /** Called by a page that closed. */
  forget(page: FakeSessionPage): void {
    const index = this.#pages.indexOf(page);
    if (index >= 0) this.#pages.splice(index, 1);
  }

  /** The browser exits (quit, crash, kill): its pages close, then the context says so. */
  die(): void {
    if (this.#gone) return;
    this.#gone = true;
    for (const page of this.pages()) page.close();
    this.emit('close');
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeBehaviour === 'hangs') {
      await new Promise<never>(() => {});
    }
    if (this.closeBehaviour === 'fails') throw new Error('Target closed');
    this.die();
  }
}

/** A `FakeRemote` that also has what a `CamoufoxSession` winds up. */
export class FakeRemoteLifecycle extends FakeRemote implements RemoteLifecycle {
  /** The lifecycle calls, in order. */
  readonly calls: string[] = [];
  restoreError: Error | null = null;
  acloseError: Error | null = null;

  constructor(spec: LaunchSpec = fakeLaunchSpec()) {
    super(spec);
  }

  async restore(urls: readonly string[], active = 0): Promise<void> {
    this.calls.push(`restore ${urls.join(',')} ${active}`);
    if (this.restoreError !== null) throw this.restoreError;
  }

  forgetLayout(): void {
    this.calls.push('forgetLayout');
  }

  freeze(options: { flush: boolean }): void {
    this.calls.push(`freeze flush=${options.flush}`);
  }

  async aclose(): Promise<void> {
    this.calls.push('aclose');
    this.close();
    if (this.acloseError !== null) throw this.acloseError;
  }
}
