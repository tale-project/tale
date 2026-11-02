import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { queryKeys } from '@/app/lib/api/keys';
import { errorText } from '@/tests/utils/errors';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { useSessionActions } from './use-session-actions';

function useActionsAndToasts() {
  const { toasts } = useToast();
  return { actions: useSessionActions(), toasts: openToasts(toasts) };
}

describe('useSessionActions', () => {
  it('starts a session and refreshes what a start changes', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/start': session({ id: 4, status: 'starting' }),
    });
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() => result.current.actions.start.mutateAsync({ id: 4 }));

    expect(api.callsTo('POST /sessions/:id/start')[0]?.body).toEqual({
      force: false,
    });
    for (const key of [queryKeys.sessions, queryKeys.meta, queryKeys.proxies]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    expect(result.current.toasts).toHaveLength(0);
  });

  it('tells a failure once, as a toast with the reason in the language of the person', async () => {
    installFakeApi({
      'POST /sessions/:id/stop': failure(409, 'session_busy'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.stop.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't stop the session",
      description: errorText('session_busy'),
    });
  });

  it('leaves a refusal a dialog words itself to the dialog', async () => {
    installFakeApi({
      'POST /sessions/:id/start': failure(409, 'ip_in_use', 'x', {
        exitIp: '203.0.113.7',
      }),
      'PATCH /sessions/:id': failure(409, 'name_taken'),
      'POST /sessions': failure(409, 'no_free_proxy'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.start.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(
        result.current.actions.rename.mutateAsync({ id: 4, name: 'a' }),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(
        result.current.actions.create.mutateAsync({}),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.toasts).toHaveLength(0);
    await waitFor(() => {
      expect(result.current.actions.start.error).toMatchObject({
        code: 'ip_in_use',
      });
      expect(result.current.actions.rename.error).toMatchObject({
        code: 'name_taken',
      });
      expect(result.current.actions.create.error).toMatchObject({
        code: 'no_free_proxy',
      });
    });
  });

  it('leaves a proxy that does not work, on a start, to the dialog that asks about it', async () => {
    installFakeApi({
      'POST /sessions/:id/start': failure(502, 'proxy_unreachable', 'x', {
        proxyId: 3,
      }),
      'POST /sessions/:id/rotate': failure(502, 'proxy_unreachable'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.start.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    expect(result.current.toasts).toHaveLength(0);

    // A rotation has no such dialog: whatever else fails is told.
    await act(async () => {
      await expect(
        result.current.actions.rotate.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]?.title).toBe("Couldn't rotate the IP");
  });

  it('starts anyway when asked to', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/start': session({ status: 'starting' }),
    });
    const { result } = renderHookApp(useActionsAndToasts);
    await act(() =>
      result.current.actions.start.mutateAsync({ id: 4, force: true }),
    );
    expect(api.callsTo('POST /sessions/:id/start')[0]?.body).toEqual({
      force: true,
    });
  });

  describe('deleting a session', () => {
    it('refreshes the lists, and forgets the session itself instead of reading it again', async () => {
      installFakeApi({ 'DELETE /sessions/:id': undefined });
      const { result, queryClient } = renderHookApp(useActionsAndToasts);
      queryClient.setQueryData(queryKeys.session(4), session({ id: 4 }));
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      await act(() => result.current.actions.remove.mutateAsync({ id: 4 }));

      for (const key of [
        queryKeys.sessionLists,
        queryKeys.meta,
        queryKeys.proxies,
        queryKeys.secrets,
      ]) {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
      }
      // Reading `['sessions']` again would ask for the session that is gone.
      expect(invalidate).not.toHaveBeenCalledWith({
        queryKey: queryKeys.sessions,
      });
      expect(queryClient.getQueryData(queryKeys.session(4))).toBeUndefined();
      expect(result.current.toasts).toHaveLength(0);
    });

    it('keeps the session when the backend refuses, and tells it once', async () => {
      installFakeApi({
        'DELETE /sessions/:id': failure(409, 'session_busy'),
      });
      const { result, queryClient } = renderHookApp(useActionsAndToasts);
      queryClient.setQueryData(queryKeys.session(4), session({ id: 4 }));

      await act(async () => {
        await expect(
          result.current.actions.remove.mutateAsync({ id: 4 }),
        ).rejects.toBeInstanceOf(ApiError);
      });

      expect(queryClient.getQueryData(queryKeys.session(4))).toBeDefined();
      await waitFor(() => expect(result.current.toasts).toHaveLength(1));
      expect(result.current.toasts[0]?.title).toBe(
        "Couldn't delete the session",
      );
    });
  });
});
