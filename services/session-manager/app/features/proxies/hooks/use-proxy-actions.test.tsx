import { useToast } from '@tale/ui/use-toast';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/app/lib/api/client';
import { queryKeys } from '@/app/lib/api/keys';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { proxy, importResult } from '@/tests/utils/fixtures';
import { countWrites, heldByWrites } from '@/tests/utils/mutation-cache';
import { renderHookApp } from '@/tests/utils/render';
import { openToasts } from '@/tests/utils/toasts';

import {
  useAddProxy,
  useCheckAllProxies,
  useCheckProxy,
  useDeleteProxy,
  useImportProxies,
} from './use-proxy-actions';

function useActionsAndToasts() {
  const { toasts } = useToast();
  return {
    add: useAddProxy(),
    importProxies: useImportProxies(),
    check: useCheckProxy(),
    checkAll: useCheckAllProxies(),
    remove: useDeleteProxy(),
    toasts: openToasts(toasts),
  };
}

const POOL = [queryKeys.proxies, queryKeys.meta];

describe('useAddProxy', () => {
  it('adds the proxy with its default type, refreshes the pool and says so', async () => {
    const api = installFakeApi({ 'POST /proxies': proxy({ id: 9 }) });
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() =>
      result.current.add.mutateAsync({
        proxy: '1.2.3.4:8080:ada:secret',
        scheme: 'socks5',
      }),
    );

    expect(api.callsTo('POST /proxies')[0]?.body).toEqual({
      proxy: '1.2.3.4:8080:ada:secret',
      defaultScheme: 'socks5',
    });
    for (const key of POOL) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      title: 'Proxy added',
      variant: 'success',
    });
  });

  it.each([
    ['invalid_proxy', 422],
    ['duplicate', 409],
    ['validation_error', 422],
  ])('leaves the refusal %s to the dialog: no toast', async (code, status) => {
    installFakeApi({ 'POST /proxies': failure(status, code, 'x') });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.add.mutateAsync({ proxy: 'x', scheme: 'http' }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() =>
      expect(result.current.add.error).toMatchObject({ code }),
    );
    expect(result.current.toasts).toHaveLength(0);
  });

  it('tells any other failure once, as a toast', async () => {
    installFakeApi({ 'POST /proxies': failure(500, 'internal', 'Boom') });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.add.mutateAsync({ proxy: 'x', scheme: 'http' }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't add the proxy",
      // A code the app has no words for: not the backend's own English.
      description: 'Something went wrong. Try again.',
    });
  });
});

describe('the proxies typed in', () => {
  // A proxy is typed with its password (`host:port:user:password`), and the
  // mutation cache keeps what a write was called with for minutes after the
  // dialog that made it is gone.
  it('are not kept in the memory of the page once the dialog is gone', async () => {
    installFakeApi({
      'POST /proxies': proxy({ id: 9 }),
      'POST /proxies/import': importResult({ added: [proxy({ id: 5 })] }),
    });
    const { result, queryClient, unmount } = renderHookApp(useActionsAndToasts);
    await act(async () => {
      await result.current.add.mutateAsync({
        proxy: '1.2.3.4:8080:ada:PROBE-ONE',
        scheme: 'http',
      });
      await result.current.importProxies.mutateAsync({
        text: '5.6.7.8:80:bob:PROBE-TWO',
        scheme: 'http',
      });
    });
    expect(heldByWrites(queryClient)).toContain('PROBE-ONE');

    unmount();

    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
  });
});

describe('useImportProxies', () => {
  it('sends the list with its default type and answers the report', async () => {
    const report = importResult({ added: [proxy({ id: 5 })] });
    const api = installFakeApi({ 'POST /proxies/import': report });
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const answer = await act(() =>
      result.current.importProxies.mutateAsync({
        text: 'a:1\nb:2',
        scheme: 'https',
      }),
    );

    expect(api.callsTo('POST /proxies/import')[0]?.body).toEqual({
      text: 'a:1\nb:2',
      defaultScheme: 'https',
    });
    expect(answer.added).toHaveLength(1);
    for (const key of POOL) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    // The dialog shows the report: nothing to toast.
    expect(result.current.toasts).toHaveLength(0);
  });

  it('tells a failure once, as a toast', async () => {
    installFakeApi({ 'POST /proxies/import': failure(500, 'internal', 'No') });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.importProxies.mutateAsync({
          text: 'a:1',
          scheme: 'http',
        }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't import the proxies",
    });
  });
});

describe('useCheckProxy and useCheckAllProxies', () => {
  it('starts a check of one proxy and refreshes the pool', async () => {
    const api = installFakeApi({ 'POST /proxies/:id/check': proxy({ id: 4 }) });
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() => result.current.check.mutateAsync({ id: 4 }));

    expect(api.callsTo('POST /proxies/:id/check')[0]?.params.id).toBe('4');
    for (const key of POOL) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      title: 'Check started',
    });
  });

  it('starts a check of every proxy', async () => {
    const api = installFakeApi({ 'POST /proxies/check-all': [proxy()] });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(() => result.current.checkAll.mutateAsync());

    expect(api.callsTo('POST /proxies/check-all')).toHaveLength(1);
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      title: 'Check of all proxies started',
    });
  });

  it('tells a failed check once, with its reason', async () => {
    installFakeApi({
      'POST /proxies/:id/check': failure(404, 'proxy_not_found'),
      'POST /proxies/check-all': failure(500, 'internal', 'Boom'),
    });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.check.mutateAsync({ id: 4 }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't check the proxy",
      description: 'This proxy no longer exists.',
    });

    await act(async () => {
      await expect(
        result.current.checkAll.mutateAsync(),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() =>
      expect(result.current.toasts[0]).toMatchObject({
        title: "Couldn't check the proxies",
      }),
    );
    expect(result.current.toasts).toHaveLength(1);
  });
});

describe('useDeleteProxy', () => {
  it('deletes the proxy, then refreshes the pool and the sessions that had it', async () => {
    const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
    const { result, queryClient } = renderHookApp(useActionsAndToasts);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(() => result.current.remove.mutateAsync({ id: 4, force: false }));

    const [call] = api.callsTo('DELETE /proxies/:id');
    expect(call?.params.id).toBe('4');
    expect(call?.query.get('force')).toBe('false');
    for (const key of [...POOL, queryKeys.sessions]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      title: 'Proxy deleted',
      variant: 'success',
    });
  });

  it('deletes anyway when asked to', async () => {
    const api = installFakeApi({ 'DELETE /proxies/:id': undefined });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(() => result.current.remove.mutateAsync({ id: 4, force: true }));

    expect(api.callsTo('DELETE /proxies/:id')[0]?.query.get('force')).toBe(
      'true',
    );
  });

  it.each(['proxy_in_use', 'proxy_busy'])(
    'leaves the refusal %s to the dialog: no toast',
    async (code) => {
      installFakeApi({
        'DELETE /proxies/:id': failure(409, code, 'x', {
          session: { id: 1, name: '0001', status: 'stopped' },
        }),
      });
      const { result } = renderHookApp(useActionsAndToasts);

      await act(async () => {
        await expect(
          result.current.remove.mutateAsync({ id: 4, force: false }),
        ).rejects.toBeInstanceOf(ApiError);
      });

      await waitFor(() =>
        expect(result.current.remove.error).toMatchObject({ code }),
      );
      expect(result.current.toasts).toHaveLength(0);
    },
  );

  it('tells any other failure once, as a toast', async () => {
    installFakeApi({ 'DELETE /proxies/:id': failure(404, 'proxy_not_found') });
    const { result } = renderHookApp(useActionsAndToasts);

    await act(async () => {
      await expect(
        result.current.remove.mutateAsync({ id: 4, force: false }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    await waitFor(() => expect(result.current.toasts).toHaveLength(1));
    expect(result.current.toasts[0]).toMatchObject({
      variant: 'destructive',
      title: "Couldn't delete the proxy",
      description: 'This proxy no longer exists.',
    });
  });
});
