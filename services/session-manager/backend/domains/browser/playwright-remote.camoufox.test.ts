// The real thing: one headless Camoufox, driven through `PlaywrightRemote`, over
// the pages of `testing/test-pages.ts`. Opt in with `bun run test:camoufox`.
// What a fake page cannot show is checked here: that the browser does what
// the remote expects (characters off the US keyboard, lists and dialogs it
// draws itself, a page that blocks while a dialog waits). The remote runs as
// it does without a window (`windowed` off): it picks the tab in front.
//
// The browser is started once for the whole file. Every test gets a new
// remote on a context with one blank tab.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { firefox } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import type { TabLayout } from '../../lib/web-url.ts';
import { closedPort } from '../../testing/local-proxies.ts';
import { runProbe, SLOW_MS, startTestPages } from '../../testing/test-pages.ts';
import type { TestPages } from '../../testing/test-pages.ts';
import { PlaywrightRemote } from './playwright-remote.ts';
import { RemoteError } from './remote.ts';
import type { PageDialog } from './remote.ts';

// `launchOptions` of camoufox-js reads this when it is imported.
process.env.CAMOUFOX_INSTALL_DIR ??= fileURLToPath(
  new URL('../../../.camoufox-tests', import.meta.url),
);

let pages: TestPages;
let context: BrowserContext;
let profile: string;

let remote: PlaywrightRemote;
let layouts: TabLayout[];

beforeAll(async () => {
  pages = await startTestPages();
  const { launchOptions } = await import('camoufox-js');
  const options = await launchOptions({
    headless: true,
    os: 'windows',
    geoip: false,
    locale: 'en-US',
  });
  profile = mkdtempSync(join(tmpdir(), 'session-manager-remote-'));
  context = await firefox.launchPersistentContext(profile, {
    ...options,
    viewport: null,
  });
}, 600_000);

afterAll(async () => {
  await context?.close();
  await pages?.close();
  if (profile !== undefined) rmSync(profile, { recursive: true, force: true });
});

beforeEach(async () => {
  const [keep, ...extra] = context.pages();
  const page = keep ?? (await context.newPage());
  for (const other of extra) await other.close();
  await page.goto('about:blank');
  layouts = [];
  remote = makeRemote();
});

afterEach(async () => {
  // A dialog that is left open would block the next test's page for good.
  for (const dialog of remote.dialogs()) {
    await remote.answerDialog(dialog.id, { accept: false });
  }
  await remote.aclose();
});

function makeRemote(): PlaywrightRemote {
  return new PlaywrightRemote(context, {
    startPage: site('/storage.html'),
    onLayout: (layout) => {
      layouts.push(layout);
    },
    saveDelayMs: 50,
    removalDelayMs: 200,
  });
}

// -- helpers --------------------------------------------------------------------

const site = (path: string): string => pages.url(path);
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The Playwright page of the tab in front. */
function current(): Page {
  const index = remote.tabs().findIndex((tab) => tab.active);
  const page = context.pages()[index];
  if (page === undefined) throw new Error('no tab is in front');
  return page;
}

async function center(page: Page, selector: string): Promise<[number, number]> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not on the page`);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function open(path: string, tab?: number): Promise<Page> {
  await remote.goto(site(path), tab ?? null, 'load');
  return current();
}

const tabUrls = (): string[] => remote.tabs().map((tab) => tab.url);

/**
 * A click on a button that opens a dialog does not return before the dialog is
 * answered: it is made in the background. `finished` never rejects.
 */
function clickInBackground(
  x: number,
  y: number,
): { done: () => boolean; failure: () => unknown; finished: Promise<void> } {
  let done = false;
  let failure: unknown = null;
  const finished = (async () => {
    try {
      await remote.clickAt(x, y);
    } catch (error) {
      failure = error;
    }
    done = true;
  })();
  return { done: () => done, failure: () => failure, finished };
}

const poll = { timeout: 20_000, interval: 50 };

// -- seeing and using a page ------------------------------------------------------

describe('a page seen through the remote', () => {
  it('is a JPEG of the viewport', async () => {
    await open('/form.html');
    const shot = await remote.screenshot();
    expect(Array.from(shot.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(shot.length).toBeGreaterThan(1000);
  });

  it('shows the tab that is in front, or the one asked for', async () => {
    await open('/form.html');
    const form = Buffer.from(await remote.screenshot());
    await remote.openTab(site('/long.html'));
    await expect.poll(() => tabUrls()[1], poll).toBe(site('/long.html'));
    await context.pages()[1]?.waitForLoadState('load');
    expect(Buffer.from(await remote.screenshot()).equals(form)).toBe(false);
    expect(Buffer.from(await remote.screenshot(1)).equals(form)).toBe(true);
  });

  it('leaves no mark in the page when it is read', async () => {
    const page = await open('/read.html');
    await page.evaluate(() => {
      const records: string[] = [];
      Reflect.set(globalThis, '__records', records);
      new MutationObserver((changes) => {
        for (const change of changes) {
          records.push(`${change.type}:${change.target.nodeName}`);
        }
      }).observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await remote.readPage();
    await remote.screenshot();
    await remote.selectedText();
    await sleep(1500);
    expect(
      await page.evaluate(() => Reflect.get(globalThis, '__records')),
    ).toEqual([]);
  });
});

describe('the keyboard', () => {
  it('types US keys, other characters as text, editing keys and pasted text', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#name')));
    for (const key of ['A', 'b', 'ü', '€', 'Backspace']) {
      await remote.key('down', key);
      await remote.key('up', key);
    }
    await remote.insertText(' pasted');
    expect(await page.inputValue('#name')).toBe('Abü pasted');

    // A key of the viewer's keyboard that has no counterpart: nothing happens.
    await remote.key('down', 'Dead');
    await remote.key('up', 'Dead');
    // An assistant is told.
    await expect(remote.key('press', 'Nonsense')).rejects.toThrow(RemoteError);
    await expect(remote.key('press', 'Nonsense')).rejects.toThrow(/Nonsense/);
    // A press of a character that is not on a US keyboard.
    await remote.key('press', 'ö');
    expect(await page.inputValue('#name')).toBe('Abü pastedö');
    await remote.key('press', 'Backspace');
    expect(await page.inputValue('#name')).toBe('Abü pasted');
  });

  it('types characters of any script, emoji too', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#name')));
    for (const character of ['日', 'ß', '👍', 'é']) {
      await remote.key('down', character);
      await remote.key('up', character);
    }
    expect(await page.inputValue('#name')).toBe('日ß👍é');
  });

  it('holds keys down: shift for a capital, and select all', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#name')));
    // The viewer's keyboard says "A" with shift held, and "b" without it.
    await remote.key('down', 'Shift');
    await remote.key('down', 'A');
    await remote.key('up', 'A');
    await remote.key('up', 'Shift');
    await remote.key('down', 'b');
    await remote.key('up', 'b');
    expect(await page.inputValue('#name')).toBe('Ab');
    await remote.key('press', 'ControlOrMeta+a');
    expect(await remote.selectedText()).toBe('Ab');
    await remote.key('press', 'Delete');
    expect(await page.inputValue('#name')).toBe('');
  });

  it('presses a button with the keyboard', async () => {
    const page = await open('/form.html');
    await page.focus('#go');
    await remote.key('press', 'Enter');
    expect(await page.textContent('#log')).toContain('clicked');
  });
});

describe('the mouse', () => {
  it('clicks, as events', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#go')));
    expect(await page.textContent('#log')).toBe('clicked;');
    await remote.clickAt(...(await center(page, '#go')));
    expect(await page.textContent('#log')).toBe('clicked;clicked;');
  });

  it('does what an assistant asks: click, select a word, drag, hover, scroll', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#go')));
    expect(await page.textContent('#log')).toContain('clicked');

    const box = await page.locator('#name').boundingBox();
    if (box === null) throw new Error('no field');
    const y = box.y + box.height / 2;
    await remote.clickAt(box.x + 20, y);
    await remote.insertText('hello world');
    await remote.clickAt(box.x + 20, y, { count: 2 }); // a double click selects a word
    expect(await remote.selectedText()).toBe('hello');
    // a drag selects the line
    await remote.drag(box.x + 5, y, box.x + box.width - 5, y);
    expect(await remote.selectedText()).toBe('hello world');
    await remote.hover(...(await center(page, '#go')));
    expect(
      await page.evaluate(() =>
        document.querySelector('#go')?.matches(':hover'),
      ),
    ).toBe(true);

    // nothing to scroll, nothing breaks
    await remote.scroll(0, 100);
  });

  it('clicks with the right button and the middle one', async () => {
    const page = await open('/form.html');
    await page.evaluate(() => {
      const records: string[] = [];
      Reflect.set(globalThis, '__buttons', records);
      window.addEventListener('mousedown', (event) =>
        records.push(`down${event.button}`),
      );
      window.addEventListener('contextmenu', (event) => {
        records.push('menu');
        event.preventDefault();
      });
    });
    const [x, y] = await center(page, '#go');
    await remote.clickAt(x, y, { button: 'right' });
    await remote.clickAt(x, y, { button: 'middle' });
    expect(
      await page.evaluate(() => Reflect.get(globalThis, '__buttons')),
    ).toEqual(['down2', 'menu', 'down1']);
  });

  it('scrolls the page by the wheel, at a place or in the middle', async () => {
    const page = await open('/long.html');
    await remote.scroll(0, 100, 400, 300);
    await expect.poll(() => page.evaluate(() => scrollY), poll).toBe(100);
    await remote.scroll(0, 200);
    await expect.poll(() => page.evaluate(() => scrollY), poll).toBe(300);
    await remote.scroll(0, -100, 200, 200);
    await expect.poll(() => page.evaluate(() => scrollY), poll).toBe(200);
  });
});

describe('drop-down lists', () => {
  it('are left to the page when it draws them itself: several choices, a box, a list that is off', async () => {
    const page = await open('/lists.html');
    for (const selector of ['#multiple', '#box', '#off']) {
      await remote.clickAt(...(await center(page, selector)));
    }
    await remote.clickAt(...(await center(page, '#box')));
    await remote.clickAt(...(await center(page, '#multiple')));
    expect(await page.inputValue('#box')).not.toBe('');
  });

  it('cannot be clicked open by an assistant, which is told what to do', async () => {
    const page = await open('/form.html');
    await expect(
      remote.clickAt(...(await center(page, '#country'))),
    ).rejects.toThrow(
      /drop-down list \(options: Switzerland, Germany, France\)/,
    );
    // other things on the page can
    await remote.clickAt(...(await center(page, '#go')));
    expect(await page.textContent('#log')).toContain('clicked');
  });
});

describe('dialogs', () => {
  it('wait for the answer of an assistant at work', async () => {
    const page = await open('/form.html');
    remote.attend(60_000);
    const [x, y] = await center(page, '#ask');
    // The release of the button is what opens the dialog, and it does not
    // return before the dialog is answered.
    const clicking = clickInBackground(x, y);
    const opened = await remote.waitForDialog(10_000);
    expect(opened).toMatchObject({
      tab: 1,
      kind: 'confirm',
      message: 'Sure?',
    });
    expect(clicking.done()).toBe(false);
    expect(remote.dialogs()).toHaveLength(1);
    await remote.answerDialog(opened?.id ?? -1, { accept: true });
    await clicking.finished;
    await expect
      .poll(() => page.textContent('#log'), poll)
      .toContain('confirm=true');
    expect(remote.dialogs()).toEqual([]);
  });

  it('are dismissed when nobody is there to answer: the page is not kept waiting', async () => {
    const page = await open('/dialogs.html');
    for (const selector of ['#alert', '#confirm', '#prompt']) {
      await remote.clickAt(...(await center(page, selector)));
    }
    expect(await page.textContent('#log')).toBe(
      'alerted;confirm=false;prompt=null;',
    );
    expect(remote.dialogs()).toEqual([]);
  });

  it('wait for an assistant that is at work, and the click returns with the answer', async () => {
    const page = await open('/dialogs.html');
    remote.attend(60_000);
    const [x, y] = await center(page, '#confirm');
    const clicking = clickInBackground(x, y);
    const dialog = await remote.waitForDialog(10_000);
    expect(dialog).toMatchObject({ kind: 'confirm', message: 'Sure?' });
    expect(remote.dialogs()).toEqual([dialog]);
    expect(clicking.done()).toBe(false);
    await remote.answerDialog(dialog?.id ?? -1, { accept: true });
    await clicking.finished;
    expect(await page.textContent('#log')).toBe('confirm=true;');
    expect(remote.dialogs()).toEqual([]);
  });

  it('can be answered as an alert, a prompt with a text, and a prompt that is dismissed', async () => {
    const page = await open('/dialogs.html');
    remote.attend(60_000);
    const answers: [string, boolean, string | undefined][] = [
      ['#alert', true, undefined],
      ['#prompt', true, 'Bob'],
      ['#prompt', false, undefined],
    ];
    const seen: PageDialog[] = [];
    for (const [selector, accept, text] of answers) {
      const clicking = clickInBackground(...(await center(page, selector)));
      const dialog = await remote.waitForDialog(10_000);
      if (dialog === null) throw new Error('no dialog came');
      seen.push(dialog);
      await remote.answerDialog(dialog.id, { accept, text });
      await clicking.finished;
    }
    expect(seen.map((d) => [d.kind, d.message, d.default])).toEqual([
      ['alert', 'Heads up', ''],
      ['prompt', 'Name?', 'Ann'],
      ['prompt', 'Name?', 'Ann'],
    ]);
    expect(await page.textContent('#log')).toBe(
      'alerted;prompt=Bob;prompt=null;',
    );
  });

  it('are given up after a tab closes', async () => {
    const page = await open('/dialogs.html');
    remote.attend(60_000);
    await remote.openTab(site('/dialogs.html'));
    await expect.poll(() => tabUrls().length, poll).toBe(2);
    const second = context.pages()[1];
    if (second === undefined) throw new Error('no second page');
    await second.waitForLoadState('load');
    const clicking = clickInBackground(...(await center(second, '#alert')));
    expect(await remote.waitForDialog(10_000)).toMatchObject({ tab: 2 });
    await remote.closeTab(2);
    await expect.poll(() => remote.dialogs(), poll).toEqual([]);
    await clicking.finished; // the click of a page that is gone fails
    expect(clicking.failure()).toBeInstanceOf(RemoteError);
    expect(page.url()).toContain('/dialogs.html');
  });
});

// -- for AI assistants ---------------------------------------------------------------

describe('reading a page', () => {
  it('tells the text, what can be used and where the page is scrolled to', async () => {
    await open('/read.html');
    const reading = await remote.readPage();
    expect(reading).toMatchObject({
      url: site('/read.html'),
      title: 'read',
      problem: null,
    });
    expect(reading.text).toBe(
      'Reading test\nSome text in a paragraph.\nA link\nEmail address\nI agree\nDisabled button\nDiv button\nFar away',
    );
    expect(reading.scroll).toMatch(/^0-\d+ of \d+$/);
    // the button far below the first screen is not in view
    expect(
      reading.elements.map((e) => [e.ref, e.role, e.name, e.value, e.state]),
    ).toEqual([
      [1, 'link', 'A link', null, null],
      [2, 'textbox', 'Email address', 'a@b.c', null],
      [3, 'textbox', 'Password', null, 'password'],
      [4, 'checkbox', 'I agree', null, 'checked'],
      [5, 'button', 'Disabled button', null, 'disabled'],
      [6, 'textbox', 'Notes', '', null],
      [7, 'button', 'Div button', null, null],
      [8, 'select', 'Size', 'M', null],
    ]);
    expect(reading.elements[0]?.href).toBe(site('/storage.html'));
    expect(reading.elements.every((e) => e.x > 0 && e.y > 0)).toBe(true);
  });

  it('numbers the elements so that they can be used', async () => {
    const page = await open('/read.html');
    const reading = await remote.readPage();
    const ref = (name: string): number => {
      const found = reading.elements.find((e) => e.name === name);
      if (found === undefined) throw new Error(`no element called ${name}`);
      return found.ref;
    };
    // (Playwright appends to a filled email or number field in Firefox: use others)
    await remote.fillElement(ref('Password'), 'hunter2');
    expect(await page.inputValue('#pw')).toBe('hunter2');
    await remote.fillElement(ref('Notes'), 'two\nlines');
    expect(await page.inputValue('#notes')).toBe('two\nlines');
    await remote.fillElement(ref('Size'), 'L');
    expect(await page.inputValue('#size')).toBe('L');
    await remote.clickElement(ref('I agree'));
    expect(await page.isChecked('#agree')).toBe(false);
    await remote.clickElement(ref('A link'));
    await expect.poll(() => page.url(), poll).toBe(site('/storage.html'));
  });

  it('submits a field with enter', async () => {
    const page = await open('/form.html');
    const reading = await remote.readPage();
    const field = reading.elements.find((e) => e.role === 'textbox');
    expect(field).toMatchObject({ name: 'name', value: '' });
    await page.evaluate(() => {
      document.querySelector('#name')?.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && event.key === 'Enter') {
          document.querySelector('#log')!.textContent += 'entered;';
        }
      });
    });
    await remote.fillElement(field?.ref ?? -1, 'by reference', {
      submit: true,
    });
    expect(await page.inputValue('#name')).toBe('by reference');
    expect(await page.textContent('#log')).toContain('entered;');
  });

  it('knows an element only until the page is read again', async () => {
    await open('/read.html');
    expect((await remote.readPage()).elements).toHaveLength(8);
    await expect(remote.clickElement(99)).rejects.toThrow(
      'Element 99 is unknown: read the page again to get current numbers.',
    );
    await open('/form.html');
    expect((await remote.readPage()).elements).toHaveLength(4);
    await expect(remote.clickElement(5)).rejects.toThrow(
      'Element 5 is unknown: read the page again to get current numbers.',
    );
  });

  it('says why a page did not load', async () => {
    await open('/form.html');
    const closed = `http://127.0.0.1:${await closedPort()}/`; // nothing listens there
    await expect(remote.goto(closed, null, 'load')).rejects.toThrow(
      RemoteError,
    );
    const reading = await remote.readPage();
    expect(reading.problem).toBeTruthy();
    expect(reading.url).toBe(closed);
    expect(remote.tabs()[0]?.url).toBe(closed);
  });

  it('says that the page does not respond while a dialog waits for an answer', async () => {
    const page = await open('/dialogs.html');
    remote.attend(60_000);
    const clicking = clickInBackground(...(await center(page, '#alert')));
    const dialog = await remote.waitForDialog(10_000);
    expect(dialog?.kind).toBe('alert');
    await expect(remote.readPage()).rejects.toThrow(/does not respond/);
    await remote.answerDialog(dialog?.id ?? -1, { accept: true });
    await clicking.finished;
    expect((await remote.readPage()).title).toBe('dialogs');
  }, 60_000);
});

describe('text that is selected', () => {
  it('is what a field has selected', async () => {
    const page = await open('/form.html');
    await remote.clickAt(...(await center(page, '#name')));
    await remote.insertText('hello world');
    await remote.key('press', 'ControlOrMeta+a');
    expect(await remote.selectedText()).toBe('hello world');
  });

  it('is what the page has selected, and nothing when nothing is', async () => {
    const page = await open('/read.html');
    expect(await remote.selectedText()).toBe('');
    const box = await page.locator('p').first().boundingBox();
    if (box === null) throw new Error('no paragraph');
    const y = box.y + box.height / 2;
    await remote.drag(box.x + 1, y, box.x + box.width - 1, y);
    expect(await remote.selectedText()).toContain('Some text in a paragraph.');
  });
});

// -- tabs ------------------------------------------------------------------------------

describe('tabs', () => {
  it('open, switch, navigate and close', async () => {
    expect(remote.tabs()).toEqual([
      { id: 1, url: '', title: '', loading: false, active: true },
    ]);
    await remote.goto(site('/storage.html'), null, 'load');
    const second = await remote.openTab(site('/form.html'));
    const third = await remote.openTab(site('/long.html'));
    expect([second.id, third.id]).toEqual([2, 3]);
    await expect
      .poll(tabUrls, poll)
      .toEqual([site('/storage.html'), site('/form.html'), site('/long.html')]);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      false,
      true,
    ]);

    await remote.activateTab(2);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      true,
      false,
    ]);

    // history
    await remote.goto(site('/lists.html'), 2, 'load');
    expect(tabUrls()[1]).toBe(site('/lists.html'));
    await remote.history('back', 2);
    await expect.poll(() => tabUrls()[1], poll).toBe(site('/form.html'));
    await remote.history('forward');
    await expect.poll(() => tabUrls()[1], poll).toBe(site('/lists.html'));
    await remote.history('reload');
    await expect.poll(() => remote.tabs()[1]?.loading, poll).toBe(false);
    expect(tabUrls()[1]).toBe(site('/lists.html'));

    // the one before it comes to the front when the tab in front closes
    await remote.closeTab(2);
    await expect.poll(() => remote.tabs().length, poll).toBe(2);
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [1, true],
      [3, false],
    ]);
    await remote.closeTab(3);
    await expect.poll(() => remote.tabs().length, poll).toBe(1);
    await expect(remote.closeTab(3)).rejects.toThrow('There is no such tab.');
  });

  it('come to the front when a page opens them', async () => {
    const page = await open('/links.html');
    await remote.clickAt(...(await center(page, '#blank')));
    await expect
      .poll(tabUrls, poll)
      .toEqual([site('/links.html'), site('/storage.html')]);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([false, true]);

    await remote.activateTab(1);
    await remote.clickAt(...(await center(current(), '#popup')));
    await expect.poll(() => remote.tabs().length, poll).toBe(3);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      false,
      true,
    ]);
    await expect.poll(() => tabUrls()[2], poll).toBe(site('/form.html'));
  });

  it('have the titles of their pages on request', async () => {
    await open('/form.html');
    await remote.openTab(site('/long.html'));
    await expect.poll(() => tabUrls().length, poll).toBe(2);
    await expect.poll(() => tabUrls()[1], poll).toBe(site('/long.html'));
    await expect
      .poll(async () => (await remote.listTabs()).map((tab) => tab.title), poll)
      .toEqual(['form', 'long']);
    await remote.goto(site('/storage.html'), 1, 'load');
    await expect
      .poll(async () => (await remote.listTabs())[0]?.title, poll)
      .toBe('storage');
  });

  it('are told to onLayout, and a closing browser does not make them forgotten', async () => {
    await remote.goto(site('/storage.html'), null, 'load');
    await remote.openTab(site('/form.html'));
    await remote.openTab(site('/long.html'));
    await remote.activateTab(2);
    const urls = [
      site('/storage.html'),
      site('/form.html'),
      site('/long.html'),
    ];
    await expect.poll(() => layouts.at(-1), poll).toEqual({ urls, active: 1 });

    // the browser dies: its tabs close one by one
    remote.freeze({ flush: false });
    for (const page of context.pages()) await page.close();
    await sleep(800);
    expect(layouts.at(-1)).toEqual({ urls, active: 1 });
  });
});

describe('restoring tabs', () => {
  it('opens the addresses of an earlier session, the chosen one in front', async () => {
    const urls = [
      site('/storage.html'),
      site('/form.html'),
      site('/long.html'),
    ];
    await remote.restore(urls, 1);
    await expect.poll(tabUrls, poll).toEqual(urls);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      true,
      false,
    ]);
    await expect.poll(() => layouts.at(-1), poll).toEqual({ urls, active: 1 });
    // what is in front is what the assistant works in
    expect((await remote.readPage()).url).toBe(site('/form.html'));
    await expect
      .poll(async () => (await remote.listTabs()).map((tab) => tab.title), poll)
      .toEqual(['storage', 'form', 'long']);
  });

  it('opens a new browser with the tabs of the last one', async () => {
    await remote.goto(site('/storage.html'), null, 'load');
    await remote.openTab(site('/form.html'));
    await remote.openTab(site('/long.html'));
    await remote.activateTab(2);
    await expect.poll(() => layouts.at(-1)?.urls.length, poll).toBe(3);
    const last = layouts.at(-1);
    if (last === undefined) throw new Error('no layout was told');
    await remote.aclose();

    // a new browser: one blank tab
    const [keep, ...extra] = context.pages();
    for (const page of extra) await page.close();
    await keep?.goto('about:blank');
    layouts = [];
    remote = makeRemote();
    await remote.restore(last.urls, last.active);
    await expect.poll(tabUrls, poll).toEqual(last.urls);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('does not lose a tab that is still loading when the session stops', async () => {
    await remote.goto(site('/storage.html'), null, 'load');
    const slow = site('/slow.html'); // answers only after SLOW_MS
    await remote.openTab(slow);
    expect(remote.tabs()[1]).toMatchObject({ url: '', active: true });
    expect(remote.layout().urls).toEqual([site('/storage.html'), slow]);
    await expect
      .poll(() => layouts.at(-1)?.urls, poll)
      .toEqual([site('/storage.html'), slow]);
    await expect
      .poll(() => tabUrls()[1], { timeout: SLOW_MS + 20_000 })
      .toBe(slow);
  });

  it('does not wait longer than 5 seconds for pages that begin to load slowly', async () => {
    const slow = await startTestPages({ slowMs: 15_000 });
    try {
      const started = Date.now();
      await remote.restore([slow.url('/slow.html'), slow.url('/slow.html')], 0);
      const waited = Date.now() - started;
      expect(waited).toBeGreaterThanOrEqual(4900);
      expect(waited).toBeLessThan(8000);
      expect(remote.layout().urls).toHaveLength(2);
    } finally {
      await slow.close();
    }
  });
});

describe('the test pages', () => {
  it('include a fingerprint probe that runs in the browser', async () => {
    const probe = await runProbe(current(), site('/probe.html'));
    expect(probe.errors).toEqual({});
    expect(probe).toMatchObject({
      navigator: { userAgent: expect.stringContaining('Firefox/') },
      screen: { width: expect.any(Number) },
    });
    expect(probe.stableHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
