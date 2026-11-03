import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/app/lib/api/keys';
import { POLL_FAST_MS } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';

import { FollowedSessions, GATHER_MS } from './followed-sessions';
import type { FinishedWork, FollowedWork } from './proxy-flows';
import { REMOVE_SESSION_KEY } from './removal';

const busy = (overrides: Partial<Session> = {}) =>
  session({ status: 'starting', activity: 'assigning_proxy', ...overrides });
const stuck = (overrides: Partial<Session> = {}) =>
  session({ status: 'error', errorCode: 'no_working_proxy', ...overrides });

/** The answers of a route, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

const work = (overrides: Partial<FollowedWork> = {}): FollowedWork => ({
  retry: () => Promise.resolve(),
  thenStart: false,
  ...overrides,
});

function setup({
  dialogOpen = () => false,
}: { dialogOpen?: () => boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const finished: FinishedWork[][] = [];
  const followed = new FollowedSessions(queryClient, dialogOpen);
  followed.listen((entries) => finished.push(entries));
  return { queryClient, followed, finished };
}

/** Lets the reads that are due happen, and what they set going. */
const later = (ms = POLL_FAST_MS) => vi.advanceTimersByTimeAsync(ms);
/** Long enough for work that is over to be handed over. */
const gathered = () => later(GATHER_MS);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FollowedSessions', () => {
  it('reads the session, and hands it over once its work is over', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': sequence(
        busy(),
        busy(),
        session({ status: 'running' }),
      ),
    });
    const { followed, finished } = setup();
    const kept = work();

    followed.follow(busy(), kept);
    await later(0);
    expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);
    expect(finished).toEqual([]);

    await later();
    expect(finished).toEqual([]);
    await later();
    await gathered();

    expect(finished).toHaveLength(1);
    expect(finished[0]).toEqual([
      { session: session({ status: 'running' }), work: kept },
    ]);
    followed.dispose();
  });

  it('stops reading once it handed the session over', async () => {
    const api = installFakeApi({ 'GET /sessions/:id': session() });
    const { followed, finished } = setup();

    followed.follow(busy(), work());
    await later(0);
    await gathered();
    expect(finished).toHaveLength(1);
    const reads = api.callsTo('GET /sessions/:id').length;

    await later(POLL_FAST_MS * 5);

    expect(api.callsTo('GET /sessions/:id')).toHaveLength(reads);
    followed.dispose();
  });

  it('goes on reading while the session is busy, every time it is due', async () => {
    const api = installFakeApi({ 'GET /sessions/:id': busy() });
    const { followed, finished } = setup();

    followed.follow(busy(), work());
    await later(0);
    await later(POLL_FAST_MS * 3);

    expect(api.callsTo('GET /sessions/:id').length).toBeGreaterThanOrEqual(4);
    expect(finished).toEqual([]);
    followed.dispose();
  });

  it('takes no account of what was known before the work began', async () => {
    // Another page holds the session as it failed an hour ago.
    installFakeApi({
      'GET /sessions/:id': sequence(busy(), session({ status: 'running' })),
    });
    const { queryClient, followed, finished } = setup();
    queryClient.setQueryData(queryKeys.session(1), stuck());

    followed.follow(busy(), work());
    await later(0);

    // The first answer is the one asked for after the work began: still busy.
    expect(finished).toEqual([]);
    await later();
    await gathered();
    expect(finished[0]?.[0]?.session.status).toBe('running');
    followed.dispose();
  });

  it('hands over every session whose work is over at once', async () => {
    installFakeApi({
      'GET /sessions/:id': ({ params }) =>
        stuck({ id: Number(params.id), name: `Session ${params.id}` }),
    });
    const { followed, finished } = setup();

    followed.follow(busy({ id: 1 }), work());
    followed.follow(busy({ id: 2 }), work());
    await later(0);
    await gathered();

    // One call, with both: the person is asked once for the two of them.
    expect(finished).toHaveLength(1);
    expect(
      finished[0]?.map((entry) => entry.session.id).sort((a, b) => a - b),
    ).toEqual([1, 2]);
    followed.dispose();
  });

  it('hands over together the sessions that end a moment apart, and apart those that do not', async () => {
    installFakeApi({
      'GET /sessions/:id': ({ params }) =>
        Number(params.id) === 3 && !later3.done
          ? busy({ id: 3 })
          : stuck({ id: Number(params.id) }),
    });
    const later3 = { done: false };
    const { followed, finished } = setup();

    followed.follow(busy({ id: 1 }), work());
    followed.follow(busy({ id: 2 }), work());
    followed.follow(busy({ id: 3 }), work());
    await later(0);
    await gathered();
    expect(finished.map((batch) => batch.length)).toEqual([2]);

    later3.done = true;
    await later();
    await gathered();
    expect(finished.map((batch) => batch.length)).toEqual([2, 1]);
    followed.dispose();
  });

  it('hands nothing over after it is disposed of, work gathered or not', async () => {
    installFakeApi({ 'GET /sessions/:id': stuck() });
    const { followed, finished } = setup();
    followed.follow(busy(), work());
    await later(0);

    followed.dispose();
    await gathered();

    expect(finished).toEqual([]);
  });

  it('holds a session back while a dialog is open, and hands it over with the next read after it closed', async () => {
    installFakeApi({ 'GET /sessions/:id': stuck() });
    let open = true;
    const { followed, finished } = setup({ dialogOpen: () => open });

    followed.follow(busy(), work());
    await later(0);
    await later(POLL_FAST_MS * 3);
    expect(finished).toEqual([]);

    open = false;
    await later();
    await gathered();

    expect(finished).toHaveLength(1);
    followed.dispose();
  });

  it('lets a session go that no longer exists, even while a dialog is open', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': failure(404, 'session_not_found'),
    });
    const { followed, finished } = setup({ dialogOpen: () => true });

    followed.follow(busy(), work());
    await later(0);
    const reads = api.callsTo('GET /sessions/:id').length;
    await later(POLL_FAST_MS * 3);

    expect(finished).toEqual([]);
    expect(api.callsTo('GET /sessions/:id')).toHaveLength(reads);
    followed.dispose();
  });

  it('lets a session go that is being deleted, without asking for it again', async () => {
    const api = installFakeApi({ 'GET /sessions/:id': busy() });
    const { queryClient, followed, finished } = setup();
    followed.follow(busy(), work());
    await later(0);
    expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);

    // The person deletes it while its work is on.
    const removal = new MutationObserver(queryClient, {
      mutationKey: REMOVE_SESSION_KEY,
      mutationFn: (_variables: { id: number }) => new Promise<void>(() => {}),
    });
    void removal.mutate({ id: 1 });
    await later(POLL_FAST_MS * 3);

    expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);
    expect(finished).toEqual([]);
    followed.dispose();
  });

  it('keeps reading after a read that failed for another reason', async () => {
    installFakeApi({
      'GET /sessions/:id': sequence(
        failure(500, 'internal'),
        session({ status: 'running' }),
      ),
    });
    const { followed, finished } = setup();

    followed.follow(busy(), work());
    await later(0);
    expect(finished).toEqual([]);
    await later();
    await gathered();

    expect(finished).toHaveLength(1);
    followed.dispose();
  });

  it('follows only the latest work of a session', async () => {
    installFakeApi({ 'GET /sessions/:id': stuck() });
    const { followed, finished } = setup();
    const first = work();
    const second = work({ thenStart: true });

    followed.follow(busy(), first);
    followed.follow(busy(), second);
    await later(0);
    await gathered();

    expect(finished).toHaveLength(1);
    expect(finished[0]?.[0]?.work).toBe(second);
    followed.dispose();
  });

  it('stops looking when it is disposed of', async () => {
    const api = installFakeApi({ 'GET /sessions/:id': busy() });
    const { followed, finished } = setup();
    followed.follow(busy(), work());
    await later(0);

    followed.dispose();
    const reads = api.callsTo('GET /sessions/:id').length;
    await later(POLL_FAST_MS * 3);

    expect(api.callsTo('GET /sessions/:id')).toHaveLength(reads);
    expect(finished).toEqual([]);
  });

  it('does not keep what it read: nothing outlives the work', async () => {
    installFakeApi({ 'GET /sessions/:id': session() });
    const { queryClient, followed } = setup();

    followed.follow(busy(), work());
    await later(0);
    await later(1);

    expect(
      queryClient.getQueryCache().findAll({ queryKey: queryKeys.sessions }),
    ).toEqual([]);
    followed.dispose();
  });
});
