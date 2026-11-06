// The real `Remote`: a Camoufox persistent context driven through Playwright.
//
// * The picture is a screenshot of the active tab, taken as often as the page
//   changes and only sent when it did. (Not Playwright's screencast: while a
//   page scrolls, its pictures come two or three times a second and show the
//   page where it was, and a screencast of a still page uses half a core.)
// * Mouse and keyboard events are replayed in the page. Characters that are
//   not on a US keyboard are inserted as text.
// * The browser does mouse events, wheel turns and switches of tabs one after
//   the other, for all its tabs, and waits for the page to take each one. A
//   mouse event is never sent to the first or the last row of the page, which
//   the browser can lose (`pointerPlace`), and one that a page free to take it
//   has not taken in time is not waited for any longer: what comes after it
//   is refused, with the reason, until it is done (`#input`).
// * The browser draws `<select>` lists and dialogs outside the page, where no
//   picture shows them. A click on a `<select>` is therefore reported as a
//   `select` event (the client draws the list), and `alert()`, `confirm()`
//   and `prompt()` as `dialog` events.
//
// Durations are milliseconds. Set the environment variable
// `DEBUG=session-manager` to see what is ignored on purpose (a page that
// closes while it is being looked at, say).

import { z } from 'zod';

import { debugLog } from '../../lib/debug.ts';
import { firstLine } from '../../lib/error-text.ts';
import {
  EMPTY_LAYOUT,
  queryParam,
  restorableUrl,
  sameLayout,
} from '../../lib/web-url.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import { RemoteError } from './remote.ts';
import type {
  Frame,
  HistoryAction,
  KeyAction,
  MouseAction,
  MouseButton,
  Navigation,
  PageDialog,
  PageElement,
  PageReading,
  Remote,
  RemoteEvent,
  Tab,
  Watcher,
} from './remote.ts';

// -- what is used of Playwright -------------------------------------------------
//
// Playwright's `BrowserContext`, `Page`, `Dialog` and `ElementHandle` are
// assignable to these (the compiler checks it wherever a real context is
// passed in), and `testing/fake-playwright.ts` implements them. Results of the
// page come back as `unknown`: they are checked where they are used.

/** A function that runs in the page, or its source. */
export type PageScript = string | ((...args: never[]) => unknown);

export interface PwHandle {
  asElement(): PwElement | null;
  getProperty(name: string): Promise<PwHandle>;
  getProperties(): Promise<Map<string, PwHandle>>;
  jsonValue(): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface PwElement extends PwHandle {
  evaluate(script: PageScript, arg?: unknown): Promise<unknown>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  selectOption(
    values: { index?: number; label?: string },
    options?: { timeout?: number },
  ): Promise<string[]>;
}

export interface PwFrame {
  url(): string;
}

export interface PwDialog {
  type(): string;
  message(): string;
  defaultValue(): string;
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

interface PwMouseOptions {
  button?: MouseButton;
  clickCount?: number;
}

export interface PwMouse {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>;
  down(options?: PwMouseOptions): Promise<void>;
  up(options?: PwMouseOptions): Promise<void>;
  click(x: number, y: number, options?: PwMouseOptions): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

export interface PwKeyboard {
  down(key: string): Promise<void>;
  up(key: string): Promise<void>;
  press(key: string): Promise<void>;
  insertText(text: string): Promise<void>;
}

interface PwNavigationOptions {
  waitUntil: Navigation;
  timeout: number;
}

/** The part of a page a picture is cut to, in CSS pixels from its top left. */
interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A size in CSS pixels. */
interface Size {
  width: number;
  height: number;
}

/** Where the picture of a page is cut, and whether the page said so or the asking failed (and may be tried again at `at`). */
interface Room {
  clip: Clip | null;
  /** The size of the pictures of the page: the room, or its viewport where it has all of it; null while not known. */
  size: Size | null;
  measured: boolean;
  at: number;
}

export interface PwPage {
  readonly mouse: PwMouse;
  readonly keyboard: PwKeyboard;
  url(): string;
  mainFrame(): PwFrame;
  title(): Promise<string>;
  bringToFront(): Promise<void>;
  close(): Promise<void>;
  goto(url: string, options: PwNavigationOptions): Promise<unknown>;
  goBack(options: PwNavigationOptions): Promise<unknown>;
  goForward(options: PwNavigationOptions): Promise<unknown>;
  reload(options: PwNavigationOptions): Promise<unknown>;
  screenshot(options: {
    type: 'jpeg';
    quality: number;
    scale: 'css';
    caret: 'initial';
    animations: 'allow';
    clip?: Clip;
    timeout: number;
  }): Promise<Uint8Array>;
  evaluate(script: PageScript, arg?: unknown): Promise<unknown>;
  evaluateHandle(script: PageScript, arg?: unknown): Promise<PwHandle>;
  on(event: 'framenavigated', listener: (frame: PwFrame) => void): unknown;
  on(event: 'dialog', listener: (dialog: PwDialog) => void): unknown;
  on(event: 'load', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'framenavigated', listener: (frame: PwFrame) => void): unknown;
  off(event: 'dialog', listener: (dialog: PwDialog) => void): unknown;
  off(event: 'load', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
}

export interface PwContext {
  pages(): PwPage[];
  newPage(): Promise<PwPage>;
  on(event: 'page', listener: (page: PwPage) => void): unknown;
  off(event: 'page', listener: (page: PwPage) => void): unknown;
}

// -- tuning -----------------------------------------------------------------------

const PICTURE_QUALITY = 70;
const SCREENSHOT_QUALITY = 80;
const SHOT_TIMEOUT = 5000;
// What the window has room for is asked of the page once; a page that does not
// answer (its script is busy) holds a picture up no longer than this, and is not
// asked again for a while.
const ROOM_TIMEOUT = 2000;
const ROOM_RETRY = 1000;
// Pictures: back to back (at most every FASTEST) while the page is used
// (ACTIVE_FOR after the last input) or keeps changing; otherwise the pause
// grows from IDLE_FLOOR to IDLE_CEILING while nothing changes, and is never
// less than six times the time a picture takes, so that a heavy page is not
// kept busy by being watched.
const ACTIVE_FOR = 1000;
const FASTEST = 20;
const IDLE_FLOOR = 150;
const IDLE_CEILING = 800;
const IDLE_GROWTH = 1.25;
const IDLE_GROWTH_STEPS = 8;
const PICTURE_COST_FACTOR = 6;
/** What a picture "took" while there is nothing to take one of. */
const NOTHING_TO_SHOOT = 250;
const PICTURE_RETRY = 1000;
const NAVIGATION_TIMEOUT = 30_000;
// A page that waits for an answer to alert() or confirm() answers nothing else.
const RESPONSE_TIMEOUT = 15_000;
// A mouse event, a turn of the wheel or a tab coming to the front that the
// browser has not done in this time is stuck, unless its page is not free: a
// dialog waits for an answer (the click that opened it returns once it is
// answered), or a script keeps the page busy (the page does not answer within
// FREE_TIMEOUT). A page that stays busy for BUSY_GIVE_UP is given up as well.
const INPUT_TIMEOUT = 5000;
const FREE_TIMEOUT = 1000;
const BUSY_GIVE_UP = 60_000;
// How long a start waits for its pages to begin loading (a slow proxy does not
// hold it up longer).
const RESTORE_WAIT = 5000;
const DIALOG_TIMEOUT = 120_000;
const TITLE_POLL = 1500;
// A page that waits for an answer to alert() does not hold up the titles of
// the others.
const TITLE_TIMEOUT = 2000;
const SAVE_RETRY = 5000;
const TEXT_LIMIT = 6000;
const ELEMENT_LIMIT = 80;
const READ_ATTEMPTS = 3;
const READ_RETRY_PAUSE = 400;
const ELEMENT_TIMEOUT = 5000;
const PICK_TIMEOUT = 3000;
const DRAG_STEPS = 12;
const LISTED_OPTIONS = 20;
const FALLBACK_VIEWPORT = { width: 1280, height: 720 };

const NOT_RESPONDING =
  'The page does not respond. A dialog (alert, confirm) may be waiting for an answer.';
const INPUT_STUCK =
  'The browser has stopped taking the mouse, in every tab: it still waits for a page to take an earlier mouse event. Restart the session to use the mouse again.';
/** What ends a line: the usual breaks plus U+001C-U+001E, U+0085, U+2028 and U+2029. */
const LINE_BREAK = /\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/;

// -- scripts that run in the page -------------------------------------------------
//
// Playwright sends the source text of these functions to the browser, so they
// use nothing of this module: no imports, constants or helpers. The fake page
// of the tests tells them apart by name.

/** The things on a page that `readPage` looks at; the members only some have. */
interface Control extends Element {
  alt?: string;
  checked?: boolean;
  disabled?: boolean;
  href?: unknown;
  innerText?: string;
  labels?: NodeListOf<HTMLLabelElement> | null;
  placeholder?: string;
  title?: string;
  value?: unknown;
}

interface TextField extends Element {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  value?: string;
}

/** The drop-down list (one choice, not disabled) at a place, or null. */
function selectAt([x, y]: readonly [number, number]): HTMLSelectElement | null {
  const element = document.elementFromPoint(x, y);
  const select = element && element.closest ? element.closest('select') : null;
  return select && !select.multiple && select.size <= 1 && !select.disabled
    ? select
    : null;
}

function selectMenu(select: HTMLSelectElement) {
  const r = select.getBoundingClientRect();
  return {
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    options: [...select.options].map((o) => {
      const parent:
        | (HTMLElement & { disabled?: boolean; label?: string })
        | null = o.parentElement;
      return {
        label: o.label || o.text,
        selected: o.selected,
        disabled: o.disabled || (parent !== null && parent.disabled === true),
        group:
          parent !== null && parent.tagName === 'OPTGROUP'
            ? (parent.label ?? null)
            : null,
      };
    }),
  };
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map((o) => o.label || o.text);
}

function tagName(element: Element): string {
  return element.tagName;
}

function selectedText(): string {
  const field: TextField | null = document.activeElement;
  const start = field?.selectionStart;
  const end = field?.selectionEnd;
  if (
    field &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    start !== end &&
    typeof field.value === 'string'
  ) {
    return field.value.slice(start, end);
  }
  return String(window.getSelection());
}

function viewportSize(): number[] {
  return [window.innerWidth, window.innerHeight];
}

// What a page answers at once, unless a script keeps it busy.
function pageIsFree(): boolean {
  return true;
}

// The viewport the window reports and the height the page can really use. A
// browser pinned to the size of a fingerprint reports that size, and a headless
// window on macOS keeps the room of a toolbar it does not draw (51 px), so the
// page has less than it says.
function roomOfPage(): number[] {
  const view = window.visualViewport;
  return [
    window.innerWidth,
    window.innerHeight,
    view === null ? window.innerHeight : view.height,
  ];
}

function titleAndState(): string[] {
  return [document.title, document.readyState];
}

// Reads what is in view: the text, and what can be clicked or typed into. It
// returns the elements themselves too, so that they can be used later without
// marking anything in the page (a page could see such marks).
function readPage(limit: number) {
  const usable =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link],' +
    ' [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [contenteditable=""],' +
    ' [contenteditable=true], [onclick]';
  const view = { width: window.innerWidth, height: window.innerHeight };
  // Only text: an <li value=3> has a number there.
  const clean = (s: unknown) =>
    (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const elements: Control[] = [];
  const items: {
    role: string;
    name: string;
    value: string | null;
    href: string | null;
    state: string | null;
    x: number;
    y: number;
  }[] = [];
  for (const element of document.querySelectorAll<Control>(usable)) {
    if (items.length >= limit) break;
    const r = element.getBoundingClientRect();
    const outside =
      r.bottom < 0 || r.right < 0 || r.top > view.height || r.left > view.width;
    if (r.width < 2 || r.height < 2 || outside) continue;
    const style = getComputedStyle(element);
    if (
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      style.opacity === '0'
    ) {
      continue;
    }
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    const label =
      element.labels && element.labels[0] ? element.labels[0].innerText : '';
    const name = clean(
      element.getAttribute('aria-label') ||
        label ||
        element.innerText ||
        element.alt ||
        element.placeholder ||
        element.title ||
        element.value,
    );
    const role =
      element.getAttribute('role') ||
      (tag === 'a'
        ? 'link'
        : tag === 'select'
          ? 'select'
          : tag === 'textarea'
            ? 'textbox'
            : tag === 'input'
              ? ['checkbox', 'radio', 'submit', 'button'].includes(type)
                ? type === 'submit'
                  ? 'button'
                  : type
                : 'textbox'
              : tag);
    const states: string[] = [];
    if (element.checked) states.push('checked');
    if (element.disabled) states.push('disabled');
    if (type === 'password') states.push('password');
    const typed =
      ['input', 'textarea', 'select'].includes(tag) &&
      type !== 'password' &&
      type !== 'checkbox' &&
      type !== 'radio' &&
      type !== 'submit' &&
      type !== 'button';
    elements.push(element);
    items.push({
      role,
      name,
      value: typed ? clean(element.value) : null,
      // An <a> inside an SVG has an object there.
      href:
        tag === 'a' && typeof element.href === 'string' ? element.href : null,
      state: states.join(', ') || null,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    });
  }
  const scrolled = Math.round(window.scrollY);
  const total = Math.round(document.documentElement.scrollHeight);
  return {
    items,
    elements,
    scroll: `${scrolled}-${scrolled + Math.round(view.height)} of ${total}`,
    text: document.body ? document.body.innerText : '',
    document: document.documentURI,
  };
}

// What comes back from the page is checked, not trusted.
const sizeSchema = z.tuple([z.number(), z.number()]);
const roomSchema = z.tuple([z.number(), z.number(), z.number()]);
const titleStateSchema = z.tuple([z.string(), z.string()]);
const menuSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  options: z.array(
    z.object({
      label: z.string(),
      selected: z.boolean(),
      disabled: z.boolean(),
      group: z.string().nullable(),
    }),
  ),
});
const labelsSchema = z.array(z.string());
const itemsSchema = z.array(
  z.object({
    role: z.string(),
    name: z.string(),
    value: z.string().nullable(),
    href: z.string().nullable(),
    state: z.string().nullable(),
    x: z.number(),
    y: z.number(),
  }),
);

// -- plumbing ---------------------------------------------------------------------

/** What is ignored on purpose, for whoever asks (`DEBUG=session-manager`). */
const debug = debugLog('remote');

/**
 * Playwright rejects with plain `Error`s (`TimeoutError` for its timeouts),
 * never with the `TypeError`s and the like that a bug here would throw: those
 * must not be mistaken for a page that is gone.
 */
export function isPlaywrightError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === 'Error' || error.name === 'TimeoutError')
  );
}

/** A page that is gone or busy is no reason to fail: that is all this ignores. */
async function ignoringPageErrors(
  what: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!isPlaywrightError(error)) throw error;
    debug(`${what}: ${firstLine(error)}`);
  }
}

/** A promise that gave up waiting (the work itself carries on). */
class TimedOut extends Error {
  constructor() {
    super('timed out');
    this.name = 'TimedOut';
  }
}

/** The remote closed while the work was under way. */
class Aborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'Aborted';
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), ms);
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Aborted());
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** A signal that aborts after `ms` (not `AbortSignal.timeout`: that one ignores fake timers). */
function deadline(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  // (setTimeout would take "forever" for "at once")
  const timer = Number.isFinite(ms)
    ? setTimeout(() => controller.abort(), ms)
    : undefined;
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** A flag that can be waited for (like `asyncio.Event`). */
class Flag {
  #isSet = false;
  readonly #waiters = new Set<() => void>();

  get isSet(): boolean {
    return this.#isSet;
  }

  set(): void {
    this.#isSet = true;
    const waiters = [...this.#waiters];
    this.#waiters.clear();
    for (const wake of waiters) wake();
  }

  clear(): void {
    this.#isSet = false;
  }

  /** `true` once the flag is set, `false` if `timeoutMs` pass or `signal` aborts first. */
  wait(
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const { timeoutMs, signal } = options;
    if (this.#isSet) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: boolean): void => {
        this.#waiters.delete(onSet);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onSet = (): void => finish(true);
      const onAbort = (): void => finish(false);
      this.#waiters.add(onSet);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => finish(false), timeoutMs);
      }
    });
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Flag().wait({ timeoutMs: ms, signal });
}

/** Wait for all of them, but at most `ms`: they carry on either way. */
async function settledWithin(
  work: readonly Promise<unknown>[],
  ms: number,
): Promise<void> {
  const stop = new AbortController();
  await Promise.race([Promise.allSettled(work), sleep(ms, stop.signal)]);
  stop.abort();
}

const now = (): number => performance.now();

const CHARACTERS = new Intl.Segmenter();

/** One character as a person sees it ("€", "e\u0301", an emoji), not a key's name. */
function isSingleCharacter(key: string): boolean {
  return [...CHARACTERS.segment(key)].length === 1;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return (
    a.length === b.length &&
    Buffer.from(a.buffer, a.byteOffset, a.length).equals(b)
  );
}

// -- small pure helpers -------------------------------------------------------------

/** Width and height of a JPEG, from its start-of-frame marker. */
export function jpegSize(
  data: Uint8Array,
): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = data[i + 1] ?? 0;
    // A frame header.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        width: ((data[i + 7] ?? 0) << 8) | (data[i + 8] ?? 0),
        height: ((data[i + 5] ?? 0) << 8) | (data[i + 6] ?? 0),
      };
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      i += 2; // markers without a length
    } else {
      i += 2 + (((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0));
    }
  }
  return null;
}

/**
 * Where a mouse event is sent: the place it is asked for, in the picture of
 * the page (`size`; null while it is not known) and off its first and last
 * row. Camoufox rounds the place to a whole pixel of its window before it
 * looks for what is under it, and the first row of a page can round onto the
 * toolbar above it (with the fingerprint of Windows or of macOS), the last
 * one past its end (with the one of Linux). The page never takes such an
 * event, and the browser, which does every mouse event, wheel turn and switch
 * of tabs only after the one before, in every tab, waits for it until it
 * closes. The next row is one pixel away. A drag that leaves the picture goes
 * on along its edge, where its release still reaches the page.
 */
export function pointerPlace(
  x: number,
  y: number,
  size: Size | null,
): { x: number; y: number } {
  const clamp = (value: number, low: number, high: number): number =>
    Math.min(Math.max(value, low), Math.max(high, low));
  return size === null
    ? { x: Math.max(x, 0), y: Math.max(y, 1) }
    : {
        x: clamp(x, 0, size.width - 1),
        y: clamp(y, 1, size.height - 2),
      };
}

/** How long to rest before the next picture, from what the last ones showed. */
export function pictureDelay(state: {
  usedLately: boolean;
  changedInARow: number;
  stillInARow: number;
  /** How long the last picture took. */
  tookMs: number;
}): number {
  if (state.usedLately || state.changedInARow >= 2) return FASTEST;
  return Math.min(
    IDLE_CEILING,
    Math.max(
      IDLE_FLOOR *
        IDLE_GROWTH ** Math.min(state.stillInARow, IDLE_GROWTH_STEPS),
      PICTURE_COST_FACTOR * state.tookMs,
    ),
  );
}

/**
 * Why the page did not load, for Firefox's error pages (their address says:
 * the error and its description).
 */
function problemOf(url: string): string | null {
  if (!url.startsWith('about:neterror') && !url.startsWith('about:certerror')) {
    return null;
  }
  return (
    queryParam(url, 'd') ||
    queryParam(url, 'e') ||
    'the page could not be loaded'
  );
}

/**
 * What the address bar shows: the page that failed to load, not Firefox's
 * error page; nothing for a blank tab.
 */
function shownUrl(url: string): string {
  return url === 'about:blank' ? '' : (restorableUrl(url) ?? url);
}

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // not half of a character
  return `${text.slice(0, end)}…`;
}

/** A dialog is answered once; one that is gone already is not worth a failure. */
async function answer(
  dialog: PwDialog,
  options: { accept: boolean; text?: string | null },
): Promise<void> {
  await ignoringPageErrors('answer a dialog', () =>
    options.accept
      ? dialog.accept(options.text ?? undefined)
      : dialog.dismiss(),
  );
}

async function disposeAll(handles: Iterable<PwHandle>): Promise<void> {
  await Promise.all(
    [...handles].map((handle) =>
      ignoringPageErrors('release a handle', () => handle.dispose()),
    ),
  );
}

// -- the remote -------------------------------------------------------------------

export interface PlaywrightRemoteOptions {
  /** What a new tab without an address opens. */
  startPage: string;
  /**
   * Told about the tabs worth reopening, shortly after they changed
   * (`saveDelayMs`). A tab closing is reported later (`removalDelayMs`): when
   * the browser dies, its tabs close one by one, and that must not look like
   * the user closing them. The layout is never reported empty (see
   * `forgetLayout`).
   */
  onLayout?: (layout: TabLayout) => void;
  /** Default 500. */
  saveDelayMs?: number;
  /** Default 1500. */
  removalDelayMs?: number;
}

interface TabState {
  readonly id: number;
  readonly page: PwPage;
  url: string;
  title: string;
  loading: boolean;
  /** What it was asked to open: its address while it is still blank. */
  goingTo: string | null;
  /** Where the page last saw the mouse. */
  mouseAt: { x: number; y: number } | null;
  /** Stop listening to the page. */
  detach: () => void;
}

interface PendingDialog {
  dialog: PwDialog;
  info: PageDialog;
  answered: Flag;
}

interface OpenMenu {
  token: number;
  tab: number;
  element: PwElement;
}

interface Subscription {
  listener: (event: RemoteEvent) => void;
}

/** A viewer's feed: only the newest picture is kept. */
class PictureFeed implements Watcher {
  readonly #isClosed: () => boolean;
  readonly #onClose: () => void;
  readonly #ready = new Flag();
  #frame: Frame | null = null;
  #released = false;

  constructor(isClosed: () => boolean, onClose: () => void) {
    this.#isClosed = isClosed;
    this.#onClose = onClose;
  }

  /** A new picture, or (without one) a wake-up that makes `get` notice that the browser is gone. */
  push(frame?: Frame): void {
    if (frame !== undefined) this.#frame = frame;
    this.#ready.set();
  }

  async get(): Promise<Frame> {
    for (;;) {
      const frame = this.#frame;
      if (frame !== null) {
        this.#frame = null;
        return frame;
      }
      if (this.#isClosed()) throw new RemoteError('The browser has closed.');
      // Whoever closes a feed does not wait for its next picture.
      if (this.#released) throw new RemoteError('The picture feed is closed.');
      this.#ready.clear();
      await this.#ready.wait();
    }
  }

  close(): void {
    this.#released = true;
    this.#ready.set();
    this.#onClose();
  }
}

export class PlaywrightRemote implements Remote {
  readonly #context: PwContext;
  readonly #startPage: string;
  readonly #onLayout: ((layout: TabLayout) => void) | undefined;
  readonly #saveDelay: number;
  readonly #removalDelay: number;
  readonly #tabs = new Map<number, TabState>();
  #active: number | null = null;
  #nextTabId = 1;
  readonly #subscriptions = new Set<Subscription>();
  readonly #watchers = new Set<PictureFeed>();
  #pictures: AbortController | null = null;
  /** Something happened that the pictures should show soon. */
  readonly #wake = new Flag();
  #lastInput = Number.NEGATIVE_INFINITY;
  #lastFrame: Frame | null = null;
  /** What each page's window has room for (see `#clipOf`). */
  readonly #rooms = new WeakMap<PwPage, Promise<Room>>();
  /** How long the last picture took. */
  #took = 0;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #saveDue = 0;
  #saved: TabLayout | null = null;
  /** The layout is final: the browser is closing or gone. */
  #frozen = false;
  #closed = false;
  #restoring = false;
  #pollingTitles = false;
  #refreshing = 0;
  /** Aborts when the remote closes: nothing started by it carries on. */
  readonly #closing = new AbortController();
  readonly #tasks = new Set<Promise<void>>();
  readonly #detachContext: () => void;
  #menu: OpenMenu | null = null;
  #nextMenuToken = 1;
  #swallowMouseUp = false;
  readonly #dialogs = new Map<number, PendingDialog>();
  /** A dialog is waiting. */
  readonly #dialogEvent = new Flag();
  #nextDialogId = 1;
  #attendedUntil = Number.NEGATIVE_INFINITY;
  #refs = new Map<number, PwElement>();
  /** Input that the browser has not done long after it was due (see `#input`). */
  readonly #stuckInput = new Set<Promise<unknown>>();

  constructor(context: PwContext, options: PlaywrightRemoteOptions) {
    this.#context = context;
    this.#startPage = options.startPage;
    this.#onLayout = options.onLayout;
    this.#saveDelay = options.saveDelayMs ?? 500;
    this.#removalDelay = options.removalDelayMs ?? 1500;
    const onPage = (page: PwPage): void => {
      this.#guard('a new page', () => this.#tabOf(page));
    };
    context.on('page', onPage);
    this.#detachContext = () => context.off('page', onPage);
    for (const page of context.pages()) this.#tabOf(page);
  }

  get closed(): boolean {
    return this.#closed;
  }

  // -- tabs ---------------------------------------------------------------------

  tabs(): readonly Tab[] {
    return [...this.#tabs.values()].map((tab) => this.#describe(tab));
  }

  /**
   * Open these addresses as the tabs of a new browser (the blank tab it starts
   * with is the first). The pages load in the background; the start only waits
   * a moment for them to begin, so that what is done right after it (a
   * navigation of its own) does not get interrupted by one of them.
   */
  async restore(urls: readonly string[], active = 0): Promise<void> {
    this.#restoring = true;
    const pages: PwPage[] = [];
    try {
      pages.push(this.#context.pages()[0] ?? (await this.#context.newPage()));
      for (let index = 1; index < urls.length; index++) {
        pages.push(await this.#context.newPage());
      }
    } finally {
      this.#restoring = false;
    }
    const opening = urls.flatMap((url, index) => {
      const page = pages[index];
      return page === undefined ? [] : [{ page, url }];
    });
    for (const { page, url } of opening) this.#tabOf(page).goingTo = url;
    const loads = opening.map(({ page, url }) =>
      this.#spawn(() => this.#load(page, url)),
    );
    if (loads.length > 0) await settledWithin(loads, RESTORE_WAIT);
    const target = pages[active];
    if (target !== undefined) await this.activateTab(this.#tabOf(target).id);
  }

  async openTab(url?: string | null): Promise<Tab> {
    let page: PwPage;
    try {
      page = await this.#context.newPage();
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(
        `Could not open a tab: ${firstLine(error)}`,
        'tab_not_opened',
      );
    }
    const tab = this.#tabOf(page);
    const goingTo = url || this.#startPage;
    tab.goingTo = goingTo;
    void this.#spawn(() => this.#load(page, goingTo));
    return { ...this.#describe(tab), active: true };
  }

  async closeTab(tab: number): Promise<void> {
    await ignoringPageErrors('close a tab', () =>
      this.#require(tab).page.close(),
    );
  }

  async activateTab(tab: number): Promise<void> {
    const target = this.#require(tab);
    this.#active = target.id;
    await this.#toFront(target);
    this.#changed();
    this.#saveSoon(this.#saveDelay);
    this.#lastFrame = null; // the next picture is of this tab, whatever the last one was
    this.#poke();
  }

  async goto(
    url: string,
    tab?: number | null,
    wait: Navigation = 'commit',
  ): Promise<void> {
    const target = this.#require(tab);
    target.goingTo = url;
    this.#poke();
    try {
      await target.page.goto(url, {
        waitUntil: wait,
        timeout: NAVIGATION_TIMEOUT,
      });
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(`Could not open ${url}: ${firstLine(error)}`);
    }
  }

  async history(action: HistoryAction, tab?: number | null): Promise<void> {
    const page = this.#require(tab).page;
    // The browser reloads in the line of the mouse events: behind a stuck one
    // it would wait, and come as a surprise once that is let go of.
    if (action === 'reload') this.#refuseWhileStuck();
    const options: { waitUntil: Navigation; timeout: number } = {
      waitUntil: 'commit',
      timeout: NAVIGATION_TIMEOUT,
    };
    try {
      if (action === 'back') await page.goBack(options);
      else if (action === 'forward') await page.goForward(options);
      else await page.reload(options);
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(`Could not ${action}: ${firstLine(error)}`);
    }
  }

  /** The user closed the last tab: the next start opens the start page. */
  forgetLayout(): void {
    if (this.#frozen) return;
    this.#frozen = true;
    this.#cancelSave();
    this.#report(EMPTY_LAYOUT);
  }

  /** No more changes to the layout: it is reported now (`flush`) or stays as last reported. */
  freeze(options: { flush: boolean }): void {
    if (options.flush) this.#save();
    this.#frozen = true;
    this.#cancelSave(); // also the retry of a flush that failed
  }

  /** The tabs worth reopening, in order, and which of them is active. */
  layout(): TabLayout {
    const urls: string[] = [];
    let active = 0;
    for (const tab of this.#tabs.values()) {
      let url = restorableUrl(tab.url);
      if (url === null && tab.url === 'about:blank' && tab.goingTo) {
        url = restorableUrl(tab.goingTo); // still on its way: stopping now must not lose it
      }
      if (url !== null) {
        if (tab.id === this.#active) active = urls.length;
        urls.push(url);
      }
    }
    return { urls, active };
  }

  #describe(tab: TabState): Tab {
    return {
      id: tab.id,
      url: shownUrl(tab.url),
      title: tab.title,
      loading: tab.loading,
      active: tab.id === this.#active,
    };
  }

  #addPage(page: PwPage): TabState {
    const tab: TabState = {
      id: this.#nextTabId++,
      page,
      url: page.url(),
      title: '',
      loading: false,
      goingTo: null,
      mouseAt: null,
      detach: () => undefined,
    };
    this.#tabs.set(tab.id, tab);
    const onNavigated = (frame: PwFrame): void =>
      this.#guard('a navigation', () => this.#navigated(tab, frame));
    const onLoad = (): void => this.#guard('a load', () => this.#loaded(tab));
    const onClose = (): void =>
      this.#guard('a closed page', () => this.#pageClosed(tab));
    const onDialog = (dialog: PwDialog): void => {
      this.#dialogOpened(tab, dialog).catch((error: unknown) => {
        console.warn('could not handle a dialog', error);
      });
    };
    page.on('framenavigated', onNavigated);
    page.on('load', onLoad);
    page.on('close', onClose);
    page.on('dialog', onDialog);
    tab.detach = () => {
      page.off('framenavigated', onNavigated);
      page.off('load', onLoad);
      page.off('close', onClose);
      page.off('dialog', onDialog);
    };
    if (!this.#restoring) {
      // A new tab, a popup or a link that opens a tab comes to the front.
      this.#active = tab.id;
      void this.#spawn(() => this.#focus(tab));
    }
    this.#changed();
    this.#saveSoon(this.#saveDelay);
    return tab;
  }

  /** The tab of a page (a new one if the context's "page" event has not arrived yet). */
  #tabOf(page: PwPage): TabState {
    for (const tab of this.#tabs.values()) {
      if (tab.page === page) return tab;
    }
    return this.#addPage(page);
  }

  /** The tab, or the active one. */
  #require(tab?: number | null): TabState {
    const id = tab ?? this.#active;
    const found = id === null ? undefined : this.#tabs.get(id);
    if (found === undefined) {
      throw new RemoteError(
        tab === undefined || tab === null
          ? 'No tab is open.'
          : 'There is no such tab.',
        'tab_gone',
      );
    }
    return found;
  }

  #activeTab(): TabState | null {
    return this.#active === null
      ? null
      : (this.#tabs.get(this.#active) ?? null);
  }

  #navigated(tab: TabState, frame: PwFrame): void {
    if (frame !== tab.page.mainFrame()) return;
    tab.url = frame.url();
    tab.loading = true;
    tab.mouseAt = null; // a new page: where its mouse is is not known any more
    this.#changed();
    this.#saveSoon(this.#saveDelay);
    this.#poke();
  }

  #loaded(tab: TabState): void {
    tab.loading = false;
    this.#changed();
    this.#refreshTitlesSoon();
    this.#poke();
  }

  #pageClosed(tab: TabState): void {
    if (!this.#tabs.delete(tab.id)) return;
    tab.detach(); // a page that is gone has nothing more to say, and is not kept alive by us
    if (this.#menu !== null || this.#dialogs.size > 0) {
      void this.#spawn(() => this.#dropPending(tab));
    }
    if (tab.id === this.#active) {
      // The one opened before it, else the first.
      const ids = [...this.#tabs.keys()];
      const before = ids.findLast((id) => id < tab.id);
      this.#active = before ?? ids[0] ?? null;
      if (this.#active !== null) {
        const next = this.#active;
        void this.#spawn(() => this.#activateQuietly(next));
      } else {
        this.#lastFrame = null;
      }
    }
    this.#changed();
    this.#saveSoon(this.#removalDelay);
  }

  async #activateQuietly(tab: number): Promise<void> {
    try {
      await this.activateTab(tab);
    } catch (error) {
      // Closed again before it came to the front.
      if (!(error instanceof RemoteError)) throw error;
    }
  }

  async #focus(tab: TabState): Promise<void> {
    await this.#toFront(tab);
    this.#lastFrame = null;
    this.#poke();
  }

  /**
   * Brings the page of a tab to the front of the browser. The tab is the
   * active one all the same when that fails: its page is gone, or the browser
   * has stopped taking input, which the next mouse event tells.
   */
  async #toFront(tab: TabState): Promise<void> {
    try {
      await this.#input(tab, () => tab.page.bringToFront());
    } catch (error) {
      if (!(error instanceof RemoteError) && !isPlaywrightError(error)) {
        throw error;
      }
      debug(`bring a tab to the front: ${firstLine(error)}`);
    }
  }

  async #load(page: PwPage, url: string): Promise<void> {
    // The page shows its own error ("The proxy server is refusing...").
    await ignoringPageErrors('load a page', () =>
      page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT }),
    );
  }

  // -- what the browser reports ---------------------------------------------------

  subscribe(listener: (event: RemoteEvent) => void): () => void {
    const subscription: Subscription = { listener };
    this.#subscriptions.add(subscription);
    this.#startTitlePolling();
    return () => {
      this.#subscriptions.delete(subscription);
      if (!this.#attended()) {
        // Nobody to answer any more: pages are not kept waiting.
        void this.#spawn(() => this.#dismissDialogs());
      }
    };
  }

  #emit(event: RemoteEvent): void {
    for (const { listener } of Array.from(this.#subscriptions)) {
      try {
        listener(event);
      } catch (error) {
        console.error('a listener of the remote failed', error);
      }
    }
  }

  #changed(): void {
    if (this.#subscriptions.size > 0) {
      this.#emit({ type: 'tabs', tabs: this.tabs() });
    }
  }

  /** Runs a page's event handler: an error in it must not reach Playwright's event loop. */
  #guard(what: string, work: () => unknown): void {
    try {
      work();
    } catch (error) {
      console.error(`could not handle ${what}`, error);
    }
  }

  #startTitlePolling(): void {
    if (this.#pollingTitles) return;
    this.#pollingTitles = true;
    void this.#pollTitles()
      .catch((error: unknown) => {
        console.warn('could not poll the titles', error);
      })
      .finally(() => {
        this.#pollingTitles = false;
      });
  }

  async #pollTitles(): Promise<void> {
    while (this.#subscriptions.size > 0 && !this.#closed) {
      try {
        await this.#refreshTitles();
      } catch (error) {
        // The titles are a nicety: whatever went wrong, try again.
        console.warn('could not refresh the titles', error);
      }
      await sleep(TITLE_POLL, this.#closing.signal);
    }
  }

  #refreshTitlesSoon(): void {
    if (this.#subscriptions.size > 0 && this.#refreshing === 0) {
      void this.#spawn(() => this.#refreshTitles());
    }
  }

  /**
   * The tabs with up to date titles (nothing reports their change, so they are
   * only polled while the session is watched).
   */
  async listTabs(): Promise<readonly Tab[]> {
    await this.#refreshTitles();
    return this.tabs();
  }

  async #refreshTitles(): Promise<void> {
    this.#refreshing += 1;
    let changes: boolean[];
    try {
      changes = await Promise.all(
        [...this.#tabs.values()].map((tab) => this.#refreshTitle(tab)),
      );
    } finally {
      this.#refreshing -= 1;
    }
    if (changes.some(Boolean)) this.#changed();
  }

  /**
   * The title (nothing reports its change) and, for a page that changed its
   * address without loading again (the history API), the end of loading: only
   * a "load" event ends it otherwise. Whether either changed.
   */
  async #refreshTitle(tab: TabState): Promise<boolean> {
    for (const pending of this.#dialogs.values()) {
      if (pending.info.tab === tab.id) return false; // it answers nothing until the dialog is answered
    }
    let answered: unknown;
    try {
      answered = await withTimeout(
        tab.page.evaluate(titleAndState),
        TITLE_TIMEOUT,
      );
    } catch (error) {
      if (isPlaywrightError(error) || error instanceof TimedOut) return false;
      throw error;
    }
    const state = titleStateSchema.safeParse(answered);
    if (!state.success) return false;
    const [title, ready] = state.data;
    let changed = false;
    if (title !== tab.title) {
      tab.title = title;
      changed = true;
    }
    if (tab.loading && ready === 'complete') {
      tab.loading = false;
      changed = true;
    }
    return changed;
  }

  // -- saving the tabs ------------------------------------------------------------

  /**
   * Save once nothing changed for `delayMs`. A save that is due later stays
   * so: a tab that closed is only saved after a while (when the browser dies,
   * its tabs close one by one), whatever else happens meanwhile.
   */
  #saveSoon(delayMs: number): void {
    if (this.#frozen || this.#closed || this.#onLayout === undefined) return;
    const due = now() + delayMs;
    if (this.#saveTimer !== null) {
      if (this.#saveDue > due) return;
      clearTimeout(this.#saveTimer);
    }
    this.#saveDue = due;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#save();
    }, delayMs);
  }

  #cancelSave(): void {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  #save(): void {
    const layout = this.layout();
    if (
      layout.urls.length === 0 ||
      (this.#saved !== null && sameLayout(layout, this.#saved))
    ) {
      return;
    }
    if (this.#report(layout)) this.#saved = layout;
    else this.#saveSoon(SAVE_RETRY);
  }

  /**
   * Hand the tabs to whoever stores them. Storing can fail (a locked
   * database): the browser is not to suffer.
   */
  #report(layout: TabLayout): boolean {
    if (this.#onLayout === undefined) return true;
    try {
      this.#onLayout(layout);
    } catch (error) {
      console.error('could not store the open tabs', error);
      return false;
    }
    return true;
  }

  // -- the picture ----------------------------------------------------------------

  watch(): Watcher {
    const feed: PictureFeed = new PictureFeed(
      () => this.#closed,
      () => {
        this.#watchers.delete(feed);
        if (this.#watchers.size === 0) this.#stopPictures();
      },
    );
    this.#watchers.add(feed);
    if (this.#lastFrame !== null) feed.push(this.#lastFrame); // a still page sends nothing new: show the last picture at once
    if (this.#pictures === null && !this.#closed) {
      const controller = new AbortController();
      this.#pictures = controller;
      void this.#takePictures(controller.signal).catch((error: unknown) => {
        console.error('the pictures stopped', error);
      });
    }
    this.#poke(); // and a new one soon
    return feed;
  }

  #stopPictures(): void {
    this.#pictures?.abort();
    this.#pictures = null;
  }

  /** The page is being used or something changed: pictures come as fast as they can for a while. */
  #poke(): void {
    this.#lastInput = now();
    this.#wake.set();
  }

  /**
   * Pictures of the active tab, for as long as someone watches.
   *
   * How often depends on what the page does: back to back while it is used (or
   * changes all the time: a video, an animation, a page that loads), less and
   * less often while it stays as it is. The pictures that are the same as the
   * one before are not sent.
   */
  async #takePictures(signal: AbortSignal): Promise<void> {
    let changedInARow = 0;
    let stillInARow = 0;
    while (!signal.aborted) {
      let changed: boolean;
      try {
        changed = await this.#takePicture(signal);
      } catch (error) {
        // Whatever it was, the view must not stay without pictures for good.
        if (!signal.aborted) console.error('could not take a picture', error);
        await sleep(PICTURE_RETRY, signal);
        continue;
      }
      if (signal.aborted) return;
      if (changed) {
        changedInARow += 1;
        stillInARow = 0;
      } else {
        changedInARow = 0;
        stillInARow += 1;
      }
      await this.#rest(
        pictureDelay({
          usedLately: now() - this.#lastInput < ACTIVE_FOR,
          changedInARow,
          stillInARow,
          tookMs: this.#took,
        }),
        signal,
      );
    }
  }

  /** One picture of the active tab, sent to the watchers if it is new. Whether it was. */
  async #takePicture(signal: AbortSignal): Promise<boolean> {
    const tab = this.#activeTab();
    if (tab === null || this.#dialogs.size > 0) {
      // Nothing to show, or a page that waits for an answer cannot be drawn.
      this.#took = NOTHING_TO_SHOOT;
      return false;
    }
    const started = now();
    const jpeg = await this.#shoot(tab.page, PICTURE_QUALITY);
    this.#took = now() - started;
    if (
      signal.aborted ||
      jpeg === null ||
      tab.id !== this.#active ||
      !this.#differs(tab, jpeg)
    ) {
      return false;
    }
    const size = jpegSize(jpeg) ?? (await this.#viewport(tab.page));
    if (signal.aborted) return false;
    const frame: Frame = { tab: tab.id, ...size, jpeg };
    this.#lastFrame = frame;
    for (const watcher of this.#watchers) watcher.push(frame);
    return true;
  }

  #differs(tab: TabState, jpeg: Uint8Array): boolean {
    const last = this.#lastFrame;
    return last === null || last.tab !== tab.id || !sameBytes(last.jpeg, jpeg);
  }

  /** Pause, or less if something happens meanwhile. */
  async #rest(ms: number, signal: AbortSignal): Promise<void> {
    if (!this.#wake.isSet) await this.#wake.wait({ timeoutMs: ms, signal });
    this.#wake.clear();
  }

  /**
   * A JPEG of the page's viewport, cut to the room the page has where the
   * window has less than the viewport it reports. The caret is left alone
   * (hiding it changes the page, which it could see).
   */
  async #shoot(page: PwPage, quality: number): Promise<Uint8Array | null> {
    try {
      const clip = await this.#clipOf(page);
      return await page.screenshot({
        type: 'jpeg',
        quality,
        scale: 'css',
        caret: 'initial',
        animations: 'allow',
        ...(clip === null ? {} : { clip }),
        timeout: SHOT_TIMEOUT,
      });
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      // The page is closing or navigating.
      debug(`could not take a picture: ${firstLine(error)}`);
      return null;
    }
  }

  /**
   * Where a picture of the page stops: at the room its window has, when that
   * is less than the viewport the page reports (a picture of the reported size
   * has a black bar where the window has nothing to show); `null` when it has
   * all of it.
   */
  async #clipOf(page: PwPage): Promise<Clip | null> {
    return (await this.#roomOf(page)).clip;
  }

  /**
   * What the window of a page has room for. A window does not change size, so
   * it is asked once for each page (a window of its own may differ), with its
   * first picture or its first mouse event; an answer that did not come is
   * asked for again after a while.
   */
  async #roomOf(page: PwPage): Promise<Room> {
    const known = this.#rooms.get(page);
    if (known !== undefined) {
      const room = await known;
      if (room.measured || now() - room.at < ROOM_RETRY) return room;
    }
    const asked = this.#measureRoom(page);
    this.#rooms.set(page, asked);
    return await asked;
  }

  async #measureRoom(page: PwPage): Promise<Room> {
    try {
      const room = roomSchema.safeParse(
        await withTimeout(page.evaluate(roomOfPage), ROOM_TIMEOUT),
      );
      if (room.success) {
        const [width, reported, usable] = room.data;
        const height = Math.floor(Math.min(reported, usable));
        const cut = height >= 1 && height < Math.floor(reported);
        return {
          clip: cut ? { x: 0, y: 0, width: Math.floor(width), height } : null,
          size: {
            width: Math.floor(width),
            height: cut ? height : Math.floor(reported),
          },
          measured: true,
          at: now(),
        };
      }
    } catch (error) {
      if (!isPlaywrightError(error) && !(error instanceof TimedOut))
        throw error;
    }
    return { clip: null, size: null, measured: false, at: now() };
  }

  async #viewport(page: PwPage): Promise<{ width: number; height: number }> {
    try {
      const size = sizeSchema.safeParse(
        await withTimeout(page.evaluate(viewportSize), RESPONSE_TIMEOUT),
      );
      if (size.success) {
        return {
          width: Math.trunc(size.data[0]),
          height: Math.trunc(size.data[1]),
        };
      }
    } catch (error) {
      if (!isPlaywrightError(error) && !(error instanceof TimedOut))
        throw error;
    }
    return this.#lastFrame === null
      ? FALLBACK_VIEWPORT
      : { width: this.#lastFrame.width, height: this.#lastFrame.height };
  }

  async screenshot(tab?: number | null): Promise<Uint8Array> {
    const picture = await this.#shoot(
      this.#require(tab).page,
      SCREENSHOT_QUALITY,
    );
    if (picture === null) {
      throw new RemoteError(
        'Could not take a screenshot: the page is not ready.',
      );
    }
    return picture;
  }

  // -- input ----------------------------------------------------------------------

  /**
   * Runs input of the tab that the browser does one after the other for all
   * its tabs: a mouse event, a turn of the wheel, a page brought to the front.
   * One that is not done in `INPUT_TIMEOUT` while its page is free is stuck
   * (the browser waits for a page that will not take it), and every one after
   * it would wait behind it, in every tab: they are refused at once, with the
   * reason, until it is done after all. The browser lets go of it only when
   * its page closes. While the page is not free (see `#pageState`) the input is
   * waited for: it is done once the page is free again.
   */
  async #input<T>(tab: TabState, work: () => Promise<T>): Promise<T> {
    this.#refuseWhileStuck();
    const call = work();
    let busySince: number | null = null;
    for (;;) {
      try {
        return await withTimeout(call, INPUT_TIMEOUT);
      } catch (error) {
        if (!(error instanceof TimedOut)) throw error;
      }
      const state = await this.#pageState(tab);
      if (state === 'dialog') {
        busySince = null;
        continue;
      }
      if (state === 'busy') {
        busySince ??= now();
        if (now() - busySince < BUSY_GIVE_UP) continue;
      }
      if (this.#stuckInput.size === 0) {
        console.warn(
          `the browser has stopped taking mouse input: an event was not done ${INPUT_TIMEOUT} ms after its page was free`,
        );
      }
      this.#stuckInput.add(call);
      void this.#unstuckWhenDone(call);
      throw new RemoteError(INPUT_STUCK, 'input_stuck');
    }
  }

  /** Input that would wait behind a stuck event is refused, with the reason. */
  #refuseWhileStuck(): void {
    if (this.#stuckInput.size > 0) {
      throw new RemoteError(INPUT_STUCK, 'input_stuck');
    }
  }

  /**
   * Whether a page can take input now: `dialog` while a dialog of it waits
   * for an answer, `busy` while it does not answer (a script keeps it busy, it
   * navigates or closes), else `free`.
   */
  async #pageState(tab: TabState): Promise<'dialog' | 'busy' | 'free'> {
    for (const pending of this.#dialogs.values()) {
      if (pending.info.tab === tab.id) return 'dialog';
    }
    try {
      await withTimeout(tab.page.evaluate(pageIsFree), FREE_TIMEOUT);
      return 'free';
    } catch (error) {
      if (error instanceof TimedOut || isPlaywrightError(error)) return 'busy';
      throw error;
    }
  }

  /** Input is taken again once the stuck call is done after all. */
  async #unstuckWhenDone(call: Promise<unknown>): Promise<void> {
    try {
      await call;
    } catch (error) {
      debug(`input that was stuck failed: ${firstLine(error)}`);
    } finally {
      this.#stuckInput.delete(call);
    }
  }

  /**
   * Where a mouse event of the tab goes (see `pointerPlace`): in the size of
   * its last picture, the one the viewer aims in, else in the size of the page
   * as measured.
   */
  async #place(
    tab: TabState,
    x: number,
    y: number,
  ): Promise<{ x: number; y: number }> {
    const frame = this.#lastFrame;
    const size =
      frame?.tab === tab.id
        ? { width: frame.width, height: frame.height }
        : (await this.#roomOf(tab.page)).size;
    return pointerPlace(x, y, size);
  }

  /** Move the mouse there, unless it is there already (every call to the browser costs a few milliseconds). */
  async #moveTo(tab: TabState, x: number, y: number): Promise<void> {
    if (tab.mouseAt?.x !== x || tab.mouseAt.y !== y) {
      tab.mouseAt = { x, y };
      try {
        await this.#input(tab, () => tab.page.mouse.move(x, y));
      } catch (error) {
        tab.mouseAt = null; // it is not known where the mouse went
        throw error;
      }
    }
  }

  async mouse(
    action: MouseAction,
    x: number,
    y: number,
    options: { button?: MouseButton; clicks?: number } = {},
  ): Promise<void> {
    const tab = this.#require();
    const button = options.button ?? 'left';
    const clickCount = options.clicks ?? 1;
    this.#poke();
    try {
      const at = await this.#place(tab, x, y);
      if (action === 'move') {
        await this.#moveTo(tab, at.x, at.y);
      } else if (action === 'down') {
        this.#swallowMouseUp = false; // a new press: the release of an earlier one will not come
        if (button === 'left' && (await this.#opensMenu(tab, at.x, at.y))) {
          this.#swallowMouseUp = true;
          return;
        }
        await this.#moveTo(tab, at.x, at.y);
        await this.#input(tab, () =>
          tab.page.mouse.down({ button, clickCount }),
        );
      } else if (this.#swallowMouseUp) {
        this.#swallowMouseUp = false;
      } else {
        await this.#moveTo(tab, at.x, at.y);
        await this.#input(tab, () => tab.page.mouse.up({ button, clickCount }));
      }
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      debug(`mouse input failed: ${firstLine(error)}`);
    }
    this.#poke();
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    const tab = this.#require();
    this.#poke();
    try {
      const at = await this.#place(tab, x, y);
      await this.#moveTo(tab, at.x, at.y);
      await this.#input(tab, () => tab.page.mouse.wheel(dx, dy));
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      debug(`wheel input failed: ${firstLine(error)}`);
    }
    this.#poke();
  }

  async scroll(
    dx: number,
    dy: number,
    x?: number | null,
    y?: number | null,
  ): Promise<void> {
    if (x === undefined || x === null || y === undefined || y === null) {
      const page = this.#require().page;
      let size: [number, number];
      try {
        size = sizeSchema.parse(
          await withTimeout(page.evaluate(viewportSize), RESPONSE_TIMEOUT),
        );
      } catch (error) {
        if (error instanceof TimedOut) throw new RemoteError(NOT_RESPONDING);
        if (!isPlaywrightError(error)) throw error;
        throw new RemoteError(`Could not scroll: ${firstLine(error)}`);
      }
      await this.wheel(size[0] / 2, size[1] / 2, dx, dy);
      return;
    }
    await this.wheel(x, y, dx, dy);
  }

  async clickAt(
    x: number,
    y: number,
    options: { button?: MouseButton; count?: number } = {},
  ): Promise<void> {
    const tab = this.#require();
    const button = options.button ?? 'left';
    this.#poke();
    try {
      const at = await this.#place(tab, x, y);
      const listed =
        button === 'left'
          ? await this.#listOptionsAt(tab.page, at.x, at.y)
          : null;
      if (listed !== null) {
        throw new RemoteError(
          `The place ${x.toFixed(0)}, ${y.toFixed(0)} is a drop-down list (${listed}). Clicking it shows nothing: read the page, then choose with type_text, giving the list's element number and the option.`,
        );
      }
      await this.#moveTo(tab, at.x, at.y);
      await this.#input(tab, () =>
        tab.page.mouse.click(at.x, at.y, {
          button,
          clickCount: options.count ?? 1,
        }),
      );
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(
        `Could not click at ${x.toFixed(0)}, ${y.toFixed(0)}: ${firstLine(error)}`,
      );
    }
    this.#poke();
  }

  async hover(x: number, y: number): Promise<void> {
    const tab = this.#require();
    this.#poke();
    try {
      const at = await this.#place(tab, x, y);
      await this.#moveTo(tab, at.x, at.y);
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(`Could not move the mouse: ${firstLine(error)}`);
    }
    this.#poke();
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const tab = this.#require();
    const mouse = tab.page.mouse;
    this.#poke();
    try {
      const from = await this.#place(tab, x1, y1);
      const to = await this.#place(tab, x2, y2);
      await this.#moveTo(tab, from.x, from.y);
      await this.#input(tab, () => mouse.down());
      // Where the mouse ends up is known only once all the moves are done.
      tab.mouseAt = null;
      try {
        // A drag needs the moves in between.
        await this.#input(tab, () =>
          mouse.move(to.x, to.y, { steps: DRAG_STEPS }),
        );
        tab.mouseAt = to;
      } finally {
        await this.#input(tab, () => mouse.up());
      }
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(`Could not drag: ${firstLine(error)}`);
    }
    this.#poke();
  }

  async key(action: KeyAction, key: string): Promise<void> {
    const keyboard = this.#require().page.keyboard;
    this.#poke();
    try {
      if (action === 'down') await keyboard.down(key);
      else if (action === 'up') await keyboard.up(key);
      else await keyboard.press(key);
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      const unknown = error.message.includes('Unknown key');
      if (unknown && isSingleCharacter(key) && action !== 'up') {
        // A character that is not on a US keyboard ("ü", "€") has no key code.
        await this.insertText(key);
      } else if (unknown && action !== 'press') {
        // A key of the viewer's keyboard that has no counterpart ("Dead", "AltGraph").
        debug(`no counterpart for the key ${key}`);
      } else {
        throw new RemoteError(
          `Could not press ${key}: ${firstLine(error)}`,
          'key_failed',
        );
      }
    }
  }

  async insertText(text: string): Promise<void> {
    this.#poke();
    await ignoringPageErrors('insert text', () =>
      this.#require().page.keyboard.insertText(text),
    );
  }

  async selectedText(): Promise<string> {
    const tab = this.#require();
    try {
      return z
        .string()
        .parse(
          await withTimeout(tab.page.evaluate(selectedText), RESPONSE_TIMEOUT),
        );
    } catch (error) {
      if (isPlaywrightError(error) || error instanceof TimedOut) return '';
      throw error;
    }
  }

  // -- lists and dialogs the browser draws itself -----------------------------------

  /** A click on a <select>: report its options instead of clicking (the browser's own list is invisible). */
  async #opensMenu(tab: TabState, x: number, y: number): Promise<boolean> {
    try {
      return await this.#openMenu(tab, x, y);
    } catch (error) {
      // Looking failed (the page is navigating): the click goes through.
      if (!isPlaywrightError(error)) throw error;
      debug(`could not look for a <select> at ${x}, ${y}: ${firstLine(error)}`);
      return false;
    }
  }

  async #selectAt(
    page: PwPage,
    x: number,
    y: number,
  ): Promise<PwElement | null> {
    const handle = await page.evaluateHandle(selectAt, [x, y]);
    const element = handle.asElement();
    if (element === null) await disposeAll([handle]);
    return element;
  }

  /** The options of the drop-down list there, as a sentence, or null if the place is no such list. */
  async #listOptionsAt(
    page: PwPage,
    x: number,
    y: number,
  ): Promise<string | null> {
    const element = await this.#selectAt(page, x, y);
    if (element === null) return null;
    let labels: string[];
    try {
      labels = labelsSchema.parse(await element.evaluate(optionLabels));
    } finally {
      await disposeAll([element]);
    }
    return `options: ${labels.slice(0, LISTED_OPTIONS).join(', ')}${labels.length > LISTED_OPTIONS ? ', …' : ''}`;
  }

  async #openMenu(tab: TabState, x: number, y: number): Promise<boolean> {
    const element = await this.#selectAt(tab.page, x, y);
    if (element === null) return false;
    await this.#closeMenu();
    let data: z.infer<typeof menuSchema>;
    try {
      data = menuSchema.parse(await element.evaluate(selectMenu));
    } catch (error) {
      await disposeAll([element]);
      throw error;
    }
    const token = this.#nextMenuToken++;
    this.#menu = { token, tab: tab.id, element };
    this.#emit({ type: 'select', menu: { token, ...data } });
    return true;
  }

  async pickOption(token: number, index: number | null): Promise<void> {
    this.#poke();
    const menu = this.#menu;
    if (menu === null || menu.token !== token) return;
    this.#menu = null;
    try {
      if (index !== null) {
        await menu.element.selectOption({ index }, { timeout: PICK_TIMEOUT });
      }
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      debug(`could not choose option ${index}: ${firstLine(error)}`);
    } finally {
      await disposeAll([menu.element]);
    }
  }

  async #closeMenu(): Promise<void> {
    const menu = this.#menu;
    if (menu === null) return;
    this.#menu = null;
    await disposeAll([menu.element]);
  }

  attend(ms: number): void {
    this.#attendedUntil = Math.max(this.#attendedUntil, now() + ms);
  }

  /** Is there somebody to answer a dialog: a viewer, or an AI assistant that is at work in the session? */
  #attended(): boolean {
    return this.#subscriptions.size > 0 || now() < this.#attendedUntil;
  }

  dialogs(): readonly PageDialog[] {
    return [...this.#dialogs.values()].map((pending) => pending.info);
  }

  async waitForDialog(timeoutMs: number): Promise<PageDialog | null> {
    const limit = deadline(timeoutMs);
    const signal = AbortSignal.any([limit.signal, this.#closing.signal]);
    try {
      while (this.#dialogs.size === 0) {
        this.#dialogEvent.clear();
        if (!(await this.#dialogEvent.wait({ signal }))) break;
      }
    } finally {
      limit.cancel();
    }
    return this.dialogs()[0] ?? null;
  }

  /**
   * alert, confirm, prompt: they are shown to somebody who can answer, and the
   * page waits for the answer. Without one (or if nobody answers in time) the
   * dialog is dismissed, as Playwright does by default.
   */
  async #dialogOpened(tab: TabState, dialog: PwDialog): Promise<void> {
    if (!this.#attended()) {
      await answer(dialog, { accept: false });
      return;
    }
    const id = this.#nextDialogId++;
    const info: PageDialog = {
      id,
      tab: tab.id,
      kind: dialog.type(),
      message: dialog.message(),
      default: dialog.defaultValue(),
    };
    const answered = new Flag();
    this.#dialogs.set(id, { dialog, info, answered });
    this.#dialogEvent.set();
    this.#emit({ type: 'dialog', dialog: info });
    const inTime = await answered.wait({
      timeoutMs: DIALOG_TIMEOUT,
      signal: this.#closing.signal,
    });
    if (!inTime && !this.#closed) {
      await this.#finishDialog(id, { accept: false, text: null });
    }
  }

  async answerDialog(
    dialogId: number,
    options: { accept: boolean; text?: string | null },
  ): Promise<void> {
    await this.#finishDialog(dialogId, options);
  }

  async #finishDialog(
    id: number,
    options: { accept: boolean; text?: string | null },
  ): Promise<void> {
    this.#poke();
    const pending = this.#dialogs.get(id);
    if (pending === undefined) return;
    this.#dialogs.delete(id);
    this.#emit({ type: 'dialog_closed', id });
    pending.answered.set();
    await answer(pending.dialog, options);
    this.#poke();
  }

  async #dismissDialogs(): Promise<void> {
    for (const id of Array.from(this.#dialogs.keys())) {
      await this.#finishDialog(id, { accept: false, text: null });
    }
    await this.#closeMenu();
  }

  /** A closed tab's dialogs and list are gone with it. */
  async #dropPending(tab: TabState): Promise<void> {
    for (const [id, pending] of Array.from(this.#dialogs)) {
      if (pending.info.tab !== tab.id) continue;
      this.#dialogs.delete(id);
      pending.answered.set();
      this.#emit({ type: 'dialog_closed', id });
    }
    if (this.#menu?.tab === tab.id) await this.#closeMenu();
  }

  // -- for AI assistants ------------------------------------------------------------

  async readPage(tab?: number | null): Promise<PageReading> {
    const target = this.#require(tab);
    let read: ReadResult | undefined;
    for (let attempt = 1; read === undefined; attempt++) {
      const reading = this.#read(target);
      try {
        read = await withTimeout(reading, RESPONSE_TIMEOUT);
      } catch (error) {
        if (error instanceof TimedOut) {
          // Answered late, the handles it made would never be released.
          void reading
            .then((late) => disposeAll(late.elements.values()))
            .catch((lateError: unknown) => {
              debug(`a late reading failed: ${firstLine(lateError)}`);
            });
          throw new RemoteError(NOT_RESPONDING);
        }
        if (!isPlaywrightError(error)) throw error;
        if (
          attempt < READ_ATTEMPTS &&
          error.message.includes('context was destroyed')
        ) {
          // The page is just navigating (or showing an error page): look again.
          await sleep(READ_RETRY_PAUSE);
          continue;
        }
        throw new RemoteError(`Could not read the page: ${firstLine(error)}`);
      }
    }
    await disposeAll(this.#refs.values());
    this.#refs = read.elements;
    const lines = read.text
      .split(LINE_BREAK)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    return {
      url: shownUrl(target.page.url()),
      title: read.title,
      text: shorten(lines.join('\n'), TEXT_LIMIT),
      elements: read.items.map((item, index): PageElement => ({
        ref: index + 1,
        ...item,
      })),
      scroll: read.scroll,
      problem: problemOf(read.document),
    };
  }

  async #read(target: TabState): Promise<ReadResult> {
    const page = target.page;
    const handle = await page.evaluateHandle(readPage, ELEMENT_LIMIT);
    const elements = new Map<number, PwElement>();
    // Everything that is made here is let go of, but for the elements.
    const spare: PwHandle[] = [handle];
    const property = async (name: string): Promise<PwHandle> => {
      const found = await handle.getProperty(name);
      spare.push(found);
      return found;
    };
    try {
      const items = itemsSchema.parse(
        await (await property('items')).jsonValue(),
      );
      const found = await (await property('elements')).getProperties();
      for (let ref = 1; ref <= items.length; ref++) {
        const child = found.get(String(ref - 1));
        const element = child?.asElement() ?? null;
        if (element !== null) elements.set(ref, element);
        else if (child !== undefined) spare.push(child);
      }
      const text = z.string().parse(await (await property('text')).jsonValue());
      const scroll = z
        .string()
        .parse(await (await property('scroll')).jsonValue());
      const document = z
        .string()
        .parse(await (await property('document')).jsonValue());
      return {
        items,
        elements,
        text,
        scroll,
        document,
        title: await page.title(),
      };
    } catch (error) {
      await disposeAll(elements.values());
      throw error;
    } finally {
      await disposeAll(spare);
    }
  }

  #element(ref: number): PwElement {
    const element = this.#refs.get(ref);
    if (element === undefined) {
      throw new RemoteError(
        `Element ${ref} is unknown: read the page again to get current numbers.`,
      );
    }
    return element;
  }

  async clickElement(ref: number): Promise<void> {
    this.#poke();
    // The click is mouse events too, which would wait behind a stuck one.
    this.#refuseWhileStuck();
    const tab = this.#activeTab();
    if (tab !== null) tab.mouseAt = null; // the click moves the mouse to the element
    try {
      await this.#element(ref).click({ timeout: ELEMENT_TIMEOUT });
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(
        `Could not click element ${ref}: ${firstLine(error)}`,
      );
    }
  }

  async fillElement(
    ref: number,
    text: string,
    options: { submit?: boolean } = {},
  ): Promise<void> {
    const element = this.#element(ref);
    this.#poke();
    try {
      if ((await element.evaluate(tagName)) === 'SELECT') {
        await element.selectOption(
          { label: text },
          { timeout: ELEMENT_TIMEOUT },
        );
        return;
      }
      await element.fill(text, { timeout: ELEMENT_TIMEOUT });
      if (options.submit)
        await element.press('Enter', { timeout: ELEMENT_TIMEOUT });
    } catch (error) {
      if (!isPlaywrightError(error)) throw error;
      throw new RemoteError(
        `Could not type into element ${ref}: ${firstLine(error)}`,
      );
    }
  }

  // -- the end --------------------------------------------------------------------

  /** The browser is closing or gone: stop everything that touches it. */
  async aclose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelSave();
    this.#emit({ type: 'closed' });
    this.#subscriptions.clear();
    for (const watcher of this.#watchers) watcher.push();
    this.#stopPictures();
    this.#closing.abort();
    // Nothing of ours listens to the pages any more: a page that is gone or a
    // dialog that opens now is the browser's business.
    this.#detachContext();
    for (const tab of this.#tabs.values()) tab.detach();
    await Promise.allSettled(this.#tasks);
  }

  /** Runs work in the background; it stops at once when the remote closes. */
  #spawn(work: () => Promise<unknown>): Promise<void> {
    const signal = this.#closing.signal;
    if (signal.aborted) return Promise.resolve();
    const task = abortable(work(), signal).then(
      () => undefined,
      (error: unknown) => {
        if (!(error instanceof Aborted)) {
          console.warn('remote task failed', error);
        }
      },
    );
    this.#tasks.add(task);
    void task.then(() => this.#tasks.delete(task));
    return task;
  }
}

interface ReadResult {
  items: z.infer<typeof itemsSchema>;
  /** By their number (`ref`), those of the items that are elements. */
  elements: Map<number, PwElement>;
  text: string;
  scroll: string;
  document: string;
  title: string;
}
