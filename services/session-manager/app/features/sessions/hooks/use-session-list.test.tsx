import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { failure, installFakeApi, list, listFor } from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { SESSIONS_PAGE_SIZE, useSessionList } from './use-session-list';

describe('useSessionList', () => {
  it('asks for the newest page and says whether there are more', async () => {
    const api = installFakeApi({
      'GET /sessions': ({ query }) =>
        listFor(query, [session({ id: 3 }), session({ id: 2 })], 120),
    });
    const { result } = renderHookApp(useSessionList);

    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(api.callsTo('GET /sessions')[0]?.query.get('limit')).toBe(
      String(SESSIONS_PAGE_SIZE),
    );
    expect(result.current.total).toBe(120);
    expect(result.current.hasMore).toBe(true);
  });

  it('widens the window on loadMore, keeping the rows meanwhile', async () => {
    const api = installFakeApi({
      'GET /sessions': ({ query }) =>
        list(
          Array.from(
            { length: Math.min(Number(query.get('limit')), 120) },
            (_v, i) => session({ id: 1000 - i }),
          ),
          120,
        ),
    });
    const { result } = renderHookApp(useSessionList);
    await waitFor(() =>
      expect(result.current.sessions).toHaveLength(SESSIONS_PAGE_SIZE),
    );

    act(() => result.current.loadMore());

    await waitFor(() =>
      expect(result.current.sessions).toHaveLength(SESSIONS_PAGE_SIZE * 2),
    );
    expect(
      api.callsTo('GET /sessions').map((call) => call.query.get('limit')),
    ).toContain(String(SESSIONS_PAGE_SIZE * 2));
    expect(result.current.hasMore).toBe(true);
  });

  describe('reading back to a session older than the rows loaded', () => {
    const newestFirst = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        session({ id: count - index }),
      );

    it('asks once for the sessions from its id up, not for one wider window after another', async () => {
      const all = newestFirst(253);
      const api = installFakeApi({
        'GET /sessions': ({ query }) => listFor(query, all),
      });
      const { result } = renderHookApp(useSessionList);
      await waitFor(() =>
        expect(result.current.sessions).toHaveLength(SESSIONS_PAGE_SIZE),
      );

      act(() => result.current.readBackTo(1));

      await waitFor(() => expect(result.current.sessions).toHaveLength(253));
      expect(
        api
          .callsTo('GET /sessions')
          .map((call) => [call.query.get('limit'), call.query.get('minId')]),
      ).toEqual([
        [String(SESSIONS_PAGE_SIZE), null],
        ['253', '1'],
      ]);
      expect(result.current.hasMore).toBe(false);
    });

    it('stops at the session when older ones exist, and says there are more', async () => {
      const all = newestFirst(400);
      installFakeApi({ 'GET /sessions': ({ query }) => listFor(query, all) });
      const { result } = renderHookApp(useSessionList);
      await waitFor(() =>
        expect(result.current.sessions).toHaveLength(SESSIONS_PAGE_SIZE),
      );

      act(() => result.current.readBackTo(300));

      await waitFor(() => expect(result.current.sessions).toHaveLength(101));
      expect(result.current.sessions.at(-1)?.id).toBe(300);
      expect(result.current.hasMore).toBe(true);
    });

    it('goes on from the rows it has when more are asked for afterwards, as one window of the newest again', async () => {
      const all = newestFirst(400);
      const api = installFakeApi({
        'GET /sessions': ({ query }) => listFor(query, all),
      });
      const { result } = renderHookApp(useSessionList);
      await waitFor(() =>
        expect(result.current.sessions).toHaveLength(SESSIONS_PAGE_SIZE),
      );
      act(() => result.current.readBackTo(300));
      await waitFor(() => expect(result.current.sessions).toHaveLength(101));

      act(() => result.current.loadMore());

      await waitFor(() =>
        expect(result.current.sessions).toHaveLength(101 + SESSIONS_PAGE_SIZE),
      );
      expect(result.current.sessions.at(-1)?.id).toBe(400 - 150);
      const last = api.callsTo('GET /sessions').at(-1);
      expect(last?.query.get('limit')).toBe(String(101 + SESSIONS_PAGE_SIZE));
      expect(last?.query.get('minId')).toBeNull();
    });
  });

  it('has no more once every row is loaded', async () => {
    installFakeApi({ 'GET /sessions': () => list([session()], 1) });
    const { result } = renderHookApp(useSessionList);
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.hasMore).toBe(false);
  });

  it('says that a read is under way, and when the last one failed', async () => {
    let mode: 'works' | 'broken' | 'slow' = 'works';
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /sessions': async () => {
        if (mode === 'broken') return failure(500, 'http_500');
        if (mode === 'slow') await gate;
        return list([session()], 1);
      },
    });
    const { result } = renderHookApp(useSessionList);
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.errorUpdatedAt).toBe(0);

    // A read of the rows that stay on screen fails.
    mode = 'broken';
    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.errorUpdatedAt).toBeGreaterThan(0);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.isFetching).toBe(false);

    // The retry is under way; the failure stands until it settles.
    mode = 'slow';
    act(() => void result.current.refetch());
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isError).toBe(true);

    release();
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.isFetching).toBe(false);
  });
});
