import type { BrowserContext } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoticeCode } from '../../../lib/live-view.ts';
import type { TabLayout } from '../../lib/web-url.ts';
import { FakeContext, fakeJpeg } from '../../testing/fake-playwright.ts';
import type {
  FakeContextOptions,
  FakePage,
} from '../../testing/fake-playwright.ts';
import {
  playwrightError,
  playwrightTimeout,
} from '../../testing/fake-playwright.ts';
import {
  isPlaywrightError,
  jpegSize,
  pictureDelay,
  PlaywrightRemote,
} from './playwright-remote.ts';
import { RemoteError } from './remote.ts';
import type { Remote, RemoteEvent, Tab } from './remote.ts';

const START = 'https://start.example/';
const NOT_RESPONDING =
  'The page does not respond. A dialog (alert, confirm) may be waiting for an answer.';

// -- helpers --------------------------------------------------------------------

interface Launched {
  context: FakeContext;
  /** The page the browser starts with. */
  page: FakePage;
  remote: PlaywrightRemote;
  /** What `onLayout` was told. */
  layouts: TabLayout[];
}

const remotes: PlaywrightRemote[] = [];

function launch(
  options: {
    context?: FakeContextOptions;
    saveDelayMs?: number;
    removalDelayMs?: number;
    onLayout?: (layout: TabLayout) => void;
  } = {},
): Launched {
  const context = new FakeContext(options.context);
  const layouts: TabLayout[] = [];
  const remote = new PlaywrightRemote(context, {
    startPage: START,
    onLayout:
      options.onLayout ??
      ((layout) => {
        layouts.push(layout);
      }),
    saveDelayMs: options.saveDelayMs,
    removalDelayMs: options.removalDelayMs,
  });
  remotes.push(remote);
  return { context, page: context.pages()[0], remote, layouts };
}

/** Let everything that is ready run (promises, timers that are due now). */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const wait = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** What a promise comes to, without ever rejecting (time can pass meanwhile). */
function capture<T>(work: Promise<T>): Promise<Outcome<T>> {
  return work.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (error: unknown): Outcome<T> => ({ ok: false, error }),
  );
}

interface Tracked<T> {
  /** Has the promise come to something yet? */
  done: boolean;
  outcome: Outcome<T> | null;
}

/** Watch a promise while time passes: is it done, and with what? */
function track<T>(work: Promise<T>): Tracked<T> {
  const tracked: Tracked<T> = { done: false, outcome: null };
  const watch = async (): Promise<void> => {
    tracked.outcome = await capture(work);
    tracked.done = true;
  };
  void watch();
  return tracked;
}

/** What a promise that is known to be done came to. */
function outcomeOf<T>(tracked: Tracked<T>): Outcome<T> {
  if (tracked.outcome === null) throw new Error('the promise is not done yet');
  return tracked.outcome;
}

async function expectRemoteError(
  work: Promise<unknown>,
  message: string | RegExp,
  notice?: NoticeCode,
): Promise<void> {
  const outcome = await capture(work);
  if (outcome.ok) throw new Error('expected a RemoteError, but it succeeded');
  expect(outcome.error).toBeInstanceOf(RemoteError);
  if (!(outcome.error instanceof RemoteError)) return;
  if (typeof message === 'string') expect(outcome.error.message).toBe(message);
  else expect(outcome.error.message).toMatch(message);
  // The notice is what the web client words for the person.
  if (notice !== undefined) expect(outcome.error.notice).toBe(notice);
}

/** `[method, ...arguments]` of a call, without the arguments that were not given. */
function entry(method: string, args: readonly unknown[]): unknown[] {
  const result: unknown[] = [method];
  result.push(...args.filter((arg) => arg !== undefined));
  return result;
}

function listen(remote: Remote): {
  events: RemoteEvent[];
  stop: () => void;
} {
  const events: RemoteEvent[] = [];
  const stop = remote.subscribe((event) => {
    events.push(event);
  });
  return { events, stop };
}

function tabsOf(events: readonly RemoteEvent[]): (readonly Tab[])[] {
  return events.flatMap((event) => (event.type === 'tabs' ? [event.tabs] : []));
}

function urlsOf(remote: Remote): string[] {
  return remote.tabs().map((tab) => tab.url);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  for (const remote of remotes.splice(0)) await remote.aclose();
  vi.restoreAllMocks(); // (the fake timers may be spied on: first them)
  vi.useRealTimers();
});

// -- pure helpers ---------------------------------------------------------------

describe('jpegSize', () => {
  const frame = (marker: number, width: number, height: number): number[] => [
    0xff,
    marker,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  const jpeg = (...parts: number[][]): Uint8Array =>
    Uint8Array.from([0xff, 0xd8, ...parts.flat(), 0xff, 0xd9]);

  it('reads the size from a baseline frame header', () => {
    expect(jpegSize(jpeg(frame(0xc0, 1280, 720)))).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('reads sizes above 255 and different width and height', () => {
    expect(jpegSize(jpeg(frame(0xc0, 2176, 1190)))).toEqual({
      width: 2176,
      height: 1190,
    });
    expect(jpegSize(jpeg(frame(0xc0, 3, 65535)))).toEqual({
      width: 3,
      height: 65535,
    });
  });

  it('reads progressive and other frame types too', () => {
    expect(jpegSize(jpeg(frame(0xc2, 800, 600)))).toEqual({
      width: 800,
      height: 600,
    });
    expect(jpegSize(jpeg(frame(0xcf, 10, 20)))).toEqual({
      width: 10,
      height: 20,
    });
  });

  it('skips the segments in front of the frame header', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0x4a)];
    const comment = [0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63];
    expect(jpegSize(jpeg(app0, comment, frame(0xc0, 640, 480)))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('does not take the Huffman, JPEG extension and arithmetic markers for a frame', () => {
    for (const marker of [0xc4, 0xc8, 0xcc]) {
      const length = 0x0010;
      const segment = [
        0xff,
        marker,
        length >> 8,
        length & 0xff,
        ...new Array<number>(length - 2).fill(0x01),
      ];
      expect(jpegSize(jpeg(segment, frame(0xc0, 33, 44)))).toEqual({
        width: 33,
        height: 44,
      });
    }
  });

  it('steps over markers that have no length', () => {
    expect(
      jpegSize(
        jpeg([0xff, 0x01], [0xff, 0xd0], [0xff, 0xd7], frame(0xc0, 5, 6)),
      ),
    ).toEqual({ width: 5, height: 6 });
  });

  it('finds its way again after bytes that are not a marker', () => {
    expect(jpegSize(jpeg([0x12, 0x34, 0x56], frame(0xc0, 100, 200)))).toEqual({
      width: 100,
      height: 200,
    });
  });

  it('has no size for data without a frame header', () => {
    expect(jpegSize(jpeg())).toBeNull();
    expect(jpegSize(new Uint8Array())).toBeNull();
    expect(jpegSize(Uint8Array.from([0xff, 0xd8]))).toBeNull();
    expect(
      jpegSize(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])),
    ).toBeNull();
  });

  it('has no size for a frame header that is cut off', () => {
    expect(
      jpegSize(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02]),
      ),
    ).toBeNull();
  });

  it('terminates on a segment whose length is zero', () => {
    expect(
      jpegSize(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBeNull();
  });

  it('reads the size of the pictures the fake browser makes', () => {
    expect(jpegSize(fakeJpeg({ width: 321, height: 123, tag: 'x' }))).toEqual({
      width: 321,
      height: 123,
    });
  });
});

describe('pictureDelay', () => {
  const idle = { usedLately: false, changedInARow: 0, tookMs: 0 };

  it('is as short as it goes while the page is used', () => {
    expect(
      pictureDelay({ ...idle, usedLately: true, stillInARow: 30, tookMs: 500 }),
    ).toBe(20);
  });

  it('is as short as it goes while the page keeps changing', () => {
    expect(pictureDelay({ ...idle, changedInARow: 2, stillInARow: 0 })).toBe(
      20,
    );
    expect(pictureDelay({ ...idle, changedInARow: 9, stillInARow: 0 })).toBe(
      20,
    );
  });

  it('is not short after a single change', () => {
    expect(pictureDelay({ ...idle, changedInARow: 1, stillInARow: 0 })).toBe(
      150,
    );
  });

  it('grows by a quarter from 150 ms while nothing changes, up to 800 ms', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map((stillInARow) =>
      pictureDelay({ ...idle, stillInARow }),
    );
    expect(delays.slice(0, 4)).toEqual([150, 187.5, 234.375, 292.96875]);
    expect(
      delays
        .slice(4, 8)
        .every((delay, index, all) => delay > (all[index - 1] ?? 0)),
    ).toBe(true);
    expect(delays.slice(8)).toEqual([800, 800, 800]);
  });

  it('is never less than six times the time a picture takes', () => {
    expect(pictureDelay({ ...idle, stillInARow: 0, tookMs: 100 })).toBe(600);
    expect(pictureDelay({ ...idle, stillInARow: 0, tookMs: 40 })).toBe(240);
  });

  it('is never more than 800 ms, however slow the pictures are', () => {
    expect(pictureDelay({ ...idle, stillInARow: 0, tookMs: 5000 })).toBe(800);
  });
});

describe('isPlaywrightError', () => {
  it('knows what Playwright rejects with', () => {
    expect(isPlaywrightError(playwrightError('page.goto: net::ERR'))).toBe(
      true,
    );
    expect(
      isPlaywrightError(playwrightTimeout('Timeout 3000ms exceeded')),
    ).toBe(true);
  });

  it('does not take bugs, our own errors or other values for Playwright errors', () => {
    expect(isPlaywrightError(new TypeError('x is not a function'))).toBe(false);
    expect(isPlaywrightError(new RangeError('x'))).toBe(false);
    expect(isPlaywrightError(new RemoteError('There is no such tab.'))).toBe(
      false,
    );
    expect(isPlaywrightError('Error')).toBe(false);
    expect(isPlaywrightError(null)).toBe(false);
    expect(isPlaywrightError({ name: 'Error', message: 'x' })).toBe(false);
  });
});

it('accepts the context that Playwright itself makes (checked by the compiler)', () => {
  const accepts = (context: BrowserContext): PlaywrightRemote =>
    new PlaywrightRemote(context, { startPage: START });
  expect(accepts).toBeTypeOf('function');
});

// -- tabs -----------------------------------------------------------------------

describe('tabs', () => {
  it('starts with the page the browser opened, in front', async () => {
    const { remote, page, context } = launch();
    await settle();
    expect(remote.tabs()).toEqual([
      { id: 1, url: '', title: '', loading: false, active: true },
    ]);
    expect(context.log.count(page.who, 'bringToFront')).toBe(1);
    expect(remote.closed).toBe(false);
  });

  it('shows the address a page is on, and nothing for a blank tab', () => {
    const { remote, page } = launch();
    page.navigate('https://example.com/a?b=1');
    expect(urlsOf(remote)).toEqual(['https://example.com/a?b=1']);
    page.navigate('about:blank');
    expect(urlsOf(remote)).toEqual(['']);
  });

  it("shows the page that failed to load instead of Firefox's error page", () => {
    const { remote, page } = launch();
    page.navigate(
      'about:neterror?e=connectionFailure&u=http%3A//127.0.0.1%3A1234/&c=UTF-8&d=Firefox%20can%E2%80%99t%20establish',
    );
    expect(urlsOf(remote)).toEqual(['http://127.0.0.1:1234/']);
  });

  it('keeps an address that is not a web page as it is', () => {
    const { remote, page } = launch();
    page.navigate('about:preferences');
    expect(urlsOf(remote)).toEqual(['about:preferences']);
  });

  it('marks a tab as loading from its navigation to the load event', () => {
    const { remote, page } = launch();
    page.navigate('https://example.com/');
    expect(remote.tabs()[0]?.loading).toBe(true);
    page.finishLoad();
    expect(remote.tabs()[0]?.loading).toBe(false);
  });

  it('ignores the navigations of frames inside the page', () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    page.navigateSubframe();
    expect(events).toEqual([]);
    expect(remote.tabs()[0]?.loading).toBe(false);
  });

  it('brings a page the browser opened itself to the front', async () => {
    const { remote, context } = launch();
    await settle();
    const popup = context.open('https://popup.example/');
    await settle();
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(context.log.count(popup.who, 'bringToFront')).toBe(1);
  });

  it('hears of a page once, whether or not the context said so before newPage returned', async () => {
    for (const pageEvent of ['before', 'after', 'never'] as const) {
      const { remote } = launch({ context: { pageEvent } });
      await remote.openTab('https://one.example/');
      await settle();
      expect(remote.tabs().map((tab) => tab.id)).toEqual([1, 2]);
    }
  });

  it('tells its listeners about every change, with a copy of the tabs', async () => {
    const { remote, page, context } = launch();
    const { events, stop } = listen(remote);
    page.navigate('https://example.com/');
    context.open('https://popup.example/');
    await settle();
    const lists = tabsOf(events);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(lists[0]?.map((tab) => tab.url)).toEqual(['https://example.com/']);
    expect(lists.at(-1)?.map((tab) => tab.id)).toEqual([1, 2]);
    stop();
    events.length = 0;
    page.navigate('https://example.com/again');
    expect(events).toEqual([]);
  });

  it('says nothing to a listener that left', () => {
    const { remote, page } = launch();
    const first = listen(remote);
    const second = listen(remote);
    first.stop();
    page.navigate('https://example.com/');
    expect(first.events).toEqual([]);
    expect(second.events).toHaveLength(1);
  });

  it('does not let a failing listener keep the others from hearing', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { remote, page } = launch();
    remote.subscribe(() => {
      throw new Error('boom');
    });
    const { events } = listen(remote);
    page.navigate('https://example.com/');
    expect(events).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      'a listener of the remote failed',
      expect.any(Error),
    );
  });

  it('stops listening to a page that closed', async () => {
    const { page, context } = launch();
    const popup = context.open('https://two.example/');
    expect(popup.listenerCount('dialog')).toBe(1);
    await popup.close();
    await settle();
    for (const event of ['dialog', 'framenavigated', 'load', 'close']) {
      expect(popup.listenerCount(event)).toBe(0);
    }
    expect(page.listenerCount('dialog')).toBe(1);
  });

  it('hears of a page closing once', async () => {
    const { remote, page, context } = launch();
    await context.open('https://two.example/').close();
    await settle();
    const { events } = listen(remote);
    page.emit('close', page);
    page.emit('close', page);
    await settle();
    expect(tabsOf(events)).toHaveLength(1);
    expect(remote.tabs()).toEqual([]);
  });

  it('forgets a page that closed', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    await page.close();
    await settle();
    expect(events.at(-1)).toEqual({ type: 'tabs', tabs: [] });
    expect(remote.tabs()).toEqual([]);
  });
});

describe('opening, closing and switching tabs', () => {
  it('opens a tab on the start page without an address', async () => {
    const { remote, context } = launch();
    const tab = await remote.openTab();
    await settle();
    expect(tab).toEqual({
      id: 2,
      url: '',
      title: '',
      loading: false,
      active: true,
    });
    const page = context.pages()[1];
    expect(context.log.of(page?.who, 'goto')[0]?.args).toEqual([
      START,
      { waitUntil: 'commit', timeout: 30_000 },
    ]);
    expect(remote.tabs().map((t) => [t.id, t.active, t.url])).toEqual([
      [1, false, ''],
      [2, true, START],
    ]);
  });

  it('opens a tab on the address it is given, and on the start page if that is empty', async () => {
    const { remote, context } = launch();
    await remote.openTab('https://given.example/');
    await remote.openTab(null);
    await remote.openTab('');
    await settle();
    const opened = context
      .pages()
      .slice(1)
      .map((page) => context.log.of(page.who, 'goto')[0]?.args[0]);
    expect(opened).toEqual(['https://given.example/', START, START]);
  });

  it('knows where a tab is going while it is still blank', async () => {
    const { remote, page } = launch();
    await settle();
    page.behave('goto', { hang: true });
    void remote.goto('https://slow.example/');
    await settle();
    expect(remote.tabs()[0]?.url).toBe('');
    expect(remote.layout().urls).toEqual(['https://slow.example/']);
  });

  it('says why a tab could not be opened', async () => {
    const { remote, context } = launch();
    context.behave('newPage', {
      error: playwrightError(
        'browserContext.newPage: Target closed\nCall log:\n  - x',
      ),
      times: 1,
    });
    await expectRemoteError(
      remote.openTab(),
      'Could not open a tab: browserContext.newPage: Target closed',
      'tab_not_opened',
    );
  });

  it('does not fail when the page it opened cannot load: the page shows its own error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { remote, context } = launch();
    context.onNewPage = (page) => {
      page.behave('goto', {
        error: playwrightError('page.goto: NS_ERROR_PROXY_CONNECTION_REFUSED'),
      });
    };
    await remote.openTab('https://refused.example/');
    await settle();
    expect(remote.tabs()).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('closes a tab', async () => {
    const { remote, context } = launch();
    const { id } = await remote.openTab('https://two.example/');
    await remote.closeTab(id);
    await settle();
    expect(remote.tabs().map((tab) => tab.id)).toEqual([1]);
    expect(context.pages()).toHaveLength(1);
  });

  it('says that there is no such tab', async () => {
    const { remote } = launch();
    await expectRemoteError(
      remote.closeTab(42),
      'There is no such tab.',
      'tab_gone',
    );
    await expectRemoteError(
      remote.activateTab(42),
      'There is no such tab.',
      'tab_gone',
    );
    await expectRemoteError(
      remote.goto('https://x.example/', 42),
      'There is no such tab.',
      'tab_gone',
    );
    await expectRemoteError(
      remote.history('back', 42),
      'There is no such tab.',
      'tab_gone',
    );
    await expectRemoteError(
      remote.readPage(42),
      'There is no such tab.',
      'tab_gone',
    );
    await expectRemoteError(
      remote.screenshot(42),
      'There is no such tab.',
      'tab_gone',
    );
  });

  it('leaves it at a closed tab if the page was already gone', async () => {
    const { remote, page } = launch();
    page.behave('close', {
      error: playwrightError('page.close: Target closed'),
    });
    await expect(remote.closeTab(1)).resolves.toBeUndefined();
  });

  it('activates a tab: front, event, and a new picture of it', async () => {
    const { remote, context } = launch();
    const { id } = await remote.openTab('https://two.example/');
    await settle();
    const { events } = listen(remote);
    context.log.clear();
    await remote.activateTab(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([true, false]);
    expect(
      context.log.count(context.pages()[0]?.who ?? '', 'bringToFront'),
    ).toBe(1);
    expect(
      tabsOf(events)
        .at(-1)
        ?.map((tab) => tab.active),
    ).toEqual([true, false]);
    await remote.activateTab(id);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([false, true]);
  });

  it('activates a tab even if its page cannot come to the front', async () => {
    const { remote, page } = launch();
    await remote.openTab('https://two.example/');
    page.behave('bringToFront', {
      error: playwrightError('page.bringToFront: closed'),
    });
    await remote.activateTab(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([true, false]);
  });

  it('has a tab open until the last page closes', async () => {
    const { remote, page } = launch();
    await settle();
    await remote.closeTab(1);
    await settle();
    expect(remote.tabs()).toEqual([]);
    await expectRemoteError(remote.readPage(), 'No tab is open.', 'tab_gone');
    await expectRemoteError(
      remote.goto('https://x.example/'),
      'No tab is open.',
    );
    await expectRemoteError(remote.screenshot(), 'No tab is open.');
    expect(page.closed).toBe(true);
  });
});

describe('what becomes active when the active tab closes', () => {
  async function threeTabs(): Promise<Launched> {
    const browser = launch();
    await browser.remote.openTab('https://two.example/');
    await browser.remote.openTab('https://three.example/');
    await settle();
    return browser;
  }

  const active = (remote: Remote): number | undefined =>
    remote.tabs().find((tab) => tab.active)?.id;

  it('is the tab that was opened before it', async () => {
    const { remote } = await threeTabs();
    expect(active(remote)).toBe(3);
    await remote.closeTab(3);
    await settle();
    expect(active(remote)).toBe(2);
    await remote.closeTab(2);
    await settle();
    expect(active(remote)).toBe(1);
  });

  it('is the first one if none was opened before it', async () => {
    const { remote } = await threeTabs();
    await remote.activateTab(1);
    await remote.closeTab(1);
    await settle();
    expect(active(remote)).toBe(2);
  });

  it('is the nearest older one, not the neighbour, when tabs in between are gone', async () => {
    const { remote } = await threeTabs();
    await remote.closeTab(2);
    await settle();
    await remote.closeTab(3);
    await settle();
    expect(active(remote)).toBe(1);
  });

  it('stays the same when another tab closes', async () => {
    const { remote } = await threeTabs();
    await remote.activateTab(2);
    await remote.closeTab(3);
    await settle();
    expect(active(remote)).toBe(2);
  });

  it('brings the new active tab to the front', async () => {
    const { remote, context } = await threeTabs();
    context.log.clear();
    await remote.closeTab(3);
    await settle();
    const second = context.pages()[1];
    expect(context.log.count(second?.who ?? '', 'bringToFront')).toBe(1);
  });

  it('is nothing when the last tab closes', async () => {
    const { remote } = launch();
    await settle();
    await remote.closeTab(1);
    await settle();
    expect(remote.tabs()).toEqual([]);
  });
});

describe('navigation', () => {
  it('opens an address in the active tab, or in the one asked for', async () => {
    const { remote, context } = launch();
    await remote.openTab('https://two.example/');
    await settle();
    await remote.goto('https://a.example/');
    await remote.goto('https://b.example/', 1);
    const [first, second] = context.pages();
    expect(first?.url()).toBe('https://b.example/');
    expect(second?.url()).toBe('https://a.example/');
  });

  it('waits for the commit unless told otherwise, 30 seconds at the most', async () => {
    const { remote, context, page } = launch();
    await remote.goto('https://a.example/');
    await remote.goto('https://b.example/', null, 'load');
    await remote.goto('https://c.example/', 1, 'domcontentloaded');
    expect(context.log.of(page.who, 'goto').map((call) => call.args)).toEqual([
      ['https://a.example/', { waitUntil: 'commit', timeout: 30_000 }],
      ['https://b.example/', { waitUntil: 'load', timeout: 30_000 }],
      [
        'https://c.example/',
        { waitUntil: 'domcontentloaded', timeout: 30_000 },
      ],
    ]);
  });

  it('says what could not be opened and why, in one line', async () => {
    const { remote, page } = launch();
    page.behave('goto', {
      error: playwrightError(
        'page.goto: NS_ERROR_CONNECTION_REFUSED\nCall log:\n  - navigating to "http://127.0.0.1:1/"',
      ),
    });
    await expectRemoteError(
      remote.goto('http://127.0.0.1:1/', null, 'load'),
      'Could not open http://127.0.0.1:1/: page.goto: NS_ERROR_CONNECTION_REFUSED',
    );
  });

  it('says so when a navigation takes too long', async () => {
    const { remote, page } = launch();
    page.behave('goto', {
      error: playwrightTimeout('page.goto: Timeout 30000ms exceeded.'),
    });
    await expectRemoteError(
      remote.goto('https://slow.example/'),
      'Could not open https://slow.example/: page.goto: Timeout 30000ms exceeded.',
    );
  });

  it('does not take a bug for a page that cannot be opened', async () => {
    const { remote, page } = launch();
    page.behave('goto', { error: new TypeError('x is not a function') });
    const outcome = await capture(remote.goto('https://a.example/'));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBeInstanceOf(TypeError);
  });

  it('goes back, forward and reloads', async () => {
    const { remote, context, page } = launch();
    await remote.history('back');
    await remote.history('forward');
    await remote.history('reload');
    const navigation = { waitUntil: 'commit', timeout: 30_000 };
    const calls = context.log
      .of(page.who)
      .filter((call) => call.method !== 'bringToFront')
      .map((call) => [call.method, call.args]);
    expect(calls).toEqual([
      ['goBack', [navigation]],
      ['goForward', [navigation]],
      ['reload', [navigation]],
    ]);
  });

  it('says what could not be done in the history', async () => {
    const { remote, page } = launch();
    page.behave('goBack', {
      error: playwrightError('page.goBack: no history\nCall log:'),
    });
    page.behave('reload', {
      error: playwrightTimeout('page.reload: Timeout 30000ms exceeded.'),
    });
    await expectRemoteError(
      remote.history('back'),
      'Could not back: page.goBack: no history',
    );
    await expectRemoteError(
      remote.history('reload'),
      'Could not reload: page.reload: Timeout 30000ms exceeded.',
    );
  });
});

describe('titles', () => {
  it('are fetched on request, for every tab, although nobody watches', async () => {
    const { remote, page, context } = launch();
    const second = await remote.openTab('https://two.example/');
    await settle();
    page.titleText = 'First';
    const secondPage = context.pages()[1];
    if (secondPage) secondPage.titleText = 'Second';
    const tabs = await remote.listTabs();
    expect(tabs.map((tab) => [tab.id, tab.title])).toEqual([
      [1, 'First'],
      [second.id, 'Second'],
    ]);
    expect(remote.tabs().map((tab) => tab.title)).toEqual(['First', 'Second']);
  });

  it('are only fetched on request while nobody listens', async () => {
    const { context, page } = launch();
    await settle();
    await wait(10_000);
    expect(context.log.count(page.who, 'evaluate')).toBe(0);
  });

  it('are polled every 1.5 seconds while somebody listens, and tell about a change', async () => {
    const { remote, page, context } = launch();
    const { events, stop } = listen(remote);
    await settle();
    expect(context.log.count(page.who, 'evaluate')).toBe(1);
    page.titleText = 'Changed';
    await wait(1499);
    expect(context.log.count(page.who, 'evaluate')).toBe(1);
    await wait(1);
    expect(context.log.count(page.who, 'evaluate')).toBe(2);
    expect(tabsOf(events).at(-1)?.[0]?.title).toBe('Changed');
    const told = events.length;
    await wait(1500);
    expect(events).toHaveLength(told); // nothing changed: nothing to say
    stop();
  });

  it('stop being polled when the last listener leaves', async () => {
    const { remote, page, context } = launch();
    const first = listen(remote);
    const second = listen(remote);
    await settle();
    first.stop();
    await wait(1500);
    expect(context.log.count(page.who, 'evaluate')).toBe(2);
    second.stop();
    await wait(1500);
    const polls = context.log.count(page.who, 'evaluate');
    await wait(10_000);
    expect(context.log.count(page.who, 'evaluate')).toBe(polls);
  });

  it('start again for a listener that comes later', async () => {
    const { remote, page, context } = launch();
    listen(remote).stop();
    await wait(3000);
    const before = context.log.count(page.who, 'evaluate');
    const { stop } = listen(remote);
    await settle();
    expect(context.log.count(page.who, 'evaluate')).toBe(before + 1);
    stop();
  });

  it('are fetched right after a page loaded, for a listener', async () => {
    const { remote, page, context } = launch();
    const { stop } = listen(remote);
    await settle();
    page.titleText = 'Loaded';
    page.navigate('https://example.com/');
    page.finishLoad();
    await settle();
    expect(remote.tabs()[0]?.title).toBe('Loaded');
    expect(context.log.count(page.who, 'evaluate')).toBe(2);
    stop();
  });

  it('are not asked of a page that waits for an answer to a dialog', async () => {
    const { remote, page, context } = launch();
    remote.attend(60_000);
    page.openDialog('alert', 'Hello');
    await settle();
    const { stop } = listen(remote);
    await settle();
    expect(context.log.count(page.who, 'evaluate')).toBe(0);
    stop();
  });

  it('do not wait for a page that does not answer more than two seconds', async () => {
    const { remote, page, context } = launch();
    await remote.openTab('https://two.example/');
    await settle();
    page.behave('evaluate', { hang: true });
    const second = context.pages()[1];
    if (second) second.titleText = 'Second';
    const listing = track(remote.listTabs());
    await wait(1999);
    expect(listing.done).toBe(false);
    await wait(1);
    const outcome = outcomeOf(listing);
    expect(outcome.ok && outcome.value.map((tab) => tab.title)).toEqual([
      '',
      'Second',
    ]);
  });

  it('end the loading of a page that changed its address without loading again', async () => {
    const { remote, page } = launch();
    page.navigate('https://spa.example/');
    expect(remote.tabs()[0]?.loading).toBe(true);
    page.readyState = 'loading';
    await remote.listTabs();
    expect(remote.tabs()[0]?.loading).toBe(true);
    page.readyState = 'complete';
    await remote.listTabs();
    expect(remote.tabs()[0]?.loading).toBe(false);
  });

  it('stay as they were if the page cannot be asked', async () => {
    const { remote, page } = launch();
    page.titleText = 'Before';
    await remote.listTabs();
    page.titleText = 'After';
    page.behave('evaluate', {
      error: playwrightError('page.evaluate: Target closed'),
      times: 1,
    });
    await remote.listTabs();
    expect(remote.tabs()[0]?.title).toBe('Before');
    await remote.listTabs();
    expect(remote.tabs()[0]?.title).toBe('After');
  });

  it('are not changed by an answer that is not a title and a state', async () => {
    const { remote, page } = launch();
    page.titleText = 'Before';
    await remote.listTabs();
    page.answers.set('titleAndState', () => ({ nonsense: true }));
    await remote.listTabs();
    expect(remote.tabs()[0]?.title).toBe('Before');
  });
});

// -- saving the tabs ------------------------------------------------------------

describe('saving the tabs', () => {
  const A = 'https://a.example/';
  const B = 'https://b.example/';
  const C = 'https://c.example/';

  it('tells onLayout about the tabs 500 ms after they changed', async () => {
    const { page, layouts } = launch();
    page.navigate(A);
    await wait(499);
    expect(layouts).toEqual([]);
    await wait(1);
    expect(layouts).toEqual([{ urls: [A], active: 0 }]);
  });

  it('waits until nothing changed for that long', async () => {
    const { page, layouts } = launch();
    page.navigate(A);
    await wait(300);
    page.navigate(B);
    await wait(499);
    expect(layouts).toEqual([]);
    await wait(1);
    expect(layouts).toEqual([{ urls: [B], active: 0 }]);
  });

  it('has the delays configured', async () => {
    const { context, layouts } = launch({
      saveDelayMs: 100,
      removalDelayMs: 300,
    });
    context.open(A);
    const second = context.open(B);
    await wait(99);
    expect(layouts).toEqual([]);
    await wait(1);
    expect(layouts).toEqual([{ urls: [A, B], active: 1 }]);
    await second.close();
    await wait(299);
    expect(layouts).toHaveLength(1);
    await wait(1);
    expect(layouts.at(-1)).toEqual({ urls: [A], active: 0 });
  });

  it('does not tell about tabs again when they are as they were', async () => {
    const { page, layouts } = launch();
    page.navigate(A);
    await wait(500);
    page.navigate(A);
    page.finishLoad();
    await wait(5000);
    expect(layouts).toHaveLength(1);
  });

  it('leaves out the tabs that would not open again: blank, internal, not web', async () => {
    const { context, page, layouts } = launch();
    context.open('about:preferences');
    context.open('view-source:https://x.example/');
    context.open('file:///etc/hosts');
    context.open(C);
    page.navigate(A);
    await wait(500);
    expect(layouts).toEqual([{ urls: [A, C], active: 1 }]);
  });

  it('names the active tab by its place among those it tells about', async () => {
    const { context, remote, layouts } = launch();
    context.open(A);
    context.open(B);
    context.open(C);
    await settle();
    await remote.activateTab(3);
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [A, B, C], active: 1 });
  });

  it('tells about the tab in front when another one is brought to the front', async () => {
    const { context, remote, layouts } = launch();
    context.open(A);
    context.open(B);
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [A, B], active: 1 });
    await remote.activateTab(2);
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [A, B], active: 0 });
    expect(layouts).toHaveLength(2);
  });

  it('counts the active tab among those it tells about, not among all', async () => {
    const { context, layouts } = launch();
    context.open('about:blank');
    context.open(B); // in front, after a blank tab and a blank first tab
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [B], active: 0 });
  });

  it('tells about a tab that is still on its way, by where it is going', async () => {
    const { remote, context, layouts } = launch();
    context.onNewPage = (page) => {
      page.behave('goto', { hang: true });
    };
    await remote.openTab('https://slow.example/');
    expect(remote.layout()).toEqual({
      urls: ['https://slow.example/'],
      active: 0,
    });
    await wait(500);
    expect(layouts).toEqual([{ urls: ['https://slow.example/'], active: 0 }]);
  });

  it('tells about a closed tab after 1.5 seconds, not after half a second', async () => {
    const { context, layouts } = launch();
    context.open(A);
    context.open(B);
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [A, B], active: 1 });
    await context.pages()[2]?.close();
    await wait(1499);
    expect(layouts).toHaveLength(1);
    await wait(1);
    expect(layouts.at(-1)).toEqual({ urls: [A], active: 0 });
  });

  it('keeps a closed tab for later when something else changes meanwhile', async () => {
    const { context, layouts } = launch();
    context.open(A);
    const second = context.open(B);
    await wait(500);
    await second.close();
    await wait(200);
    context.open(C); // would be told about after 500 ms
    await wait(1299);
    expect(layouts).toHaveLength(1);
    await wait(1);
    expect(layouts.at(-1)).toEqual({ urls: [A, C], active: 1 });
  });

  it('does not take the tabs of a browser that dies for tabs the user closed', async () => {
    const { context, remote, layouts } = launch();
    context.open(A);
    context.open(B);
    await wait(500);
    expect(layouts).toHaveLength(1);
    remote.freeze({ flush: false });
    for (const page of context.pages()) await page.close();
    await wait(10_000);
    expect(layouts).toHaveLength(1);
  });

  it('never tells about an empty layout, even if the tabs closed one by one', async () => {
    const { context, layouts } = launch();
    context.open(A);
    context.open(B);
    await wait(500);
    expect(layouts).toHaveLength(1);
    for (const page of context.pages()) {
      await page.close();
      await wait(100);
    }
    await wait(10_000);
    expect(layouts).toHaveLength(1);
  });

  it('tells about the tabs that are left when only some of them closed', async () => {
    const { context, layouts } = launch();
    context.open(A);
    context.open(B);
    context.open(C);
    await wait(500);
    const [, first, second] = context.pages();
    await first?.close();
    await wait(100);
    await second?.close();
    await wait(1499);
    expect(layouts).toHaveLength(1);
    await wait(100);
    expect(layouts.at(-1)).toEqual({ urls: [C], active: 0 });
  });

  it('tells about an empty layout once the user closed the last tab (forgetLayout)', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    await wait(500);
    remote.forgetLayout();
    expect(layouts.at(-1)).toEqual({ urls: [], active: 0 });
    expect(layouts).toHaveLength(2);
    page.navigate(B);
    await wait(10_000);
    remote.forgetLayout();
    expect(layouts).toHaveLength(2);
  });

  it('drops a save that was due when the last tab closed', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    remote.forgetLayout();
    await wait(10_000);
    expect(layouts).toEqual([{ urls: [], active: 0 }]);
  });

  it('tells about the tabs at once and then no more when frozen with a flush', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    remote.freeze({ flush: true });
    expect(layouts).toEqual([{ urls: [A], active: 0 }]);
    page.navigate(B);
    await wait(10_000);
    expect(layouts).toHaveLength(1);
  });

  it('does not repeat itself or report nothing when frozen with a flush', async () => {
    const first = launch();
    first.page.navigate(A);
    await wait(500);
    first.remote.freeze({ flush: true });
    expect(first.layouts).toHaveLength(1);
    const blank = launch();
    blank.remote.freeze({ flush: true });
    expect(blank.layouts).toEqual([]);
  });

  it('leaves the layout as it was last told when frozen without a flush', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    remote.freeze({ flush: false });
    await wait(10_000);
    expect(layouts).toEqual([]);
  });

  it('does not let a save that was due run after a flush', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    remote.freeze({ flush: true });
    expect(vi.getTimerCount()).toBe(0);
    await wait(1000);
    expect(layouts).toHaveLength(1);
  });

  it('tries again after 5 seconds when it could not be stored', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const told: TabLayout[] = [];
    let attempts = 0;
    const { page } = launch({
      onLayout: (layout) => {
        attempts += 1;
        if (attempts === 1) throw new Error('database is locked');
        told.push(layout);
      },
    });
    page.navigate(A);
    await wait(500);
    expect(attempts).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'could not store the open tabs',
      expect.any(Error),
    );
    await wait(4999);
    expect(attempts).toBe(1);
    await wait(1);
    expect(told).toEqual([{ urls: [A], active: 0 }]);
    await wait(60_000);
    expect(attempts).toBe(2);
  });

  it('does not try again after a flush that failed: the layout is frozen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    const { remote, page } = launch({
      onLayout: () => {
        attempts += 1;
        throw new Error('database is locked');
      },
    });
    page.navigate(A);
    remote.freeze({ flush: true });
    expect(attempts).toBe(1);
    await wait(60_000);
    expect(attempts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not try again once the layout is frozen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    const { remote, page } = launch({
      onLayout: () => {
        attempts += 1;
        throw new Error('database is locked');
      },
    });
    page.navigate(A);
    await wait(500);
    remote.freeze({ flush: false });
    await wait(60_000);
    expect(attempts).toBe(1);
  });

  it('schedules nothing without somebody to tell', () => {
    const context = new FakeContext();
    const remote = new PlaywrightRemote(context, { startPage: START });
    remotes.push(remote);
    context.pages()[0]?.navigate(A);
    expect(vi.getTimerCount()).toBe(0);
    expect(remote.layout()).toEqual({ urls: [A], active: 0 });
  });

  it('stops when the remote closes', async () => {
    const { remote, page, layouts } = launch();
    page.navigate(A);
    await remote.aclose();
    await wait(10_000);
    expect(layouts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// -- restoring the tabs ---------------------------------------------------------

describe('restore', () => {
  const A = 'https://a.example/';
  const B = 'https://b.example/';
  const C = 'https://c.example/';

  it('opens the addresses as tabs, the blank tab being the first, and the chosen one in front', async () => {
    const { remote, context } = launch();
    await remote.restore([A, B, C], 1);
    expect(context.pages().map((page) => page.url())).toEqual([A, B, C]);
    expect(remote.tabs().map((tab) => [tab.id, tab.url, tab.active])).toEqual([
      [1, A, false],
      [2, B, true],
      [3, C, false],
    ]);
  });

  it('starts every page at its address, waiting for the commit only', async () => {
    const { remote, context } = launch();
    await remote.restore([A, B]);
    for (const [index, url] of [A, B].entries()) {
      const page = context.pages()[index];
      expect(
        context.log.of(page?.who, 'goto').map((call) => call.args),
      ).toEqual([[url, { waitUntil: 'commit', timeout: 30_000 }]]);
    }
  });

  it('puts only the chosen tab in front, not every tab it makes', async () => {
    const { remote, context } = launch();
    await settle();
    context.log.clear();
    await remote.restore([A, B, C], 2);
    await settle();
    const fronts = context
      .pages()
      .map((page) => context.log.count(page.who, 'bringToFront'));
    expect(fronts).toEqual([0, 0, 1]);
  });

  it('changes the active tab only at the end', async () => {
    const { remote } = launch();
    const { events } = listen(remote);
    await remote.restore([A, B, C], 2);
    const actives = tabsOf(events).map(
      (tabs) => tabs.find((tab) => tab.active)?.id,
    );
    expect(new Set(actives.slice(0, -1))).toEqual(new Set([1]));
    expect(actives.at(-1)).toBe(3);
  });

  it('tells about the tabs it restored', async () => {
    const { remote, layouts } = launch();
    await remote.restore([A, B, C], 1);
    await wait(500);
    expect(layouts.at(-1)).toEqual({ urls: [A, B, C], active: 1 });
  });

  it('waits at most 5 seconds for the pages to begin loading', async () => {
    const { remote, context, page } = launch();
    page.behave('goto', { hang: true });
    context.onNewPage = (made) => {
      made.behave('goto', { hang: true });
    };
    const restoring = track(remote.restore([A, B], 1));
    await wait(4999);
    expect(restoring.done).toBe(false);
    await wait(1);
    expect(restoring.outcome).toEqual({ ok: true, value: undefined });
    expect(remote.tabs().map((tab) => tab.active)).toEqual([false, true]);
    expect(remote.layout()).toEqual({ urls: [A, B], active: 1 }); // they are on their way
  });

  it('does not wait at all when the pages began loading', async () => {
    const { remote } = launch();
    await remote.restore([A, B, C]);
    expect(vi.getTimerCount()).toBe(1); // only the layout is still to be told about
  });

  it('waits for all the pages to begin loading, if that takes less than 5 seconds', async () => {
    const { remote, context } = launch();
    context.onNewPage = (page) => {
      page.behave('goto', { delayMs: 2000 });
    };
    const restoring = track(remote.restore([A, B]));
    await wait(1999);
    expect(restoring.done).toBe(false);
    await wait(1);
    expect(restoring.outcome).toEqual({ ok: true, value: undefined });
  });

  it('only brings the first tab to the front without addresses', async () => {
    const { remote, context } = launch();
    await remote.restore([]);
    expect(context.pages()).toHaveLength(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([true]);
  });

  it('keeps the active tab if the one asked for does not exist', async () => {
    const { remote } = launch();
    await remote.restore([A, B], 7);
    await remote.restore([], -1);
    expect(remote.tabs().filter((tab) => tab.active)).toHaveLength(1);
  });

  it('opens a page itself if the browser has none', async () => {
    const { remote, context } = launch({ context: { pages: 0 } });
    await remote.restore([A]);
    expect(context.pages()).toHaveLength(1);
    expect(remote.tabs().map((tab) => [tab.url, tab.active])).toEqual([
      [A, true],
    ]);
  });

  it('does not fail when a page cannot load: the page shows its own error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { remote, context } = launch();
    context.onNewPage = (page) => {
      page.behave('goto', {
        error: playwrightError('page.goto: NS_ERROR_PROXY_CONNECTION_REFUSED'),
      });
    };
    await expect(remote.restore([A, B])).resolves.toBeUndefined();
    expect(remote.tabs()).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes each tab once, whenever the context tells about the pages', async () => {
    for (const pageEvent of ['before', 'after', 'never'] as const) {
      const { remote } = launch({ context: { pageEvent } });
      await remote.restore([A, B, C], 2);
      await settle();
      expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
        [1, false],
        [2, false],
        [3, true],
      ]);
    }
  });

  it('fails when the browser cannot make a page, and is a normal remote after that', async () => {
    const { remote, context } = launch();
    context.behave('newPage', {
      error: playwrightError('browserContext.newPage: Target closed'),
      times: 1,
    });
    const outcome = await capture(remote.restore([A, B]));
    expect(outcome.ok).toBe(false);
    // a tab that is opened now comes to the front, as it does when nothing is being restored
    const tab = await remote.openTab(C);
    await settle();
    expect(remote.tabs().map((t) => [t.id, t.active])).toEqual([
      [1, false],
      [tab.id, true],
    ]);
  });
});

// -- the picture ----------------------------------------------------------------

describe('pictures', () => {
  const bytes = (data: Uint8Array): number[] => Array.from(data);

  interface Received {
    at: number;
    tab: number;
    width: number;
    height: number;
    jpeg: number[];
  }

  /** Every picture a watcher gets, with the time it came; why it stopped getting them. */
  function collect(watcher: ReturnType<Remote['watch']>): {
    frames: Received[];
    ended: { reason: unknown };
  } {
    const frames: Received[] = [];
    const ended: { reason: unknown } = { reason: null };
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const frame = await watcher.get();
          frames.push({
            at: performance.now(),
            tab: frame.tab,
            width: frame.width,
            height: frame.height,
            jpeg: bytes(frame.jpeg),
          });
        }
      } catch (error) {
        ended.reason = error; // the browser is gone, or the viewer left
      }
    };
    void pump();
    return { frames, ended };
  }

  const shotTimes = (launched: Launched, page = launched.page): number[] =>
    launched.context.log.of(page.who, 'screenshot').map((call) => call.at);

  const gapsOf = (times: readonly number[]): number[] =>
    times.slice(1).map((time, index) => time - (times[index] ?? 0));

  it('gives a picture of the active tab at once', async () => {
    const { remote, page, context } = launch();
    page.jpeg = fakeJpeg({ width: 800, height: 600, tag: 1 });
    const watcher = remote.watch();
    const first = capture(watcher.get());
    await settle();
    const outcome = await first;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({ tab: 1, width: 800, height: 600 });
    expect(bytes(outcome.value.jpeg)).toEqual(bytes(page.jpeg));
    expect(context.log.of(page.who, 'screenshot')[0]?.args[0]).toEqual({
      type: 'jpeg',
      quality: 70,
      scale: 'css',
      caret: 'initial',
      animations: 'allow',
      timeout: 5000,
    });
    watcher.close();
  });

  describe('when the window has less room for the page than the viewport it reports', () => {
    // A browser pinned to the size of a fingerprint reports that size as its
    // viewport; a headless window on macOS keeps the room of a toolbar it does
    // not draw, so the page has less. A picture of the reported size has a
    // black bar where the window has nothing to show.
    const shots = (launched: Launched, page = launched.page) =>
      launched.context.log
        .of(page.who, 'screenshot')
        .map((call) => call.args[0]);
    const roomMeasures = (launched: Launched, page = launched.page) =>
      launched.context.log
        .of(page.who, 'evaluate')
        .filter((call) => call.args[0] === 'roomOfPage');

    it('takes the picture of the room the page has, from the top left', async () => {
      const launched = launch();
      const { remote, page } = launched;
      page.answers.set('roomOfPage', () => [1000, 600, 549]);
      page.jpeg = fakeJpeg({ width: 1000, height: 549 });
      const watcher = remote.watch();
      const first = capture(watcher.get());
      await settle();
      expect((await first).ok).toBe(true);
      expect(shots(launched)[0]).toMatchObject({
        clip: { x: 0, y: 0, width: 1000, height: 549 },
      });
      watcher.close();
    });

    it('takes the picture of the whole viewport when the page has all the room it reports', async () => {
      const launched = launch();
      const { remote, page } = launched;
      page.answers.set('roomOfPage', () => [1000, 600, 600]);
      const watcher = remote.watch();
      const first = capture(watcher.get());
      await settle();
      expect((await first).ok).toBe(true);
      expect(shots(launched)[0]).not.toHaveProperty('clip');
      watcher.close();
    });

    it('measures the room of a page once, not for every picture', async () => {
      const launched = launch();
      const { remote, page } = launched;
      page.answers.set('roomOfPage', () => [1000, 600, 549]);
      let picture = 0;
      page.pictures = () => fakeJpeg({ tag: (picture += 1) });
      const watcher = remote.watch();
      const frames = capture(
        (async () => {
          await watcher.get();
          await watcher.get();
          return watcher.get();
        })(),
      );
      await wait(2000);
      expect((await frames).ok).toBe(true);
      expect(shots(launched).length).toBeGreaterThanOrEqual(3);
      expect(roomMeasures(launched)).toHaveLength(1);
      watcher.close();
    });

    it('measures the room of every page: a window of its own may have another', async () => {
      const launched = launch();
      const second = launched.context.open('https://two.example/');
      second.answers.set('roomOfPage', () => [1000, 600, 560]);
      launched.page.answers.set('roomOfPage', () => [1000, 600, 549]);
      await launched.remote.screenshot(1);
      await launched.remote.screenshot(2);
      expect(shots(launched)[0]).toMatchObject({
        clip: { x: 0, y: 0, width: 1000, height: 549 },
      });
      expect(shots(launched, second)[0]).toMatchObject({
        clip: { x: 0, y: 0, width: 1000, height: 560 },
      });
    });

    it('takes the whole viewport, and tries again, when the room cannot be measured', async () => {
      const launched = launch();
      const { remote, page } = launched;
      let measures = 0;
      page.answers.set('roomOfPage', () => {
        measures += 1;
        if (measures === 1) {
          throw playwrightError(
            'page.evaluate: Execution context was destroyed',
          );
        }
        return [1000, 600, 549];
      });
      await remote.screenshot();
      expect(shots(launched)[0]).not.toHaveProperty('clip');
      // Not at once: a page that does not answer is left alone for a while.
      await remote.screenshot();
      expect(shots(launched)[1]).not.toHaveProperty('clip');
      expect(measures).toBe(1);
      await wait(1100);
      await remote.screenshot();
      expect(shots(launched)[2]).toMatchObject({
        clip: { x: 0, y: 0, width: 1000, height: 549 },
      });
    });
  });

  it('takes the size of the page from the picture, not from the page', async () => {
    const { remote, page } = launch();
    page.viewport = { width: 1000, height: 500 };
    page.jpeg = fakeJpeg({ width: 640, height: 480 });
    const watcher = remote.watch();
    const first = capture(watcher.get());
    await settle();
    const outcome = await first;
    expect(outcome.ok && outcome.value).toMatchObject({
      width: 640,
      height: 480,
    });
    watcher.close();
  });

  it('asks the page for its size when the picture does not say', async () => {
    const { remote, page } = launch();
    page.viewport = { width: 1000.9, height: 700.2 };
    page.jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const watcher = remote.watch();
    const first = capture(watcher.get());
    await settle();
    const outcome = await first;
    expect(outcome.ok && outcome.value).toMatchObject({
      width: 1000,
      height: 700,
    });
    watcher.close();
  });

  it('falls back to 1280 by 720 when neither the picture nor the page says how big it is', async () => {
    const { remote, page } = launch();
    page.jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    page.behave('evaluate', {
      error: playwrightError('page.evaluate: closed'),
    });
    const watcher = remote.watch();
    const { frames } = collect(watcher);
    await settle();
    expect(frames.map((frame) => [frame.width, frame.height])).toEqual([
      [1280, 720],
    ]);
    watcher.close();
  });

  it('keeps the size of the last picture when the page cannot be asked', async () => {
    const { remote, page } = launch();
    page.jpeg = fakeJpeg({ width: 640, height: 480 });
    const watcher = remote.watch();
    const { frames } = collect(watcher);
    await wait(100);
    page.jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xd9, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    page.behave('evaluate', { hang: true });
    await wait(100 + 15_000);
    expect(frames.map((frame) => [frame.width, frame.height])).toEqual([
      [640, 480],
      [640, 480],
    ]);
    watcher.close();
  });

  it('sends a page that does not change once, and takes few pictures of it', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(10_000);
    expect(frames).toHaveLength(1);
    expect(shotTimes(launched).length).toBeLessThan(70);
    watcher.close();
  });

  it('takes a picture every 20 ms while the page is used, then every 0.8 s while it stays as it is', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    collect(watcher);
    await wait(6000);
    const times = shotTimes(launched);
    const gaps = gapsOf(times);
    const active = gaps.filter((_, index) => (times[index + 1] ?? 0) <= 1000);
    expect(active.length).toBeGreaterThan(45);
    expect(Math.max(...active)).toBeLessThanOrEqual(20);
    expect(gaps.slice(-3)).toEqual([800, 800, 800]);
    expect(Math.min(...gaps.slice(active.length + 1))).toBeGreaterThanOrEqual(
      150,
    );
    watcher.close();
  });

  it('takes pictures back to back for as long as the page keeps changing', async () => {
    const launched = launch();
    let count = 0;
    launched.page.pictures = () => fakeJpeg({ tag: count++ });
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(5000);
    const gaps = gapsOf(shotTimes(launched));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20);
    expect(shotTimes(launched).length).toBeGreaterThan(240);
    expect(frames.length).toBeGreaterThan(240);
    watcher.close();
  });

  it('sends a picture that differs, and none that is the same', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(3000);
    expect(frames).toHaveLength(1);
    launched.page.jpeg = fakeJpeg({ tag: 'changed' });
    await wait(1000);
    expect(frames).toHaveLength(2);
    await wait(3000);
    expect(frames).toHaveLength(2);
    watcher.close();
  });

  it('takes a picture at once when the page is used, however long it rested', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    collect(watcher);
    await wait(5000);
    const before = shotTimes(launched).length;
    await launched.remote.hover(10, 10);
    await settle();
    expect(shotTimes(launched).length).toBeGreaterThan(before);
    expect(shotTimes(launched).length).toBeLessThanOrEqual(before + 2);
    await wait(500); // and it is back to every 20 ms for a while
    expect(shotTimes(launched).length).toBeGreaterThan(before + 20);
    watcher.close();
  });

  it('shows the last picture to a viewer who comes later, without waiting for one', async () => {
    const launched = launch();
    launched.page.jpeg = fakeJpeg({ tag: 'last' });
    const first = launched.remote.watch();
    collect(first);
    await wait(3000);
    const second = launched.remote.watch();
    const late = capture(second.get());
    await settle();
    const outcome = await late;
    expect(outcome.ok && bytes(outcome.value.jpeg)).toEqual(
      bytes(launched.page.jpeg),
    );
    first.close();
    second.close();
  });

  it('gives every viewer the pictures', async () => {
    const launched = launch();
    const first = collect(launched.remote.watch());
    const second = collect(launched.remote.watch());
    await wait(100);
    launched.page.jpeg = fakeJpeg({ tag: 2 });
    await wait(1100);
    expect(first.frames).toHaveLength(2);
    expect(second.frames).toHaveLength(2);
  });

  it('gives a slow viewer the newest picture only', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    await wait(100);
    for (const tag of [1, 2, 3]) {
      launched.page.jpeg = fakeJpeg({ tag });
      await wait(900);
    }
    const newest = await watcher.get();
    expect(bytes(newest.jpeg)).toEqual(bytes(fakeJpeg({ tag: 3 })));
    const next = track(watcher.get());
    await wait(2000);
    expect(next.done).toBe(false);
    watcher.close();
  });

  it('stops taking pictures when the last viewer is gone, and starts again for the next', async () => {
    const launched = launch();
    const first = launched.remote.watch();
    const second = launched.remote.watch();
    await wait(2000);
    first.close();
    first.close();
    const afterFirst = shotTimes(launched).length;
    await wait(2000);
    expect(shotTimes(launched).length).toBeGreaterThan(afterFirst);
    second.close();
    await settle();
    const stopped = shotTimes(launched).length;
    await wait(10_000);
    expect(shotTimes(launched).length).toBe(stopped);
    expect(vi.getTimerCount()).toBe(0);
    const third = launched.remote.watch();
    await wait(100);
    expect(shotTimes(launched).length).toBeGreaterThan(stopped);
    third.close();
  });

  it('does not stop for a viewer that left when another came since', async () => {
    const launched = launch();
    const first = launched.remote.watch();
    await wait(1000);
    first.close();
    const second = launched.remote.watch();
    first.close();
    const before = shotTimes(launched).length;
    await wait(3000);
    expect(shotTimes(launched).length).toBeGreaterThan(before);
    second.close();
  });

  it('rests 0.8 seconds between looks while there is no tab to take a picture of', async () => {
    const launched = launch();
    await launched.remote.closeTab(1);
    await settle();
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    const watcher = launched.remote.watch();
    await wait(1100); // the first second the page counts as used
    timeouts.mockClear();
    await wait(5000);
    const rests = timeouts.mock.calls.map(([, delay]) => delay);
    expect(rests.length).toBeGreaterThan(4);
    expect(new Set(rests)).toEqual(new Set([800]));
    watcher.close();
  });

  it('starts again at 150 ms after a change and rests a quarter longer each time nothing changes', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    collect(watcher);
    await wait(1100); // the first second the page counts as used
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    launched.page.jpeg = fakeJpeg({ tag: 'changed' });
    await wait(10_000);
    const rests = timeouts.mock.calls.map(([, delay]) => delay);
    const start = rests.indexOf(150);
    expect(start).toBeGreaterThanOrEqual(0);
    const grown = rests.slice(start, start + 10);
    expect(grown.slice(0, 5)).toEqual([
      150,
      150 * 1.25,
      150 * 1.25 ** 2,
      150 * 1.25 ** 3,
      150 * 1.25 ** 4,
    ]);
    expect(grown[7]).toBeCloseTo(150 * 1.25 ** 7, 6);
    expect(grown.slice(-2)).toEqual([800, 800]);
    watcher.close();
  });

  it('rests six times as long as a picture took, however little has changed', async () => {
    const launched = launch();
    launched.page.behave('screenshot', { delayMs: 100 });
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(4000); // it has not changed for a long time ...
    launched.page.jpeg = fakeJpeg({ tag: 'changed' });
    await wait(2000); // ... and now it did
    expect(frames).toHaveLength(2);
    const shownAt = frames[1]?.at ?? 0;
    const nextShot = shotTimes(launched).find((at) => at > shownAt) ?? 0;
    // (the pause after a picture that was new is 150 ms and no more, but not
    // less than six times the 100 ms that a picture took)
    expect(nextShot - shownAt).toBeGreaterThanOrEqual(600);
    watcher.close();
  });

  it.each([
    [
      'a page that loaded',
      (launched: Launched): Promise<unknown> => {
        launched.page.finishLoad();
        return Promise.resolve();
      },
    ],
    [
      'a page that navigated',
      (launched: Launched): Promise<unknown> => {
        launched.page.navigate('https://example.com/');
        return Promise.resolve();
      },
    ],
    [
      'another viewer',
      (launched: Launched): Promise<unknown> => {
        launched.remote.watch();
        return Promise.resolve();
      },
    ],
    [
      'a tab that is brought to the front',
      (launched: Launched): Promise<unknown> => launched.remote.activateTab(1),
    ],
  ])('come at once for %s', async (_what, act) => {
    const launched = launch();
    const watcher = launched.remote.watch();
    collect(watcher);
    await wait(5000);
    const before = shotTimes(launched).length;
    await act(launched);
    await settle();
    expect(shotTimes(launched).length).toBeGreaterThan(before);
    watcher.close();
  });

  it.each([
    [
      'the mouse moving',
      (launched: Launched) =>
        launched.page.mouse.behave('move', { delayMs: 500 }),
      (launched: Launched) => launched.remote.hover(5, 5),
    ],
    [
      'the mouse button going down',
      (launched: Launched) =>
        launched.page.mouse.behave('move', { delayMs: 500 }),
      (launched: Launched) => launched.remote.mouse('down', 5, 5),
    ],
    [
      'the wheel turning',
      (launched: Launched) =>
        launched.page.mouse.behave('move', { delayMs: 500 }),
      (launched: Launched) => launched.remote.wheel(5, 5, 0, 10),
    ],
    [
      'a click',
      (launched: Launched) =>
        launched.page.mouse.behave('click', { delayMs: 500 }),
      (launched: Launched) => launched.remote.clickAt(5, 5),
    ],
    [
      'a drag',
      (launched: Launched) =>
        launched.page.mouse.behave('move', { delayMs: 500 }),
      (launched: Launched) => launched.remote.drag(5, 5, 9, 9),
    ],
    [
      'a key',
      (launched: Launched) =>
        launched.page.keyboard.behave('press', { delayMs: 500 }),
      (launched: Launched) => launched.remote.key('press', 'a'),
    ],
    [
      'text',
      (launched: Launched) =>
        launched.page.keyboard.behave('insertText', { delayMs: 500 }),
      (launched: Launched) => launched.remote.insertText('hello'),
    ],
    [
      'a navigation',
      (launched: Launched) => launched.page.behave('goto', { delayMs: 500 }),
      (launched: Launched) => launched.remote.goto('https://example.com/'),
    ],
  ])(
    'come as soon as the page is used, not when that is done: %s',
    async (_what, slow, act) => {
      const launched = launch();
      const watcher = launched.remote.watch();
      collect(watcher);
      await wait(5000);
      slow(launched);
      const before = shotTimes(launched).length;
      const acting = track(act(launched));
      await settle();
      expect(acting.done).toBe(false);
      expect(shotTimes(launched).length).toBeGreaterThan(before);
      await wait(1000); // (a drag moves the mouse twice)
      expect(acting.done).toBe(true);
      watcher.close();
    },
  );

  it('has no pictures without a tab, and takes up again when one opens', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(1000);
    await launched.remote.closeTab(1);
    await settle();
    const shots = shotTimes(launched).length;
    await wait(5000);
    expect(shotTimes(launched).length).toBe(shots);
    const popup = launched.context.open('https://popup.example/');
    popup.jpeg = fakeJpeg({ tag: 'popup' });
    await wait(1000);
    expect(frames.at(-1)?.tab).toBe(2);
    watcher.close();
  });

  it('takes no pictures of a page that waits for an answer to a dialog', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    collect(watcher);
    launched.remote.attend(600_000);
    await wait(100);
    launched.page.openDialog('alert', 'Hello');
    await settle();
    const shots = shotTimes(launched).length;
    await wait(5000);
    expect(shotTimes(launched).length).toBe(shots);
    await launched.remote.answerDialog(1, { accept: true });
    await wait(100);
    expect(shotTimes(launched).length).toBeGreaterThan(shots);
    watcher.close();
  });

  it('tries again when a picture cannot be taken: the page is closing or navigating', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const launched = launch();
    launched.page.behave('screenshot', {
      error: playwrightError('page.screenshot: Target closed'),
      times: 3,
    });
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(500);
    expect(frames).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
    watcher.close();
  });

  it('logs a bug, waits a second and tries again', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const launched = launch();
    launched.page.behave('screenshot', {
      error: new TypeError('boom'),
      times: 1,
    });
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(999);
    expect(frames).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'could not take a picture',
      expect.any(TypeError),
    );
    await wait(1);
    expect(frames).toHaveLength(1);
    watcher.close();
  });

  it('drops a picture of a tab that is not in front any more', async () => {
    const launched = launch();
    launched.page.behave('screenshot', { delayMs: 100, times: 1 });
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(50);
    launched.context.open('https://popup.example/');
    await wait(1000);
    expect(frames.map((frame) => frame.tab)).toEqual([2]);
    watcher.close();
  });

  it('sends the picture of a tab again when it is activated again', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(1000);
    expect(frames).toHaveLength(1);
    await launched.remote.activateTab(1);
    await wait(1000);
    expect(frames).toHaveLength(2);
    watcher.close();
  });

  it('sends the pictures of other tabs even if they look the same', async () => {
    const launched = launch();
    launched.context.open('https://two.example/');
    const watcher = launched.remote.watch();
    const { frames } = collect(watcher);
    await wait(1000);
    await launched.remote.activateTab(1);
    await wait(1000);
    expect(frames.map((frame) => frame.tab)).toEqual([2, 1]);
    watcher.close();
  });

  it('takes a picture of the tab it is asked for, at the quality of a screenshot', async () => {
    const launched = launch();
    const second = launched.context.open('https://two.example/');
    second.jpeg = fakeJpeg({ tag: 'second' });
    const shot = await launched.remote.screenshot(2);
    expect(bytes(shot)).toEqual(bytes(second.jpeg));
    expect(
      launched.context.log.of(second.who, 'screenshot')[0]?.args[0],
    ).toMatchObject({
      type: 'jpeg',
      quality: 80,
      scale: 'css',
      caret: 'initial',
    });
    expect(bytes(await launched.remote.screenshot())).toEqual(
      bytes(second.jpeg),
    );
  });

  it('says so when a screenshot cannot be taken', async () => {
    const launched = launch();
    launched.page.behave('screenshot', {
      error: playwrightTimeout('page.screenshot: Timeout 5000ms exceeded.'),
    });
    await expectRemoteError(
      launched.remote.screenshot(),
      'Could not take a screenshot: the page is not ready.',
    );
  });
});

describe('watchers', () => {
  it('fail with a RemoteError when the browser is gone, also while they wait', async () => {
    const { remote } = launch();
    const watcher = remote.watch();
    await watcher.get();
    const waiting = capture(watcher.get());
    await wait(100);
    await remote.aclose();
    const outcome = await waiting;
    expect(outcome.ok).toBe(false);
    await expectRemoteError(watcher.get(), 'The browser has closed.');
  });

  it('get the picture that was waiting before they hear that the browser is gone', async () => {
    const { remote } = launch();
    const watcher = remote.watch();
    await wait(100);
    await remote.aclose();
    await expect(watcher.get()).resolves.toMatchObject({ tab: 1 });
    await expectRemoteError(watcher.get(), 'The browser has closed.');
  });

  it('fail at once for a viewer who comes after the browser is gone, and cost nothing', async () => {
    const launched = launch();
    await launched.remote.aclose();
    const watcher = launched.remote.watch();
    await expectRemoteError(watcher.get(), 'The browser has closed.');
    await wait(1000);
    expect(launched.context.log.count(launched.page.who, 'screenshot')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('end a wait when their viewer leaves', async () => {
    const { remote } = launch();
    const watcher = remote.watch();
    await watcher.get();
    const waiting = capture(watcher.get());
    await wait(50);
    watcher.close();
    await settle();
    const outcome = await waiting;
    expect(!outcome.ok && outcome.error).toBeInstanceOf(RemoteError);
    await expectRemoteError(watcher.get(), 'The picture feed is closed.');
  });
});

// -- dialogs --------------------------------------------------------------------

describe('dialogs', () => {
  const dialogEvents = (events: readonly RemoteEvent[]): RemoteEvent[] =>
    events.filter(
      (event) => event.type === 'dialog' || event.type === 'dialog_closed',
    );

  it('are dismissed when nobody is there to answer', async () => {
    const { remote, page } = launch();
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
    expect(remote.dialogs()).toEqual([]);
  });

  it('wait for the viewer, who is told', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    expect(dialog.result).toBeNull();
    const shown = {
      id: 1,
      tab: 1,
      kind: 'confirm',
      message: 'Sure?',
      default: '',
    };
    expect(remote.dialogs()).toEqual([shown]);
    expect(dialogEvents(events)).toEqual([{ type: 'dialog', dialog: shown }]);
    await remote.answerDialog(1, { accept: true });
    expect(dialog.result).toEqual({ accepted: true, text: undefined });
    expect(remote.dialogs()).toEqual([]);
    expect(dialogEvents(events).at(-1)).toEqual({
      type: 'dialog_closed',
      id: 1,
    });
  });

  it('can be dismissed by the viewer', async () => {
    const { remote, page } = launch();
    listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: false });
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
  });

  it('tell a prompt’s default and take the text of the answer', async () => {
    const { remote, page } = launch();
    listen(remote);
    const dialog = page.openDialog('prompt', 'Name?', 'Ann');
    await settle();
    expect(remote.dialogs()).toEqual([
      { id: 1, tab: 1, kind: 'prompt', message: 'Name?', default: 'Ann' },
    ]);
    await remote.answerDialog(1, { accept: true, text: 'Bob' });
    expect(dialog.result).toEqual({ accepted: true, text: 'Bob' });
  });

  it('do not take the text of an answer that is a no', async () => {
    const { remote, page } = launch();
    listen(remote);
    const dialog = page.openDialog('prompt', 'Name?', 'Ann');
    await settle();
    await remote.answerDialog(1, { accept: false, text: 'ignored' });
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
  });

  it('also come from a page that is about to be left', async () => {
    const { remote, page } = launch();
    listen(remote);
    page.openDialog('beforeunload', 'Leave?');
    await settle();
    expect(remote.dialogs()[0]?.kind).toBe('beforeunload');
  });

  it('wait for an assistant that is at work, not only for a viewer', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    const dialog = page.openDialog('alert', 'Hello');
    await settle();
    expect(dialog.result).toBeNull();
    expect(remote.dialogs()).toHaveLength(1);
    await remote.answerDialog(1, { accept: true });
    expect(dialog.result?.accepted).toBe(true);
  });

  it('are dismissed again once the assistant has been away for the time it said', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    await wait(59_999);
    const waiting = page.openDialog('alert', 'Hello');
    await settle();
    expect(waiting.result).toBeNull();
    await wait(1);
    const late = page.openDialog('alert', 'Too late');
    await settle();
    expect(late.result).toEqual({ accepted: false, text: undefined });
  });

  it('are not hurried by a shorter attendance', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    remote.attend(10);
    await wait(30_000);
    const dialog = page.openDialog('alert', 'Hello');
    await settle();
    expect(dialog.result).toBeNull();
  });

  it('are numbered, and listed oldest first', async () => {
    const { remote, page, context } = launch();
    listen(remote);
    const other = context.open('https://two.example/');
    page.openDialog('alert', 'First');
    other.openDialog('confirm', 'Second');
    await settle();
    expect(
      remote.dialogs().map((dialog) => [dialog.id, dialog.tab, dialog.message]),
    ).toEqual([
      [1, 1, 'First'],
      [2, 2, 'Second'],
    ]);
    await remote.answerDialog(1, { accept: true });
    expect(remote.dialogs().map((dialog) => dialog.id)).toEqual([2]);
  });

  it('are given up after two minutes without an answer', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    await wait(119_999);
    expect(dialog.result).toBeNull();
    expect(remote.dialogs()).toHaveLength(1);
    await wait(1);
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
    expect(remote.dialogs()).toEqual([]);
    expect(dialogEvents(events).at(-1)).toEqual({
      type: 'dialog_closed',
      id: 1,
    });
  });

  it('leave no timer behind when they are answered in time', async () => {
    const { remote, page, context } = launch();
    const { stop } = listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: true });
    stop();
    await wait(1500); // (the titles are polled once more after the last viewer left)
    expect(vi.getTimerCount()).toBe(0);
    await wait(300_000);
    expect(context.log.count(dialog.who, 'dismiss')).toBe(0);
    expect(context.log.count(dialog.who, 'accept')).toBe(1);
  });

  it('ignore an answer to a dialog that is not there (any more)', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: true });
    const told = events.length;
    await remote.answerDialog(1, { accept: true });
    await remote.answerDialog(99, { accept: false });
    expect(events).toHaveLength(told);
  });

  it('do not fail the answer when the page has dealt with them already', async () => {
    const { remote, page } = launch();
    listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    dialog.behave('accept', {
      error: playwrightError(
        'dialog.accept: Cannot accept dialog which is already handled!',
      ),
    });
    await settle();
    await expect(
      remote.answerDialog(1, { accept: true }),
    ).resolves.toBeUndefined();
    expect(remote.dialogs()).toEqual([]);
  });

  it('are dropped with their tab, and the viewer is told', async () => {
    const { remote, page, context } = launch();
    const { events } = listen(remote);
    const other = context.open('https://two.example/');
    const dialog = other.openDialog('alert', 'Hello');
    page.openDialog('alert', 'Stays');
    await settle();
    await other.close();
    await settle();
    expect(remote.dialogs().map((shown) => shown.message)).toEqual(['Stays']);
    expect(dialogEvents(events).at(-1)).toEqual({
      type: 'dialog_closed',
      id: 1,
    });
    expect(dialog.result).toBeNull();
    await wait(300_000);
    expect(dialog.result).toBeNull(); // nobody answers a dialog that is gone
  });

  it('are dismissed when the last viewer leaves, unless somebody still attends', async () => {
    const first = launch();
    const viewer = listen(first.remote);
    const dialog = first.page.openDialog('confirm', 'Sure?');
    await settle();
    viewer.stop();
    await settle();
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
    expect(first.remote.dialogs()).toEqual([]);

    const second = launch();
    second.remote.attend(60_000);
    const viewer2 = listen(second.remote);
    const kept = second.page.openDialog('confirm', 'Sure?');
    await settle();
    viewer2.stop();
    await settle();
    expect(kept.result).toBeNull();
    expect(second.remote.dialogs()).toHaveLength(1);

    const third = launch();
    const one = listen(third.remote);
    listen(third.remote);
    const stays = third.page.openDialog('confirm', 'Sure?');
    await settle();
    one.stop();
    await settle();
    expect(stays.result).toBeNull();
  });

  it('are not touched once the browser is gone, also when a viewer leaves afterwards', async () => {
    const { remote, page, context } = launch();
    const { stop } = listen(remote);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.aclose();
    stop();
    await wait(300_000);
    expect(dialog.result).toBeNull();
    expect(context.log.count(dialog.who, 'dismiss')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('are left to Playwright after the remote closed: nothing listens to the page', async () => {
    const { remote, page, context } = launch();
    await remote.aclose();
    expect(page.listenerCount('dialog')).toBe(0);
    expect(page.listenerCount('framenavigated')).toBe(0);
    expect(page.listenerCount('load')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
    expect(context.listenerCount('page')).toBe(0);
  });
});

describe('waiting for a dialog', () => {
  it('returns the dialog that is already there', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    page.openDialog('alert', 'Hello');
    await settle();
    await expect(remote.waitForDialog(1000)).resolves.toMatchObject({
      id: 1,
      message: 'Hello',
    });
  });

  it('returns the oldest dialog', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    page.openDialog('alert', 'First');
    page.openDialog('alert', 'Second');
    await settle();
    await expect(remote.waitForDialog(1000)).resolves.toMatchObject({
      message: 'First',
    });
  });

  it('waits for one to come', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    const waiting = capture(remote.waitForDialog(10_000));
    await wait(5000);
    page.openDialog('confirm', 'Sure?');
    await settle();
    const outcome = await waiting;
    expect(outcome.ok && outcome.value).toMatchObject({
      kind: 'confirm',
      message: 'Sure?',
    });
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // the dialog's own
  });

  it('gives up with null after the time it was given', async () => {
    const { remote } = launch();
    const waiting = track(remote.waitForDialog(1000));
    await wait(999);
    expect(waiting.done).toBe(false);
    await wait(1);
    expect(outcomeOf(waiting)).toEqual({ ok: true, value: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for ever when it is given no limit', async () => {
    const { remote, page } = launch();
    remote.attend(Number.POSITIVE_INFINITY);
    const waiting = track(remote.waitForDialog(Number.POSITIVE_INFINITY));
    await wait(24 * 60 * 60 * 1000);
    expect(waiting.done).toBe(false);
    page.openDialog('alert', 'At last');
    await settle();
    expect(outcomeOf(waiting)).toMatchObject({
      ok: true,
      value: { message: 'At last' },
    });
  });

  it('waits again after the dialog was answered', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    page.openDialog('alert', 'Hello');
    await settle();
    await remote.answerDialog(1, { accept: true });
    const waiting = capture(remote.waitForDialog(500));
    await wait(500);
    expect(await waiting).toEqual({ ok: true, value: null });
  });

  it('gives up when the browser is gone', async () => {
    const { remote } = launch();
    const waiting = capture(remote.waitForDialog(60_000));
    await wait(100);
    await remote.aclose();
    expect(await waiting).toEqual({ ok: true, value: null });
  });

  it('does not answer for a dialog that is dismissed because nobody attends', async () => {
    const { remote, page } = launch();
    const waiting = capture(remote.waitForDialog(100));
    page.openDialog('alert', 'Hello');
    await wait(100);
    expect(await waiting).toEqual({ ok: true, value: null });
  });
});

// -- lists the browser draws itself -----------------------------------------------

describe('drop-down lists', () => {
  const OPTIONS = [
    { label: 'Switzerland', selected: true },
    { label: 'Germany' },
    { label: 'France', disabled: true },
    { label: 'Mars', group: 'Far away' },
  ];

  function withSelect(): Launched & {
    select: ReturnType<FakePage['element']>;
  } {
    const launched = launch();
    const select = launched.page.element({
      tag: 'SELECT',
      rect: { x: 10.5, y: 20, width: 200, height: 24 },
      options: OPTIONS,
    });
    launched.page.answers.set('selectAt', () => select);
    return { ...launched, select };
  }

  const selects = (events: readonly RemoteEvent[]): RemoteEvent[] =>
    events.filter((event) => event.type === 'select');

  it('are reported to the viewer instead of clicked', async () => {
    const { remote, page, context, select } = withSelect();
    const { events } = listen(remote);
    await remote.mouse('down', 50, 30);
    expect(selects(events)).toEqual([
      {
        type: 'select',
        menu: {
          token: 1,
          x: 10.5,
          y: 20,
          width: 200,
          height: 24,
          options: [
            {
              label: 'Switzerland',
              selected: true,
              disabled: false,
              group: null,
            },
            { label: 'Germany', selected: false, disabled: false, group: null },
            { label: 'France', selected: false, disabled: true, group: null },
            {
              label: 'Mars',
              selected: false,
              disabled: false,
              group: 'Far away',
            },
          ],
        },
      },
    ]);
    expect(context.log.of(`${page.who}.mouse`)).toEqual([]);
    expect(select.disposed).toBe(false);
  });

  it('swallow the release of the press that opened them', async () => {
    const { remote, page, context } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30);
    await remote.mouse('up', 50, 30);
    expect(context.log.of(`${page.who}.mouse`)).toEqual([]);
    page.answers.set('selectAt', () => null);
    await remote.mouse('down', 400, 300);
    await remote.mouse('up', 400, 300);
    expect(context.log.names(`${page.who}.mouse`)).toEqual([
      `${page.who}.mouse.move`,
      `${page.who}.mouse.down`,
      `${page.who}.mouse.up`,
    ]);
  });

  it('do not swallow the release of a press that came after one that opened a list', async () => {
    const { remote, page, context } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30); // opens a list; its release never came
    page.answers.set('selectAt', () => null);
    await remote.mouse('down', 400, 300);
    await remote.mouse('up', 400, 300);
    expect(context.log.count(`${page.who}.mouse`, 'up')).toBe(1);
  });

  it('are chosen by the number of the option', async () => {
    const { remote, select, context } = withSelect();
    const { events } = listen(remote);
    await remote.mouse('down', 50, 30);
    const menu = events.find((event) => event.type === 'select');
    expect(menu?.type === 'select' && menu.menu.token).toBe(1);
    await remote.pickOption(1, 2);
    expect(select.chosen).toEqual([{ index: 2 }]);
    expect(context.log.of(select.who, 'selectOption')[0]?.args[1]).toEqual({
      timeout: 3000,
    });
    expect(select.disposed).toBe(true);
  });

  it('can be dismissed without a choice', async () => {
    const { remote, select } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30);
    await remote.pickOption(1, null);
    expect(select.chosen).toEqual([]);
    expect(select.disposed).toBe(true);
  });

  it('are only chosen from once, by their own token', async () => {
    const { remote, select } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30);
    await remote.pickOption(7, 1);
    expect(select.chosen).toEqual([]);
    expect(select.disposed).toBe(false);
    await remote.pickOption(1, 1);
    await remote.pickOption(1, 2);
    expect(select.chosen).toEqual([{ index: 1 }]);
  });

  it('still close when the choice cannot be made', async () => {
    const { remote, select } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30);
    select.behave('selectOption', {
      error: playwrightTimeout(
        'elementHandle.selectOption: Timeout 3000ms exceeded.',
      ),
    });
    await expect(remote.pickOption(1, 1)).resolves.toBeUndefined();
    expect(select.disposed).toBe(true);
  });

  it('replace the list that was open before', async () => {
    const { remote, page, select } = withSelect();
    const { events } = listen(remote);
    await remote.mouse('down', 50, 30);
    const second = page.element({ tag: 'SELECT', options: [{ label: 'A' }] });
    page.answers.set('selectAt', () => second);
    await remote.mouse('down', 50, 90);
    expect(select.disposed).toBe(true);
    expect(selects(events)).toHaveLength(2);
    await remote.pickOption(1, 0);
    expect(second.chosen).toEqual([]);
    await remote.pickOption(2, 0);
    expect(second.chosen).toEqual([{ index: 0 }]);
  });

  it('are not looked for under any other button than the left one', async () => {
    const { remote, page, context } = withSelect();
    const { events } = listen(remote);
    await remote.mouse('down', 50, 30, { button: 'right' });
    expect(selects(events)).toEqual([]);
    expect(context.log.count(page.who, 'evaluateHandle')).toBe(0);
    expect(context.log.of(`${page.who}.mouse`, 'down')[0]?.args).toEqual([
      { button: 'right', clickCount: 1 },
    ]);
  });

  it('are not found where there is none, and the handle of the answer is let go', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    await remote.mouse('down', 50, 30);
    expect(selects(events)).toEqual([]);
    expect(page.handles.filter((handle) => !handle.disposed)).toEqual([]);
    expect(page.handles).toHaveLength(1);
  });

  it('let the click through when looking for them fails: the page is navigating', async () => {
    const { remote, page, context } = launch();
    page.behave('evaluateHandle', {
      error: playwrightError(
        'page.evaluateHandle: Execution context was destroyed',
      ),
    });
    await remote.mouse('down', 50, 30);
    expect(context.log.count(`${page.who}.mouse`, 'down')).toBe(1);
  });

  it('are closed with the tab they were open in', async () => {
    const { remote, select, page } = withSelect();
    listen(remote);
    await remote.mouse('down', 50, 30);
    await page.close();
    await settle();
    expect(select.disposed).toBe(true);
    await remote.pickOption(1, 1);
    expect(select.chosen).toEqual([]);
  });

  it('stay open when another tab closes', async () => {
    const { remote, select, context } = withSelect();
    listen(remote);
    const other = context.open('https://two.example/');
    await remote.activateTab(1);
    await remote.mouse('down', 50, 30);
    await other.close();
    await settle();
    expect(select.disposed).toBe(false);
  });

  it('are closed when the last viewer leaves', async () => {
    const { remote, select } = withSelect();
    const viewer = listen(remote);
    await remote.mouse('down', 50, 30);
    viewer.stop();
    await settle();
    expect(select.disposed).toBe(true);
  });

  it('cannot be clicked open by an assistant, which is told what to do instead', async () => {
    const { remote, select, page, context } = withSelect();
    await expectRemoteError(
      remote.clickAt(50.4, 30.6),
      "The place 50, 31 is a drop-down list (options: Switzerland, Germany, France, Mars). Clicking it shows nothing: read the page, then choose with type_text, giving the list's element number and the option.",
    );
    expect(select.disposed).toBe(true);
    expect(context.log.count(`${page.who}.mouse`, 'click')).toBe(0);
  });

  it('name only the first twenty options to an assistant', async () => {
    const { remote, page } = launch();
    const select = page.element({
      tag: 'SELECT',
      options: Array.from({ length: 25 }, (_, index) => ({
        label: `Option ${index + 1}`,
      })),
    });
    page.answers.set('selectAt', () => select);
    const labels = Array.from(
      { length: 20 },
      (_, index) => `Option ${index + 1}`,
    ).join(', ');
    await expectRemoteError(
      remote.clickAt(1, 1),
      new RegExp(`\\(options: ${labels}, …\\)\\.`),
    );
    page.answers.set('selectAt', () =>
      page.element({
        tag: 'SELECT',
        options: Array.from({ length: 20 }, (_, index) => ({
          label: `Option ${index + 1}`,
        })),
      }),
    );
    await expectRemoteError(
      remote.clickAt(1, 1),
      new RegExp(`\\(options: ${labels}\\)\\.`),
    );
  });

  it('can be clicked by an assistant with another button', async () => {
    const { remote, page, context } = withSelect();
    await remote.clickAt(50, 30, { button: 'right' });
    expect(context.log.count(`${page.who}.mouse`, 'click')).toBe(1);
    expect(context.log.count(page.who, 'evaluateHandle')).toBe(0);
  });
});

// -- mouse and keyboard ---------------------------------------------------------

describe('mouse', () => {
  /** What the page's mouse was asked, as `[method, ...arguments]`. */
  const mouseCalls = (launched: Launched): unknown[][] =>
    launched.context.log
      .of(`${launched.page.who}.mouse`)
      .map((call) => entry(call.method, call.args));

  it('moves to a place once, not again while it is there', async () => {
    const launched = launch();
    await launched.remote.mouse('move', 5, 6);
    await launched.remote.mouse('move', 5, 6);
    await launched.remote.mouse('move', 7, 6);
    await launched.remote.mouse('move', 7, 8);
    expect(mouseCalls(launched)).toEqual([
      ['move', 5, 6],
      ['move', 7, 6],
      ['move', 7, 8],
    ]);
  });

  it('presses and releases at the place the viewer names', async () => {
    const launched = launch();
    await launched.remote.mouse('down', 10, 20);
    await launched.remote.mouse('up', 10, 20);
    expect(mouseCalls(launched)).toEqual([
      ['move', 10, 20],
      ['down', { button: 'left', clickCount: 1 }],
      ['up', { button: 'left', clickCount: 1 }],
    ]);
  });

  it('passes on the button and the number of clicks', async () => {
    const launched = launch();
    await launched.remote.mouse('down', 10, 20, { button: 'right', clicks: 2 });
    await launched.remote.mouse('up', 10, 20, { button: 'right', clicks: 2 });
    await launched.remote.mouse('down', 10, 20, { button: 'middle' });
    expect(mouseCalls(launched)).toEqual([
      ['move', 10, 20],
      ['down', { button: 'right', clickCount: 2 }],
      ['up', { button: 'right', clickCount: 2 }],
      ['down', { button: 'middle', clickCount: 1 }],
    ]);
  });

  it('follows the mouse to a new page: it does not know where it is any more', async () => {
    const launched = launch();
    await launched.remote.mouse('move', 5, 6);
    launched.page.navigate('https://example.com/');
    await launched.remote.mouse('move', 5, 6);
    expect(mouseCalls(launched)).toEqual([
      ['move', 5, 6],
      ['move', 5, 6],
    ]);
  });

  it('does not mind what the page refuses: it is navigating or closing', async () => {
    const launched = launch();
    launched.page.mouse.behave('move', {
      error: playwrightError('mouse.move: Target closed'),
    });
    launched.page.mouse.behave('down', {
      error: playwrightError('mouse.down: Target closed'),
    });
    launched.page.mouse.behave('up', {
      error: playwrightError('mouse.up: Target closed'),
    });
    await expect(launched.remote.mouse('move', 1, 1)).resolves.toBeUndefined();
    await expect(launched.remote.mouse('down', 2, 2)).resolves.toBeUndefined();
    await expect(launched.remote.mouse('up', 2, 2)).resolves.toBeUndefined();
  });

  it('does not hide a bug', async () => {
    const launched = launch();
    launched.page.mouse.behave('down', {
      error: new TypeError('x is not a function'),
    });
    const outcome = await capture(launched.remote.mouse('down', 1, 1));
    expect(!outcome.ok && outcome.error).toBeInstanceOf(TypeError);
  });

  it('turns the wheel at a place', async () => {
    const launched = launch();
    await launched.remote.wheel(100, 200, 0, 40);
    await launched.remote.wheel(100, 200, 5, -40);
    expect(mouseCalls(launched)).toEqual([
      ['move', 100, 200],
      ['wheel', 0, 40],
      ['wheel', 5, -40],
    ]);
  });

  it('does not mind what the page refuses when the wheel turns', async () => {
    const launched = launch();
    launched.page.mouse.behave('wheel', {
      error: playwrightError('mouse.wheel: closed'),
    });
    await expect(launched.remote.wheel(1, 1, 0, 1)).resolves.toBeUndefined();
  });

  it('scrolls in the middle of the page without a place', async () => {
    const launched = launch();
    launched.page.viewport = { width: 1000, height: 501 };
    await launched.remote.scroll(0, 100);
    expect(mouseCalls(launched)).toEqual([
      ['move', 500, 250.5],
      ['wheel', 0, 100],
    ]);
  });

  it('scrolls at the place it is given, without asking the page how big it is', async () => {
    const launched = launch();
    await launched.remote.scroll(10, 20, 30, 40);
    expect(mouseCalls(launched)).toEqual([
      ['move', 30, 40],
      ['wheel', 10, 20],
    ]);
    expect(launched.context.log.count(launched.page.who, 'evaluate')).toBe(0);
  });

  it('asks the page when only one of the two coordinates is given', async () => {
    const launched = launch();
    await launched.remote.scroll(0, 10, 30, null);
    await launched.remote.scroll(0, 10, null, 40);
    expect(launched.context.log.count(launched.page.who, 'evaluate')).toBe(2);
  });

  it('says why it cannot scroll, and that the page does not respond', async () => {
    const launched = launch();
    launched.page.behave('evaluate', {
      error: playwrightError('page.evaluate: Target closed\nCall log:'),
    });
    await expectRemoteError(
      launched.remote.scroll(0, 1),
      'Could not scroll: page.evaluate: Target closed',
    );
    launched.page.behaveNormally('evaluate');
    launched.page.behave('evaluate', { hang: true });
    const scrolling = track(launched.remote.scroll(0, 1));
    await wait(14_999);
    expect(scrolling.done).toBe(false);
    await wait(1);
    const outcome = outcomeOf(scrolling);
    expect(
      !outcome.ok &&
        outcome.error instanceof RemoteError &&
        outcome.error.message,
    ).toBe(NOT_RESPONDING);
  });

  it('clicks at a place, once or twice', async () => {
    const launched = launch();
    await launched.remote.clickAt(10, 20);
    await launched.remote.clickAt(10, 20, { count: 2 });
    await launched.remote.clickAt(30, 40, { button: 'right' });
    expect(mouseCalls(launched)).toEqual([
      ['move', 10, 20],
      ['click', 10, 20, { button: 'left', clickCount: 1 }],
      ['click', 10, 20, { button: 'left', clickCount: 2 }],
      ['move', 30, 40],
      ['click', 30, 40, { button: 'right', clickCount: 1 }],
    ]);
  });

  it('looks for a drop-down list under a left click only', async () => {
    const launched = launch();
    await launched.remote.clickAt(10, 20);
    await launched.remote.clickAt(10, 20, { button: 'middle' });
    const lookups = launched.context.log.of(
      launched.page.who,
      'evaluateHandle',
    );
    expect(lookups.map((call) => call.args)).toEqual([['selectAt', [10, 20]]]);
  });

  it('says why a click failed', async () => {
    const launched = launch();
    launched.page.mouse.behave('click', {
      error: playwrightError('mouse.click: Target closed\nCall log:'),
    });
    await expectRemoteError(
      launched.remote.clickAt(10.4, 20.6),
      'Could not click at 10, 21: mouse.click: Target closed',
    );
  });

  it('says why a click failed when the page could not even be looked at', async () => {
    const launched = launch();
    launched.page.behave('evaluateHandle', {
      error: playwrightError('page.evaluateHandle: closed'),
    });
    await expectRemoteError(
      launched.remote.clickAt(1, 2),
      'Could not click at 1, 2: page.evaluateHandle: closed',
    );
  });

  it('hovers', async () => {
    const launched = launch();
    await launched.remote.hover(15, 25);
    await launched.remote.hover(15, 25);
    expect(mouseCalls(launched)).toEqual([['move', 15, 25]]);
  });

  it('says why it could not hover', async () => {
    const launched = launch();
    launched.page.mouse.behave('move', {
      error: playwrightError('mouse.move: closed'),
    });
    await expectRemoteError(
      launched.remote.hover(1, 1),
      'Could not move the mouse: mouse.move: closed',
    );
  });

  it('drags: press, move in steps, release', async () => {
    const launched = launch();
    await launched.remote.drag(10, 20, 110, 220);
    expect(mouseCalls(launched)).toEqual([
      ['move', 10, 20],
      ['down'],
      ['move', 110, 220, { steps: 12 }],
      ['up'],
    ]);
    await launched.remote.hover(110, 220); // it is known where the mouse is now
    expect(mouseCalls(launched)).toHaveLength(4);
  });

  it('does not move when the press at the start of a drag fails', async () => {
    const launched = launch();
    launched.page.mouse.behave('down', {
      error: playwrightError('mouse.down: Target closed'),
    });
    await expectRemoteError(
      launched.remote.drag(5, 5, 9, 9),
      'Could not drag: mouse.down: Target closed',
    );
    expect(mouseCalls(launched).map(([method]) => method)).toEqual([
      'move',
      'down',
    ]);
  });

  it('lets go of the button when the move in the middle of a drag fails', async () => {
    const launched = launch();
    await launched.remote.hover(5, 5);
    launched.page.mouse.behave('move', {
      error: playwrightError('mouse.move: Target closed'),
    });
    await expectRemoteError(
      launched.remote.drag(5, 5, 9, 9),
      'Could not drag: mouse.move: Target closed',
    );
    expect(mouseCalls(launched).map(([method]) => method)).toEqual([
      'move',
      'down',
      'move',
      'up',
    ]);
  });

  it('does not press when the mouse could not be moved to the start of a drag', async () => {
    const launched = launch();
    launched.page.mouse.behave('move', {
      error: playwrightError('mouse.move: closed'),
    });
    await expectRemoteError(
      launched.remote.drag(5, 5, 9, 9),
      'Could not drag: mouse.move: closed',
    );
    expect(mouseCalls(launched).map(([method]) => method)).toEqual(['move']);
  });

  it('needs a tab for everything', async () => {
    const { remote } = launch();
    await remote.closeTab(1);
    await settle();
    const message = 'No tab is open.';
    await expectRemoteError(remote.mouse('move', 1, 1), message);
    await expectRemoteError(remote.wheel(1, 1, 0, 1), message);
    await expectRemoteError(remote.scroll(0, 1), message);
    await expectRemoteError(remote.clickAt(1, 1), message);
    await expectRemoteError(remote.hover(1, 1), message);
    await expectRemoteError(remote.drag(1, 1, 2, 2), message);
    await expectRemoteError(remote.key('press', 'a'), message);
    await expectRemoteError(remote.insertText('a'), message);
    await expectRemoteError(remote.selectedText(), message);
    await expectRemoteError(
      remote.clickElement(1),
      'Element 1 is unknown: read the page again to get current numbers.',
    );
  });
});

describe('keyboard', () => {
  const keyCalls = (launched: Launched): unknown[][] =>
    launched.context.log
      .of(`${launched.page.who}.keyboard`)
      .map((call) => entry(call.method, call.args));

  it('presses, holds and releases keys', async () => {
    const launched = launch();
    await launched.remote.key('down', 'Shift');
    await launched.remote.key('press', 'Enter');
    await launched.remote.key('up', 'Shift');
    await launched.remote.key('press', 'a');
    expect(keyCalls(launched)).toEqual([
      ['down', 'Shift'],
      ['press', 'Enter'],
      ['up', 'Shift'],
      ['press', 'a'],
    ]);
  });

  it('types a character that is not on a US keyboard as text', async () => {
    const launched = launch();
    for (const character of ['ü', '€', 'ö', '日', '👍', 'é']) {
      await launched.remote.key('down', character);
      await launched.remote.key('up', character);
      await launched.remote.key('press', character);
    }
    // down and press type; the release of a key that never went down does nothing
    expect(launched.page.keyboard.inserted).toEqual([
      'ü',
      'ü',
      '€',
      '€',
      'ö',
      'ö',
      '日',
      '日',
      '👍',
      '👍',
      'é',
      'é',
    ]);
  });

  it('ignores the keys of the viewer’s keyboard that have no counterpart', async () => {
    const launched = launch();
    await launched.remote.key('down', 'Dead');
    await launched.remote.key('up', 'Dead');
    await launched.remote.key('down', 'AltGraph');
    await launched.remote.key('up', 'AltGraph');
    expect(launched.page.keyboard.inserted).toEqual([]);
  });

  it('tells an assistant that presses a key that does not exist', async () => {
    const launched = launch();
    await expectRemoteError(
      launched.remote.key('press', 'Nonsense'),
      'Could not press Nonsense: keyboard.press: Unknown key: "Nonsense"',
    );
    await expectRemoteError(
      launched.remote.key('press', 'Dead'),
      /Could not press Dead/,
    );
  });

  it('says why another key press failed', async () => {
    const launched = launch();
    launched.page.keyboard.behave('press', {
      error: playwrightError('keyboard.press: Target closed'),
    });
    launched.page.keyboard.behave('down', {
      error: playwrightError('keyboard.down: Target closed'),
    });
    launched.page.keyboard.behave('up', {
      error: playwrightError('keyboard.up: Target closed'),
    });
    await expectRemoteError(
      launched.remote.key('press', 'Enter'),
      'Could not press Enter: keyboard.press: Target closed',
      'key_failed',
    );
    await expectRemoteError(
      launched.remote.key('down', 'Enter'),
      'Could not press Enter: keyboard.down: Target closed',
      'key_failed',
    );
    await expectRemoteError(
      launched.remote.key('up', 'Enter'),
      'Could not press Enter: keyboard.up: Target closed',
      'key_failed',
    );
  });

  it('does not hide a bug', async () => {
    const launched = launch();
    launched.page.keyboard.behave('press', {
      error: new TypeError('x is not a function'),
    });
    const outcome = await capture(launched.remote.key('press', 'a'));
    expect(!outcome.ok && outcome.error).toBeInstanceOf(TypeError);
  });

  it('inserts text, all of it at once', async () => {
    const launched = launch();
    await launched.remote.insertText('hello wörld\nsecond line');
    expect(launched.page.keyboard.inserted).toEqual([
      'hello wörld\nsecond line',
    ]);
  });

  it('does not mind that the page refuses to take the text', async () => {
    const launched = launch();
    launched.page.keyboard.behave('insertText', {
      error: playwrightError('keyboard.insertText: closed'),
    });
    await expect(launched.remote.insertText('x')).resolves.toBeUndefined();
    launched.page.keyboard.behaveNormally();
    launched.page.keyboard.behave('press', {
      error: playwrightError('keyboard.press: Unknown key: "ü"'),
    });
    launched.page.keyboard.behave('insertText', {
      error: playwrightError('keyboard.insertText: closed'),
    });
    await expect(launched.remote.key('press', 'ü')).resolves.toBeUndefined();
  });

  it('wakes the pictures: the page is being used', async () => {
    const launched = launch();
    const watcher = launched.remote.watch();
    await wait(5000);
    const before = launched.context.log.count(launched.page.who, 'screenshot');
    await launched.remote.key('press', 'a');
    await settle();
    expect(
      launched.context.log.count(launched.page.who, 'screenshot'),
    ).toBeGreaterThan(before);
    watcher.close();
  });
});

describe('the text that is selected', () => {
  it('is what the page says', async () => {
    const launched = launch();
    launched.page.selection = 'hello world';
    await expect(launched.remote.selectedText()).resolves.toBe('hello world');
  });

  it('is nothing when the page cannot say', async () => {
    const launched = launch();
    launched.page.selection = 'hello';
    launched.page.behave('evaluate', {
      error: playwrightError('page.evaluate: closed'),
    });
    await expect(launched.remote.selectedText()).resolves.toBe('');
  });

  it('is nothing when the page does not answer within 15 seconds', async () => {
    const launched = launch();
    launched.page.behave('evaluate', { hang: true });
    const asking = track(launched.remote.selectedText());
    await wait(14_999);
    expect(asking.done).toBe(false);
    await wait(1);
    expect(outcomeOf(asking)).toEqual({ ok: true, value: '' });
  });
});

// -- for AI assistants -------------------------------------------------------------

describe('reading a page', () => {
  const GO = {
    role: 'button',
    name: 'Go',
    value: null,
    href: null,
    state: null,
    x: 10,
    y: 20,
  };
  const NAME = {
    role: 'textbox',
    name: 'name',
    value: '',
    href: null,
    state: null,
    x: 30,
    y: 40,
  };

  function readable(
    launched: Launched,
    text = 'Hello',
  ): {
    go: ReturnType<FakePage['element']>;
    name: ReturnType<FakePage['element']>;
  } {
    const go = launched.page.element({ tag: 'BUTTON' });
    const name = launched.page.element({ tag: 'INPUT' });
    launched.page.currentUrl = 'https://example.com/form';
    launched.page.titleText = 'form';
    launched.page.reading = {
      items: [GO, NAME],
      elements: [go, name],
      text,
      scroll: '0-720 of 1500',
      document: 'https://example.com/form',
    };
    return { go, name };
  }

  it('tells the page, its elements by number, and where it is scrolled to', async () => {
    const launched = launch();
    readable(launched);
    expect(await launched.remote.readPage()).toEqual({
      url: 'https://example.com/form',
      title: 'form',
      text: 'Hello',
      elements: [
        { ref: 1, ...GO },
        { ref: 2, ...NAME },
      ],
      scroll: '0-720 of 1500',
      problem: null,
    });
  });

  it('lets go of everything it made, except the elements it numbered', async () => {
    const launched = launch();
    const { go, name } = readable(launched);
    await launched.remote.readPage();
    expect(launched.page.liveHandles()).toEqual([go, name]);
  });

  it('asks for at most 80 elements', async () => {
    const launched = launch();
    readable(launched);
    await launched.remote.readPage();
    expect(
      launched.context.log.of(launched.page.who, 'evaluateHandle')[0]?.args,
    ).toEqual(['readPage', 80]);
  });

  it('reads another tab when asked', async () => {
    const launched = launch();
    readable(launched);
    const other = launched.context.open('https://other.example/');
    other.titleText = 'other';
    other.reading = { ...other.reading, text: 'Other text' };
    const reading = await launched.remote.readPage(2);
    expect(reading).toMatchObject({
      url: 'https://other.example/',
      title: 'other',
      text: 'Other text',
    });
    expect(await launched.remote.readPage(1)).toMatchObject({ title: 'form' });
  });

  it('tidies the text: lines trimmed, empty ones gone, whatever ends them', async () => {
    const launched = launch();
    readable(launched, '  Hello  \r\n\r\n\t world next\u0085last\rone\n\n\n  ');
    expect((await launched.remote.readPage()).text).toBe(
      'Hello\nworld\nnext\nlast\none',
    );
  });

  it('shortens the text to 6000 characters', async () => {
    const launched = launch();
    readable(launched, 'a'.repeat(6000));
    expect((await launched.remote.readPage()).text).toBe('a'.repeat(6000));
    launched.page.reading = {
      ...launched.page.reading,
      text: `${'a'.repeat(6000)}b`,
    };
    expect((await launched.remote.readPage()).text).toBe(
      `${'a'.repeat(6000)}…`,
    );
  });

  it('does not cut a character in half when it shortens the text', async () => {
    const launched = launch();
    readable(launched, `${'a'.repeat(5999)}😀tail`);
    const { text } = await launched.remote.readPage();
    expect(text).toBe(`${'a'.repeat(5999)}…`);
  });

  it('numbers the elements again with every reading, and lets go of the old ones', async () => {
    const launched = launch();
    const first = readable(launched);
    await launched.remote.readPage();
    const next = launched.page.element({ tag: 'A' });
    launched.page.reading = {
      ...launched.page.reading,
      items: [GO],
      elements: [next],
    };
    await launched.remote.readPage();
    expect(first.go.disposed).toBe(true);
    expect(first.name.disposed).toBe(true);
    await expectRemoteError(
      launched.remote.clickElement(2),
      'Element 2 is unknown: read the page again to get current numbers.',
    );
    await launched.remote.clickElement(1);
    expect(launched.context.log.count(next.who, 'click')).toBe(1);
  });

  it('keeps the numbers of the last reading when a reading fails', async () => {
    const launched = launch();
    const { go } = readable(launched);
    await launched.remote.readPage();
    launched.page.behave('evaluateHandle', {
      error: playwrightError('page.evaluateHandle: closed'),
      times: 1,
    });
    await expectRemoteError(
      launched.remote.readPage(),
      'Could not read the page: page.evaluateHandle: closed',
    );
    expect(go.disposed).toBe(false);
    await launched.remote.clickElement(1);
    expect(launched.context.log.count(go.who, 'click')).toBe(1);
  });

  it('does not number an item whose element it did not get', async () => {
    const launched = launch();
    const { go } = readable(launched);
    launched.page.reading = { ...launched.page.reading, elements: [go] };
    const reading = await launched.remote.readPage();
    expect(reading.elements).toHaveLength(2);
    await expectRemoteError(
      launched.remote.clickElement(2),
      'Element 2 is unknown: read the page again to get current numbers.',
    );
  });

  it('says why a page did not load, and shows the page that failed', async () => {
    const launched = launch();
    readable(launched);
    const error =
      'about:neterror?e=dnsNotFound&u=http%3A//nope.invalid/&c=UTF-8&d=We%20can%E2%80%99t%20find%20that%20site.';
    launched.page.navigate(error);
    const reading = await launched.remote.readPage();
    expect(reading.problem).toBe('We can’t find that site.');
    expect(reading.url).toBe('http://nope.invalid/');
  });

  it('has the error code when the page did not load and nothing more is known, or a general word', async () => {
    const launched = launch();
    readable(launched);
    launched.page.navigate(
      'about:neterror?e=connectionFailure&u=http%3A//x.invalid/',
    );
    expect((await launched.remote.readPage()).problem).toBe(
      'connectionFailure',
    );
    launched.page.navigate('about:certerror?u=https%3A//x.invalid/&d=');
    expect((await launched.remote.readPage()).problem).toBe(
      'the page could not be loaded',
    );
    launched.page.navigate(
      'about:certerror?e=nssFailure2&d=Secure%20Connection%20Failed',
    );
    expect((await launched.remote.readPage()).problem).toBe(
      'Secure Connection Failed',
    );
  });

  it('has no problem to tell about for a page that loaded, whatever its text says', async () => {
    const launched = launch();
    readable(launched, 'about:neterror?d=nope');
    expect((await launched.remote.readPage()).problem).toBeNull();
  });

  it('looks again, up to three times, when the page is navigating', async () => {
    const launched = launch();
    readable(launched);
    launched.page.behave('evaluateHandle', {
      error: playwrightError(
        'page.evaluateHandle: Execution context was destroyed, most likely because of a navigation',
      ),
      times: 2,
    });
    const reading = track(launched.remote.readPage());
    await wait(799);
    expect(
      launched.context.log.count(launched.page.who, 'evaluateHandle'),
    ).toBe(2);
    expect(reading.done).toBe(false);
    await wait(1);
    const outcome = outcomeOf(reading);
    expect(outcome.ok && outcome.value.title).toBe('form');
    expect(
      launched.context.log.count(launched.page.who, 'evaluateHandle'),
    ).toBe(3);
  });

  it('gives up on a page that keeps navigating', async () => {
    const launched = launch();
    readable(launched);
    launched.page.behave('evaluateHandle', {
      error: playwrightError(
        'page.evaluateHandle: Execution context was destroyed, most likely because of a navigation\nCall log:',
      ),
    });
    const reading = capture(launched.remote.readPage());
    await wait(800);
    const outcome = await reading;
    expect(
      !outcome.ok &&
        outcome.error instanceof RemoteError &&
        outcome.error.message,
    ).toBe(
      'Could not read the page: page.evaluateHandle: Execution context was destroyed, most likely because of a navigation',
    );
    expect(
      launched.context.log.count(launched.page.who, 'evaluateHandle'),
    ).toBe(3);
  });

  it('does not look again for any other problem', async () => {
    const launched = launch();
    readable(launched);
    launched.page.behave('evaluateHandle', {
      error: playwrightError('page.evaluateHandle: Target closed'),
    });
    await expectRemoteError(
      launched.remote.readPage(),
      'Could not read the page: page.evaluateHandle: Target closed',
    );
    expect(
      launched.context.log.count(launched.page.who, 'evaluateHandle'),
    ).toBe(1);
  });

  it('says that the page does not respond after 15 seconds, and lets go of what it gets late', async () => {
    const launched = launch();
    readable(launched);
    launched.page.behave('evaluateHandle', { delayMs: 20_000 });
    const reading = track(launched.remote.readPage());
    await wait(14_999);
    expect(reading.done).toBe(false);
    await wait(1);
    const outcome = outcomeOf(reading);
    expect(
      !outcome.ok &&
        outcome.error instanceof RemoteError &&
        outcome.error.message,
    ).toBe(NOT_RESPONDING);
    await wait(5001);
    expect(launched.page.liveHandles()).toEqual([]);
  });

  it('does not respond while a dialog waits for an answer', async () => {
    const launched = launch();
    readable(launched);
    launched.remote.attend(600_000);
    launched.page.openDialog('alert', 'Hello');
    await settle();
    const reading = capture(launched.remote.readPage());
    await wait(15_000);
    const outcome = await reading;
    expect(
      !outcome.ok &&
        outcome.error instanceof RemoteError &&
        outcome.error.message,
    ).toBe(NOT_RESPONDING);
    await launched.remote.answerDialog(1, { accept: true });
    await settle();
    expect(launched.page.liveHandles()).toEqual([]);
  });

  it('is not misled by a page that answers with something else', async () => {
    const launched = launch();
    const { go, name } = readable(launched);
    launched.page.reading = {
      ...launched.page.reading,
      items: [{ ...GO, role: 5 }, NAME],
    };
    const outcome = await capture(launched.remote.readPage());
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).not.toBeInstanceOf(RemoteError);
    // it never got to the elements, and let go of what it made
    expect(launched.page.liveHandles()).toEqual([go, name]);
  });

  it('lets go of the elements it got when the rest of the answer is not right', async () => {
    const launched = launch();
    readable(launched);
    launched.page.reading = { ...launched.page.reading, scroll: 5 };
    const outcome = await capture(launched.remote.readPage());
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).not.toBeInstanceOf(RemoteError);
    expect(launched.page.liveHandles()).toEqual([]);
  });
});

describe('using an element of a page that was read', () => {
  async function read(
    tag = 'INPUT',
  ): Promise<{ launched: Launched; element: ReturnType<FakePage['element']> }> {
    const launched = launch();
    const element = launched.page.element({ tag });
    launched.page.reading = {
      items: [
        {
          role: 'textbox',
          name: 'name',
          value: '',
          href: null,
          state: null,
          x: 1,
          y: 2,
        },
      ],
      elements: [element],
      text: '',
      scroll: '0-720 of 720',
      document: 'about:blank',
    };
    await launched.remote.readPage();
    return { launched, element };
  }

  it('clicks it', async () => {
    const { launched, element } = await read('BUTTON');
    await launched.remote.clickElement(1);
    expect(launched.context.log.of(element.who, 'click')[0]?.args).toEqual([
      { timeout: 5000 },
    ]);
  });

  it('forgets where the mouse is: the click moved it', async () => {
    const { launched } = await read('BUTTON');
    await launched.remote.mouse('move', 5, 6);
    await launched.remote.clickElement(1);
    await launched.remote.mouse('move', 5, 6);
    expect(
      launched.context.log.count(`${launched.page.who}.mouse`, 'move'),
    ).toBe(2);
  });

  it('says why it could not click', async () => {
    const { launched, element } = await read('BUTTON');
    element.behave('click', {
      error: playwrightTimeout(
        'elementHandle.click: Timeout 5000ms exceeded.\nCall log:',
      ),
    });
    await expectRemoteError(
      launched.remote.clickElement(1),
      'Could not click element 1: elementHandle.click: Timeout 5000ms exceeded.',
    );
  });

  it('says that it does not know an element, whatever it is asked to do with it', async () => {
    const { launched } = await read();
    const message =
      'Element 7 is unknown: read the page again to get current numbers.';
    await expectRemoteError(launched.remote.clickElement(7), message);
    await expectRemoteError(launched.remote.fillElement(7, 'x'), message);
    await expectRemoteError(
      launched.remote.fillElement(0, 'x'),
      'Element 0 is unknown: read the page again to get current numbers.',
    );
  });

  it('fills a field', async () => {
    const { launched, element } = await read();
    await launched.remote.fillElement(1, 'by reference');
    expect(element.filled).toBe('by reference');
    expect(launched.context.log.of(element.who, 'fill')[0]?.args).toEqual([
      'by reference',
      { timeout: 5000 },
    ]);
    expect(launched.context.log.count(element.who, 'press')).toBe(0);
  });

  it('fills a field and presses enter', async () => {
    const { launched, element } = await read();
    await launched.remote.fillElement(1, 'query', { submit: true });
    expect(launched.context.log.of(element.who, 'press')[0]?.args).toEqual([
      'Enter',
      { timeout: 5000 },
    ]);
    await launched.remote.fillElement(1, 'query', { submit: false });
    expect(launched.context.log.count(element.who, 'press')).toBe(1);
  });

  it('chooses an option of a drop-down list by its label instead of filling it', async () => {
    const { launched, element } = await read('SELECT');
    await launched.remote.fillElement(1, 'Germany', { submit: true });
    expect(element.chosen).toEqual([{ label: 'Germany' }]);
    expect(element.filled).toBeNull();
    expect(
      launched.context.log.of(element.who, 'selectOption')[0]?.args[1],
    ).toEqual({ timeout: 5000 });
    expect(launched.context.log.count(element.who, 'press')).toBe(0);
  });

  it('says why it could not fill', async () => {
    const { launched, element } = await read();
    element.behave('fill', {
      error: playwrightTimeout('elementHandle.fill: Timeout 5000ms exceeded.'),
    });
    await expectRemoteError(
      launched.remote.fillElement(1, 'x'),
      'Could not type into element 1: elementHandle.fill: Timeout 5000ms exceeded.',
    );
    element.behaveNormally();
    element.behave('press', {
      error: playwrightError('elementHandle.press: gone'),
    });
    await expectRemoteError(
      launched.remote.fillElement(1, 'x', { submit: true }),
      'Could not type into element 1: elementHandle.press: gone',
    );
  });

  it('says why it could not choose', async () => {
    const { launched, element } = await read('SELECT');
    element.behave('selectOption', {
      error: playwrightTimeout(
        'elementHandle.selectOption: Timeout 5000ms exceeded.',
      ),
    });
    await expectRemoteError(
      launched.remote.fillElement(1, 'Mars'),
      'Could not type into element 1: elementHandle.selectOption: Timeout 5000ms exceeded.',
    );
  });
});

// -- the end ---------------------------------------------------------------------

describe('closing', () => {
  it('tells the listeners that the browser is gone, once, and then lets them go', async () => {
    const { remote, page } = launch();
    const { events } = listen(remote);
    expect(remote.closed).toBe(false);
    await remote.aclose();
    expect(remote.closed).toBe(true);
    expect(events.filter((event) => event.type === 'closed')).toEqual([
      { type: 'closed' },
    ]);
    const told = events.length;
    await remote.aclose();
    page.navigate('https://example.com/');
    expect(events).toHaveLength(told);
  });

  it('stops polling the titles', async () => {
    const { remote, page, context } = launch();
    listen(remote);
    await wait(3000);
    await remote.aclose();
    const polls = context.log.count(page.who, 'evaluate');
    await wait(30_000);
    expect(context.log.count(page.who, 'evaluate')).toBe(polls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start polling the titles for a listener who comes after it closed', async () => {
    const { remote, page, context } = launch();
    await remote.aclose();
    listen(remote);
    await wait(10_000);
    expect(context.log.count(page.who, 'evaluate')).toBe(0);
  });

  it('does not wait for what is under way in the browser', async () => {
    const { remote, context } = launch();
    context.onNewPage = (page) => {
      page.behave('goto', { hang: true });
    };
    await remote.openTab('https://slow.example/');
    await settle();
    await expect(remote.aclose()).resolves.toBeUndefined();
  });

  it('does not report on what the closing browser does to its tabs', async () => {
    const { remote, context, layouts } = launch();
    context.open('https://a.example/');
    await wait(500);
    await remote.aclose();
    for (const page of context.pages()) await page.close();
    await wait(10_000);
    expect(layouts).toHaveLength(1);
  });
});
