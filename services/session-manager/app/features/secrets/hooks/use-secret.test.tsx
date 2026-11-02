import { focusManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/app/lib/api/keys';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { renderHookApp } from '@/tests/utils/render';
import { installSecretsApi, SAMPLE } from '@/tests/utils/secrets-api';

import { useSecret } from './use-secret';

describe('useSecret', () => {
  it('fetches the whole secret, hidden values included', async () => {
    const { api } = installSecretsApi();
    const { result } = renderHookApp(() => useSecret(6));

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.fields).toEqual(SAMPLE.credentials.fields);
    expect(api.callsTo('GET /secrets/:id')[0]?.params.id).toBe('6');
  });

  it('asks only for the secret it is given', async () => {
    const { api } = installSecretsApi();
    renderHookApp(() => useSecret(7));
    await waitFor(() =>
      expect(api.callsTo('GET /secrets/:id')).toHaveLength(1),
    );
    expect(api.callsTo('GET /secrets')).toHaveLength(0);
  });

  it('fails with the code of a secret that no longer exists', async () => {
    installSecretsApi();
    const { result } = renderHookApp(() => useSecret(999));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: 'secret_not_found',
      status: 404,
    });
  });

  it('does not read the secret again when the window regains focus, so a form never changes under the hands of the person', async () => {
    const { api } = installSecretsApi();
    const { result } = renderHookApp(() => useSecret(6));
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(api.callsTo('GET /secrets/:id')).toHaveLength(1);
  });

  it('is not kept once nothing shows it: the values do not stay in memory', async () => {
    installSecretsApi();
    const { result, queryClient, unmount } = renderHookApp(() => useSecret(6));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(queryClient.getQueryData(queryKeys.secret(6))).toBeDefined();

    unmount();

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.secret(6))).toBeUndefined(),
    );
  });

  it('does not retry a failure by itself', async () => {
    const api = installFakeApi({
      'GET /secrets/:id': failure(500, 'internal'),
    });
    const { result } = renderHookApp(() => useSecret(1));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.callsTo('GET /secrets/:id')).toHaveLength(1);
  });
});
