import {
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { z } from 'zod';

import type { Session } from '../../../lib/api/schemas';
import type { ServerMessage, TabInfo } from '../../../lib/live-view';
import type { BrowserState, Control } from './control';
import { TIMEOUT } from './env';
import { fill, literally, t } from './i18n';
import {
  waitForPictures,
  watchLiveView,
  type LiveViewWatch,
} from './live-view';

/*
  What a spec of the live viewer (`/sessions/:id`) needs besides the shared
  helpers: the viewer's controls found by role and name, where the picture is on
  the screen, what the fake browser was told in typed form (`Fake`), and what the
  fake page's pictures look like. The fake browser (`backend/testing/fake-browser.ts`)
  has a page of 800 x 600 pixels, titles a tab "Title of <url>", draws one
  mock-up per tab in its own colour and sends a new picture whenever the tabs
  change, as a real screencast does.
*/

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  width: number;
  height: number;
}

/** Where a mouse event that never came is: nowhere, so that a comparison with it fails. */
export const NOWHERE: Point = { x: Number.NaN, y: Number.NaN };

/** The fake page's viewport, the pixels that every mouse position is in. */
export const PAGE = { width: 800, height: 600 } as const;

/** How a wheel turns, as `WheelEvent.deltaMode` says it: by pixels, by lines (Firefox) or by pages. */
export const WHEEL = { PIXELS: 0, LINES: 1, PAGES: 2 } as const;

/** What the page counts as a line of a wheel that turns by lines (`LINE_HEIGHT` of `lib/wheel.ts`), in pixels. */
export const LINE_HEIGHT = 16;

/**
 * A message that has one plural of the kind `{count, plural, one {# line}
 * other {# lines}}`, worded for `count` (English has these two forms).
 */
export function plural(message: string, count: number): string {
  return message.replaceAll(
    /\{\w+, plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
    (_whole, one: string, other: string) =>
      (count === 1 ? one : other).replaceAll('#', String(count)),
  );
}

/**
 * A message with an ICU `{name, number}` argument replaced, grouped the way
 * English writes it (`100,000`); `fill()` only knows the simple `{name}`.
 */
export function withNumber(
  message: string,
  name: string,
  value: number,
): string {
  return message.replace(`{${name}, number}`, value.toLocaleString('en-US'));
}

/**
 * How long a browser takes to come up when a spec slows the start (the fake's
 * `launchDelayMs`): long enough to look at the page while the session is
 * "Starting…", short enough not to hold a test up.
 */
export const SLOW_START_MS = 2500;

/** What the fake browser titles a tab. */
export function titleOf(url: string): string {
  return `Title of ${url}`;
}

/** The IP the proxy of a running session exits through, as the API says it: the one the chip of the header shows. */
export function exitIpOf(session: Session): string {
  const ip = session.proxy?.exitIp;
  if (ip === undefined || ip === null) {
    throw new Error(`session ${session.name} has no exit IP yet`);
  }
  return ip;
}

/** The key the platform's shortcuts use (Playwright's `ControlOrMeta`): the page treats both alike. */
export const COMMAND = process.platform === 'darwin' ? 'Meta' : 'Control';

/** The way out of the page to the address bar, as the page spells it in a sentence. */
export const ADDRESS_SHORTCUT = COMMAND === 'Meta' ? 'Command+L' : 'Control+L';

/**
 * A notice of the page (a toast) that says this. The toast is also read out
 * by a live region of its own, which the same words would match.
 */
export function notice(page: Page, text: string | RegExp): Locator {
  return page.getByRole('listitem').filter({ hasText: text });
}

export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox({ timeout: TIMEOUT.VISIBLE });
  if (box === null) throw new Error('the element is not on the screen');
  return box;
}

// -- what the fake browser was told -------------------------------------------------

type Events = BrowserState['events'];

const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const;

const mouseSchema = z.tuple([
  z.literal('mouse'),
  z.enum(['move', 'down', 'up']),
  z.number(),
  z.number(),
  z.enum(MOUSE_BUTTONS),
  z.number(),
]);
const wheelSchema = z.tuple([
  z.literal('wheel'),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
const keySchema = z.tuple([
  z.literal('key'),
  z.enum(['down', 'up', 'press']),
  z.string(),
]);
const textSchema = z.tuple([z.literal('text'), z.string()]);
const gotoSchema = z.tuple([
  z.literal('goto'),
  z.string(),
  z.number().nullable(),
  z.string(),
]);
const historySchema = z.tuple([
  z.literal('history'),
  z.enum(['back', 'forward', 'reload']),
  z.number().nullable(),
]);
const pickSchema = z.tuple([
  z.literal('pick'),
  z.number(),
  z.number().nullable(),
]);
const answerSchema = z.tuple([
  z.literal('answer'),
  z.number(),
  z.boolean(),
  z.string().nullable(),
]);

function only<S extends z.ZodType>(
  events: Events,
  kind: string,
  schema: S,
): z.output<S>[] {
  return events
    .filter(([first]) => first === kind)
    .map((event) => schema.parse(event));
}

export interface MouseRecord extends Point {
  action: 'move' | 'down' | 'up';
  button: (typeof MOUSE_BUTTONS)[number];
  clicks: number;
}

export function mouseOf(events: Events): MouseRecord[] {
  return only(events, 'mouse', mouseSchema).map(
    ([, action, x, y, button, clicks]) => ({ action, x, y, button, clicks }),
  );
}

export interface WheelRecord extends Point {
  dx: number;
  dy: number;
}

export function wheelsOf(events: Events): WheelRecord[] {
  return only(events, 'wheel', wheelSchema).map(([, x, y, dx, dy]) => ({
    x,
    y,
    dx,
    dy,
  }));
}

export interface KeyRecord {
  action: 'down' | 'up' | 'press';
  key: string;
}

export function keysOf(events: Events): KeyRecord[] {
  return only(events, 'key', keySchema).map(([, action, key]) => ({
    action,
    key,
  }));
}

/** The keys as `down Shift`, `up Shift`, … for a readable comparison. */
export function keyTrace(events: Events): string[] {
  return keysOf(events).map(({ action, key }) => `${action} ${key}`);
}

/** The keys whose last event is a press: they are still held down in the page. */
export function heldKeys(events: Events): string[] {
  const last = new Map<string, 'down' | 'up'>();
  for (const { action, key } of keysOf(events)) {
    if (action !== 'press') last.set(key, action);
  }
  return [...last]
    .filter(([, action]) => action === 'down')
    .map(([key]) => key);
}

/** The keys that are down in the page at the moment `key` is pressed (down and up in one go). */
export function heldWhenPressed(events: Events, key: string): string[] {
  const held = new Set<string>();
  for (const record of keysOf(events)) {
    if (record.action === 'press' && record.key === key) return [...held];
    if (record.action === 'down') held.add(record.key);
    else if (record.action === 'up') held.delete(record.key);
  }
  throw new Error(`${key} was never pressed in the page`);
}

export function textsOf(events: Events): string[] {
  return only(events, 'text', textSchema).map(([, text]) => text);
}

/** The addresses the page was sent to, in order. */
export function navigationsOf(events: Events): string[] {
  return only(events, 'goto', gotoSchema).map(([, url]) => url);
}

export function historyOf(events: Events): string[] {
  return only(events, 'history', historySchema).map(([, action]) => action);
}

export interface PickRecord {
  token: number;
  index: number | null;
}

export function picksOf(events: Events): PickRecord[] {
  return only(events, 'pick', pickSchema).map(([, token, index]) => ({
    token,
    index,
  }));
}

export interface AnswerRecord {
  id: number;
  accept: boolean;
  text: string | null;
}

export function answersOf(events: Events): AnswerRecord[] {
  return only(events, 'answer', answerSchema).map(([, id, accept, text]) => ({
    id,
    accept,
    text,
  }));
}

/**
 * The browser the fake backend launched for a session, as the control server
 * tells it: the ground truth of what the viewer's input did.
 */
export class Fake {
  constructor(
    private readonly control: Control,
    readonly name: string,
  ) {}

  state(): Promise<BrowserState> {
    return this.control.browser(this.name);
  }

  async events(): Promise<Events> {
    return (await this.state()).events;
  }

  /** Waits until `ready` is true of what the browser was told, and returns that. */
  async when(
    ready: (events: Events) => boolean,
    message: string,
  ): Promise<Events> {
    let latest: Events = [];
    await expect
      .poll(
        async () => {
          latest = await this.events();
          return ready(latest);
        },
        { timeout: TIMEOUT.VISIBLE, message },
      )
      .toBe(true);
    return latest;
  }
}

// -- where things are on the screen ---------------------------------------------------

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * How far (in pixels of the page) a mouse position may be from where it was
 * aimed: the screen has whole pixels and a picture shown smaller turns each of
 * them into more than one pixel of the page.
 */
export const POINT_TOLERANCE = 2;

export function expectPoint(
  actual: Point,
  expected: Point,
  what: string,
  tolerance = POINT_TOLERANCE,
): void {
  expect(
    distance(actual, expected),
    `${what} is at ${actual.x}, ${actual.y}; it should be near ${expected.x}, ${expected.y}`,
  ).toBeLessThanOrEqual(tolerance);
}

/** A point of the picture: where it is on the screen, and where it is in the fake page. */
export interface Aim {
  screen: Point;
  page: Point;
}

// -- what the picture looks like --------------------------------------------------------------

/** The top bar's colour in the fake browser's mock-ups (`backend/testing/fake-pictures.ts`). */
const TAB_COLOURS = {
  blue: [67, 135, 244],
  green: [43, 199, 100],
  amber: [243, 162, 20],
  violet: [141, 96, 244],
} as const;

export type TabColour = keyof typeof TAB_COLOURS;

/** The fake browser draws tab `n` with the colour at `n` modulo 4. */
const TAB_ORDER: readonly TabColour[] = ['blue', 'green', 'amber', 'violet'];

export function colourOfTab(tab: number): TabColour {
  return TAB_ORDER[Math.abs(tab) % TAB_ORDER.length] ?? 'blue';
}

/** How far a picture's bar may be from a colour and still be that colour (JPEG is not exact). */
const COLOUR_TOLERANCE = 60;

export interface PictureProbe {
  width: number;
  height: number;
  /** Colours the picture holds, coarsely told apart: a blank picture holds one. */
  colours: number;
  /** The average colour of the top bar of the page. */
  bar: readonly [number, number, number];
  /** The average colour of the last rows of the page: a picture that is cut wrongly has an empty bar there. */
  foot: readonly [number, number, number];
}

/** Reads the picture back from the canvas the page draws on. */
export async function probePicture(page: Page): Promise<PictureProbe> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('the page has no canvas');
    // A copy is read: the page's own canvas is not made for reading back.
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('the canvas has no 2d context');
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    const barPixels = copy.width * Math.max(1, Math.floor(copy.height / 20));
    const pixels = copy.width * copy.height;
    const colours = new Set<number>();
    const bar = [0, 0, 0];
    const foot = [0, 0, 0];
    for (let at = 0; at < data.length; at += 4) {
      const [red = 0, green = 0, blue = 0] = data.subarray(at, at + 3);
      colours.add((red >> 5) * 64 + (green >> 5) * 8 + (blue >> 5));
      const total =
        at / 4 < barPixels ? bar : at / 4 >= pixels - barPixels ? foot : null;
      if (total !== null) {
        total[0] = (total[0] ?? 0) + red;
        total[1] = (total[1] ?? 0) + green;
        total[2] = (total[2] ?? 0) + blue;
      }
    }
    const average = (total: number[]) =>
      [
        Math.round((total[0] ?? 0) / barPixels),
        Math.round((total[1] ?? 0) / barPixels),
        Math.round((total[2] ?? 0) / barPixels),
      ] as const;
    return {
      width: copy.width,
      height: copy.height,
      colours: colours.size,
      bar: average(bar),
      foot: average(foot),
    };
  });
}

/** The colour of a tab's mock-up that a picture shows, or null when it is none of them. */
export function colourOfPicture(probe: PictureProbe): TabColour | null {
  let nearest: TabColour | null = null;
  let nearestDistance = COLOUR_TOLERANCE;
  for (const name of TAB_ORDER) {
    const [red, green, blue] = TAB_COLOURS[name];
    const away = Math.hypot(
      probe.bar[0] - red,
      probe.bar[1] - green,
      probe.bar[2] - blue,
    );
    if (away <= nearestDistance) {
      nearestDistance = away;
      nearest = name;
    }
  }
  return nearest;
}

/**
 * Waits until what is fading in or sliding in has stopped moving: a colour
 * measured on a popover that is half transparent is not the colour it ends up
 * with, and an audit would blame it. Animations that never end (a spinner)
 * are left alone.
 */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      );
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
}

/**
 * Writes down what the polite live regions of the page say from now on: their
 * text each time it changes, which is what a screen reader is told. `said()` is
 * the list so far, one entry per change (a region that empties adds none).
 */
export async function recordLiveRegions(
  page: Page,
): Promise<{ said: () => Promise<string[]> }> {
  const list = await page.evaluateHandle(() => {
    const said: string[] = [];
    const read = () => {
      const text = [
        ...document.querySelectorAll('[role="status"][aria-live="polite"]'),
      ]
        .map((region) => region.textContent?.trim() ?? '')
        .filter((words) => words !== '')
        .join(' | ');
      if (text !== '' && said.at(-1) !== text) said.push(text);
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return said;
  });
  return { said: () => list.jsonValue() };
}

// -- the viewer -----------------------------------------------------------------------------

/** The tabs the server last told the page about. */
function tabsOf(watch: LiveViewWatch): TabInfo[] {
  const latest = watch
    .received()
    .findLast(
      (message): message is Extract<ServerMessage, { t: 'tabs' }> =>
        message.t === 'tabs',
    );
  return latest?.tabs ?? [];
}

/** The live viewer of one running session, opened in a page. */
export class Viewer {
  /** The picture of the browser: the one element of the page the pointer and keyboard act on. */
  readonly picture: Locator;
  /** The frame the picture is laid out in. */
  readonly room: Locator;
  /** The hidden text field that has the keyboard while the page has it. */
  readonly keyboard: Locator;
  /** The row around the page's one heading: the name, the state and the exit IP under it, Start or Stop and the menu. */
  readonly header: Locator;
  readonly address: Locator;
  readonly back: Locator;
  readonly forward: Locator;
  readonly reload: Locator;
  readonly newTab: Locator;
  readonly tablist: Locator;
  readonly tabs: Locator;
  readonly secrets: Locator;
  readonly stop: Locator;
  readonly fake: Fake;
  #flushes = 0;

  constructor(
    readonly page: Page,
    readonly watch: LiveViewWatch,
    readonly session: Session,
    control: Control,
  ) {
    this.fake = new Fake(control, session.name);
    this.picture = page.getByRole('application', {
      name: t('viewer.stage.canvas'),
    });
    // By its own role: the picture is hidden until the first one is drawn, the room is not.
    this.room = page.locator('[role="application"]').locator('xpath=..');
    this.keyboard = page.getByRole('textbox', {
      name: t('viewer.stage.keyboard'),
    });
    // One header at every width (the library's `ThreadHeader`, a size container of that name):
    // the nearest ancestor of the heading, so the list of sessions beside the page is not in it.
    this.header = page
      .getByRole('heading', { level: 1 })
      .locator('xpath=ancestor::div[contains(@class, "thread-header")][1]');
    this.address = page.getByRole('textbox', {
      name: t('viewer.address.label'),
      exact: true,
    });
    this.back = this.#button(t('viewer.address.back'));
    this.forward = this.#button(t('viewer.address.forward'));
    this.reload = this.#button(t('viewer.address.reload'));
    this.newTab = this.#button(t('viewer.tabs.new'));
    this.tablist = page.getByRole('tablist', { name: t('viewer.tabs.label') });
    this.tabs = this.tablist.getByRole('tab');
    // Named after what it opens; the visible word is only `viewer.secrets.button`.
    this.secrets = this.#button(t('viewer.secrets.title'));
    this.stop = this.#button(t('viewer.actions.stop'));
  }

  /** A button of the page itself: a phone's bar of the app has a Secrets button of its own, outside it. */
  #button(name: string): Locator {
    return this.page
      .getByRole('main')
      .getByRole('button', { name, exact: true });
  }

  /**
   * The chip of the header that says where the session exits (`<ip> · <country>`)
   * and opens its details. A narrow header keeps only its glyph on the screen,
   * the words are still its name.
   */
  exitChip(ip: string): Locator {
    return this.header.getByRole('button', {
      name: new RegExp(`^${literally(ip).source}(?: · .+)?$`),
    });
  }

  /** The tab named by its title. */
  tab(title: string): Locator {
    return this.tablist.getByRole('tab', { name: title, exact: true });
  }

  /** The button that closes the tab with this title, while other tabs stay open. */
  closeButton(title: string): Locator {
    return this.#button(fill(t('viewer.tabs.close'), { title }));
  }

  /** The button that closes the only tab left, which also stops the session. */
  closeLastButton(title: string): Locator {
    return this.#button(fill(t('viewer.tabs.closeLast'), { title }));
  }

  /** Waits until the picture is on the screen: the connection is live and a picture was drawn. */
  async waitUntilLive(): Promise<void> {
    await expect(this.picture).toBeVisible({ timeout: TIMEOUT.PICTURE });
    await waitForPictures(this.watch);
  }

  /**
   * A point of the picture, by its share of the width and the height (0.5,
   * 0.5 is the middle): where that is on the screen now, and the pixel of the
   * fake page it stands for.
   */
  async at(shareX: number, shareY: number): Promise<Aim> {
    const box = await boxOf(this.picture);
    return {
      screen: {
        x: box.x + box.width * shareX,
        y: box.y + box.height * shareY,
      },
      page: { x: PAGE.width * shareX, y: PAGE.height * shareY },
    };
  }

  /** The tabs the server last told the page about. */
  serverTabs(): TabInfo[] {
    return tabsOf(this.watch);
  }

  /**
   * Waits until everything the page sent so far has reached the fake browser
   * (the page must have the keyboard): input travels in one queue, so a text
   * typed last arrives last. After it, "nothing else was sent" can be asserted.
   */
  async flush(): Promise<void> {
    this.#flushes += 1;
    const marker = `flush ${this.#flushes}`;
    await this.page.keyboard.insertText(marker);
    await this.fake.when(
      (events) => textsOf(events).includes(marker),
      'what the page sent has reached the browser',
    );
  }
}

/** Opens a new tab and sends it to `url`, as a person does: the button, then the address bar. */
export async function openTabAt(viewer: Viewer, url: string): Promise<void> {
  await viewer.newTab.click();
  await expect(viewer.address).toBeFocused();
  await viewer.address.fill(url);
  await viewer.address.press('Enter');
  await expect(viewer.tab(titleOf(url))).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/**
 * Opens the viewer of a running session, without waiting for it to be live: a
 * dialog of the page that is already waiting hides the picture from the
 * accessibility tree, which the viewer's locators go by.
 */
export async function visitViewer(
  page: Page,
  control: Control,
  session: Session,
): Promise<Viewer> {
  const watch = watchLiveView(page);
  await page.goto(`/sessions/${session.id}`);
  return new Viewer(page, watch, session, control);
}

/** Opens the live viewer of a running session and waits until it shows a picture. */
export async function openViewer(
  page: Page,
  control: Control,
  session: Session,
): Promise<Viewer> {
  const viewer = await visitViewer(page, control, session);
  await viewer.waitUntilLive();
  return viewer;
}

// -- the socket of the live view ----------------------------------------------------------------

/** The address of the live view's socket, whatever the session. */
const STREAM = /\/api\/sessions\/\d+\/stream$/;

interface SocketLink {
  /** The page's end of the socket. */
  page: WebSocketRoute;
  /** The server's end of it. */
  server: WebSocketRoute;
}

/**
 * The sockets the page opens to the live view, with the network in the hand of
 * the spec: they pass through to the real server until the spec cuts them.
 */
export class LiveSockets {
  readonly #links: SocketLink[] = [];
  /** How many sockets the page has tried to open. */
  attempts = 0;
  /** How many of the sockets that passed the page has closed itself. */
  closed = 0;
  /** While false every socket the page opens is closed at once, as when the network is down. */
  up = true;

  private constructor(
    /** What the page says to the server goes through this: the text it returns is what the server hears. */
    private readonly toServer: (text: string) => string,
  ) {}

  static async route(
    page: Page,
    options: { toServer?: (text: string) => string } = {},
  ): Promise<LiveSockets> {
    const sockets = new LiveSockets(options.toServer ?? ((text) => text));
    await page.routeWebSocket(STREAM, (route) => {
      sockets.attempts += 1;
      if (!sockets.up) {
        void route.close();
        return;
      }
      const server = route.connectToServer();
      sockets.#links.push({ page: route, server });
      // A handler of the page's messages has to pass them on itself.
      route.onMessage((message) => {
        server.send(
          typeof message === 'string' ? sockets.toServer(message) : message,
        );
      });
      // So has a handler of its closing: closing one end does not close the other.
      // Playwright can report the close of one socket twice (the page's own
      // `close()`, then the close of the server end that this handler makes), so
      // a socket is counted, and its server end closed, the first time only.
      let closing = false;
      route.onClose((code, reason) => {
        if (closing) return;
        closing = true;
        sockets.closed += 1;
        void server.close({
          ...(code === undefined ? {} : { code }),
          ...(reason === undefined ? {} : { reason }),
        });
      });
    });
    return sockets;
  }

  /** The server says something to the page that it has not said itself, over the socket the page has now. */
  tell(message: ServerMessage): void {
    const link = this.#links.at(-1);
    if (link === undefined) throw new Error('the page has no socket to tell');
    link.page.send(JSON.stringify(message));
  }

  /** The socket the page has now is closed, from both ends; the page may open another. */
  async drop(): Promise<void> {
    const link = this.#links.at(-1);
    if (link === undefined) throw new Error('the page has no socket to drop');
    await link.page.close();
    await link.server.close();
  }

  /** The network goes down: the socket is dropped and no other opens until `up` is true again. */
  async cut(): Promise<void> {
    this.up = false;
    await this.drop();
  }
}

/**
 * A socket that is open but has no server behind it until it is released: the
 * live view is connecting. `sent` is what the page said to it meanwhile.
 */
export async function holdLiveView(page: Page) {
  const sent: string[] = [];
  const link: { page?: WebSocketRoute; server?: WebSocketRoute } = {};
  await page.routeWebSocket(STREAM, (route) => {
    link.page = route;
    route.onMessage((message) => {
      sent.push(String(message));
      link.server?.send(message);
    });
  });
  return {
    sent,
    /** The server answers: what it sends goes to the page, what the page sends goes to it. */
    release(): void {
      const open = link.page;
      if (open === undefined) throw new Error('the page opened no socket');
      const server = open.connectToServer();
      server.onMessage((message) => {
        open.send(message);
      });
      link.server = server;
    },
  };
}
