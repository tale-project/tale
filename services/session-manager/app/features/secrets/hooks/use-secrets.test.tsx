import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/app/lib/api/keys';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { renderHookApp } from '@/tests/utils/render';
import {
  allSecrets,
  installSecretsApi,
  summaryOf,
} from '@/tests/utils/secrets-api';

import { SECRET_LISTS, useSecrets } from './use-secrets';

afterEach(() => {
  vi.useRealTimers();
});

describe('useSecrets', () => {
  it('lists every secret, newest first, with no filter', async () => {
    const { api } = installSecretsApi();
    const { result } = renderHookApp(useSecrets);

    await waitFor(() => expect(result.current.data).toHaveLength(6));
    expect(result.current.data?.map((secret) => secret.id)).toEqual([
      8, 7, 6, 5, 4, 3,
    ]);
    const call = api.callsTo('GET /secrets')[0];
    expect([...(call?.query.keys() ?? [])]).toEqual([]);
  });

  it('is pending before the first answer and has no data', () => {
    installFakeApi({ 'GET /secrets': () => new Promise(() => {}) });
    const { result } = renderHookApp(useSecrets);
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('never carries a field: a list shows no hidden value', async () => {
    installSecretsApi();
    const { result } = renderHookApp(useSecrets);
    await waitFor(() => expect(result.current.data).toBeDefined());
    for (const secret of result.current.data ?? []) {
      expect(secret).not.toHaveProperty('fields');
    }
  });

  it('keeps the rows through a refresh that fails, and says it failed', async () => {
    const { api } = installSecretsApi();
    const { result } = renderHookApp(useSecrets);
    await waitFor(() => expect(result.current.data).toHaveLength(6));
    expect(result.current.isError).toBe(false);

    api.on('GET /secrets', failure(500, 'internal'));
    await act(() => result.current.refetch());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toHaveLength(6);
  });

  it('fails with the answer of the server when the first read fails', async () => {
    installFakeApi({ 'GET /secrets': failure(500, 'internal', 'boom') });
    const { result } = renderHookApp(useSecrets);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: 'internal',
      status: 500,
    });
  });

  it('reads the list again every few seconds, as an assistant can change it meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = installSecretsApi();
    renderHookApp(useSecrets);
    await vi.waitFor(() => expect(api.callsTo('GET /secrets')).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() =>
      expect(api.callsTo('GET /secrets').length).toBeGreaterThan(1),
    );
  });

  it('is refreshed by invalidating the lists of secrets', async () => {
    const { api, state } = installSecretsApi();
    const { result, queryClient } = renderHookApp(useSecrets);
    await waitFor(() => expect(result.current.data).toHaveLength(6));

    state.secrets = state.secrets.slice(1);
    await act(() => queryClient.invalidateQueries({ queryKey: SECRET_LISTS }));

    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(api.callsTo('GET /secrets')).toHaveLength(2);
  });

  it('is kept under the key the app names for the lists of secrets', async () => {
    installSecretsApi({ secrets: allSecrets().slice(0, 1) });
    const { result, queryClient } = renderHookApp(useSecrets);
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(queryClient.getQueryData(queryKeys.secretList({}))).toEqual([
      summaryOf(allSecrets()[0]),
    ]);
  });
});
