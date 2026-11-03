import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { useSession } from './use-session';
import { useSessionActions } from './use-session-actions';

describe('useSession', () => {
  it('reads one session', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': session({ id: 4, name: 'Shop' }),
    });
    const { result } = renderHookApp(() => useSession(4));

    await waitFor(() => expect(result.current.data?.name).toBe('Shop'));
    expect(api.callsTo('GET /sessions/:id')[0]?.params.id).toBe('4');
  });

  it('says a session that does not exist as the refusal it is', async () => {
    installFakeApi({
      'GET /sessions/:id': failure(404, 'session_not_found'),
    });
    const { result } = renderHookApp(() => useSession(4));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: 'session_not_found' });
  });

  it('asks for nothing while it is told not to', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': session({ id: 4 }),
    });
    const { result } = renderHookApp(() => useSession(4, { enabled: false }));

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(api.callsTo('GET /sessions/:id')).toHaveLength(0);
  });

  describe('while the session is deleted', () => {
    /** The session's page and the menu that deletes it, over a backend that answers when told. */
    function setup() {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const api = installFakeApi({
        'GET /sessions/:id': session({ id: 4, name: 'Shop' }),
        'DELETE /sessions/:id': async () => {
          await gate;
          return undefined;
        },
      });
      const view = renderHookApp(() => ({
        page: useSession(4),
        actions: useSessionActions(),
      }));
      return { ...view, api, release };
    }

    it('asks nothing more of it, and keeps what the page knew, while the deletion is under way', async () => {
      const { result, api, release } = setup();
      await waitFor(() => expect(result.current.page.data?.name).toBe('Shop'));
      expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);

      act(() => result.current.actions.remove.mutate({ id: 4 }));
      // A poll, an invalidation by whoever else, the browser closing: reads.
      await act(() => result.current.page.refetch());

      expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);
      expect(result.current.page.data?.name).toBe('Shop');
      expect(result.current.page.isError).toBe(false);

      release();
      await waitFor(() =>
        expect(result.current.actions.remove.isSuccess).toBe(true),
      );
    });

    it('says it is gone once it is deleted, without asking', async () => {
      const { result, api, release } = setup();
      await waitFor(() => expect(result.current.page.data).toBeDefined());

      act(() => result.current.actions.remove.mutate({ id: 4 }));
      release();
      await waitFor(() =>
        expect(result.current.actions.remove.isSuccess).toBe(true),
      );
      await act(() => result.current.page.refetch());

      await waitFor(() => expect(result.current.page.isError).toBe(true));
      expect(result.current.page.error).toMatchObject({
        status: 404,
        code: 'session_not_found',
      });
      expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);
    });
  });
});
