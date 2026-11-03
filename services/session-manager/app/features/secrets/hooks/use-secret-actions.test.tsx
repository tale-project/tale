import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { queryKeys } from '@/app/lib/api/keys';
import type { SecretCreate } from '@/lib/api/schemas';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { countWrites, heldByWrites } from '@/tests/utils/mutation-cache';
import { renderHookApp } from '@/tests/utils/render';
import { installSecretsApi } from '@/tests/utils/secrets-api';
import { openToasts } from '@/tests/utils/toasts';

import { FORM_REFUSALS, useSecretActions } from './use-secret-actions';
import { SECRET_LISTS } from './use-secrets';

function useActionsAndToasts() {
  const { toasts } = useToast();
  return { actions: useSecretActions(), toasts: openToasts(toasts) };
}

const body: SecretCreate = {
  kind: 'note',
  title: 'Notes',
  sessionId: null,
  fields: [{ label: 'Note', value: 'text' }],
};

describe('useSecretActions', () => {
  it('adds a secret, refreshes the lists and the counts, and says so', async () => {
    const { api } = installSecretsApi();
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() => result.current.actions.create.mutateAsync(body));

    expect(api.callsTo('POST /secrets')[0]?.body).toEqual(body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SECRET_LISTS });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.meta });
    await waitFor(() =>
      expect(result.current.toasts[0]).toMatchObject({
        title: 'Secret added',
        variant: 'success',
      }),
    );
    expect(result.current.toasts).toHaveLength(1);
  });

  it('keeps nothing of the secret the server answers with, which holds its hidden values', async () => {
    installSecretsApi();
    const { result } = renderHookApp(useActionsAndToasts);
    await act(() =>
      result.current.actions.create.mutateAsync({
        ...body,
        fields: [{ label: 'Password', value: 'hunter2', hidden: true }],
      }),
    );
    await waitFor(() =>
      expect(result.current.actions.create.isSuccess).toBe(true),
    );
    expect(result.current.actions.create.data).toBeUndefined();
  });

  describe('what stays in memory of the values a write carries', () => {
    const hidden = (value: string) => [
      { label: 'Password', value, hidden: true },
    ];

    it('is nothing once the writes are no longer watched: the cache holds the values a write was called with for minutes otherwise', async () => {
      installSecretsApi();
      const { result, queryClient, unmount } =
        renderHookApp(useActionsAndToasts);
      await act(async () => {
        await result.current.actions.create.mutateAsync({
          ...body,
          fields: hidden('PROBE-CREATE'),
        });
        await result.current.actions.update.mutateAsync({
          id: 6,
          update: { fields: hidden('PROBE-UPDATE') },
        });
        await result.current.actions.remove.mutateAsync({ id: 6 });
      });
      expect(countWrites(queryClient)).toBe(3);

      unmount();

      await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    });

    it('is nothing either when the server refused the values', async () => {
      installFakeApi({
        'POST /secrets': failure(422, 'invalid_secret'),
        'PATCH /secrets/:id': failure(422, 'invalid_secret'),
      });
      const { result, queryClient, unmount } =
        renderHookApp(useActionsAndToasts);
      await act(async () => {
        await expect(
          result.current.actions.create.mutateAsync({
            ...body,
            fields: hidden('PROBE-CREATE'),
          }),
        ).rejects.toBeInstanceOf(ApiError);
        await expect(
          result.current.actions.update.mutateAsync({
            id: 6,
            update: { fields: hidden('PROBE-UPDATE') },
          }),
        ).rejects.toBeInstanceOf(ApiError);
      });
      expect(heldByWrites(queryClient)).toContain('PROBE-CREATE');

      unmount();

      await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    });
  });

  it('changes a secret with what the form sends, and says it is saved', async () => {
    const { api } = installSecretsApi();
    const { result } = renderHookApp(useActionsAndToasts);

    await act(() =>
      result.current.actions.update.mutateAsync({
        id: 6,
        update: { title: 'Shop' },
      }),
    );

    const call = api.callsTo('PATCH /secrets/:id')[0];
    expect(call?.params.id).toBe('6');
    expect(call?.body).toEqual({ title: 'Shop' });
    await waitFor(() =>
      expect(result.current.toasts[0]?.title).toBe('Secret updated'),
    );
  });

  it('deletes a secret, refreshes the lists and says so', async () => {
    const { api } = installSecretsApi();
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() => result.current.actions.remove.mutateAsync({ id: 6 }));

    expect(api.callsTo('DELETE /secrets/:id')[0]?.params.id).toBe('6');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SECRET_LISTS });
    await waitFor(() =>
      expect(result.current.toasts[0]?.title).toBe('Secret deleted'),
    );
  });

  it('tells a failure once, as a toast with the reason in the language of the person', async () => {
    installFakeApi({
      'DELETE /secrets/:id': failure(404, 'secret_not_found'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.remove.mutateAsync({ id: 6 }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't delete the secret",
      description: 'This secret no longer exists.',
    });
  });

  it('raises the toast of the action that failed, whatever it is', async () => {
    installFakeApi({
      'POST /secrets': failure(500, 'internal', 'boom'),
      'PATCH /secrets/:id': failure(500, 'internal', 'boom'),
    });
    const { result } = renderHookApp(useActionsAndToasts);
    await act(async () => {
      await expect(
        result.current.actions.create.mutateAsync(body),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() =>
      expect(result.current.toasts[0]?.title).toBe("Couldn't add the secret"),
    );
    await act(async () => {
      await expect(
        result.current.actions.update.mutateAsync({
          id: 1,
          update: { title: 'x' },
        }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() =>
      expect(result.current.toasts[0]?.title).toBe("Couldn't save the secret"),
    );
  });

  it('leaves the refusals the form words to the form: no toast, the error is on the mutation', async () => {
    installFakeApi({
      'POST /secrets': failure(
        422,
        'invalid_secret',
        'Fill in at least one value.',
      ),
      'PATCH /secrets/:id': failure(404, 'secret_not_found'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.actions.create.mutateAsync(body),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(
        result.current.actions.update.mutateAsync({
          id: 1,
          update: { title: 'x' },
        }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.toasts).toHaveLength(0);
    await waitFor(() => {
      expect(result.current.actions.create.error).toMatchObject({
        code: 'invalid_secret',
      });
      expect(result.current.actions.update.error).toMatchObject({
        code: 'secret_not_found',
      });
    });
  });

  it('words as its own the refusals a value, a kind, a scope, a secret or a session can cause', () => {
    expect([...FORM_REFUSALS].sort()).toEqual(
      [
        'invalid_kind',
        'invalid_scope',
        'invalid_secret',
        'secret_not_found',
        'session_not_found',
        'validation_error',
      ].sort(),
    );
  });
});
