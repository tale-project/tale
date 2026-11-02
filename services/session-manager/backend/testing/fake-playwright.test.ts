import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isPlaywrightError,
  jpegSize,
} from '../domains/browser/playwright-remote.ts';
import {
  CallLog,
  FakeContext,
  FakeElementHandle,
  FakeJSHandle,
  fakeJpeg,
  playwrightError,
  playwrightTimeout,
} from './fake-playwright.ts';
import type { FakePage } from './fake-playwright.ts';

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function onePage(): { context: FakeContext; page: FakePage } {
  const context = new FakeContext();
  const page = context.pages()[0];
  if (page === undefined) throw new Error('the context has no page');
  return { context, page };
}

describe('the call log', () => {
  it('records who did what with which arguments, and when', async () => {
    const { context, page } = onePage();
    await vi.advanceTimersByTimeAsync(250);
    await page.mouse.move(1, 2);
    await vi.advanceTimersByTimeAsync(50);
    await page.keyboard.press('a');
    expect(context.log.entries).toEqual([
      {
        who: `${page.who}.mouse`,
        method: 'move',
        args: [1, 2, undefined],
        at: 250,
      },
      { who: `${page.who}.keyboard`, method: 'press', args: ['a'], at: 300 },
    ]);
  });

  it('can be asked for the calls of one object, or one method', async () => {
    const { context, page } = onePage();
    await page.mouse.move(1, 2);
    await page.mouse.down();
    await page.mouse.move(3, 4);
    await page.keyboard.press('a');
    expect(context.log.count(`${page.who}.mouse`, 'move')).toBe(2);
    expect(context.log.of(`${page.who}.mouse`, 'down')).toHaveLength(1);
    expect(context.log.of(`${page.who}.mouse`)).toHaveLength(3);
    expect(context.log.names(`${page.who}.keyboard`)).toEqual([
      `${page.who}.keyboard.press`,
    ]);
    expect(context.log.of()).toHaveLength(4);
    context.log.clear();
    expect(context.log.entries).toEqual([]);
  });

  it('starts empty', () => {
    expect(new CallLog().entries).toEqual([]);
  });
});

describe('scripted behaviour', () => {
  it('fails the next calls, as many as asked, then goes back to normal', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { error: playwrightError('closed'), times: 2 });
    await expect(page.bringToFront()).rejects.toThrow('closed');
    await expect(page.bringToFront()).rejects.toThrow('closed');
    await expect(page.bringToFront()).resolves.toBeUndefined();
  });

  it('fails all calls without a count', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { error: playwrightError('closed') });
    for (let call = 0; call < 5; call++) {
      await expect(page.bringToFront()).rejects.toThrow('closed');
    }
  });

  it('takes time, on the clock the test uses', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { delayMs: 300 });
    let done = false;
    const calling = page.bringToFront().then(() => {
      done = true;
      return done;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await calling).toBe(true);
  });

  it('takes time, then fails', async () => {
    const { page } = onePage();
    page.behave('bringToFront', {
      delayMs: 100,
      error: playwrightError('late'),
    });
    const calling = page.bringToFront().then(
      () => 'ok',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    await vi.advanceTimersByTimeAsync(99);
    await settle();
    let state = 'waiting';
    void calling.then((value) => {
      state = value;
      return value;
    });
    await settle();
    expect(state).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(await calling).toBe('late');
  });

  it('never returns when told to hang', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { hang: true });
    let done = false;
    void page.bringToFront().then(() => {
      done = true;
      return done;
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(done).toBe(false);
  });

  it('uses the first rule that still applies', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { error: playwrightError('first'), times: 1 });
    page.behave('bringToFront', { error: playwrightError('second'), times: 1 });
    await expect(page.bringToFront()).rejects.toThrow('first');
    await expect(page.bringToFront()).rejects.toThrow('second');
    await expect(page.bringToFront()).resolves.toBeUndefined();
  });

  it('can be forgotten, for one method or for all', async () => {
    const { page } = onePage();
    page.behave('bringToFront', { error: playwrightError('x') });
    page.behave('close', { error: playwrightError('y') });
    page.behaveNormally('bringToFront');
    await expect(page.bringToFront()).resolves.toBeUndefined();
    await expect(page.close()).rejects.toThrow('y');
    page.behaveNormally();
    await expect(page.close()).resolves.toBeUndefined();
  });

  it('is kept apart for every object', async () => {
    const { page } = onePage();
    page.mouse.behave('move', { error: playwrightError('mouse') });
    await expect(page.mouse.move(1, 1)).rejects.toThrow('mouse');
    await expect(page.keyboard.press('a')).resolves.toBeUndefined();
    await expect(page.mouse.down()).resolves.toBeUndefined();
  });

  it('does nothing before the call has returned its promise, like a real browser', async () => {
    const { page } = onePage();
    const calling = page.goto('https://example.com/', {
      waitUntil: 'commit',
      timeout: 1000,
    });
    expect(page.url()).toBe('about:blank');
    await calling;
    expect(page.url()).toBe('https://example.com/');
  });
});

describe('errors', () => {
  it('are the kind Playwright rejects with', () => {
    expect(isPlaywrightError(playwrightError('x'))).toBe(true);
    expect(isPlaywrightError(playwrightTimeout('x'))).toBe(true);
    expect(playwrightTimeout('x').name).toBe('TimeoutError');
    expect(playwrightError('x').name).toBe('Error');
  });
});

describe('a JPEG that says how big it is', () => {
  it('has a frame header that can be read', () => {
    expect(jpegSize(fakeJpeg())).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(fakeJpeg({ width: 2176, height: 1190 }))).toEqual({
      width: 2176,
      height: 1190,
    });
    expect(jpegSize(fakeJpeg({ width: 3, height: 5 }))).toEqual({
      width: 3,
      height: 5,
    });
  });

  it('starts like a JPEG and ends like one', () => {
    const jpeg = fakeJpeg();
    expect(Array.from(jpeg.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(jpeg.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it('differs by its tag only', () => {
    expect(fakeJpeg({ tag: 1 }).equals(fakeJpeg({ tag: 1 }))).toBe(true);
    expect(fakeJpeg({ tag: 1 }).equals(fakeJpeg({ tag: 2 }))).toBe(false);
    expect(fakeJpeg({ tag: 'a' }).equals(fakeJpeg({ tag: 'b' }))).toBe(false);
    expect(
      jpegSize(fakeJpeg({ tag: 'some longer tag', width: 9, height: 8 })),
    ).toEqual({
      width: 9,
      height: 8,
    });
  });
});

describe('a keyboard', () => {
  it('knows the keys of a US keyboard', async () => {
    const { page } = onePage();
    for (const key of [
      'a',
      'Z',
      '5',
      ' ',
      '~',
      'Enter',
      'Backspace',
      'ArrowUp',
      'Shift',
    ]) {
      await expect(page.keyboard.press(key)).resolves.toBeUndefined();
    }
  });

  it('does not know any other, and says so as Playwright does', async () => {
    const { page } = onePage();
    for (const key of ['ü', '€', '日', '👍', 'Dead', 'Nonsense']) {
      const error = await page.keyboard.press(key).then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(`Unknown key: "${key}"`);
    }
    await expect(page.keyboard.down('ü')).rejects.toThrow(
      'keyboard.down: Unknown key',
    );
    await expect(page.keyboard.up('ü')).rejects.toThrow(
      'keyboard.up: Unknown key',
    );
  });

  it('takes any text', async () => {
    const { page } = onePage();
    await page.keyboard.insertText('ü € 日');
    await page.keyboard.insertText('more');
    expect(page.keyboard.inserted).toEqual(['ü € 日', 'more']);
  });
});

describe('a dialog', () => {
  it('can be accepted or dismissed, once', async () => {
    const { page } = onePage();
    const accepted = page.openDialog('prompt', 'Name?', 'Ann');
    expect(accepted.type()).toBe('prompt');
    expect(accepted.message()).toBe('Name?');
    expect(accepted.defaultValue()).toBe('Ann');
    expect(accepted.result).toBeNull();
    await accepted.accept('Bob');
    expect(accepted.result).toEqual({ accepted: true, text: 'Bob' });
    await expect(accepted.accept()).rejects.toThrow(
      'dialog.accept: Cannot accept dialog which is already handled!',
    );
    await expect(accepted.dismiss()).rejects.toThrow(
      'Cannot dismiss dialog which is already handled!',
    );

    const dismissed = page.openDialog('confirm', 'Sure?');
    await dismissed.dismiss();
    expect(dismissed.result).toEqual({ accepted: false, text: undefined });
    await dismissed.answered;
  });

  it('is told to the page’s listeners', () => {
    const { page } = onePage();
    const heard: string[] = [];
    page.on('dialog', (dialog: { message(): string }) =>
      heard.push(dialog.message()),
    );
    page.openDialog('alert', 'Hello');
    expect(heard).toEqual(['Hello']);
  });

  it('keeps the page from answering until it is answered', async () => {
    const { page } = onePage();
    page.titleText = 'Title';
    const dialog = page.openDialog('alert', 'Hello');
    let title = '';
    void page.title().then((value) => {
      title = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(title).toBe('');
    expect([...page.openDialogs]).toEqual([dialog]);
    await dialog.accept();
    await settle();
    expect(title).toBe('Title');
    expect(page.openDialogs.size).toBe(0);
  });

  it('does not keep the page quiet when it is told not to', async () => {
    const { page } = onePage();
    page.blockedByDialogs = false;
    page.titleText = 'Title';
    page.openDialog('alert', 'Hello');
    await expect(page.title()).resolves.toBe('Title');
  });
});

describe('a page', () => {
  it('moves to an address and says so for its main frame only', () => {
    const { page } = onePage();
    const frames: unknown[] = [];
    page.on('framenavigated', (frame: unknown) => frames.push(frame));
    page.navigate('https://example.com/a');
    expect(page.url()).toBe('https://example.com/a');
    expect(frames).toEqual([page.mainFrame()]);
    expect(page.mainFrame().url()).toBe('https://example.com/a');
    page.navigateSubframe();
    expect(frames).toHaveLength(2);
    expect(frames[1]).not.toBe(page.mainFrame());
    expect(page.mainFrame()).toBe(page.mainFrame());
  });

  it('says when it loaded', () => {
    const { page } = onePage();
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    page.finishLoad();
    expect(loads).toBe(1);
  });

  it('closes once, leaving its context', async () => {
    const { context, page } = onePage();
    let closes = 0;
    page.on('close', () => {
      closes += 1;
    });
    await page.close();
    await page.close();
    expect(closes).toBe(1);
    expect(page.closed).toBe(true);
    expect(context.pages()).toEqual([]);
  });

  it('shows the picture it is given, or makes a new one every time', async () => {
    const { page } = onePage();
    page.jpeg = fakeJpeg({ tag: 'one' });
    const options = { type: 'jpeg' };
    expect((await page.screenshot(options)).length).toBe(page.jpeg.length);
    expect(Buffer.from(await page.screenshot(options)).equals(page.jpeg)).toBe(
      true,
    );
    let count = 0;
    page.pictures = () => fakeJpeg({ tag: count++ });
    const first = await page.screenshot(options);
    const second = await page.screenshot(options);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });

  it('answers page scripts by their name, with defaults for a few', async () => {
    const { page } = onePage();
    page.viewport = { width: 800, height: 600 };
    page.titleText = 'T';
    page.readyState = 'loading';
    page.selection = 'chosen';
    function viewportSize(): number[] {
      return [];
    }
    function titleAndState(): string[] {
      return [];
    }
    function selectedText(): string {
      return '';
    }
    expect(await page.evaluate(viewportSize)).toEqual([800, 600]);
    expect(await page.evaluate(titleAndState)).toEqual(['T', 'loading']);
    expect(await page.evaluate(selectedText)).toBe('chosen');
    function special(): number {
      return 0;
    }
    page.answers.set('special', () => 42);
    expect(await page.evaluate(special)).toBe(42);
    expect(await page.evaluate('special')).toBe(42);
  });

  it('is told off for a script nobody answers for: that is a bug of the test', async () => {
    const { page } = onePage();
    function unknownScript(): void {}
    const error = await page.evaluate(unknownScript).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(isPlaywrightError(error)).toBe(false);
  });

  it('makes handles that show whether they were let go', async () => {
    const { page } = onePage();
    function selectAt(): void {}
    const found = await page.evaluateHandle(selectAt);
    expect(found.asElement()).toBeNull();
    expect(page.liveHandles()).toEqual([found]);
    await found.dispose();
    expect(page.liveHandles()).toEqual([]);

    const element = page.element({ tag: 'SELECT' });
    page.answers.set('selectAt', () => element);
    const handle = await page.evaluateHandle(selectAt);
    expect(handle).toBe(element);
    expect(handle.asElement()).toBe(element);
  });

  it('makes the handles of a reading when they are asked for, as Playwright does', async () => {
    const { page } = onePage();
    const element = page.element({ tag: 'BUTTON' });
    page.reading = {
      items: [{ role: 'button' }],
      elements: [element],
      text: 'Hello',
      scroll: '0-1 of 1',
      document: 'about:blank',
    };
    function readPage(): void {}
    const root = await page.evaluateHandle(readPage, 80);
    expect(page.handles).toHaveLength(2); // the element, and the root
    const items = await root.getProperty('items');
    expect(await items.jsonValue()).toEqual([{ role: 'button' }]);
    const found = await (await root.getProperty('elements')).getProperties();
    expect([...found.keys()]).toEqual(['0']);
    expect(found.get('0')).toBe(element);
    expect(await (await root.getProperty('text')).jsonValue()).toBe('Hello');
    expect(page.handles.length).toBeGreaterThan(4);
    await expect(root.getProperty('nothing')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('an element', () => {
  it('knows its tag, its options and the rectangle of its list', async () => {
    const { page } = onePage();
    const select = page.element({
      tag: 'SELECT',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      options: [
        { label: 'A', selected: true },
        { label: 'B', disabled: true, group: 'G' },
      ],
    });
    function tagName(): void {}
    function optionLabels(): void {}
    function selectMenu(): void {}
    expect(await select.evaluate(tagName)).toBe('SELECT');
    expect(await select.evaluate(optionLabels)).toEqual(['A', 'B']);
    expect(await select.evaluate(selectMenu)).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      options: [
        { label: 'A', selected: true, disabled: false, group: null },
        { label: 'B', selected: false, disabled: true, group: 'G' },
      ],
    });
  });

  it('can be told other answers, and is a bug of the test for any it does not know', async () => {
    const { page } = onePage();
    const element: FakeElementHandle = page.element();
    function tagName(): void {}
    function other(): void {}
    element.answers.set('tagName', () => 'CUSTOM');
    expect(await element.evaluate(tagName)).toBe('CUSTOM');
    await expect(element.evaluate(other)).rejects.toBeInstanceOf(TypeError);
  });

  it('remembers what was done with it', async () => {
    const { page } = onePage();
    const element = page.element();
    await element.fill('text', { timeout: 1 });
    await element.click({ timeout: 1 });
    await element.press('Enter', { timeout: 1 });
    expect(await element.selectOption({ index: 1 }, { timeout: 1 })).toEqual(
      [],
    );
    await element.selectOption({ label: 'B' });
    expect(element.filled).toBe('text');
    expect(element.chosen).toEqual([{ index: 1 }, { label: 'B' }]);
    expect(element.asElement()).toBe(element);
    expect(new FakeJSHandle(page, 5).asElement()).toBeNull();
  });
});

describe('a context', () => {
  it('starts with one page, or as many as asked', () => {
    expect(new FakeContext().pages()).toHaveLength(1);
    expect(new FakeContext({ pages: 0 }).pages()).toEqual([]);
    expect(new FakeContext({ pages: 3 }).pages()).toHaveLength(3);
  });

  it('gives a copy of its pages', () => {
    const context = new FakeContext();
    context.pages().pop();
    expect(context.pages()).toHaveLength(1);
  });

  it('says when it made a page: before newPage returns, after it, or never', async () => {
    for (const [pageEvent, expected] of [
      ['before', ['heard', 'returned']],
      ['after', ['returned', 'heard']],
      ['never', ['returned']],
    ] as const) {
      const context = new FakeContext({ pageEvent });
      const order: string[] = [];
      context.on('page', () => order.push('heard'));
      await context.newPage();
      order.push('returned');
      await settle();
      expect(order).toEqual(expected);
      expect(context.pages()).toHaveLength(2);
    }
  });

  it('opens pages by itself', () => {
    const context = new FakeContext();
    const heard: string[] = [];
    context.on('page', (page: FakePage) => heard.push(page.url()));
    const popup = context.open('https://popup.example/');
    expect(popup.url()).toBe('https://popup.example/');
    expect(heard).toEqual(['https://popup.example/']);
    expect(context.pages()).toContain(popup);
  });

  it('lets the test prepare every page it makes', async () => {
    const context = new FakeContext();
    const prepared: FakePage[] = [];
    context.onNewPage = (page) => {
      prepared.push(page);
      page.behave('bringToFront', { error: playwrightError('x') });
    };
    const made = await context.newPage();
    const popup = context.open();
    expect(prepared).toEqual([made, popup]);
    await expect(made.bringToFront()).rejects.toThrow('x');
  });

  it('fails to make a page when told to', async () => {
    const context = new FakeContext();
    context.behave('newPage', { error: playwrightError('closed'), times: 1 });
    await expect(context.newPage()).rejects.toThrow('closed');
    await expect(context.newPage()).resolves.toBeDefined();
    expect(context.pages()).toHaveLength(2);
  });
});
