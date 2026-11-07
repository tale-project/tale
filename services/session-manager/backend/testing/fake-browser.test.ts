import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LaunchSpec } from '../domains/browser/backend.ts';
import { RemoteError } from '../domains/browser/remote.ts';
import {
  GeoLookupError,
  IdentityError,
  identityFromJson,
  identityToJson,
} from '../domains/identity/types.ts';
import { EMPTY_LAYOUT } from '../lib/web-url.ts';
import type { TabLayout } from '../lib/web-url.ts';
import {
  FakeBackend,
  FakeBrowser,
  FakeRemote,
  FakeRemoteLifecycle,
  FakeSessionContext,
  Gate,
  NEW_YORK,
  fakeGeneratedIdentity,
  fakeIdentity,
  fakeJpeg,
  fakeLaunchSpec,
  fakeLocation,
} from './fake-browser.ts';
import { settle, track } from './promises.ts';

afterEach(() => {
  vi.useRealTimers();
});

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function newRemote(overrides: Partial<LaunchSpec> = {}) {
  const layouts: TabLayout[] = [];
  const onEmpty = vi.fn();
  const remote = new FakeRemote(
    fakeLaunchSpec({
      onLayout: (layout) => layouts.push(layout),
      ...overrides,
    }),
    onEmpty,
  );
  return { remote, layouts, onEmpty };
}

describe('Gate', () => {
  it('holds waiters back until it opens', async () => {
    const gate = new Gate();
    const waiting = track(gate.wait());
    await settle();
    expect(waiting.settled).toBe(false);
    expect(gate.isOpen).toBe(false);

    gate.open();
    await settle();
    expect(waiting.settled).toBe(true);
    expect(gate.isOpen).toBe(true);
  });

  it('lets waiters through while open and holds them again after a reset', async () => {
    const gate = new Gate();
    gate.open();
    await gate.wait();

    gate.reset();
    const waiting = track(gate.wait());
    await settle();
    expect(waiting.settled).toBe(false);
    gate.open();
    await settle();
    expect(waiting.settled).toBe(true);
  });
});

describe('FakeBackend installs', () => {
  it('starts with an installed browser and an idle install', () => {
    const backend = new FakeBackend();
    expect(backend.browserInstalled()).toBe(true);
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
      progress: null,
    });
    expect(backend.browserVersion).not.toBe('');
  });

  it('leaves an installed browser alone when it warms up', async () => {
    const backend = new FakeBackend();
    await backend.warmUp();
    expect(backend.warmUps).toBe(1);
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
      progress: null,
    });
  });

  it('shows a missing browser as installing until the install gate opens, then installed', async () => {
    const backend = new FakeBackend();
    backend.installed = false;
    backend.installGate = new Gate();

    const warming = backend.warmUp();
    expect(backend.browserInstall()).toEqual({
      installing: true,
      error: null,
      progress: null,
    });
    expect(backend.browserInstalled()).toBe(false);

    backend.installGate.open();
    await warming;
    expect(backend.browserInstalled()).toBe(true);
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
      progress: null,
    });
  });

  it('keeps the issue of an install that failed', async () => {
    const backend = new FakeBackend();
    backend.installed = false;
    backend.installError = 'no space left on device';
    await backend.warmUp();
    expect(backend.browserInstalled()).toBe(false);
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: 'no space left on device',
      progress: null,
    });
  });

  it('lets a test script the state directly', () => {
    const backend = new FakeBackend();
    backend.installed = false;
    backend.install = { installing: true, error: null, progress: null };
    expect(backend.browserInstalled()).toBe(false);
    expect(backend.browserInstall().installing).toBe(true);
  });
});

describe('FakeBackend identities', () => {
  it('draws numbered identities with the old fake’s summary and signatures', async () => {
    const backend = new FakeBackend();
    const first = await backend.createIdentity('linux', new Set());
    const second = await backend.createIdentity('windows', new Set());

    expect(first.summary).toEqual({
      userAgent: 'FakeAgent/1',
      platform: 'Win32',
      screen: '1920x1080',
      gpu: 'Fake GPU',
    });
    expect([first.visibleSignature, first.fullSignature]).toEqual([
      'visible-1',
      'full-1',
    ]);
    expect(first.identity.os).toBe('linux');
    expect(first.identity.locale).toBeNull();
    expect(second.summary.userAgent).toBe('FakeAgent/2');
    expect(second.identity).not.toEqual(first.identity);
    expect(backend.identities).toEqual([first, second]);
  });

  it('draws the same identities on every run', async () => {
    const a = await new FakeBackend().createIdentity('macos', new Set());
    const b = await new FakeBackend().createIdentity('macos', new Set());
    expect(a).toEqual(b);
    expect(a).toEqual(fakeGeneratedIdentity('macos', 1));
  });

  it('skips the numbers whose signatures are taken', async () => {
    const backend = new FakeBackend();
    const drawn = await backend.createIdentity(
      'windows',
      new Set(['visible-1', 'full-2']),
    );
    expect(drawn.visibleSignature).toBe('visible-3');
    expect(backend.identityRequests).toEqual([
      { os: 'windows', taken: new Set(['visible-1', 'full-2']) },
    ]);
  });

  it('draws identities that survive the stored form', async () => {
    const { identity } = await new FakeBackend().createIdentity(
      'linux',
      new Set(),
    );
    expect(identityFromJson(identityToJson(identity))).toEqual(identity);
    expect(fakeIdentity('linux', 1)).toEqual(identity);
  });

  it('draws a windows identity for a random OS, and logs what it was asked for', async () => {
    const backend = new FakeBackend();
    const drawn = await backend.createIdentity('random', new Set());
    expect(drawn.identity.os).toBe('windows');
    expect(backend.identityRequests.map((request) => request.os)).toEqual([
      'random',
    ]);
  });

  it('rejects an OS it does not know', async () => {
    await expect(
      new FakeBackend().createIdentity('android', new Set()),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it('rejects with the error a test sets', async () => {
    const backend = new FakeBackend();
    backend.identityError = new IdentityError('no suitable identity');
    await expect(backend.createIdentity('windows', new Set())).rejects.toThrow(
      'no suitable identity',
    );
    backend.identityError = null;
    await expect(
      backend.createIdentity('windows', new Set()),
    ).resolves.toBeDefined();
  });
});

describe('FakeBackend geo lookups', () => {
  it('answers every lookup with its geo and logs the IPs', async () => {
    const backend = new FakeBackend();
    expect(await backend.lookupGeo('203.0.113.1')).toEqual(NEW_YORK);

    const zurich = {
      country: 'CH',
      locale: 'de-CH',
      timezone: 'Europe/Zurich',
      latitude: 47.37,
      longitude: 8.54,
    };
    backend.geo = zurich;
    expect(await backend.lookupGeo('203.0.113.2')).toEqual(zurich);
    expect(backend.lookups).toEqual(['203.0.113.1', '203.0.113.2']);
  });

  it('answers from a table per IP and rejects with a scripted error', async () => {
    const backend = new FakeBackend();
    const geneva = { ...NEW_YORK, country: 'CH', locale: 'fr-CH' };
    backend.geoByIp.set('198.51.100.7', geneva);
    backend.geoByIp.set(
      '198.51.100.8',
      new GeoLookupError('the GeoIP database has no location for 198.51.100.8'),
    );

    expect(await backend.lookupGeo('198.51.100.7')).toEqual(geneva);
    expect(await backend.lookupGeo('198.51.100.9')).toEqual(NEW_YORK);
    const failure = backend.lookupGeo('198.51.100.8');
    await expect(failure).rejects.toBeInstanceOf(GeoLookupError);
    await expect(failure).rejects.toThrow('no location for 198.51.100.8');
    expect(backend.lookups).toHaveLength(3);
  });

  it('answers from a function, which can be asynchronous or fail', async () => {
    const backend = new FakeBackend();
    backend.geoFor = (ip) => ({ ...NEW_YORK, country: ip });
    expect((await backend.lookupGeo('JP')).country).toBe('JP');

    backend.geoFor = async (ip) => {
      throw new GeoLookupError(`unknown ${ip}`);
    };
    await expect(backend.lookupGeo('1.1.1.1')).rejects.toThrow(
      'unknown 1.1.1.1',
    );
  });
});

describe('FakeBackend launches', () => {
  it('launches a browser per spec and keeps both logs', async () => {
    const backend = new FakeBackend();
    const spec = fakeLaunchSpec({ name: 'shop' });
    const browser = await backend.launch(spec);

    expect(browser).toBeInstanceOf(FakeBrowser);
    expect(browser.spec).toBe(spec);
    expect(backend.launches).toEqual([browser]);
    expect(backend.attempts).toEqual([spec]);
    expect(backend.latest()).toBe(browser);
  });

  it('fails a launch with the error a test sets, and still logs the attempt', async () => {
    const backend = new FakeBackend();
    backend.launchError = new Error('A copy of Camoufox is already open.');
    const spec = fakeLaunchSpec();
    await expect(backend.launch(spec)).rejects.toThrow(
      'A copy of Camoufox is already open.',
    );
    expect(backend.attempts).toEqual([spec]);
    expect(backend.launches).toEqual([]);

    backend.launchError = null;
    await backend.launch(spec);
    expect(backend.launches).toHaveLength(1);
    expect(backend.attempts).toHaveLength(2);
  });

  it('holds a launch back until its gate opens', async () => {
    const backend = new FakeBackend();
    backend.launchGate = new Gate();
    const launching = backend.launch(fakeLaunchSpec());
    const state = track(launching);
    await settle();
    expect(state.settled).toBe(false);
    expect(backend.attempts).toHaveLength(1); // logged before it waits
    expect(backend.launches).toHaveLength(0);

    backend.launchGate.open();
    await launching;
    expect(backend.launches).toHaveLength(1);
  });

  it('delays a launch', async () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    backend.launchDelayMs = 500;
    const launching = backend.launch(fakeLaunchSpec());
    const state = track(launching);

    await vi.advanceTimersByTimeAsync(499);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await launching;
    expect(state.settled).toBe(true);
  });

  it('has no latest browser before the first launch', () => {
    expect(() => new FakeBackend().latest()).toThrow('no browser was launched');
  });

  it('counts how often it was closed', async () => {
    const backend = new FakeBackend();
    await backend.close();
    await backend.close();
    expect(backend.closeCalls).toBe(2);
  });
});

describe('FakeBrowser', () => {
  it('closes its remote and ends the session when it is closed', async () => {
    const browser = new FakeBrowser(fakeLaunchSpec());
    const waiting = track(browser.waitClosed());
    await settle();
    expect(waiting.settled).toBe(false);
    expect(browser.closed).toBe(false);

    await browser.close();
    await settle();
    expect(waiting.settled).toBe(true);
    expect(browser.closed).toBe(true);
    expect(browser.closeCalls).toBe(1);
    expect(browser.remote.closed).toBe(true);
  });

  it('counts every close call', async () => {
    const browser = new FakeBrowser(fakeLaunchSpec());
    await browser.close();
    await browser.close();
    expect(browser.closeCalls).toBe(2);
  });

  it('counts the times its window is brought to the front, and brings its tab forward', async () => {
    const browser = new FakeBrowser(fakeLaunchSpec());
    await browser.show();
    await browser.show();
    expect(browser.shows).toBe(2);
    expect(browser.remote.events).toEqual([['toFront'], ['toFront']]);
  });

  it('ends the session when the browser dies, without a close call', async () => {
    const browser = new FakeBrowser(fakeLaunchSpec());
    browser.crash();
    await browser.waitClosed();
    expect(browser.closed).toBe(true);
    expect(browser.closeCalls).toBe(0);
    expect(browser.remote.closed).toBe(true);
  });

  it('ends the session when the user closes the last tab', async () => {
    const layouts: TabLayout[] = [];
    const browser = new FakeBrowser(
      fakeLaunchSpec({ onLayout: (layout) => layouts.push(layout) }),
    );
    await browser.remote.openTab('https://two.example');
    await browser.closeAllTabs();

    await browser.waitClosed();
    expect(browser.closed).toBe(true);
    expect(browser.remote.closed).toBe(false); // the owner closes it next
    expect(layouts.at(-1)).toEqual(EMPTY_LAYOUT);
  });
});

describe('FakeRemote tabs', () => {
  it('starts with the start page as its only tab', () => {
    const { remote } = newRemote({ startPage: 'https://duckduckgo.com' });
    expect(remote.tabs()).toEqual([
      {
        id: 1,
        url: 'https://duckduckgo.com',
        title: 'Title of https://duckduckgo.com',
        loading: false,
        active: true,
      },
    ]);
  });

  it('reopens the tabs of a layout with the active one', async () => {
    const { remote } = newRemote({
      tabs: { urls: ['https://a.example', 'https://b.example'], active: 0 },
    });
    expect(remote.tabs().map((tab) => [tab.url, tab.active])).toEqual([
      ['https://a.example', true],
      ['https://b.example', false],
    ]);
    expect(await remote.listTabs()).toEqual(remote.tabs());
  });

  it('reports the tabs as soon as it starts', () => {
    const { layouts } = newRemote({
      tabs: { urls: ['https://a.example', 'https://b.example'], active: 1 },
    });
    expect(layouts).toEqual([
      { urls: ['https://a.example', 'https://b.example'], active: 1 },
    ]);
  });

  it('opens a tab on the start page or on a url, and activates it', async () => {
    const { remote, layouts } = newRemote();

    const blank = await remote.openTab();
    expect(blank).toMatchObject({
      id: 2,
      url: 'https://www.google.com',
      active: true,
    });
    const two = await remote.openTab('https://two.example');
    expect(two.id).toBe(3);

    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      false,
      false,
      true,
    ]);
    expect(layouts.at(-1)).toEqual({
      urls: [
        'https://www.google.com',
        'https://www.google.com',
        'https://two.example',
      ],
      active: 2,
    });
  });

  it('goes to a url in the active tab or in a given one', async () => {
    const { remote } = newRemote();
    await remote.openTab('https://two.example');
    await remote.goto('https://one.example');
    await remote.goto('https://other.example', 1, 'domcontentloaded');

    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://other.example',
      'https://one.example',
    ]);
    expect(remote.events).toEqual([
      ['goto', 'https://one.example', null, 'commit'],
      ['goto', 'https://other.example', 1, 'domcontentloaded'],
    ]);
  });

  it('activates a tab and moves the active tab to the last one when it closes', async () => {
    const { remote } = newRemote();
    await remote.openTab('https://two.example');
    await remote.openTab('https://three.example');
    await remote.activateTab(1);
    expect(remote.tabs().map((tab) => tab.active)).toEqual([
      true,
      false,
      false,
    ]);

    await remote.closeTab(1);
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [2, false],
      [3, true],
    ]);
    await remote.closeTab(2); // not the active one
    expect(remote.tabs().map((tab) => [tab.id, tab.active])).toEqual([
      [3, true],
    ]);
  });

  it('refuses an unknown tab as the browser does', async () => {
    const { remote } = newRemote();
    for (const attempt of [
      remote.closeTab(9),
      remote.activateTab(9),
      remote.goto('https://x.example', 9),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(RemoteError);
      await expect(attempt).rejects.toThrow('There is no such tab.');
    }
    expect(remote.events).toEqual([]);
  });

  it('reports only the tabs worth reopening, and which of them is active', async () => {
    const { remote, layouts } = newRemote();
    await remote.openTab('about:blank');
    await remote.openTab(
      'about:neterror?u=https%3A%2F%2Ffailed.example%2F&e=x',
    );
    await remote.activateTab(3);
    expect(layouts.at(-1)).toEqual({
      urls: ['https://www.google.com', 'https://failed.example/'],
      active: 1,
    });

    const before = layouts.length;
    await remote.closeTab(1);
    await remote.activateTab(2); // about:blank: nothing to reopen but the other tab
    expect(layouts.length).toBeGreaterThan(before);
    expect(layouts.at(-1)).toEqual({
      urls: ['https://failed.example/'],
      active: 0,
    });
  });

  it('reports an empty layout and ends the session when the last tab closes', async () => {
    const { remote, layouts, onEmpty } = newRemote();
    await remote.closeTab(1);

    expect(layouts.at(-1)).toEqual(EMPTY_LAYOUT);
    expect(onEmpty).toHaveBeenCalledTimes(1);
    expect(remote.tabs()).toEqual([]);
  });

  it('keeps its layout when the browser dies instead', async () => {
    const { remote, layouts } = newRemote();
    await remote.openTab('https://two.example');
    const reported = layouts.length;
    remote.close();
    await remote.openTab('https://late.example');
    expect(layouts).toHaveLength(reported); // nothing is reported once it is closed
    expect(layouts.at(-1)?.urls).toEqual([
      'https://www.google.com',
      'https://two.example',
    ]);
  });

  it('works without anybody told about the layout', async () => {
    const remote = new FakeRemote(fakeLaunchSpec());
    await remote.openTab('https://two.example');
    await remote.closeAllTabs();
    expect(remote.tabs()).toEqual([]);
  });
});

describe('FakeRemote input', () => {
  it('logs every input in order, with the defaults the browser applies', async () => {
    const { remote } = newRemote();
    await remote.history('back');
    await remote.history('reload', 1);
    await remote.scroll(0, -100);
    await remote.scroll(70, 0, 10, 20);
    await remote.scroll(1, 2, null, 5);
    await remote.clickAt(30, 40);
    await remote.clickAt(32, 42, { button: 'middle', count: 2 });
    await remote.hover(50, 60);
    await remote.drag(1, 2, 300, 4);
    await remote.key('press', 'Enter');
    await remote.insertText('ü€ paste');
    await remote.toFront();
    await remote.clickElement(2);
    await remote.fillElement(1, 'me@example.com');
    await remote.fillElement(1, 'again', { submit: true });

    expect(remote.events).toEqual([
      ['history', 'back', null],
      ['history', 'reload', 1],
      ['scroll', 0, -100],
      ['scroll', 70, 0, 10, 20],
      ['scroll', 1, 2],
      ['clickAt', 30, 40, 'left', 1],
      ['clickAt', 32, 42, 'middle', 2],
      ['hover', 50, 60],
      ['drag', 1, 2, 300, 4],
      ['key', 'press', 'Enter'],
      ['text', 'ü€ paste'],
      ['toFront'],
      ['clickElement', 2],
      ['fillElement', 1, 'me@example.com', false],
      ['fillElement', 1, 'again', true],
    ]);
  });

  it('answers with the selection a test sets', async () => {
    const { remote } = newRemote();
    expect(await remote.selectedText()).toBe('');
    remote.selection = 'chosen words';
    expect(await remote.selectedText()).toBe('chosen words');
  });

  it('remembers how long somebody attends the session', () => {
    const { remote } = newRemote();
    remote.attend(120_000);
    remote.attend(5_000);
    expect(remote.attended).toEqual([120_000, 5_000]);
  });

  it('reads the active page', async () => {
    const { remote } = newRemote();
    await remote.openTab('https://two.example');
    const page = await remote.readPage();
    expect(page).toMatchObject({
      url: 'https://two.example',
      title: 'Title of https://two.example',
      text: 'Fake page text',
      scroll: '0-600 of 600',
      problem: null,
    });
    expect(
      page.elements.map((element) => [element.ref, element.role, element.name]),
    ).toEqual([
      [1, 'textbox', 'Email'],
      [2, 'button', 'Go'],
    ]);
    expect(page.elements[0]).toMatchObject({ value: '', x: 120, y: 80 });

    remote.problem = 'The proxy server is refusing connections';
    expect((await remote.readPage()).problem).toBe(
      'The proxy server is refusing connections',
    );
  });

  it('takes a screenshot', async () => {
    const { remote } = newRemote();
    expect(text(await remote.screenshot())).toBe('jpeg-screenshot');
    expect(text(await remote.screenshot(1))).toBe('jpeg-screenshot');
  });
});

describe('FakeRemote dialogs', () => {
  it('opens a dialog that waits for an answer', () => {
    const { remote } = newRemote();
    const dialog = remote.openDialog('prompt', 'Your name?', 'Anna');

    expect(dialog).toEqual({
      id: 1,
      tab: 1,
      kind: 'prompt',
      message: 'Your name?',
      default: 'Anna',
    });
    expect(remote.dialogs()).toEqual([dialog]);
    expect(remote.pending).toEqual([dialog]);
    expect(remote.openDialog()).toMatchObject({
      id: 2,
      kind: 'confirm',
      message: 'Sure?',
      default: '',
    });
  });

  it('closes a dialog when it is answered', async () => {
    const { remote } = newRemote();
    const first = remote.openDialog();
    remote.openDialog('alert', 'Done');

    await remote.answerDialog(first.id, { accept: true, text: 'Bo' });
    await remote.answerDialog(99, { accept: false }); // answers nothing
    expect(remote.dialogs().map((dialog) => dialog.id)).toEqual([2]);
    expect(remote.events).toEqual([
      ['answer', 1, true, 'Bo'],
      ['answer', 99, false, null],
    ]);
  });

  it('hands the oldest waiting dialog to whoever waits for one', async () => {
    const { remote } = newRemote();
    const waiting = remote.waitForDialog(60_000);
    await settle();
    const dialog = remote.openDialog('alert', 'Hello');
    remote.openDialog('alert', 'Later');
    expect(await waiting).toEqual(dialog);
    expect(await remote.waitForDialog(60_000)).toEqual(dialog); // one is waiting already
  });

  it('gives up waiting for a dialog after the timeout', async () => {
    vi.useFakeTimers();
    const { remote } = newRemote();
    const waiting = remote.waitForDialog(5_000);
    const state = track(waiting);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting for a dialog when the browser is gone', async () => {
    const { remote } = newRemote();
    const waiting = remote.waitForDialog(60_000);
    await settle();
    remote.close();
    expect(await waiting).toBeNull();
  });

  it('holds back the click that opens a dialog until the dialog is answered', async () => {
    const { remote } = newRemote();
    remote.dialogOnClick = ['confirm', 'Delete everything?'];
    const click = remote.clickElement(2);
    const state = track(click);
    await settle();

    expect(state.settled).toBe(false);
    expect(remote.dialogOnClick).toBeNull(); // only the next click
    expect(remote.dialogs()).toEqual([
      {
        id: 1,
        tab: 1,
        kind: 'confirm',
        message: 'Delete everything?',
        default: '',
      },
    ]);

    await remote.answerDialog(1, { accept: false });
    await click;
    expect(state.settled).toBe(true);

    await remote.clickAt(1, 2); // no dialog this time
    expect(remote.dialogs()).toEqual([]);
  });

  it('holds back a click at a position the same way', async () => {
    const { remote } = newRemote();
    remote.dialogOnClick = ['prompt', 'Your name?'];
    const click = remote.clickAt(1, 2);
    await settle();
    expect(remote.dialogs()).toHaveLength(1);
    await remote.answerDialog(1, { accept: true, text: 'Ada' });
    await click;
    expect(remote.events).toContainEqual(['answer', 1, true, 'Ada']);
  });

  it('fails the click that waits for a dialog when the browser closes', async () => {
    const { remote } = newRemote();
    remote.dialogOnClick = ['confirm', 'Sure?'];
    const click = remote.clickElement(1);
    await settle();
    remote.close();
    await expect(click).rejects.toBeInstanceOf(RemoteError);
  });
});

describe('fake pictures', () => {
  it('writes the bytes of a fake picture as text', () => {
    expect(text(fakeJpeg(7))).toBe('jpeg-7');
    expect(text(fakeJpeg('screenshot'))).toBe('jpeg-screenshot');
  });
});

describe('FakeRemote closing', () => {
  it('is closed once', () => {
    const { remote } = newRemote();
    expect(remote.closed).toBe(false);
    remote.close();
    remote.close();
    expect(remote.closed).toBe(true);
  });
});

describe('fake data', () => {
  it('builds a complete launch spec that tests can override', () => {
    const spec = fakeLaunchSpec();
    expect(spec).toMatchObject({
      name: '0001',
      proxy: { server: 'http://192.0.2.1:8080' },
      tabs: EMPTY_LAYOUT,
      startPage: 'https://www.google.com',
    });
    expect(spec.location).toEqual(fakeLocation());
    expect(fakeLaunchSpec({ name: 'shop' }).name).toBe('shop');
  });

  it('puts a location in New York unless told otherwise', () => {
    expect(fakeLocation('8.8.8.8')).toEqual({
      ip: '8.8.8.8',
      country: 'US',
      timezone: 'America/New_York',
      latitude: 40.71,
      longitude: -74,
    });
    expect(fakeLocation('8.8.8.8', { country: 'CH' }).country).toBe('CH');
  });
});

describe('FakeSessionContext', () => {
  it('starts with the pages it is given and opens more', () => {
    const context = new FakeSessionContext(2);
    expect(context.pages()).toHaveLength(2);
    const heard: unknown[] = [];
    context.on('page', (page) => heard.push(page));

    const opened = context.openPage();
    expect(context.pages()).toHaveLength(3);
    expect(heard).toEqual([opened]);
    expect(new FakeSessionContext(0).pages()).toEqual([]);
  });

  it('forgets a page that closes and tells it', () => {
    const context = new FakeSessionContext(1);
    const [page] = context.pages();
    let closed = 0;
    page?.on('close', () => (closed += 1));
    page?.close();
    expect(closed).toBe(1);
    expect(context.pages()).toEqual([]);
  });

  it('closes the pages and then says "close" once when the browser dies', () => {
    const context = new FakeSessionContext(2);
    const order: string[] = [];
    for (const page of context.pages())
      page.on('close', () => order.push('page'));
    context.on('close', () => order.push('context'));

    context.die();
    context.die();
    expect(order).toEqual(['page', 'page', 'context']);
    expect(context.pages()).toEqual([]);
  });

  it('closes the browser when asked to, and counts the calls', async () => {
    const context = new FakeSessionContext();
    let closed = 0;
    context.on('close', () => (closed += 1));
    await context.close();
    expect(closed).toBe(1);
    expect(context.closeCalls).toBe(1);
  });

  it('can be told to hang or to fail when asked to close', async () => {
    const hanging = new FakeSessionContext();
    hanging.closeBehaviour = 'hangs';
    const closing = track(hanging.close());
    await settle();
    expect(closing.settled).toBe(false);
    expect(hanging.closeCalls).toBe(1);

    const failing = new FakeSessionContext();
    failing.closeBehaviour = 'fails';
    await expect(failing.close()).rejects.toThrow('Target closed');
    expect(failing.pages()).toHaveLength(1); // nothing closed
  });
});

describe('FakeRemoteLifecycle', () => {
  it('lists the lifecycle calls in order', async () => {
    const remote = new FakeRemoteLifecycle();
    await remote.restore(['https://a.example', 'https://b.example'], 1);
    await remote.restore(['https://c.example']);
    remote.freeze({ flush: true });
    remote.forgetLayout();
    await remote.aclose();
    expect(remote.calls).toEqual([
      'restore https://a.example,https://b.example 1',
      'restore https://c.example 0',
      'freeze flush=true',
      'forgetLayout',
      'aclose',
    ]);
    expect(remote.closed).toBe(true);
  });

  it('still works as a fake remote', async () => {
    const remote = new FakeRemoteLifecycle(
      fakeLaunchSpec({ startPage: 'https://start.example' }),
    );
    expect(remote.tabs().map((tab) => tab.url)).toEqual([
      'https://start.example',
    ]);
    await remote.openTab('https://two.example');
    expect(remote.tabs()).toHaveLength(2);
  });

  it('can be told to fail', async () => {
    const remote = new FakeRemoteLifecycle();
    remote.restoreError = new Error('no page');
    remote.acloseError = new Error('stuck');
    await expect(remote.restore(['https://a.example'])).rejects.toThrow(
      'no page',
    );
    await expect(remote.aclose()).rejects.toThrow('stuck');
    expect(remote.calls).toEqual(['restore https://a.example 0', 'aclose']);
    expect(remote.closed).toBe(true); // it closed before it failed
  });
});
