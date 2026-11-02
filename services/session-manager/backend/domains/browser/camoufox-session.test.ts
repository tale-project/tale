import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeRemoteLifecycle,
  FakeSessionContext,
} from '../../testing/fake-browser.ts';
import { settle, track } from '../../testing/promises.ts';
import {
  CamoufoxSession,
  NO_PAGES_GRACE_MS,
  findBrowserPid,
  listProcesses,
} from './camoufox-session.ts';
import type { SessionOptions } from './camoufox-session.ts';

const PROFILE = '/data/profiles/1';

const PS_OUTPUT = `\
  101 /Applications/Camoufox.app/Contents/MacOS/camoufox -no-remote -profile /data/profiles/10 -juggler-pipe
  102 /Applications/Camoufox.app/Contents/MacOS/plugin-container -contentproc -profile /data/profiles/1 tab
  103 /Applications/Camoufox.app/Contents/MacOS/camoufox -no-remote -profile /data/profiles/1 -juggler-pipe
`;

function listing(text: string): () => Promise<string> {
  return () => Promise.resolve(text);
}

function newSession(
  options: Partial<SessionOptions> = {},
  pages = 1,
): {
  session: CamoufoxSession;
  context: FakeSessionContext;
  remote: FakeRemoteLifecycle;
  kill: ReturnType<typeof vi.fn<(pid: number) => void>>;
} {
  const context = new FakeSessionContext(pages);
  const remote = new FakeRemoteLifecycle();
  const kill = vi.fn<(pid: number) => void>();
  const session = new CamoufoxSession(context, remote, {
    profileDir: PROFILE,
    listProcesses: listing(PS_OUTPUT),
    kill,
    ...options,
  });
  return { session, context, remote, kill };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('findBrowserPid', () => {
  it('matches the exact profile', async () => {
    const list = listing(PS_OUTPUT);
    expect(await findBrowserPid('/data/profiles/1', list)).toBe(103);
    expect(await findBrowserPid('/data/profiles/10', list)).toBe(101);
    expect(await findBrowserPid('/data/profiles/2', list)).toBeNull();
  });

  it('is not misled by characters that mean something in a pattern', async () => {
    const list = listing(
      [
        '  7 /x/camoufox -profile /data/profiles/a+b (1) -juggler-pipe',
        '  8 /x/camoufox -profile /data/profilesXa+b (1) -juggler-pipe',
        '  9 /x/camoufox -profile /data/profiles/aab (1) -juggler-pipe',
      ].join('\n'),
    );
    expect(await findBrowserPid('/data/profiles/a+b (1)', list)).toBe(7);
    expect(await findBrowserPid('/data/profiles/a.b (1)', list)).toBeNull();
  });

  it('finds a profile that ends its line', async () => {
    expect(
      await findBrowserPid(
        PROFILE,
        listing('  5 /x/camoufox -profile /data/profiles/1'),
      ),
    ).toBe(5);
  });

  it('skips the content processes of the browser', async () => {
    const list = listing(
      [
        // Linux marks them -contentproc, macOS gives them a parent.
        ' 40 /x/camoufox-bin -contentproc -parentBuildID 1 -profile /data/profiles/1 tab',
        ' 41 /x/plugin-container -isForBrowser -parentBuildID 1 -profile /data/profiles/1 -parentPid 42 4 tab',
        ' 42 /x/camoufox -no-remote -headless -profile /data/profiles/1 -juggler-pipe about:blank',
      ].join('\n'),
    );
    expect(await findBrowserPid(PROFILE, list)).toBe(42);
  });

  it('answers null when there is no such process', async () => {
    expect(await findBrowserPid(PROFILE, listing(''))).toBeNull();
  });

  it('ignores lines that are no process', async () => {
    const list = listing(
      [
        '',
        'garbage',
        '   ',
        'abc /x/camoufox -profile /data/profiles/1 -juggler-pipe',
      ].join('\r\n'),
    );
    expect(await findBrowserPid(PROFILE, list)).toBeNull();
  });

  it('works with Windows line ends', async () => {
    expect(
      await findBrowserPid(
        PROFILE,
        listing(PS_OUTPUT.replaceAll('\n', '\r\n')),
      ),
    ).toBe(103);
  });
});

describe('findBrowserPid with the processes of this host', () => {
  it('lists this process', async () => {
    expect(await listProcesses()).toMatch(
      new RegExp(`^\\s*${process.pid}\\s`, 'm'),
    );
  });

  it('finds a running process by its -profile argument', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sm-session-test-'));
    const hold = join(dir, 'hold.js');
    writeFileSync(hold, 'setInterval(() => {}, 1000);');
    const profile = join(dir, 'profile');
    const child = spawn(
      process.execPath,
      [hold, '-profile', profile, '-juggler-pipe'],
      {
        stdio: 'ignore',
      },
    );
    try {
      await vi.waitFor(async () => {
        expect(await findBrowserPid(profile)).toBe(child.pid);
      });
      expect(await findBrowserPid(`${profile}2`)).toBeNull();
    } finally {
      child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a session whose browser exits', () => {
  it('ends, freezes the tabs as they are and closes the remote', async () => {
    const { session, context, remote } = newSession();
    const ended = track(session.waitClosed());
    await settle();
    expect(ended.settled).toBe(false);

    context.die();
    await session.waitClosed();
    await session.contextClosed;
    expect(remote.calls).toEqual(['freeze flush=false', 'aclose']);
    expect(remote.closed).toBe(true);
  });

  it('ends even when the remote fails to close', async () => {
    const { session, context, remote } = newSession();
    remote.acloseError = new Error('no way');
    context.die();
    await session.waitClosed();
    await settle();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(PROFILE),
      expect.any(Error),
    );
  });

  it('ends even when the remote fails to freeze', async () => {
    const { session, context, remote } = newSession();
    vi.spyOn(remote, 'freeze').mockImplementation(() => {
      throw new Error('no way');
    });
    context.die();
    await session.waitClosed();
    await session.contextClosed;
    expect(remote.calls).toEqual(['aclose']);
  });

  it('only needs a close afterwards that waits for the remote', async () => {
    const { session, context, remote } = newSession();
    context.die();
    await session.close();
    expect(context.closeCalls).toBe(0);
    expect(remote.calls).toEqual(['freeze flush=false', 'aclose']);
  });
});

describe('a session whose last tab is closed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('ends after a grace period and forgets its tabs, but not the browser', async () => {
    const { session, context, remote } = newSession();
    const ended = track(session.waitClosed());
    const [page] = context.pages();
    page?.close();

    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS - 1);
    expect(ended.settled).toBe(false);
    expect(remote.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await session.waitClosed();
    expect(remote.calls).toEqual(['forgetLayout']);
    expect(context.closeCalls).toBe(0); // the owner closes the browser
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits as long as it is told to', async () => {
    const { session, context } = newSession({ noPagesGraceMs: 50 });
    const ended = track(session.waitClosed());
    context.pages()[0]?.close();
    await vi.advanceTimersByTimeAsync(49);
    expect(ended.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ended.settled).toBe(true);
  });

  it('keeps going while another tab is open', async () => {
    const { session, context, remote } = newSession({}, 2);
    const ended = track(session.waitClosed());
    context.pages()[0]?.close();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS * 2);
    expect(ended.settled).toBe(false);
    expect(remote.calls).toEqual([]);
  });

  it('keeps going when a tab opens during the grace period', async () => {
    const { session, context, remote } = newSession();
    const ended = track(session.waitClosed());
    context.pages()[0]?.close();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS / 2);
    context.openPage();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS * 2);
    expect(ended.settled).toBe(false);
    expect(remote.calls).toEqual([]);
  });

  it('ends when a tab that was opened later is the last to close', async () => {
    const { session, context, remote } = newSession();
    const opened = context.openPage();
    context.pages()[0]?.close();
    opened.close();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS);
    await session.waitClosed();
    expect(remote.calls).toEqual(['forgetLayout']);
  });

  it('forgets nothing when the whole browser is what went away', async () => {
    const { session, context, remote } = newSession({}, 3);
    context.die(); // its pages close first, then the context says so
    await session.waitClosed();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS * 2);
    expect(remote.calls).toEqual(['freeze flush=false', 'aclose']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still closes the browser when the owner asks', async () => {
    const { session, context, remote } = newSession();
    context.pages()[0]?.close();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS);
    await session.waitClosed();
    await session.close();
    expect(context.closeCalls).toBe(1);
    expect(remote.calls).toEqual([
      'forgetLayout',
      'freeze flush=true',
      'aclose',
    ]);
  });

  it('survives a remote that cannot forget its tabs', async () => {
    const { session, context, remote } = newSession();
    vi.spyOn(remote, 'forgetLayout').mockImplementation(() => {
      throw new Error('no way');
    });
    context.pages()[0]?.close();
    await vi.advanceTimersByTimeAsync(NO_PAGES_GRACE_MS);
    await session.waitClosed();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('closing a session', () => {
  it('closes the remote and then the browser, saving the tabs first', async () => {
    const { session, context, remote } = newSession();
    await session.close();

    expect(remote.calls).toEqual(['freeze flush=true', 'aclose']);
    expect(context.closeCalls).toBe(1);
    expect(remote.closed).toBe(true);
    await session.waitClosed(); // the browser said it is gone
  });

  it('is one close however often it is asked for', async () => {
    const { session, context, remote } = newSession();
    const first = session.close();
    const second = session.close();
    await Promise.all([first, second]);
    await session.close();

    expect(context.closeCalls).toBe(1);
    expect(remote.calls).toEqual(['freeze flush=true', 'aclose']);
  });

  it('kills the browser when closing it fails', async () => {
    const { session, context, kill } = newSession();
    context.closeBehaviour = 'fails';
    kill.mockImplementation(() => {
      context.die(); // what the kill does to the browser
    });
    await session.close();

    expect(kill).toHaveBeenCalledWith(103);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('killing the browser'),
    );
    await session.waitClosed();
  });

  it('kills the browser when closing it takes too long', async () => {
    vi.useFakeTimers();
    const { session, context, kill } = newSession();
    context.closeBehaviour = 'hangs';
    kill.mockImplementation(() => {
      context.die();
    });
    const closing = session.close(2_000);
    const closed = track(closing);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed.settled).toBe(true);
    expect(kill).toHaveBeenCalledWith(103);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills with SIGKILL unless told otherwise', async () => {
    const { session, context } = newSession({ kill: undefined });
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => {
      context.die();
      return true;
    });
    context.closeBehaviour = 'fails';
    await session.close();
    expect(processKill).toHaveBeenCalledWith(103, 'SIGKILL');
  });

  it('does not mind a browser that is gone by the time it is killed', async () => {
    const { session, context, kill } = newSession();
    context.closeBehaviour = 'fails';
    kill.mockImplementation(() => {
      context.die();
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    });
    await session.close();
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('fails when the browser cannot be killed, and can be closed again', async () => {
    const { session, context, kill } = newSession();
    context.closeBehaviour = 'fails';
    kill.mockImplementation(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    });
    await expect(session.close()).rejects.toThrow('kill EPERM');

    context.closeBehaviour = 'closes';
    await session.close();
    expect(context.closeCalls).toBe(2);
  });

  it('waits for the browser to exit when it finds no process to kill', async () => {
    const { session, context, kill } = newSession({
      listProcesses: listing(''),
    });
    context.closeBehaviour = 'fails';
    const closing = session.close();
    const closed = track(closing);
    await settle();
    expect(closed.settled).toBe(false);

    context.die();
    await closing;
    expect(kill).not.toHaveBeenCalled();
  });

  it('fails when the killed browser does not exit', async () => {
    vi.useFakeTimers();
    const { session, context, kill } = newSession();
    context.closeBehaviour = 'fails';
    const closing = session.close();
    const assertion = expect(closing).rejects.toThrow(
      'the killed browser exiting took more than',
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(kill).toHaveBeenCalledWith(103);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a close that lost its race fail on its own later', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { session, context, kill } = newSession();
      // The browser answers after the session gave up on it: with an error.
      context.close = () =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('late failure')), 5_000);
        });
      kill.mockImplementation(() => {
        context.die();
      });
      const closing = session.close(100);
      await vi.advanceTimersByTimeAsync(100);
      await closing;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
