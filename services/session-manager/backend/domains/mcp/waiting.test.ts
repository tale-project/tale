import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '../../../lib/api/schemas.ts';
import { FakeRemote, fakeLaunchSpec } from '../../testing/fake-browser.ts';
import { sessionFixture, stubManager } from '../../testing/mcp-stub-manager.ts';
import type { Manager } from '../sessions/manager.ts';
import { AccessOffError } from './tool.ts';
import type { ToolContext } from './tool.ts';
import {
  START_TIMEOUT,
  paced,
  sleep,
  sleepWhileOn,
  until,
  untilStarted,
} from './waiting.ts';

afterEach(() => {
  vi.useRealTimers();
});

function contextOf(
  session: () => Session,
  extra: Partial<Manager> = {},
  waitScale = 1,
): ToolContext {
  return {
    manager: stubManager({ session, ...extra }),
    waitScale,
  };
}

describe('paced', () => {
  it('scales a wait by what the context says', () => {
    const manager = stubManager();
    expect(paced({ manager, waitScale: 1 }, 400)).toBe(400);
    expect(paced({ manager, waitScale: 0.5 }, 400)).toBe(200);
    expect(paced({ manager, waitScale: 0 }, 400)).toBe(0);
  });
});

describe('sleep', () => {
  it('waits the milliseconds', async () => {
    vi.useFakeTimers();
    let woken = false;
    void sleep(250).then(() => {
      woken = true;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(woken).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(woken).toBe(true);
  });
});

describe('until', () => {
  it('returns at once when the session is there already', async () => {
    const session = vi.fn(() => sessionFixture());
    const result = await until(
      contextOf(session),
      1,
      (current) => current.status === 'running',
      1000,
    );
    expect(result.status).toBe('running');
    expect(session).toHaveBeenCalledTimes(1);
    expect(session).toHaveBeenCalledWith(1);
  });

  it('looks again every 0.4 seconds until it is', async () => {
    vi.useFakeTimers();
    const states: Session[] = [
      sessionFixture({ status: 'stopping' }),
      sessionFixture({ status: 'stopping' }),
      sessionFixture({ status: 'stopped' }),
    ];
    const session = vi.fn(
      () => states.shift() ?? sessionFixture({ status: 'stopped' }),
    );
    const waiting = until(
      contextOf(session),
      1,
      (current) => current.status !== 'stopping',
      30_000,
    );
    await vi.advanceTimersByTimeAsync(399);
    expect(session).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(session).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect((await waiting).status).toBe('stopped');
    expect(session).toHaveBeenCalledTimes(3);
  });

  it('returns the session as it is when the time is up', async () => {
    vi.useFakeTimers();
    const session = vi.fn(() => sessionFixture({ status: 'stopping' }));
    const waiting = until(contextOf(session), 1, () => false, 2000);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await waiting).status).toBe('stopping');
    // About every 0.4 seconds for 2 seconds.
    expect(session.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(session.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it('does not wait with a context that paces nothing', async () => {
    const states = [
      sessionFixture({ status: 'stopping' }),
      sessionFixture({ status: 'stopped' }),
    ];
    const session = vi.fn(() => states.shift() ?? sessionFixture());
    const result = await until(
      contextOf(session, {}, 0),
      1,
      (current) => current.status === 'stopped',
      30_000,
    );
    expect(result.status).toBe('stopped');
  });

  it('lets the error of the manager through (the session is gone)', async () => {
    const session = vi.fn(() => {
      throw new Error('no such session');
    });
    await expect(
      until(contextOf(session), 1, () => false, 1000),
    ).rejects.toThrow('no such session');
  });
});

describe('untilStarted', () => {
  it('answers with the session and its number of tabs once it runs', async () => {
    const remote = new FakeRemote(fakeLaunchSpec());
    void remote.openTab('https://two.example');
    const states = [
      sessionFixture({ status: 'starting', activity: 'launching' }),
      sessionFixture({ status: 'running' }),
    ];
    const result = await untilStarted(
      contextOf(
        () => states.shift() ?? sessionFixture(),
        { remote: () => remote },
        0,
      ),
      1,
    );
    expect(result).toMatchObject({ name: '0001', status: 'running', tabs: 2 });
  });

  it('does not wait for a session that was a start away from running to be settled', async () => {
    const states = [
      sessionFixture({ status: 'running', activity: 'launching' }),
      sessionFixture({ status: 'running', activity: null }),
    ];
    const session = vi.fn(() => states.shift() ?? sessionFixture());
    const remote = new FakeRemote(fakeLaunchSpec());
    await untilStarted(contextOf(session, { remote: () => remote }, 0), 1);
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('answers without tabs when the start failed or the session stopped', async () => {
    for (const status of ['error', 'stopped'] as const) {
      const failed = sessionFixture({
        status,
        error: 'No working proxy available.',
        proxy: null,
        location: null,
      });
      const result = await untilStarted(
        contextOf(() => failed, {}, 0),
        1,
      );
      expect(result).toMatchObject({
        status,
        error: 'No working proxy available.',
      });
      expect(result).not.toHaveProperty('tabs');
    }
  });

  it('answers with how far it got after two minutes', async () => {
    vi.useFakeTimers();
    const slow = sessionFixture({ status: 'starting', activity: 'launching' });
    const waiting = untilStarted(
      contextOf(() => slow),
      1,
    );
    await vi.advanceTimersByTimeAsync(START_TIMEOUT - 1000);
    let done = false;
    void waiting.then(() => {
      done = true;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await waiting).toMatchObject({ status: 'starting' });
    expect(START_TIMEOUT).toBe(120_000);
  });
});

describe('while AI access is switched off', () => {
  /** A context whose AI access the test switches. */
  function switchable(session: () => Session) {
    const access = { on: true };
    const context: ToolContext = {
      ...contextOf(session),
      accessOn: () => access.on,
    };
    return { access, context };
  }

  it('sleepWhileOn waits the whole time with access on', async () => {
    vi.useFakeTimers();
    const { context } = switchable(() => sessionFixture());
    let woken = false;
    void sleepWhileOn(context, 1000).then(() => {
      woken = true;
      return undefined;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(woken).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(woken).toBe(true);
  });

  it('sleepWhileOn stops within a fraction of a second, with the error of the switch', async () => {
    vi.useFakeTimers();
    const { access, context } = switchable(() => sessionFixture());
    const sleeping = sleepWhileOn(context, 30_000).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1000);
    access.on = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(await sleeping).toBeInstanceOf(AccessOffError);
  });

  it('until stops looking at the session and fails with the error of the switch', async () => {
    vi.useFakeTimers();
    const session = vi.fn(() => sessionFixture({ status: 'starting' }));
    const { access, context } = switchable(session);
    const waiting = until(context, 1, () => false, 120_000).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const looked = session.mock.calls.length;
    access.on = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(await waiting).toBeInstanceOf(AccessOffError);
    // It did not look again after the switch.
    expect(session.mock.calls.length).toBeLessThanOrEqual(looked + 1);
  });

  it('untilStarted fails with the error of the switch, also in its first moment', async () => {
    vi.useFakeTimers();
    const { access, context } = switchable(() =>
      sessionFixture({ status: 'starting', activity: 'launching' }),
    );
    const starting = untilStarted(context, 1).catch((error: unknown) => error);
    access.on = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(await starting).toBeInstanceOf(AccessOffError);
  });

  it('sleepWhileOn lets the event loop turn even when it waits no time at all', async () => {
    let turned = false;
    setTimeout(() => {
      turned = true;
    }, 0);
    await sleepWhileOn(
      contextOf(() => sessionFixture()),
      0,
    );
    expect(turned).toBe(true);
  });

  it('does not stop a wait that has no switch to look at', async () => {
    vi.useFakeTimers();
    const waiting = sleepWhileOn(
      contextOf(() => sessionFixture()),
      500,
    );
    await vi.advanceTimersByTimeAsync(500);
    await expect(waiting).resolves.toBeUndefined();
  });
});
