import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeRemote, fakeLaunchSpec } from '../../testing/fake-browser.ts';
import { unframed } from '../../testing/mcp-client.ts';
import { settle } from '../../testing/promises.ts';
import { RemoteError } from '../browser/remote.ts';
import { act, typeInto } from './acting.ts';

const remotes: FakeRemote[] = [];

function newRemote(): FakeRemote {
  const remote = new FakeRemote(fakeLaunchSpec());
  remotes.push(remote);
  return remote;
}

afterEach(() => {
  // Closing wakes the watches for a dialog that the tests leave behind.
  for (const remote of remotes.splice(0)) remote.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.DEBUG;
});

describe('act', () => {
  it('has nothing to say when the page took the action without a dialog', async () => {
    const remote = newRemote();
    expect(await act(remote, remote.hover(1, 2), 0)).toBe('');
    expect(remote.events).toEqual([['hover', 1, 2]]);
  });

  it('gives the page the time to react', async () => {
    vi.useFakeTimers();
    const remote = newRemote();
    let answered = false;
    void act(remote, remote.hover(1, 2), 500).then(() => {
      answered = true;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
  });

  it('says so when the page reacts with a dialog, without waiting out the time', async () => {
    vi.useFakeTimers();
    const remote = newRemote();
    let notice: string | null = null;
    void act(remote, remote.hover(1, 2), 10_000).then((text) => {
      notice = text;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(notice).toBeNull();
    remote.openDialog('alert', 'Welcome');
    await vi.advanceTimersByTimeAsync(0);
    expect(notice).toContain(
      'A dialog is open. The page does not respond until it is answered: use handle_dialog (accept or not).',
    );
    expect(unframed(notice ?? '')).toBe('An alert dialog: “Welcome”');
  });

  it('reports a dialog that a click opened at once, while the click waits for the answer', async () => {
    const remote = newRemote();
    remote.dialogOnClick = ['confirm', 'Delete everything?'];
    // The click itself does not return before the dialog is answered.
    const notice = await act(remote, remote.clickAt(1, 2), 60_000);
    expect(unframed(notice)).toBe('A confirm dialog: “Delete everything?”');
    expect(notice).toContain('handle_dialog');
    expect(remote.pending).toHaveLength(1);

    // Answering lets the click end, and nobody hears about it.
    await remote.answerDialog(1, { accept: false });
    await settle(4);
    expect(remote.pending).toHaveLength(0);
  });

  it('only logs an error of an action that came after its tool answered', async () => {
    process.env.DEBUG = 'session-manager';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const remote = newRemote();
    remote.dialogOnClick = ['confirm', 'Sure?'];
    await act(remote, remote.clickAt(1, 2), 0);
    remote.close(); // the click ends with "The browser has closed."
    await settle(4);
    expect(debug).toHaveBeenCalledOnce();
    expect(String(debug.mock.calls[0]?.[0])).toContain(
      'The browser has closed.',
    );
  });

  it('passes on the error of an action that failed', async () => {
    const remote = newRemote();
    await expect(act(remote, remote.activateTab(99), 0)).rejects.toThrow(
      new RemoteError('There is no such tab.', 'tab_gone'),
    );
  });

  it('passes on the error of an action that failed also when it failed at once', async () => {
    const remote = newRemote();
    await expect(
      act(remote, Promise.reject(new RemoteError('The page is gone.')), 0),
    ).rejects.toThrow('The page is gone.');
  });

  it('waits for a dialog for a minute at most, and then leaves the action to itself', async () => {
    vi.useFakeTimers();
    const remote = newRemote();
    const never = new Promise<void>(() => {});
    let notice: string | null = null;
    void act(remote, never, 0).then((text) => {
      notice = text;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(notice).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(notice).toBe('');
  });
});

describe('typeInto', () => {
  it('fills the field with this number', async () => {
    const remote = newRemote();
    await typeInto(remote, 'me@example.com', 1, true);
    await typeInto(remote, 'plain', 2, false);
    expect(remote.events).toEqual([
      ['fillElement', 1, 'me@example.com', true],
      ['fillElement', 2, 'plain', false],
    ]);
  });

  it('types where the focus is when there is no number, and presses Enter on request', async () => {
    const remote = newRemote();
    await typeInto(remote, 'focused', undefined, true);
    await typeInto(remote, 'again', null, false);
    expect(remote.events).toEqual([
      ['text', 'focused'],
      ['key', 'press', 'Enter'],
      ['text', 'again'],
    ]);
  });

  it('counts element 0 as an element', async () => {
    const remote = newRemote();
    await typeInto(remote, 'x', 0, false);
    expect(remote.events).toEqual([['fillElement', 0, 'x', false]]);
  });
});
