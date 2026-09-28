// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { threadShareStatusQuery } from '@/app/lib/backend/chat';
import { act, renderHook } from '@/tests/utils/render';

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock('@tale/ui/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

import { useThreadMenuActions } from '../hooks/use-thread-menu-actions';
import { threadShareUrl, useThreadSharing } from './thread-sharing';

let savedEnv: typeof window.__ENV__;

beforeEach(() => {
  savedEnv = window.__ENV__;
  mockToast.mockClear();
});

afterEach(() => {
  window.__ENV__ = savedEnv;
  vi.restoreAllMocks();
});

describe('threadShareUrl', () => {
  it.each([
    [
      'https://tale.example',
      '',
      'https://tale.example/dashboard/org-1/chat/shared/tok-1',
    ],
    [
      'https://tale.example',
      '/app',
      'https://tale.example/app/dashboard/org-1/chat/shared/tok-1',
    ],
    [
      'https://tale.example/',
      '/app',
      'https://tale.example/app/dashboard/org-1/chat/shared/tok-1',
    ],
    [
      'https://tale.example',
      '/app/',
      'https://tale.example/app/dashboard/org-1/chat/shared/tok-1',
    ],
    [
      'https://tale.example',
      'app',
      'https://tale.example/app/dashboard/org-1/chat/shared/tok-1',
    ],
    [
      'https://tale.example:8443',
      '/team/tale',
      'https://tale.example:8443/team/tale/dashboard/org-1/chat/shared/tok-1',
    ],
  ])(
    'joins SITE_URL %j and BASE_PATH %j with one slash apiece',
    (siteUrl, basePath, link) => {
      window.__ENV__ = { SITE_URL: siteUrl, BASE_PATH: basePath };
      expect(threadShareUrl('org-1', 'tok-1')).toBe(link);
    },
  );

  it('keeps the organization and token inside their own path segments', () => {
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '' };
    expect(threadShareUrl('org/1', 'tok?#1')).toBe(
      'https://tale.example/dashboard/org%2F1/chat/shared/tok%3F%231',
    );
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapperWith(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('the Home row menu’s Share (#3718)', () => {
  it('copies the snapshot URL under the deployment base path', async () => {
    window.__ENV__ = {
      SITE_URL: 'https://tale.example',
      BASE_PATH: '/audit-prefix',
    };
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(json(200, { shareToken: 'tok-1' }));
    userEvent.setup();
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () => useThreadMenuActions('org-1', { id: 'thread-1' }),
      { wrapper: wrapperWith(queryClient) },
    );

    await act(() => result.current.shareAndCopyLink());

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/audit-prefix/api/app/chat/threads/thread-1/share?orgId=org-1',
    );
    await expect(navigator.clipboard.readText()).resolves.toBe(
      'https://tale.example/audit-prefix/dashboard/org-1/chat/shared/tok-1',
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Link copied' });
  });
});

describe('useThreadSharing', () => {
  const statusKey = threadShareStatusQuery('org-1', 'thread-1').queryKey;
  const readStatus = {
    isShared: false,
    shareToken: null,
    sharedAt: null,
    isShareable: true,
  };

  it('records a share and a revocation in the status it has read', async () => {
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '' };
    const fetchSpy = vi.spyOn(window, 'fetch');
    const queryClient = new QueryClient();
    queryClient.setQueryData(statusKey, readStatus);
    const { result } = renderHook(() => useThreadSharing('org-1'), {
      wrapper: wrapperWith(queryClient),
    });

    fetchSpy.mockResolvedValueOnce(json(200, { shareToken: 'tok-1' }));
    await act(async () => {
      await expect(result.current.share('thread-1')).resolves.toBe('tok-1');
    });
    expect(queryClient.getQueryData(statusKey)).toEqual({
      ...readStatus,
      isShared: true,
      shareToken: 'tok-1',
    });

    fetchSpy.mockResolvedValueOnce(json(200, { ok: true }));
    await act(async () => {
      await expect(result.current.unshare('thread-1')).resolves.toBe(true);
    });
    // The token stays: sharing again restores the same link.
    expect(queryClient.getQueryData(statusKey)).toEqual({
      ...readStatus,
      isShared: false,
      shareToken: 'tok-1',
    });
  });

  it('leaves the status alone when the backend refuses', async () => {
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '' };
    const fetchSpy = vi.spyOn(window, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = new QueryClient();
    const shared = { ...readStatus, isShared: true, shareToken: 'tok-1' };
    queryClient.setQueryData(statusKey, shared);
    const { result } = renderHook(() => useThreadSharing('org-1'), {
      wrapper: wrapperWith(queryClient),
    });

    fetchSpy.mockResolvedValueOnce(json(200, { ok: false }));
    await act(async () => {
      await expect(result.current.unshare('thread-1')).resolves.toBe(false);
    });
    fetchSpy.mockResolvedValueOnce(json(404, { error: 'thread not found' }));
    await act(async () => {
      await expect(result.current.share('thread-1')).resolves.toBeNull();
    });
    expect(queryClient.getQueryData(statusKey)).toEqual(shared);
  });
});
