// Doubles of the parts of Playwright that `PlaywrightRemote` uses: a browser
// context with pages, a mouse, a keyboard, dialogs and element handles. They
// are EventEmitters like the real ones, record every call in one `CallLog`
// and can be told to fail, to take time or to hang (`behave`).
//
// They know nothing about HTML: what a page script finds out is what the test
// put into `page.answers`; a few of them have a default (`viewportSize`,
// `roomOfPage`, `titleAndState`, `selectedText`, `selectAt`, `readPage`). The
// scripts are told apart by their name.

import { EventEmitter } from 'node:events';

import type {
  PageScript,
  PwContext,
  PwDialog,
  PwElement,
  PwFrame,
  PwHandle,
  PwKeyboard,
  PwMouse,
  PwPage,
} from '../domains/browser/playwright-remote.ts';

// -- recording ------------------------------------------------------------------

export interface LoggedCall {
  /** Which object: `page 1`, `page 1.mouse`, `dialog 2`, ... */
  who: string;
  method: string;
  args: readonly unknown[];
  /** `performance.now()`: the faked clock, if there is one. */
  at: number;
}

export class CallLog {
  readonly entries: LoggedCall[] = [];

  record(who: string, method: string, args: readonly unknown[]): void {
    this.entries.push({ who, method, args, at: performance.now() });
  }

  /** The calls of an object (all of them without `who`), optionally of one method. */
  of(who?: string, method?: string): LoggedCall[] {
    return this.entries.filter(
      (call) =>
        (who === undefined || call.who === who) &&
        (method === undefined || call.method === method),
    );
  }

  count(who: string, method: string): number {
    return this.of(who, method).length;
  }

  /** `who.method` of each call, in order. */
  names(who?: string): string[] {
    return this.of(who).map((call) => `${call.who}.${call.method}`);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

// -- scripted behaviour ---------------------------------------------------------

export interface Behaviour {
  /** The call takes this long (on the faked clock, if there is one). */
  delayMs?: number;
  /** The call fails with this (after the delay). */
  error?: Error;
  /** The call never returns. */
  hang?: boolean;
  /** For how many calls; default: all of them. */
  times?: number;
}

interface Rule {
  method: string;
  behaviour: Behaviour;
  remaining: number;
}

/** An error the way Playwright reports a failed call. */
export function playwrightError(message: string): Error {
  return new Error(message);
}

/** The error of an action that took too long. */
export function playwrightTimeout(message: string): Error {
  return Object.assign(new Error(message), { name: 'TimeoutError' });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Records the calls of an object and does what the test said they do. */
class Scripted {
  readonly who: string;
  readonly log: CallLog;
  readonly #rules: Rule[] = [];

  constructor(who: string, log: CallLog) {
    this.who = who;
    this.log = log;
  }

  /** What the next calls of `method` do. The first rule that still applies wins. */
  behave(method: string, behaviour: Behaviour): this {
    this.#rules.push({
      method,
      behaviour,
      remaining: behaviour.times ?? Number.POSITIVE_INFINITY,
    });
    return this;
  }

  /** Forget what was scripted for `method` (for all methods without it). */
  behaveNormally(method?: string): this {
    for (let index = this.#rules.length - 1; index >= 0; index--) {
      if (method === undefined || this.#rules[index]?.method === method) {
        this.#rules.splice(index, 1);
      }
    }
    return this;
  }

  /** Record the call, then do what was scripted for it, then `action`. */
  async run<T>(
    method: string,
    args: readonly unknown[],
    action: () => T | Promise<T>,
  ): Promise<T> {
    this.log.record(this.who, method, args);
    // Nothing a real page does has happened by the time the call returns its promise.
    await Promise.resolve();
    const rule = this.#rules.find(
      (candidate) => candidate.method === method && candidate.remaining > 0,
    );
    if (rule !== undefined) {
      rule.remaining -= 1;
      const { delayMs, error, hang } = rule.behaviour;
      if (delayMs !== undefined) await delay(delayMs);
      if (hang) await new Promise<never>(() => undefined);
      if (error !== undefined) throw error;
    }
    return await action();
  }
}

// -- a JPEG that says how big it is ----------------------------------------------

/**
 * The start of a JPEG with a comment (so that pictures with different `tag`s
 * differ) and a frame header (so that its size can be read). Not a picture.
 */
export function fakeJpeg(
  options: { width?: number; height?: number; tag?: string | number } = {},
): Buffer {
  const { width = 1280, height = 720, tag = 0 } = options;
  const comment = Buffer.from(`tag:${tag}`, 'latin1');
  const commentLength = comment.length + 2;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // start of image
    Buffer.from([0xff, 0xfe, commentLength >> 8, commentLength & 0xff]),
    comment, // a comment
    // a baseline frame: 17 bytes long, 8 bits, the size, three components
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    Buffer.from([height >> 8, height & 0xff, width >> 8, width & 0xff]),
    Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
    Buffer.from([0xff, 0xd9]), // end of image
  ]);
}

// -- handles and elements ---------------------------------------------------------

export interface FakeOption {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  group?: string | null;
}

export interface FakeElementModel {
  tag?: string;
  rect?: { x: number; y: number; width: number; height: number };
  options?: readonly FakeOption[];
}

interface HandleOwner {
  readonly log: CallLog;
  readonly handles: FakeJSHandle[];
}

let handleCount = 0;

function nextHandleName(): string {
  handleCount += 1;
  return `handle ${handleCount}`;
}

export class FakeJSHandle extends Scripted implements PwHandle {
  disposed = false;
  readonly #value: unknown;
  readonly #properties: Map<string, () => FakeJSHandle>;

  /**
   * `properties` make the handle of a property when it is asked for (like
   * Playwright, which makes a new handle every time).
   */
  constructor(
    owner: HandleOwner,
    value?: unknown,
    properties: Record<string, () => FakeJSHandle> = {},
  ) {
    super(nextHandleName(), owner.log);
    this.#value = value;
    this.#properties = new Map(Object.entries(properties));
    owner.handles.push(this);
  }

  asElement(): PwElement | null {
    return null;
  }

  getProperty(name: string): Promise<PwHandle> {
    return this.run('getProperty', [name], () => {
      const property = this.#properties.get(name);
      if (property === undefined) {
        throw new TypeError(`${this.who} has no property "${name}"`);
      }
      return property();
    });
  }

  getProperties(): Promise<Map<string, PwHandle>> {
    return this.run(
      'getProperties',
      [],
      () =>
        new Map<string, PwHandle>(
          [...this.#properties].map(([name, make]) => [name, make()]),
        ),
    );
  }

  jsonValue(): Promise<unknown> {
    return this.run('jsonValue', [], () => this.#value);
  }

  dispose(): Promise<void> {
    return this.run('dispose', [], () => {
      this.disposed = true;
    });
  }
}

function scriptName(script: PageScript): string {
  return typeof script === 'string' ? script : script.name;
}

export class FakeElementHandle extends FakeJSHandle implements PwElement {
  readonly model: Required<FakeElementModel>;
  /** The options chosen with `selectOption`, as asked for. */
  readonly chosen: { index?: number; label?: string }[] = [];
  /** What the field was `fill`ed with. */
  filled: string | null = null;
  /** Answers of `evaluate` by script name; the defaults come from the model. */
  readonly answers = new Map<string, (arg: unknown) => unknown>();

  constructor(owner: HandleOwner, model: FakeElementModel = {}) {
    super(owner);
    this.model = {
      tag: model.tag ?? 'DIV',
      rect: model.rect ?? { x: 0, y: 0, width: 100, height: 20 },
      options: model.options ?? [],
    };
  }

  override asElement(): PwElement {
    return this;
  }

  evaluate(script: PageScript, arg?: unknown): Promise<unknown> {
    const name = scriptName(script);
    return this.run('evaluate', [name, arg], () => {
      const answer = this.answers.get(name);
      if (answer !== undefined) return answer(arg);
      const { tag, rect, options } = this.model;
      switch (name) {
        case 'tagName':
          return tag;
        case 'optionLabels':
          return options.map((option) => option.label);
        case 'selectMenu':
          return {
            ...rect,
            options: options.map((option) => ({
              label: option.label,
              selected: option.selected ?? false,
              disabled: option.disabled ?? false,
              group: option.group ?? null,
            })),
          };
        default:
          throw new TypeError(`${this.who} has no answer for "${name}"`);
      }
    });
  }

  click(options?: { timeout?: number }): Promise<void> {
    return this.run('click', [options], () => undefined);
  }

  fill(value: string, options?: { timeout?: number }): Promise<void> {
    return this.run('fill', [value, options], () => {
      this.filled = value;
    });
  }

  press(key: string, options?: { timeout?: number }): Promise<void> {
    return this.run('press', [key, options], () => undefined);
  }

  selectOption(
    values: { index?: number; label?: string },
    options?: { timeout?: number },
  ): Promise<string[]> {
    return this.run('selectOption', [values, options], () => {
      this.chosen.push(values);
      return [];
    });
  }
}

// -- input devices ----------------------------------------------------------------

interface MouseOptions {
  button?: string;
  clickCount?: number;
}

class FakeMouse extends Scripted implements PwMouse {
  move(x: number, y: number, options?: { steps?: number }): Promise<void> {
    return this.run('move', [x, y, options], () => undefined);
  }

  down(options?: MouseOptions): Promise<void> {
    return this.run('down', [options], () => undefined);
  }

  up(options?: MouseOptions): Promise<void> {
    return this.run('up', [options], () => undefined);
  }

  click(x: number, y: number, options?: MouseOptions): Promise<void> {
    return this.run('click', [x, y, options], () => undefined);
  }

  wheel(deltaX: number, deltaY: number): Promise<void> {
    return this.run('wheel', [deltaX, deltaY], () => undefined);
  }
}

const NAMED_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Escape',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/** A key of a US keyboard: a named key or one printable ASCII character. */
function isUsKey(key: string): boolean {
  return NAMED_KEYS.has(key) || /^[ -~]$/.test(key);
}

class FakeKeyboard extends Scripted implements PwKeyboard {
  /** What `insertText` put into the page. */
  readonly inserted: string[] = [];

  down(key: string): Promise<void> {
    return this.run('down', [key], () => {
      this.#require('down', key);
    });
  }

  up(key: string): Promise<void> {
    return this.run('up', [key], () => {
      this.#require('up', key);
    });
  }

  press(key: string): Promise<void> {
    return this.run('press', [key], () => {
      this.#require('press', key);
    });
  }

  insertText(text: string): Promise<void> {
    return this.run('insertText', [text], () => {
      this.inserted.push(text);
    });
  }

  #require(method: string, key: string): void {
    if (!isUsKey(key)) {
      throw playwrightError(
        `keyboard.${method}: Unknown key: "${key}"\nCall log:\n  - key not known`,
      );
    }
  }
}

// -- dialogs ----------------------------------------------------------------------

let dialogCount = 0;

class FakeDialog extends Scripted implements PwDialog {
  /** How it was answered; null while it waits. */
  result: { accepted: boolean; text: string | undefined } | null = null;
  /** Resolves when it was answered. */
  readonly answered: Promise<void>;
  readonly #kind: string;
  readonly #message: string;
  readonly #initial: string;
  #settle: () => void = () => undefined;

  constructor(
    log: CallLog,
    kind: string,
    message: string,
    initial: string,
    onAnswered: () => void,
  ) {
    dialogCount += 1;
    super(`dialog ${dialogCount}`, log);
    this.#kind = kind;
    this.#message = message;
    this.#initial = initial;
    this.answered = new Promise<void>((resolve) => {
      this.#settle = () => {
        resolve();
        onAnswered();
      };
    });
  }

  type(): string {
    return this.#kind;
  }

  message(): string {
    return this.#message;
  }

  defaultValue(): string {
    return this.#initial;
  }

  accept(promptText?: string): Promise<void> {
    return this.run('accept', [promptText], () => {
      this.#answer('accept', true, promptText);
    });
  }

  dismiss(): Promise<void> {
    return this.run('dismiss', [], () => {
      this.#answer('dismiss', false, undefined);
    });
  }

  #answer(method: string, accepted: boolean, text: string | undefined): void {
    if (this.result !== null) {
      throw playwrightError(
        `dialog.${method}: Cannot ${method} dialog which is already handled!`,
      );
    }
    this.result = { accepted, text };
    this.#settle();
  }
}

// -- pages --------------------------------------------------------------------------

class FakeFrame implements PwFrame {
  readonly #page: FakePage;

  constructor(page: FakePage) {
    this.#page = page;
  }

  url(): string {
    return this.#page.currentUrl;
  }
}

/** What `readPage` finds on a page (what the page answers, right or wrong). */
export interface FakeReading {
  items: readonly Record<string, unknown>[];
  /** The elements of the items, in order. */
  elements: readonly FakeElementHandle[];
  text: unknown;
  scroll: unknown;
  /** `document.documentURI` */
  document: unknown;
}

let pageCount = 0;

export class FakePage extends EventEmitter implements PwPage, HandleOwner {
  readonly who: string;
  readonly log: CallLog;
  readonly mouse: FakeMouse;
  readonly keyboard: FakeKeyboard;
  readonly frame: FakeFrame;
  readonly handles: FakeJSHandle[] = [];
  /** The dialogs that wait for an answer. */
  readonly openDialogs = new Set<FakeDialog>();
  /**
   * What page scripts find out, by the name of the script. The defaults:
   * `viewportSize`, `roomOfPage`, `titleAndState` and `selectedText` from the fields below,
   * `selectAt` finds no list, `readPage` reads `reading`.
   */
  readonly answers = new Map<string, (arg: unknown) => unknown>();
  currentUrl = 'about:blank';
  titleText = '';
  readyState = 'complete';
  selection = '';
  viewport = { width: 1280, height: 720 };
  /** What the next screenshot shows. */
  jpeg: Uint8Array = fakeJpeg();
  /** If set, makes the picture of each screenshot (a page that keeps changing). */
  pictures: (() => Uint8Array) | null = null;
  reading: FakeReading = {
    items: [],
    elements: [],
    text: '',
    scroll: '0-720 of 720',
    document: 'about:blank',
  };
  closed = false;
  /** Like a real page: while a dialog waits, the page answers nothing. */
  blockedByDialogs = true;
  readonly #scripted: Scripted;
  readonly #context: FakeContext;
  #dialogsCleared: (() => void)[] = [];

  constructor(context: FakeContext) {
    super();
    pageCount += 1;
    this.who = `page ${pageCount}`;
    this.log = context.log;
    this.#context = context;
    this.#scripted = new Scripted(this.who, context.log);
    this.mouse = new FakeMouse(`${this.who}.mouse`, context.log);
    this.keyboard = new FakeKeyboard(`${this.who}.keyboard`, context.log);
    this.frame = new FakeFrame(this);
  }

  /** What the next calls of `method` do (see `Scripted.behave`). */
  behave(method: string, behaviour: Behaviour): this {
    this.#scripted.behave(method, behaviour);
    return this;
  }

  behaveNormally(method?: string): this {
    this.#scripted.behaveNormally(method);
    return this;
  }

  // -- what happens in the page, for the tests ---------------------------------------

  /** The page moves to another address (like a committed navigation). */
  navigate(url: string): void {
    this.currentUrl = url;
    this.reading = { ...this.reading, document: url };
    this.emit('framenavigated', this.frame);
  }

  /** An address change inside a frame that is not the page's. */
  navigateSubframe(): void {
    this.emit('framenavigated', new FakeFrame(this));
  }

  finishLoad(): void {
    this.emit('load', this);
  }

  /** A dialog opens. */
  openDialog(kind: string, message: string, initial = ''): FakeDialog {
    const dialog = new FakeDialog(this.log, kind, message, initial, () => {
      this.openDialogs.delete(dialog);
      if (this.openDialogs.size === 0) {
        const waiting = this.#dialogsCleared;
        this.#dialogsCleared = [];
        for (const resume of waiting) resume();
      }
    });
    this.openDialogs.add(dialog);
    this.emit('dialog', dialog);
    return dialog;
  }

  /** An element of this page. */
  element(model: FakeElementModel = {}): FakeElementHandle {
    return new FakeElementHandle(this, model);
  }

  /** The handles that were not disposed. */
  liveHandles(): FakeJSHandle[] {
    return this.handles.filter((handle) => !handle.disposed);
  }

  // -- the API of a page ---------------------------------------------------------------

  url(): string {
    return this.currentUrl;
  }

  mainFrame(): FakeFrame {
    return this.frame;
  }

  title(): Promise<string> {
    return this.#answering('title', [], () => this.titleText);
  }

  bringToFront(): Promise<void> {
    return this.#scripted.run('bringToFront', [], () => undefined);
  }

  close(): Promise<void> {
    return this.#scripted.run('close', [], () => {
      if (this.closed) return;
      this.closed = true;
      this.#context.forget(this);
      this.emit('close', this);
    });
  }

  goto(
    url: string,
    options: { waitUntil: string; timeout: number },
  ): Promise<unknown> {
    return this.#scripted.run('goto', [url, options], () => {
      this.navigate(url);
      return null;
    });
  }

  goBack(options: { waitUntil: string; timeout: number }): Promise<unknown> {
    return this.#scripted.run('goBack', [options], () => null);
  }

  goForward(options: { waitUntil: string; timeout: number }): Promise<unknown> {
    return this.#scripted.run('goForward', [options], () => null);
  }

  reload(options: { waitUntil: string; timeout: number }): Promise<unknown> {
    return this.#scripted.run('reload', [options], () => null);
  }

  screenshot(options: Record<string, unknown>): Promise<Uint8Array> {
    return this.#answering('screenshot', [options], () =>
      Buffer.from(this.pictures?.() ?? this.jpeg),
    );
  }

  evaluate(script: PageScript, arg?: unknown): Promise<unknown> {
    const name = scriptName(script);
    return this.#answering('evaluate', [name, arg], () =>
      this.#answer(name, arg),
    );
  }

  evaluateHandle(script: PageScript, arg?: unknown): Promise<PwHandle> {
    const name = scriptName(script);
    return this.#answering('evaluateHandle', [name, arg], () => {
      if (name === 'readPage' && !this.answers.has(name)) {
        return this.#readingHandle();
      }
      const found = this.#answer(name, arg);
      return found instanceof FakeJSHandle
        ? found
        : new FakeJSHandle(this, found);
    });
  }

  #answer(name: string, arg: unknown): unknown {
    const answer = this.answers.get(name);
    if (answer !== undefined) return answer(arg);
    switch (name) {
      case 'viewportSize':
        return [this.viewport.width, this.viewport.height];
      case 'roomOfPage':
        // A window with all the room it reports.
        return [
          this.viewport.width,
          this.viewport.height,
          this.viewport.height,
        ];
      case 'titleAndState':
        return [this.titleText, this.readyState];
      case 'selectedText':
        return this.selection;
      case 'selectAt':
        return null;
      default:
        throw new TypeError(`${this.who} has no answer for "${name}"`);
    }
  }

  #readingHandle(): FakeJSHandle {
    const { items, elements, text, scroll, document } = this.reading;
    return new FakeJSHandle(this, undefined, {
      items: () => new FakeJSHandle(this, items),
      elements: () =>
        new FakeJSHandle(
          this,
          undefined,
          Object.fromEntries(
            elements.map((element, index) => [String(index), () => element]),
          ),
        ),
      text: () => new FakeJSHandle(this, text),
      scroll: () => new FakeJSHandle(this, scroll),
      document: () => new FakeJSHandle(this, document),
    });
  }

  /** A call that waits while a dialog is open, as the real page does. */
  #answering<T>(
    method: string,
    args: readonly unknown[],
    action: () => T,
  ): Promise<T> {
    return this.#scripted.run(method, args, async () => {
      while (this.blockedByDialogs && this.openDialogs.size > 0) {
        await new Promise<void>((resume) => this.#dialogsCleared.push(resume));
      }
      return action();
    });
  }
}

// -- the context ----------------------------------------------------------------------

export interface FakeContextOptions {
  /** How many pages the browser starts with (default 1: Camoufox opens a blank one). */
  pages?: number;
  /**
   * When the context's "page" event is emitted for a page made by `newPage`:
   * before it returns (default), right after, or never (a test emits it).
   */
  pageEvent?: 'before' | 'after' | 'never';
}

export class FakeContext extends EventEmitter implements PwContext {
  readonly log = new CallLog();
  /** Called with every page the context makes after the first ones, before anybody hears of it. */
  onNewPage: ((page: FakePage) => void) | null = null;
  readonly #open: FakePage[] = [];
  readonly #scripted: Scripted;
  readonly #pageEvent: 'before' | 'after' | 'never';

  constructor(options: FakeContextOptions = {}) {
    super();
    this.#scripted = new Scripted('context', this.log);
    this.#pageEvent = options.pageEvent ?? 'before';
    for (let index = 0; index < (options.pages ?? 1); index++) {
      this.#open.push(new FakePage(this));
    }
  }

  /** What the next calls of `method` do (see `Scripted.behave`). */
  behave(method: string, behaviour: Behaviour): this {
    this.#scripted.behave(method, behaviour);
    return this;
  }

  pages(): FakePage[] {
    return [...this.#open];
  }

  newPage(): Promise<FakePage> {
    return this.#scripted.run('newPage', [], () => {
      const page = new FakePage(this);
      this.onNewPage?.(page);
      this.#open.push(page);
      if (this.#pageEvent === 'before') this.emit('page', page);
      else if (this.#pageEvent === 'after') {
        // (a later turn of the event loop: after the caller of newPage went on)
        setTimeout(() => this.emit('page', page), 0);
      }
      return page;
    });
  }

  /** The browser opens a page by itself (a popup, a link that opens a tab). */
  open(url = 'about:blank'): FakePage {
    const page = new FakePage(this);
    page.currentUrl = url;
    this.onNewPage?.(page);
    this.#open.push(page);
    this.emit('page', page);
    return page;
  }

  /** Called by a page that closed. */
  forget(page: FakePage): void {
    const index = this.#open.indexOf(page);
    if (index >= 0) this.#open.splice(index, 1);
  }
}
