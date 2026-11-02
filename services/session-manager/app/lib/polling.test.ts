import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { meta, session } from '@/tests/utils/fixtures';

import { queryKeys } from './api/keys';
import {
  offlineDelay,
  POLL_FAST_MS,
  POLL_MAX_MS,
  POLL_SLOW_MS,
  pollInterval,
  sessionIsBusy,
  somethingIsBusy,
} from './polling';

afterEach(() => {
  vi.useRealTimers();
});

/** What the polling reads of a query: how it stands and how many answers failed. */
function queryStub(state: { status: string; errorUpdateCount: number }) {
  return { state };
}

describe('sessionIsBusy', () => {
  it('is busy while the browser is on its way up or down, or a proxy is assigned', () => {
    expect(sessionIsBusy(session({ status: 'starting' }))).toBe(true);
    expect(sessionIsBusy(session({ status: 'stopping' }))).toBe(true);
    expect(sessionIsBusy(session({ activity: 'assigning_proxy' }))).toBe(true);
    expect(sessionIsBusy(session({ status: 'running' }))).toBe(false);
    expect(sessionIsBusy(session({ status: 'error' }))).toBe(false);
  });
});

describe('offlineDelay', () => {
  it('doubles from 5 seconds with every failure and stops at 30', () => {
    expect([1, 2, 3, 4, 5, 6].map(offlineDelay)).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
    expect(POLL_MAX_MS).toBe(30_000);
  });

  it('stays at the longest wait however long the server is away', () => {
    expect(offlineDelay(60)).toBe(POLL_MAX_MS);
    expect(offlineDelay(5_000)).toBe(POLL_MAX_MS);
  });
});

describe('pollInterval', () => {
  it('polls slowly while nothing changes, quickly while something does', () => {
    const client = new QueryClient();
    const interval = pollInterval(client);
    const ok = queryStub({ status: 'success', errorUpdateCount: 0 });
    client.setQueryData(queryKeys.meta, meta());
    expect(interval(ok)).toBe(POLL_SLOW_MS);
    client.setQueryData(
      queryKeys.meta,
      meta({ counts: { checkingProxies: 2 } }),
    );
    expect(interval(ok)).toBe(POLL_FAST_MS);
  });

  it('waits 5, 10, 20 and then 30 seconds while the server does not answer', () => {
    const interval = pollInterval(new QueryClient());
    const state = { status: 'error', errorUpdateCount: 0 };
    const query = queryStub(state);
    const waits = [1, 2, 3, 4, 5].map((failures) => {
      state.errorUpdateCount = failures;
      return interval(query);
    });
    expect(waits).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
  });

  it('keeps the wait it has while a new try is under way, so that nothing flips back to the quick pace', () => {
    const interval = pollInterval(new QueryClient());
    // A query that never answered goes back to "pending" while it tries again.
    const query = queryStub({ status: 'pending', errorUpdateCount: 3 });
    expect(interval(query)).toBe(20_000);
  });

  it('starts again at 5 seconds with the first answer', () => {
    const interval = pollInterval(new QueryClient());
    const state = { status: 'error', errorUpdateCount: 4 };
    const query = queryStub(state);
    expect(interval(query)).toBe(30_000);

    // The server answers: the pace is the ordinary one again.
    state.status = 'success';
    expect(interval(query)).toBe(POLL_SLOW_MS);

    // It goes away again: the wait begins at the beginning, not at 30.
    state.status = 'error';
    state.errorUpdateCount = 5;
    expect(interval(query)).toBe(5_000);
    state.errorUpdateCount = 6;
    expect(interval(query)).toBe(10_000);
  });

  it('counts the failures of every query on its own', () => {
    const interval = pollInterval(new QueryClient());
    const failing = queryStub({ status: 'error', errorUpdateCount: 3 });
    const fresh = queryStub({ status: 'error', errorUpdateCount: 1 });
    expect(interval(failing)).toBe(20_000);
    expect(interval(fresh)).toBe(5_000);
    expect(interval(failing)).toBe(20_000);
  });

  it('counts again from the start for a query that was reset', () => {
    const interval = pollInterval(new QueryClient());
    const state = { status: 'success', errorUpdateCount: 7 };
    const query = queryStub(state);
    expect(interval(query)).toBe(POLL_SLOW_MS);

    // The cache forgot the query's history: it begins at nothing again.
    state.errorUpdateCount = 0;
    expect(interval(query)).toBe(POLL_SLOW_MS);
    state.status = 'error';
    state.errorUpdateCount = 1;
    expect(interval(query)).toBe(5_000);
  });
});

describe('pollInterval on a query that is read for real', () => {
  it('asks again after 5, 10, 20 and 30 seconds while the server fails, and after 5 once it answers', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let serverIsUp = false;
    const read = vi.fn(async () => {
      if (!serverIsUp) throw new Error('The server does not answer.');
      return 'answer';
    });
    const observer = new QueryObserver(client, {
      queryKey: ['read'],
      queryFn: read,
      refetchInterval: pollInterval(client),
      refetchIntervalInBackground: true,
    });
    const stop = observer.subscribe(() => {});

    // The first try fails at once.
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);

    // Every wait is exactly as long as it should be: a try a moment before
    // it is over would be a try too soon.
    let tries = 1;
    for (const wait of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(
        read,
        `a try ${wait - 1} ms into a wait of ${wait}`,
      ).toHaveBeenCalledTimes(tries);
      await vi.advanceTimersByTimeAsync(1);
      tries += 1;
      expect(read, `no try after a wait of ${wait}`).toHaveBeenCalledTimes(
        tries,
      );
    }

    // The server is back: the next try finds it, and the pace is the ordinary one.
    serverIsUp = true;
    await vi.advanceTimersByTimeAsync(30_000);
    tries += 1;
    expect(read).toHaveBeenCalledTimes(tries);
    expect(observer.getCurrentResult().status).toBe('success');
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS);
    tries += 1;
    expect(read).toHaveBeenCalledTimes(tries);

    // Away again: the wait starts over at 5 seconds.
    serverIsUp = false;
    await vi.advanceTimersByTimeAsync(POLL_SLOW_MS);
    tries += 1;
    expect(read).toHaveBeenCalledTimes(tries);
    expect(observer.getCurrentResult().status).toBe('error');
    await vi.advanceTimersByTimeAsync(5_000);
    tries += 1;
    expect(read).toHaveBeenCalledTimes(tries);
    await vi.advanceTimersByTimeAsync(10_000);
    tries += 1;
    expect(read).toHaveBeenCalledTimes(tries);

    stop();
  });

  it('backs off for a query that has never had an answer too', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const read = vi.fn(async () => {
      throw new Error('The server does not answer.');
    });
    const observer = new QueryObserver(client, {
      queryKey: ['never'],
      queryFn: read,
      refetchInterval: pollInterval(client),
      refetchIntervalInBackground: true,
    });
    const stop = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(4);

    stop();
  });
});

describe('somethingIsBusy', () => {
  it('sees the browser download, a busy session in any loaded window and a proxy check', () => {
    const client = new QueryClient();
    expect(somethingIsBusy(client)).toBe(false);

    client.setQueryData(
      queryKeys.meta,
      meta({ browserInstalling: true, browserInstalled: false }),
    );
    expect(somethingIsBusy(client)).toBe(true);

    client.setQueryData(queryKeys.meta, meta());
    expect(somethingIsBusy(client)).toBe(false);

    client.setQueryData(queryKeys.sessionList(50), {
      items: [
        session({ status: 'running' }),
        session({ id: 2, status: 'starting' }),
      ],
      total: 2,
    });
    expect(somethingIsBusy(client)).toBe(true);

    client.setQueryData(queryKeys.sessionList(50), {
      items: [session({ status: 'running' })],
      total: 1,
    });
    expect(somethingIsBusy(client)).toBe(false);
  });

  // The page asks every second and a half while something is changing, and
  // every five seconds otherwise. A browser that is not there, whose download
  // failed or which nobody installed, changes nothing by itself: the person is
  // told in the banner, and the page notices an install made by hand within
  // the slow pace.
  it('does not hurry for a browser that is missing, whether its installation failed or none was started', () => {
    const client = new QueryClient();
    client.setQueryData(
      queryKeys.meta,
      meta({ browserInstalled: false, browserInstalling: false }),
    );
    expect(somethingIsBusy(client)).toBe(false);

    client.setQueryData(
      queryKeys.meta,
      meta({
        browserInstalled: false,
        browserInstalling: false,
        browserInstallError: 'download failed: ECONNRESET',
      }),
    );
    expect(somethingIsBusy(client)).toBe(false);
    expect(
      pollInterval(client)(
        queryStub({ status: 'success', errorUpdateCount: 0 }),
      ),
    ).toBeLessThanOrEqual(5_000);
    expect(
      pollInterval(client)(
        queryStub({ status: 'success', errorUpdateCount: 0 }),
      ),
    ).toBe(POLL_SLOW_MS);
  });

  it('sees a busy session of a page of its own, outside any list', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.session(1), session({ status: 'starting' }));
    expect(somethingIsBusy(client)).toBe(true);
    client.setQueryData(queryKeys.session(1), session({ status: 'running' }));
    expect(somethingIsBusy(client)).toBe(false);
  });
});
