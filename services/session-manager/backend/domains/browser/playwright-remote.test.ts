import type { BrowserContext } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TabLayout } from '../../lib/web-url.ts';
import { FakeContext } from '../../testing/fake-playwright.ts';
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
  PlaywrightRemote,
  pointerPlace,
} from './playwright-remote.ts';
import { PageNotRespondingError, RemoteError } from './remote.ts';
import type { Remote } from './remote.ts';

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
    windowed?: boolean;
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
    windowed: options.windowed,
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
): Promise<void> {
  const outcome = await capture(work);
  if (outcome.ok) throw new Error('expected a RemoteError, but it succeeded');
  expect(outcome.error).toBeInstanceOf(RemoteError);
  if (!(outcome.error instanceof RemoteError)) return;
  if (typeof message === 'string') expect(outcome.error.message).toBe(message);
  else expect(outcome.error.message).toMatch(message);
}

/** `[method, ...arguments]` of a call, without the arguments that were not given. */
function entry(method: string, args: readonly unknown[]): unknown[] {
  const result: unknown[] = [method];
  result.push(...args.filter((arg) => arg !== undefined));
  return result;
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

describe('pointerPlace', () => {
  const page = { width: 800, height: 600 };

  it('keeps a place on the page as it is', () => {
    expect(pointerPlace(10.5, 20.25, page)).toEqual({ x: 10.5, y: 20.25 });
    expect(pointerPlace(799, 598, page)).toEqual({ x: 799, y: 598 });
  });

  it('moves a place on the first or the last row of the page one row further in', () => {
    expect(pointerPlace(31, 0, page)).toEqual({ x: 31, y: 1 });
    expect(pointerPlace(31, 0.6, page)).toEqual({ x: 31, y: 1 });
    expect(pointerPlace(31, 599, page)).toEqual({ x: 31, y: 598 });
    expect(pointerPlace(31, 598.7, page)).toEqual({ x: 31, y: 598 });
  });

  it('leaves the first and the last column alone', () => {
    expect(pointerPlace(0, 300, page)).toEqual({ x: 0, y: 300 });
    expect(pointerPlace(799, 300, page)).toEqual({ x: 799, y: 300 });
  });

  it('puts a place beside the page on its edge', () => {
    expect(pointerPlace(-20, -20, page)).toEqual({ x: 0, y: 1 });
    expect(pointerPlace(900, 700, page)).toEqual({ x: 799, y: 598 });
    expect(pointerPlace(799.5, 300, page)).toEqual({ x: 799, y: 300 });
  });

  it('keeps a place off the first row and on the page on the left while its size is not known', () => {
    expect(pointerPlace(-3, 0, null)).toEqual({ x: 0, y: 1 });
    expect(pointerPlace(5000, 5000, null)).toEqual({ x: 5000, y: 5000 });
  });

  it('puts every place of a page lower than three rows on its second row', () => {
    expect(pointerPlace(5, 0, { width: 10, height: 2 })).toEqual({
      x: 5,
      y: 1,
    });
    expect(pointerPlace(5, 9, { width: 10, height: 1 })).toEqual({
      x: 5,
      y: 1,
    });
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
    page.navigateSubframe();
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
    page.emit('close', page);
    page.emit('close', page);
    await settle();
    expect(remote.tabs()).toEqual([]);
  });

  it('forgets a page that closed', async () => {
    const { remote, page } = launch();
    await page.close();
    await settle();
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
    await expectRemoteError(remote.closeTab(42), 'There is no such tab.');
    await expectRemoteError(remote.activateTab(42), 'There is no such tab.');
    await expectRemoteError(
      remote.goto('https://x.example/', 42),
      'There is no such tab.',
    );
    await expectRemoteError(
      remote.history('back', 42),
      'There is no such tab.',
    );
    await expectRemoteError(remote.readPage(42), 'There is no such tab.');
    await expectRemoteError(remote.screenshot(42), 'There is no such tab.');
  });

  it('leaves it at a closed tab if the page was already gone', async () => {
    const { remote, page } = launch();
    page.behave('close', {
      error: playwrightError('page.close: Target closed'),
    });
    await expect(remote.closeTab(1)).resolves.toBeUndefined();
  });

  it('activates a tab and brings it to the front', async () => {
    const { remote, context } = launch();
    const { id } = await remote.openTab('https://two.example/');
    await settle();
    context.log.clear();
    await remote.activateTab(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([true, false]);
    expect(
      context.log.count(context.pages()[0]?.who ?? '', 'bringToFront'),
    ).toBe(1);
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
    await expectRemoteError(remote.readPage(), 'No tab is open.');
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

  it('are not asked of a page that waits for an answer to a dialog', async () => {
    const { remote, page, context } = launch();
    remote.attend(60_000);
    page.openDialog('alert', 'Hello');
    await settle();
    page.titleText = 'Never asked';
    const tabs = await remote.listTabs();
    expect(tabs[0]?.title).toBe('');
    expect(context.log.count(page.who, 'evaluate')).toBe(0);
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
    await settle(); // the first page has come to the front: nothing waits for it
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

  it('schedules nothing without somebody to tell', async () => {
    const context = new FakeContext();
    const remote = new PlaywrightRemote(context, { startPage: START });
    remotes.push(remote);
    await settle(); // the first page has come to the front: nothing waits for it
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
    const restoring = track(remote.restore([A, B, C], 2));
    await settle();
    if (!restoring.done) {
      expect(remote.tabs().find((tab) => tab.active)?.id).toBe(1);
    }
    await wait(5000);
    expect(restoring.done).toBe(true);
    expect(remote.tabs().find((tab) => tab.active)?.id).toBe(3);
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

describe('dialogs', () => {
  it('are dismissed when nobody is there to answer', async () => {
    const { remote, page } = launch();
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
    expect(remote.dialogs()).toEqual([]);
  });

  it('wait for the assistant at work, who sees them', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
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
    await remote.answerDialog(1, { accept: true });
    expect(dialog.result).toEqual({ accepted: true, text: undefined });
    expect(remote.dialogs()).toEqual([]);
  });

  it('can be dismissed by the assistant', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: false });
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
  });

  it('tell a prompt’s default and take the text of the answer', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
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
    remote.attend(60_000);
    const dialog = page.openDialog('prompt', 'Name?', 'Ann');
    await settle();
    await remote.answerDialog(1, { accept: false, text: 'ignored' });
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
  });

  it('also come from a page that is about to be left', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
    page.openDialog('beforeunload', 'Leave?');
    await settle();
    expect(remote.dialogs()[0]?.kind).toBe('beforeunload');
  });

  it('wait for an assistant that is at work', async () => {
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
    remote.attend(60_000);
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
    remote.attend(600_000);
    const dialog = page.openDialog('confirm', 'Sure?');
    await wait(119_999);
    expect(dialog.result).toBeNull();
    expect(remote.dialogs()).toHaveLength(1);
    await wait(1);
    expect(dialog.result).toEqual({ accepted: false, text: undefined });
    expect(remote.dialogs()).toEqual([]);
  });

  it('leave no timer behind when they are answered in time', async () => {
    const { remote, page, context } = launch();
    remote.attend(10);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: true });
    await wait(1500); // (the tabs are saved half a second after a change)
    expect(vi.getTimerCount()).toBe(0);
    await wait(300_000);
    expect(context.log.count(dialog.who, 'dismiss')).toBe(0);
    expect(context.log.count(dialog.who, 'accept')).toBe(1);
  });

  it('ignore an answer to a dialog that is not there (any more)', async () => {
    const { remote, page, context } = launch();
    remote.attend(60_000);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.answerDialog(1, { accept: true });
    await remote.answerDialog(1, { accept: true });
    await remote.answerDialog(99, { accept: false });
    expect(context.log.count(dialog.who, 'accept')).toBe(1);
    expect(context.log.count(dialog.who, 'dismiss')).toBe(0);
  });

  it('do not fail the answer when the page has dealt with them already', async () => {
    const { remote, page } = launch();
    remote.attend(60_000);
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

  it('are dropped with their tab', async () => {
    const { remote, page, context } = launch();
    remote.attend(60_000);
    const other = context.open('https://two.example/');
    const dialog = other.openDialog('alert', 'Hello');
    page.openDialog('alert', 'Stays');
    await settle();
    await other.close();
    await settle();
    expect(remote.dialogs().map((shown) => shown.message)).toEqual(['Stays']);
    expect(dialog.result).toBeNull();
    await wait(300_000);
    expect(dialog.result).toBeNull(); // nobody answers a dialog that is gone
  });

  it('are not touched once the browser is gone', async () => {
    const { remote, page, context } = launch();
    remote.attend(60_000);
    const dialog = page.openDialog('confirm', 'Sure?');
    await settle();
    await remote.aclose();
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
    { label: 'Switzerland' },
    { label: 'Germany' },
    { label: 'France' },
    { label: 'Mars' },
  ];

  function withSelect(): Launched & {
    select: ReturnType<FakePage['element']>;
  } {
    const launched = launch();
    const select = launched.page.element({
      tag: 'SELECT',
      options: OPTIONS,
    });
    launched.page.answers.set('selectAt', () => select);
    return { ...launched, select };
  }

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

  /** How often the page ran the script of this name. */
  const asked = (launched: Launched, script: string): number =>
    launched.context.log
      .of(launched.page.who, 'evaluate')
      .filter((call) => call.args[0] === script).length;

  it('moves to a place once, not again while it is there', async () => {
    const launched = launch();
    await launched.remote.hover(5, 6);
    await launched.remote.hover(5, 6);
    await launched.remote.hover(7, 6);
    await launched.remote.hover(7, 8);
    expect(mouseCalls(launched)).toEqual([
      ['move', 5, 6],
      ['move', 7, 6],
      ['move', 7, 8],
    ]);
  });

  it('follows the mouse to a new page: it does not know where it is any more', async () => {
    const launched = launch();
    await launched.remote.hover(5, 6);
    launched.page.navigate('https://example.com/');
    await launched.remote.hover(5, 6);
    expect(mouseCalls(launched)).toEqual([
      ['move', 5, 6],
      ['move', 5, 6],
    ]);
  });

  it('turns the wheel at a place', async () => {
    const launched = launch();
    await launched.remote.scroll(0, 40, 100, 200);
    await launched.remote.scroll(5, -40, 100, 200);
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
    await expect(launched.remote.scroll(0, 1, 1, 1)).resolves.toBeUndefined();
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

  it('scrolls at the place it is given, without asking the page where its middle is', async () => {
    const launched = launch();
    await launched.remote.scroll(10, 20, 30, 40);
    expect(mouseCalls(launched)).toEqual([
      ['move', 30, 40],
      ['wheel', 10, 20],
    ]);
    expect(asked(launched, 'viewportSize')).toBe(0);
  });

  it('asks the page where its middle is when only one of the two coordinates is given', async () => {
    const launched = launch();
    await launched.remote.scroll(0, 10, 30, null);
    await launched.remote.scroll(0, 10, null, 40);
    expect(asked(launched, 'viewportSize')).toBe(2);
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

  it('does not take the mouse to be where a drag that failed began', async () => {
    const launched = launch();
    await launched.remote.hover(5, 5);
    launched.page.mouse.behave('move', {
      error: playwrightError('mouse.move: Target closed'),
      times: 1,
    });
    await capture(launched.remote.drag(5, 5, 9, 9));
    await launched.remote.hover(5, 5); // moved there anew
    expect(mouseCalls(launched).map(([method]) => method)).toEqual([
      'move',
      'down',
      'move',
      'up',
      'move',
    ]);
  });

  it('needs a tab for everything', async () => {
    const { remote } = launch();
    await remote.closeTab(1);
    await settle();
    const message = 'No tab is open.';
    await expectRemoteError(remote.scroll(0, 1, 1, 1), message);
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

  describe('on the first and the last row of the page', () => {
    // The browser can lose a mouse event there, and then takes no other one
    // (see `pointerPlace`): every event goes one row further in.

    it('turns the wheel, clicks, hovers and drags one row further in', async () => {
      const launched = launch(); // a page of 1280 x 720
      await launched.remote.scroll(0, 40, 50, 0);
      await launched.remote.clickAt(60, 0);
      await launched.remote.hover(70, 719.6);
      await launched.remote.drag(80, 0, 90, 719);
      expect(mouseCalls(launched)).toEqual([
        ['move', 50, 1],
        ['wheel', 0, 40],
        ['move', 60, 1],
        ['click', 60, 1, { button: 'left', clickCount: 1 }],
        ['move', 70, 718],
        ['move', 80, 1],
        ['down'],
        ['move', 90, 718, { steps: 12 }],
        ['up'],
      ]);
    });

    it('keeps the mouse on the page: a place beside it goes to its edge', async () => {
      const launched = launch();
      await launched.remote.hover(-40, 300);
      await launched.remote.hover(1500, 300);
      await launched.remote.hover(1279, 300); // there already
      await launched.remote.hover(0, 300.5);
      expect(mouseCalls(launched)).toEqual([
        ['move', 0, 300],
        ['move', 1279, 300],
        ['move', 0, 300.5],
      ]);
    });

    it('goes by the room the page has where its window has less than the viewport it reports', async () => {
      const launched = launch();
      launched.page.answers.set('roomOfPage', () => [1280, 720, 669]);
      await launched.remote.hover(10, 668);
      expect(mouseCalls(launched)).toEqual([['move', 10, 667]]);
    });

    it('measures the page once for all its mouse events', async () => {
      const launched = launch();
      await launched.remote.hover(1, 1);
      await launched.remote.hover(2, 2);
      await launched.remote.scroll(0, 1, 3, 3);
      await launched.remote.clickAt(4, 4);
      expect(asked(launched, 'roomOfPage')).toBe(1);
    });

    it('keeps off the first row while the size of the page is not known', async () => {
      const launched = launch();
      launched.page.answers.set('roomOfPage', () => {
        throw playwrightError('page.evaluate: busy');
      });
      await launched.remote.hover(31, 0);
      await launched.remote.hover(5000, 5000);
      expect(mouseCalls(launched)).toEqual([
        ['move', 31, 1],
        ['move', 5000, 5000],
      ]);
    });
  });

  describe('that the browser does not do in time', () => {
    // The browser does mouse events, wheel turns and switches of tabs one after
    // the other, for all its tabs: one that never ends holds up every other.
    const STUCK = /^The browser has stopped taking the mouse, in every tab: /;

    /** A browser whose mouse got stuck at 10, 10: what the test does next waits for nothing. */
    async function stuck(
      behaviour: { hang: true } | { delayMs: number } = { hang: true },
    ): Promise<Launched> {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const launched = launch();
      launched.page.mouse.behave('move', { ...behaviour, times: 1 });
      const moving = track(launched.remote.hover(10, 10));
      await wait(4999);
      expect(moving.done).toBe(false);
      await wait(1);
      const outcome = outcomeOf(moving);
      if (outcome.ok) throw new Error('the stuck move was not given up');
      expect(outcome.error).toBeInstanceOf(RemoteError);
      if (outcome.error instanceof RemoteError) {
        expect(outcome.error.message).toMatch(STUCK);
      }
      return launched;
    }

    it('is given up 5 seconds after it was due while its page was free, with the reason', async () => {
      await stuck();
    });

    it('makes every mouse event, wheel turn, click and drag after it fail at once, in every tab', async () => {
      const launched = await stuck();
      await launched.remote.openTab('https://two.example/');
      for (const work of [
        () => launched.remote.hover(20, 20),
        () => launched.remote.scroll(0, 10, 20, 20),
        () => launched.remote.clickAt(20, 20),
        () => launched.remote.drag(1, 1, 2, 2),
      ]) {
        await expectRemoteError(work(), STUCK);
      }
      // Nothing of it reached a page: only the stuck move did.
      expect(
        launched.context.log.of(`${launched.page.who}.mouse`),
      ).toHaveLength(1);
      const second = launched.context.pages()[1];
      expect(second && launched.context.log.of(`${second.who}.mouse`)).toEqual(
        [],
      );
    });

    it('leaves the keyboard, the address bar and the tabs working', async () => {
      const launched = await stuck();
      await launched.remote.key('press', 'a');
      await launched.remote.insertText('hello');
      await launched.remote.goto('https://example.com/');
      await launched.remote.openTab('https://two.example/');
      // A tab that cannot come to the front is the active one all the same.
      await launched.remote.activateTab(1);
      expect(launched.remote.tabs().map((tab) => tab.active)).toEqual([
        true,
        false,
      ]);
      expect(
        launched.context.log
          .of(`${launched.page.who}.keyboard`)
          .map((call) => entry(call.method, call.args)),
      ).toEqual([
        ['press', 'a'],
        ['insertText', 'hello'],
      ]);
      expect(launched.context.log.count(launched.page.who, 'goto')).toBe(1);
    });

    it('takes input again once the stuck event is done after all', async () => {
      const launched = await stuck({ delayMs: 8000 });
      await expectRemoteError(launched.remote.hover(20, 20), STUCK);
      await wait(3000); // the stuck move is done
      await launched.remote.hover(30, 30);
      expect(mouseCalls(launched)).toEqual([
        ['move', 10, 10],
        ['move', 30, 30],
      ]);
    });

    it('says so once in the log, however much input is refused', async () => {
      const launched = await stuck();
      await capture(launched.remote.hover(20, 20));
      await capture(launched.remote.scroll(0, 1, 20, 20));
      await capture(launched.remote.activateTab(1));
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        'the browser has stopped taking mouse input: an event was not done 5000 ms after its page was free',
      );
    });

    it('keeps a tab active that does not come to the front in time, and refuses the mouse after it', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const launched = launch();
      await launched.remote.openTab('https://two.example/');
      await settle();
      launched.page.behave('bringToFront', { hang: true });
      const activating = track(launched.remote.activateTab(1));
      await wait(5000);
      expect(activating.done).toBe(true);
      expect(outcomeOf(activating).ok).toBe(true);
      expect(launched.remote.tabs().find((tab) => tab.active)?.id).toBe(1);
      await expectRemoteError(launched.remote.hover(5, 5), STUCK);
    });

    it('is waited for while a dialog of its page waits for an answer, however long that takes', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const launched = launch();
      launched.remote.attend(60_000); // somebody to answer the dialog
      await launched.remote.hover(1, 1);
      // A click that opened confirm() returns once it is answered.
      launched.page.mouse.behave('click', { delayMs: 30_000, times: 1 });
      const clicking = track(launched.remote.clickAt(1, 1));
      await settle(); // the click has reached the page, which opens the dialog
      launched.page.openDialog('confirm', 'Sure?');
      await wait(29_999);
      expect(clicking.done).toBe(false);
      await wait(1);
      expect(outcomeOf(clicking).ok).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
      await launched.remote.hover(2, 2); // and the mouse is taken
      expect(mouseCalls(launched).at(-1)).toEqual(['move', 2, 2]);
    });

    it('is waited for while a script keeps its page busy, and taken once the page is free', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const launched = launch();
      await launched.remote.hover(1, 1);
      launched.page.behave('evaluate', { hang: true, times: 2 }); // it answers nothing for a while
      launched.page.mouse.behave('move', { delayMs: 12_000, times: 1 });
      const moving = track(launched.remote.hover(10, 10));
      await wait(13_000);
      expect(outcomeOf(moving).ok).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('is given up when its page has not answered for a minute', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const launched = launch();
      await launched.remote.hover(1, 1);
      launched.page.behave('evaluate', { hang: true });
      launched.page.mouse.behave('move', { hang: true, times: 1 });
      const moving = track(launched.remote.hover(10, 10));
      await wait(60_000);
      expect(moving.done).toBe(false);
      await wait(15_000);
      const outcome = outcomeOf(moving);
      expect(
        !outcome.ok &&
          outcome.error instanceof RemoteError &&
          STUCK.test(outcome.error.message),
      ).toBe(true);
    });

    it('makes a reload fail at once, instead of letting it wait behind and come as a surprise', async () => {
      const launched = await stuck();
      await expectRemoteError(launched.remote.history('reload'), STUCK);
      expect(launched.context.log.count(launched.page.who, 'reload')).toBe(0);
      // Back and forward do not wait for the mouse.
      await launched.remote.history('back');
      expect(launched.context.log.count(launched.page.who, 'goBack')).toBe(1);
    });

    it('makes a click on an element of a page that was read fail at once', async () => {
      const launched = await stuck();
      await expectRemoteError(launched.remote.clickElement(1), STUCK);
    });
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
    );
    await expectRemoteError(
      launched.remote.key('down', 'Enter'),
      'Could not press Enter: keyboard.down: Target closed',
    );
    await expectRemoteError(
      launched.remote.key('up', 'Enter'),
      'Could not press Enter: keyboard.up: Target closed',
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
    await launched.remote.hover(5, 6);
    await launched.remote.clickElement(1);
    await launched.remote.hover(5, 6);
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

// -- in a window -------------------------------------------------------------------

describe('a browser in a window', () => {
  it('has the pages keep when they were last used, where the page cannot see it', async () => {
    const windowed = launch({ windowed: true });
    await windowed.remote.restore(['https://a.example/']);
    expect(windowed.context.initScripts).toEqual(['watchInput']);
    const headless = launch();
    await headless.remote.restore(['https://a.example/']);
    expect(headless.context.initScripts).toEqual([]);
  });

  it('opens the pages of a start only once they keep when they were used', async () => {
    const { remote, context } = launch({ windowed: true });
    context.behave('addInitScript', { delayMs: 1000 });
    const restoring = remote.restore([
      'https://a.example/',
      'https://b.example/',
    ]);
    await wait(500);
    expect(context.log.count('context', 'newPage')).toBe(0);
    await wait(600);
    await restoring;
    expect(context.log.count('context', 'newPage')).toBe(1);
  });

  it('opens the pages of a start all the same when the watch is not taken in time, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { remote, context } = launch({ windowed: true });
    context.behave('addInitScript', { hang: true });
    const restoring = remote.restore([
      'https://a.example/',
      'https://b.example/',
    ]);
    await wait(16_000);
    await restoring;
    expect(context.log.count('context', 'newPage')).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      'could not watch the input of the pages',
      expect.any(Error),
    );
  });

  it('makes a tab the browser opened the active one, and leaves it where the browser put it', async () => {
    const { remote, context } = launch({ windowed: true });
    await settle();
    const popup = context.open('https://popup.example/');
    await settle();
    expect(context.log.count(popup.who, 'bringToFront')).toBe(0);
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('brings a tab it opened itself to the front: that is the tab to work in', async () => {
    const { remote, context } = launch({ windowed: true });
    const tab = await remote.openTab('https://two.example/');
    await settle();
    expect(tab.active).toBe(true);
    expect(
      context.log.count(context.pages()[1]?.who ?? '', 'bringToFront'),
    ).toBe(1);
  });

  it('does not choose a tab for the window when the active one closes', async () => {
    const { remote, context } = launch({ windowed: true });
    const second = await remote.openTab('https://two.example/');
    await settle();
    context.log.clear();
    await remote.closeTab(second.id);
    await settle();
    expect(
      context.log.entries.filter((call) => call.method === 'bringToFront'),
    ).toEqual([]);
  });

  it('works in the tab the person last clicked or typed in', async () => {
    const { remote, page, context } = launch({ windowed: true });
    await remote.openTab('https://two.example/');
    await settle();
    // The person went back to the first tab in the window, and clicked in it.
    page.inputAt = Date.now() + 1000;
    await wait(2000);
    await remote.goto('https://example.com/');
    expect(context.log.count(page.who, 'goto')).toBe(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([true, false]);
  });

  it('lists the tab the person last used as the active one', async () => {
    const { remote, page } = launch({ windowed: true });
    await remote.openTab('https://two.example/');
    await settle();
    page.inputAt = Date.now() + 1000;
    await wait(2000);
    const tabs = await remote.listTabs();
    expect(tabs.map((tab) => tab.active)).toEqual([true, false]);
  });

  it('saves the tab the person last used as the active one', async () => {
    const { remote, page, layouts } = launch({ windowed: true });
    await remote.restore(['https://one.example/', 'https://two.example/'], 1);
    await settle();
    page.inputAt = Date.now() + 1000;
    await wait(2000);
    await remote.followWindow();
    remote.freeze({ flush: true });
    expect(layouts.at(-1)).toEqual({
      urls: ['https://one.example/', 'https://two.example/'],
      active: 0,
    });
  });

  it('keeps the tab a tool chose over a click from before', async () => {
    const { remote, page } = launch({ windowed: true });
    await wait(1000);
    page.inputAt = Date.now();
    await wait(1000);
    await remote.openTab('https://two.example/');
    await settle();
    await remote.toFront();
    expect(remote.tabs().map((tab) => tab.active)).toEqual([false, true]);
  });

  it('skips a page that does not say when it was used', async () => {
    const { remote, page, context } = launch({ windowed: true });
    await remote.openTab('https://two.example/');
    await settle();
    page.answers.set('inputAt', () => {
      throw playwrightError('Execution context was destroyed');
    });
    context.pages()[1]?.answers.set('inputAt', () => 'soon');
    await remote.toFront();
    expect(remote.tabs().map((tab) => tab.active)).toEqual([false, true]);
  });

  it('brings the tab the person last used forward in its window', async () => {
    const { remote, page, context } = launch({ windowed: true });
    await remote.openTab('https://two.example/');
    await settle();
    page.inputAt = Date.now() + 1000;
    await wait(2000);
    context.log.clear();
    await remote.toFront();
    expect(context.log.count(page.who, 'bringToFront')).toBe(1);
  });

  it('types into the tab the person last used', async () => {
    const { remote, page, context } = launch({ windowed: true });
    await remote.openTab('https://two.example/');
    await settle();
    page.inputAt = Date.now() + 1000;
    await wait(2000);
    await remote.insertText('hunter2');
    expect(page.keyboard.inserted).toEqual(['hunter2']);
    expect(context.pages()[1]?.keyboard.inserted).toEqual([]);
  });

  it('tells whether what has the focus takes text', async () => {
    const { remote, page } = launch({ windowed: true });
    expect(await remote.takesText()).toBe(true);
    page.focusTakesText = false;
    expect(await remote.takesText()).toBe(false);
  });

  it('says that a page that does not tell what has the focus does not respond', async () => {
    const { remote, page } = launch({ windowed: true });
    page.answers.set('focusTakesText', () => new Promise(() => {}));
    const asking = remote.takesText();
    const failure = expectRemoteError(
      asking,
      'The page does not respond. A dialog (alert, confirm) may be waiting for an answer.',
    );
    await wait(1500);
    await failure;
    await expect(asking).rejects.toBeInstanceOf(PageNotRespondingError);
  });

  it('leaves a dialog to the person in the window while no assistant is at work', async () => {
    const { remote, page } = launch({ windowed: true });
    const dialog = page.openDialog('confirm', 'Sure?');
    await wait(300_000);
    expect(dialog.result).toBeNull();
    expect(remote.dialogs()).toEqual([]);
  });

  it('lets an assistant answer a dialog, and leaves it to the person when the assistant does not', async () => {
    const { remote, page } = launch({ windowed: true });
    remote.attend(600_000);
    const answered = page.openDialog('confirm', 'First?');
    await settle();
    await remote.answerDialog(1, { accept: true });
    expect(answered.result).toEqual({ accepted: true, text: undefined });
    const left = page.openDialog('confirm', 'Second?');
    await wait(120_000);
    expect(left.result).toBeNull();
    expect(remote.dialogs()).toEqual([]);
  });
});

// -- the end ---------------------------------------------------------------------

describe('closing', () => {
  it('is closed once, and leaves nothing running', async () => {
    const { remote, page } = launch();
    expect(remote.closed).toBe(false);
    await remote.aclose();
    expect(remote.closed).toBe(true);
    await remote.aclose();
    page.navigate('https://example.com/');
    expect(remote.tabs()[0]?.loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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
