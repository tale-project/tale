import { useToast } from '@tale/ui/use-toast';
import type { MutationCache } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { createTestQueryClient, renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import { useApiMutation } from './use-api-mutation';

const KEY = ['things'] as const;

function setup(
  mutationFn: (name: string) => Promise<string>,
  options: {
    quietFor?: string[];
    onSuccess?: (data: string) => void;
    gcTime?: number;
  } = {},
) {
  const queryClient = createTestQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = renderHookApp(
    () => ({
      mutation: useApiMutation({
        mutationFn,
        errorTitle: 'Could not do it',
        invalidates: [KEY],
        ...options,
      }),
      toasts: openToasts(useToast().toasts),
    }),
    { queryClient },
  );
  return { ...view, invalidate };
}

const busy = () => new ApiError(409, 'session_busy', 'The session is busy.');

describe('useApiMutation', () => {
  it('refreshes what the write changed once it succeeded', async () => {
    const { result, invalidate } = setup(() => Promise.resolve('done'));

    await act(() => result.current.mutation.mutateAsync('a'));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
    expect(result.current.toasts).toEqual([]);
  });

  it('refreshes it after a failure too: the server may have changed it anyway', async () => {
    // A start that is refused leaves the session in the error state; the row
    // must say so now, not at the next poll.
    const { result, invalidate } = setup(() => Promise.reject(busy()));

    await act(async () => {
      await expect(
        result.current.mutation.mutateAsync('a'),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
  });

  it('tells a failure once, in the words of the app, under the title it was given', async () => {
    const { result } = setup(() => Promise.reject(busy()));

    await act(async () => {
      await expect(
        result.current.mutation.mutateAsync('a'),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: 'Could not do it',
      description: 'This session is busy. Try again in a moment.',
    });
  });

  it('tells nothing of a refusal the caller words itself, and still refreshes', async () => {
    const { result, invalidate } = setup(() => Promise.reject(busy()), {
      quietFor: ['session_busy'],
    });

    await act(async () => {
      await expect(
        result.current.mutation.mutateAsync('a'),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.toasts).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY });
    await waitFor(() =>
      expect(result.current.mutation.error).toBeInstanceOf(ApiError),
    );
  });

  it('hands the answer to onSuccess, and only on a success', async () => {
    const onSuccess = vi.fn();
    const ok = setup(() => Promise.resolve('done'), { onSuccess });
    await act(() => ok.result.current.mutation.mutateAsync('a'));
    expect(onSuccess).toHaveBeenCalledWith('done', 'a');

    onSuccess.mockClear();
    const failing = setup(() => Promise.reject(busy()), { onSuccess });
    await act(async () => {
      await expect(
        failing.result.current.mutation.mutateAsync('a'),
      ).rejects.toBeInstanceOf(ApiError);
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('settles only after the lists were refreshed, so the caller sees them current', async () => {
    let release: () => void = () => {};
    const refreshed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { result, invalidate } = setup(() => Promise.reject(busy()));
    invalidate.mockReturnValue(refreshed);

    let settled = false;
    const pending = act(async () => {
      await expect(
        result.current.mutation.mutateAsync('a'),
      ).rejects.toBeInstanceOf(ApiError);
      settled = true;
    });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(settled).toBe(false);

    release();
    await pending;
    expect(settled).toBe(true);
  });

  describe('what the mutation cache keeps of a write', () => {
    // react-query keeps a finished write (what it was called with, what it
    // answered) for five minutes after the last component that watched it is
    // gone. A write whose values must not linger says how long instead.
    const cached = (queryClient: { getMutationCache: () => MutationCache }) =>
      queryClient.getMutationCache().getAll();

    it('drops a finished write once nothing watches it, when it asks to be kept for no time', async () => {
      const { result, queryClient, unmount } = setup(
        () => Promise.resolve('done'),
        { gcTime: 0 },
      );
      await act(() => result.current.mutation.mutateAsync('a'));
      // The hook still shows the outcome, so the write is still there.
      await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
      expect(cached(queryClient)).toHaveLength(1);

      unmount();

      await waitFor(() => expect(cached(queryClient)).toHaveLength(0));
    });

    it('drops one that failed in the same way', async () => {
      const { result, queryClient, unmount } = setup(
        () => Promise.reject(busy()),
        { gcTime: 0 },
      );
      await act(async () => {
        await expect(
          result.current.mutation.mutateAsync('a'),
        ).rejects.toBeInstanceOf(ApiError);
      });

      unmount();

      await waitFor(() => expect(cached(queryClient)).toHaveLength(0));
    });

    it('keeps it for as long as react-query does, five minutes, when it asks for nothing', async () => {
      const { result, queryClient, unmount } = setup(() =>
        Promise.resolve('done'),
      );
      await act(() => result.current.mutation.mutateAsync('a'));

      unmount();

      expect(cached(queryClient)).toHaveLength(1);
      expect(cached(queryClient)[0]?.gcTime).toBe(5 * 60 * 1000);
    });
  });
});
