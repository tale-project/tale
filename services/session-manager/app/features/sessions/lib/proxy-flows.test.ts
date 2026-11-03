import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { runningSession, session } from '@/tests/utils/fixtures';

import {
  createProxyFlows,
  type FlowDeps,
  type FollowedWork,
  type ProxyFlows,
} from './proxy-flows';
import type { Settled } from './settle';

const ok = <T>(value: T): Settled<T> => ({ ok: true, value });
const refused = (code: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const,
  error: new ApiError(409, code, `the backend says ${code}`, extra),
});

/** Lets what a flow went on to do after its first answer run (a macrotask). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The server's answer to a start or a rotation: the session, busy now. */
const starting = (overrides = {}) =>
  session({ status: 'starting', activity: 'assigning_proxy', ...overrides });

function setup() {
  const deps = {
    start: vi.fn<FlowDeps['start']>(),
    rotate: vi.fn<FlowDeps['rotate']>(),
    create: vi.fn<FlowDeps['create']>(),
    askForProxies: vi.fn<FlowDeps['askForProxies']>(),
    askForWorkingProxies: vi.fn<FlowDeps['askForWorkingProxies']>(),
    askAboutSharedIp: vi.fn<FlowDeps['askAboutSharedIp']>(),
    askAboutBrokenProxy: vi.fn<FlowDeps['askAboutBrokenProxy']>(),
    follow: vi.fn<FlowDeps['follow']>(),
    open: vi.fn<FlowDeps['open']>(),
    tell: vi.fn<FlowDeps['tell']>(),
  };
  // What was marked as under way: (session, action).
  const tracked = vi.fn<(id: number, action: string) => void>();
  const flows: ProxyFlows = createProxyFlows({
    ...deps,
    track: <T>(id: number, action: string, request: Promise<T>) => {
      tracked(id, action);
      return request;
    },
  });
  return { deps: { ...deps, tracked }, flows };
}

/** The work a flow asked to have followed, the nth time. */
function followed(deps: ReturnType<typeof setup>['deps'], nth = 0) {
  const call = deps.follow.mock.calls[nth];
  if (call === undefined) throw new Error(`nothing was followed (${nth})`);
  return { session: call[0], work: call[1] };
}

describe('starting a session', () => {
  it('starts it, shows its page and remembers the work to look at it again', async () => {
    const { deps, flows } = setup();
    deps.start.mockResolvedValue(ok(starting({ id: 4 })));

    const attempt = await flows.start(session({ id: 4 }));

    expect(attempt).toEqual({ kind: 'done' });
    expect(deps.start).toHaveBeenCalledWith(4, false);
    expect(deps.open).toHaveBeenCalledWith(4);
    const { session: remembered, work } = followed(deps);
    expect(remembered.id).toBe(4);
    expect(work.thenStart).toBe(false);
  });

  it('marks the session as starting while the request is under way', async () => {
    const { deps, flows } = setup();
    deps.start.mockResolvedValue(ok(starting()));

    await flows.start(session());

    expect(deps.tracked).toHaveBeenCalledWith(1, 'start');
  });

  it('leaves a refusal that was told to the caller, and asks nothing', async () => {
    const { deps, flows } = setup();
    const result = refused('session_busy');
    deps.start.mockResolvedValue(result);

    const attempt = await flows.start(session());

    expect(attempt).toEqual({ kind: 'refused', error: result.error });
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.follow).not.toHaveBeenCalled();
    expect(deps.askForProxies).not.toHaveBeenCalled();
    expect(deps.askAboutSharedIp).not.toHaveBeenCalled();
    expect(deps.askAboutBrokenProxy).not.toHaveBeenCalled();
  });

  describe('when no proxy is free', () => {
    it('asks for proxies, and starts again once some were added', async () => {
      const { deps, flows } = setup();
      deps.start
        .mockResolvedValueOnce(refused('no_free_proxy'))
        .mockResolvedValueOnce(ok(starting({ id: 4 })));
      deps.askForProxies.mockResolvedValue(true);

      const attempt = await flows.start(session({ id: 4 }));

      expect(attempt).toEqual({ kind: 'asking' });
      expect(deps.askForProxies).toHaveBeenCalledWith('start', undefined);
      await vi.waitFor(() => expect(deps.start).toHaveBeenCalledTimes(2));
      expect(deps.start).toHaveBeenLastCalledWith(4, false);
      await vi.waitFor(() => expect(deps.open).toHaveBeenCalledWith(4));
      expect(deps.tell).not.toHaveBeenCalled();
    });

    it('gives up quietly when the person cancels', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(refused('no_free_proxy'));
      deps.askForProxies.mockResolvedValue(false);

      await flows.start(session());
      await vi.waitFor(() => expect(deps.askForProxies).toHaveBeenCalled());
      await flush();

      expect(deps.start).toHaveBeenCalledTimes(1);
      expect(deps.open).not.toHaveBeenCalled();
      expect(deps.tell).not.toHaveBeenCalled();
    });

    it('asks again when the server still has none after they were added', async () => {
      const { deps, flows } = setup();
      deps.start
        .mockResolvedValueOnce(refused('no_free_proxy'))
        .mockResolvedValueOnce(refused('no_free_proxy'))
        .mockResolvedValueOnce(ok(starting()));
      deps.askForProxies.mockResolvedValue(true);

      await flows.start(session());

      await vi.waitFor(() => expect(deps.start).toHaveBeenCalledTimes(3));
      expect(deps.askForProxies).toHaveBeenCalledTimes(2);
    });
  });

  describe('when another running session exits through the same IP', () => {
    const shared = refused('ip_in_use', {
      exitIp: '203.0.113.7',
      sessions: [{ id: 2, name: 'Shop', status: 'running' }],
    });

    it('asks, naming the session and the IP', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(shared);
      deps.askAboutSharedIp.mockResolvedValue('cancel');

      const attempt = await flows.start(session({ name: 'Bank' }));

      expect(attempt).toEqual({ kind: 'asking' });
      expect(deps.askAboutSharedIp).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bank' }),
        { exitIp: '203.0.113.7', names: ['Shop'] },
      );
    });

    it('starts anyway when told to', async () => {
      const { deps, flows } = setup();
      deps.start
        .mockResolvedValueOnce(shared)
        .mockResolvedValueOnce(ok(starting({ id: 4 })));
      deps.askAboutSharedIp.mockResolvedValue('force');

      await flows.start(session({ id: 4 }));

      await vi.waitFor(() => expect(deps.start).toHaveBeenCalledTimes(2));
      expect(deps.start).toHaveBeenLastCalledWith(4, true);
      await vi.waitFor(() => expect(deps.open).toHaveBeenCalledWith(4));
    });

    it('leaves the session alone when told to cancel', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(shared);
      deps.askAboutSharedIp.mockResolvedValue('cancel');

      await flows.start(session());
      await vi.waitFor(() => expect(deps.askAboutSharedIp).toHaveBeenCalled());
      await flush();

      expect(deps.start).toHaveBeenCalledTimes(1);
      expect(deps.rotate).not.toHaveBeenCalled();
      expect(deps.open).not.toHaveBeenCalled();
    });

    it('gives it another proxy first, and then starts it, when told to rotate', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(shared);
      deps.askAboutSharedIp.mockResolvedValue('rotate');
      deps.rotate.mockResolvedValue(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );

      await flows.start(session({ id: 4 }));

      await vi.waitFor(() => expect(deps.rotate).toHaveBeenCalledWith(4));
      await vi.waitFor(() => expect(deps.follow).toHaveBeenCalled());
      expect(followed(deps).work.thenStart).toBe(true);
      // The start itself waits until the new proxy is there.
      expect(deps.start).toHaveBeenCalledTimes(1);
    });

    it('tells a shared IP that stays refused although the start was forced', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValueOnce(shared).mockResolvedValueOnce(shared);
      deps.askAboutSharedIp.mockResolvedValue('force');

      await flows.start(session());

      await vi.waitFor(() =>
        expect(deps.tell).toHaveBeenCalledWith('start', shared.error),
      );
      expect(deps.askAboutSharedIp).toHaveBeenCalledTimes(1);
    });
  });

  describe('when its own proxy does not work', () => {
    const broken = refused('proxy_unreachable', { proxyId: 3 });

    it('asks, with the error of the server, whether to give it another one', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(broken);
      deps.askAboutBrokenProxy.mockResolvedValue('cancel');

      const attempt = await flows.start(session({ name: 'Bank' }));

      expect(attempt).toEqual({ kind: 'asking' });
      expect(deps.askAboutBrokenProxy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bank' }),
        broken.error,
      );
    });

    it('rotates the proxy, and starts the session afterwards, when told to', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(broken);
      deps.askAboutBrokenProxy.mockResolvedValue('rotate');
      deps.rotate.mockResolvedValue(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );

      await flows.start(session({ id: 4 }));

      await vi.waitFor(() => expect(deps.rotate).toHaveBeenCalledWith(4));
      await vi.waitFor(() => expect(deps.follow).toHaveBeenCalled());
      expect(followed(deps).work.thenStart).toBe(true);
    });

    it('leaves the session as it is when told to cancel', async () => {
      const { deps, flows } = setup();
      deps.start.mockResolvedValue(broken);
      deps.askAboutBrokenProxy.mockResolvedValue('cancel');

      await flows.start(session());
      await vi.waitFor(() =>
        expect(deps.askAboutBrokenProxy).toHaveBeenCalled(),
      );
      await flush();

      expect(deps.rotate).not.toHaveBeenCalled();
    });
  });
});

describe('giving a session another proxy', () => {
  it('rotates it and remembers the work, without starting it unless asked to', async () => {
    const { deps, flows } = setup();
    deps.rotate.mockResolvedValue(
      ok(session({ id: 4, activity: 'assigning_proxy' })),
    );

    const attempt = await flows.rotate(session({ id: 4 }));

    expect(attempt).toEqual({ kind: 'done' });
    expect(deps.rotate).toHaveBeenCalledWith(4);
    expect(deps.tracked).toHaveBeenCalledWith(4, 'rotate');
    expect(followed(deps).work.thenStart).toBe(false);
    // The page it is on stays: a rotation is not a start.
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('remembers that it is to start afterwards when asked to', async () => {
    const { deps, flows } = setup();
    deps.rotate.mockResolvedValue(ok(session({ activity: 'assigning_proxy' })));

    await flows.rotate(session(), { thenStart: true });

    expect(followed(deps).work.thenStart).toBe(true);
  });

  it('leaves any other refusal to the caller', async () => {
    const { deps, flows } = setup();
    const result = refused('session_busy');
    deps.rotate.mockResolvedValue(result);

    const attempt = await flows.rotate(session());

    expect(attempt).toEqual({ kind: 'refused', error: result.error });
    expect(deps.askForProxies).not.toHaveBeenCalled();
  });

  it('asks for proxies when none is free, and rotates again with the same wish', async () => {
    const { deps, flows } = setup();
    deps.rotate
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );
    deps.askForProxies.mockResolvedValue(true);

    const attempt = await flows.rotate(session({ id: 4 }), { thenStart: true });

    expect(attempt).toEqual({ kind: 'asking' });
    expect(deps.askForProxies).toHaveBeenCalledWith('rotate', undefined);
    await vi.waitFor(() => expect(deps.rotate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(deps.follow).toHaveBeenCalled());
    expect(followed(deps).work.thenStart).toBe(true);
  });

  it('tells the dialog that asks for proxies where the keyboard goes back to when it is given up, every time it asks', async () => {
    // The question that began the rotation closes for the dialog that asks, so
    // the control that was pressed is the only place left to go back to.
    const { deps, flows } = setup();
    const returnFocusTo = document.createElement('button');
    deps.rotate
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );
    deps.askForProxies.mockResolvedValue(true);

    await flows.rotate(session({ id: 4 }), { returnFocusTo });

    await vi.waitFor(() => expect(deps.follow).toHaveBeenCalled());
    expect(deps.askForProxies).toHaveBeenCalledTimes(2);
    expect(deps.askForProxies).toHaveBeenNthCalledWith(
      1,
      'rotate',
      returnFocusTo,
    );
    expect(deps.askForProxies).toHaveBeenNthCalledWith(
      2,
      'rotate',
      returnFocusTo,
    );
  });

  it('gives up quietly when the person cancels', async () => {
    const { deps, flows } = setup();
    deps.rotate.mockResolvedValue(refused('no_free_proxy'));
    deps.askForProxies.mockResolvedValue(false);

    await flows.rotate(session());
    await vi.waitFor(() => expect(deps.askForProxies).toHaveBeenCalled());
    await flush();

    expect(deps.rotate).toHaveBeenCalledTimes(1);
    expect(deps.tell).not.toHaveBeenCalled();
  });

  describe('the work to try again when no proxy worked', () => {
    it('rotates once more, and starts if the session was asked to start', async () => {
      const { deps, flows } = setup();
      deps.rotate.mockResolvedValue(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );
      await flows.rotate(session({ id: 4 }), { thenStart: true });

      await followed(deps).work.retry(session({ id: 4 }));

      expect(deps.rotate).toHaveBeenCalledTimes(2);
      expect(followed(deps, 1).work.thenStart).toBe(true);
    });

    it('starts the session afterwards when it was running: its browser is closed by then', async () => {
      const { deps, flows } = setup();
      // A running session answers a rotation as starting again.
      deps.rotate.mockResolvedValue(
        ok(
          session({
            id: 4,
            status: 'starting',
            activity: 'assigning_proxy',
          }),
        ),
      );
      await flows.rotate(runningSession({ id: 4 }));
      expect(followed(deps).work.thenStart).toBe(false);

      await followed(deps).work.retry(session({ id: 4, status: 'error' }));

      expect(followed(deps, 1).work.thenStart).toBe(true);
    });

    it('only rotates when a stopped session was only asked to rotate', async () => {
      const { deps, flows } = setup();
      deps.rotate.mockResolvedValue(
        ok(session({ id: 4, activity: 'assigning_proxy' })),
      );
      await flows.rotate(session({ id: 4 }));

      await followed(deps).work.retry(session({ id: 4 }));

      expect(followed(deps, 1).work.thenStart).toBe(false);
    });
  });
});

describe('adding a session', () => {
  it('creates it, shows its page and remembers the work, which a start repeats', async () => {
    const { deps, flows } = setup();
    deps.create.mockResolvedValue(ok(starting({ id: 9, name: 'Shop' })));

    const attempt = await flows.create({ name: 'Shop', os: 'macos' });

    expect(attempt).toEqual({ kind: 'done' });
    expect(deps.create).toHaveBeenCalledWith({ name: 'Shop', os: 'macos' });
    expect(deps.open).toHaveBeenCalledWith(9);
    const { session: remembered, work } = followed(deps);
    expect(remembered.id).toBe(9);
    expect(work.thenStart).toBe(false);

    deps.start.mockResolvedValue(ok(starting({ id: 9 })));
    await work.retry(session({ id: 9 }));
    expect(deps.start).toHaveBeenCalledWith(9, false);
  });

  it('tells the dialog that asks for proxies where the keyboard goes back to when it is given up, every time it asks', async () => {
    const { deps, flows } = setup();
    const returnFocusTo = document.createElement('button');
    deps.create
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(ok(starting({ id: 9 })));
    deps.askForProxies.mockResolvedValue(true);

    await flows.create({ name: 'Shop' }, { returnFocusTo });

    await vi.waitFor(() => expect(deps.open).toHaveBeenCalledWith(9));
    expect(deps.askForProxies).toHaveBeenCalledTimes(2);
    expect(deps.askForProxies).toHaveBeenNthCalledWith(
      1,
      'create',
      returnFocusTo,
    );
    expect(deps.askForProxies).toHaveBeenNthCalledWith(
      2,
      'create',
      returnFocusTo,
    );
  });

  it('hands a name that is refused back, for the dialog to word beside its field', async () => {
    const { deps, flows } = setup();
    const result = refused('name_taken');
    deps.create.mockResolvedValue(result);

    const attempt = await flows.create({ name: 'Shop' });

    expect(attempt).toEqual({ kind: 'refused', error: result.error });
    expect(deps.tell).not.toHaveBeenCalled();
  });

  it('asks for proxies when none is free, and then adds the session with the same input', async () => {
    const { deps, flows } = setup();
    deps.create
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(ok(starting({ id: 9 })));
    deps.askForProxies.mockResolvedValue(true);

    const attempt = await flows.create({ name: 'Shop', os: 'linux' });

    expect(attempt).toEqual({ kind: 'asking' });
    expect(deps.askForProxies).toHaveBeenCalledWith('create', undefined);
    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledTimes(2));
    expect(deps.create).toHaveBeenNthCalledWith(1, {
      name: 'Shop',
      os: 'linux',
    });
    expect(deps.create).toHaveBeenNthCalledWith(2, {
      name: 'Shop',
      os: 'linux',
    });
    await vi.waitFor(() => expect(deps.open).toHaveBeenCalledWith(9));
  });

  it('adds nothing when the person cancels', async () => {
    const { deps, flows } = setup();
    deps.create.mockResolvedValue(refused('no_free_proxy'));
    deps.askForProxies.mockResolvedValue(false);

    await flows.create({ name: 'Shop' });
    await vi.waitFor(() => expect(deps.askForProxies).toHaveBeenCalled());
    await flush();

    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.tell).not.toHaveBeenCalled();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('tells a name that was taken meanwhile: the dialog that would word it is gone', async () => {
    const { deps, flows } = setup();
    const taken = refused('name_taken');
    deps.create
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(taken);
    deps.askForProxies.mockResolvedValue(true);

    await flows.create({ name: 'Shop' });

    await vi.waitFor(() =>
      expect(deps.tell).toHaveBeenCalledWith('create', taken.error),
    );
    expect(deps.open).not.toHaveBeenCalled();
  });

  it('does not tell again a refusal that was already told as a toast', async () => {
    const { deps, flows } = setup();
    deps.create
      .mockResolvedValueOnce(refused('no_free_proxy'))
      .mockResolvedValueOnce(refused('fingerprint_exhausted'));
    deps.askForProxies.mockResolvedValue(true);

    await flows.create({ name: 'Shop' });

    await vi.waitFor(() => expect(deps.create).toHaveBeenCalledTimes(2));
    await flush();
    expect(deps.tell).not.toHaveBeenCalled();
  });
});

describe('work that is over', () => {
  const finished = (
    overrides: Parameters<typeof session>[0],
    work: Partial<FollowedWork> = {},
  ) => ({
    session: session(overrides),
    work: {
      retry: vi.fn(() => Promise.resolve()),
      thenStart: false,
      ...work,
    },
  });

  it('starts a session that was to start once it has its proxy and has stopped', async () => {
    const { deps, flows } = setup();
    deps.start.mockResolvedValue(ok(starting({ id: 4 })));

    await flows.finished([finished({ id: 4 }, { thenStart: true })]);

    expect(deps.start).toHaveBeenCalledWith(4, false);
    expect(deps.open).toHaveBeenCalledWith(4);
  });

  it('starts it from the error state too: that is a stopped session', async () => {
    const { deps, flows } = setup();
    deps.start.mockResolvedValue(ok(starting({ id: 4 })));

    await flows.finished([
      finished({ id: 4, status: 'error', error: 'x' }, { thenStart: true }),
    ]);

    expect(deps.start).toHaveBeenCalledWith(4, false);
  });

  it('leaves a session alone that was not to start, or that is running already', async () => {
    const { deps, flows } = setup();

    await flows.finished([
      finished({ id: 1 }),
      finished({ id: 2, status: 'running' }, { thenStart: true }),
    ]);

    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.askForWorkingProxies).not.toHaveBeenCalled();
  });

  it('asks once for every session that found no working proxy, and tries each again when some were added', async () => {
    const { deps, flows } = setup();
    deps.askForWorkingProxies.mockResolvedValue(true);
    const first = finished({
      id: 1,
      name: 'Shop',
      status: 'error',
      errorCode: 'no_working_proxy',
    });
    const second = finished({
      id: 2,
      name: 'Bank',
      errorCode: 'no_working_proxy',
    });

    await flows.finished([first, second, finished({ id: 3 })]);

    expect(deps.askForWorkingProxies).toHaveBeenCalledTimes(1);
    expect(
      deps.askForWorkingProxies.mock.calls[0]?.[0].map((s) => s.name),
    ).toEqual(['Shop', 'Bank']);
    expect(first.work.retry).toHaveBeenCalledWith(first.session);
    expect(second.work.retry).toHaveBeenCalledWith(second.session);
  });

  it('tries nothing again when the person gives up', async () => {
    const { deps, flows } = setup();
    deps.askForWorkingProxies.mockResolvedValue(false);
    const stuck = finished({ errorCode: 'no_working_proxy' });

    await flows.finished([stuck]);

    expect(stuck.work.retry).not.toHaveBeenCalled();
    expect(deps.tell).not.toHaveBeenCalled();
  });

  it('does not start a stuck session before it has a proxy, whatever it was told', async () => {
    const { deps, flows } = setup();
    deps.askForWorkingProxies.mockResolvedValue(false);

    await flows.finished([
      finished({ errorCode: 'no_working_proxy' }, { thenStart: true }),
    ]);

    expect(deps.start).not.toHaveBeenCalled();
  });
});

describe('a session without a working proxy', () => {
  it('asks for proxies for it, and starts it once some were added', async () => {
    const { deps, flows } = setup();
    deps.askForWorkingProxies.mockResolvedValue(true);
    deps.start.mockResolvedValue(ok(starting({ id: 4 })));

    await flows.addProxiesFor(session({ id: 4, name: 'Shop' }));

    expect(
      deps.askForWorkingProxies.mock.calls[0]?.[0].map((s) => s.name),
    ).toEqual(['Shop']);
    expect(deps.start).toHaveBeenCalledWith(4, false);
  });

  it('leaves it as it is when the person gives up', async () => {
    const { deps, flows } = setup();
    deps.askForWorkingProxies.mockResolvedValue(false);

    await flows.addProxiesFor(session());

    expect(deps.start).not.toHaveBeenCalled();
  });
});
