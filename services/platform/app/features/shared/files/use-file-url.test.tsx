/**
 * The batch of file links a chat or a task draws its pictures from. Each
 * link runs out after `FILE_LINK_LIFETIME_SEC` (15 minutes), and the store
 * answers it with 403 from then on. A chat that stayed open kept its first
 * batch, so a picture opened in the preview after that loaded a link that
 * had run out (#5366). The read lane runs for real here (the hook, the
 * adapter row, `backendFetch`), under the app's own query defaults, against
 * a closed synthetic transport that signs a new link on every call.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isStructuredBackendError } from '@/app/hooks/use-action-query';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { useFileUrls } from './use-file-url';

const URLS = /^POST \/api\/app\/files\/urls\?orgId=org-1$/;
const MINUTE = 60_000;
const SIGNED_AT = new Date('2026-11-04T11:05:58Z').getTime();

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  // Only the clock moves: react-query ages an answer by `Date.now()`.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SIGNED_AT);
  window.history.replaceState({}, '', '/dashboard/org-1/chat');
  backend = syntheticBackend();
  backend.on(URLS, (_url, init) => {
    const { fileIds } = (
      typeof init?.body === 'string' ? JSON.parse(init.body) : { fileIds: [] }
    ) as { fileIds: string[] };
    return Response.json({
      urls: fileIds.map((fileId) => ({
        fileId,
        url: `https://store.test/${fileId}?signed=${Date.now()}`,
      })),
    });
  });
  // The app's defaults (`app/router.tsx`): an answer is fresh for five
  // minutes, and only a read that failed on a fault is fetched again when
  // the tab is looked at again.
  client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * MINUTE,
        gcTime: 15 * MINUTE,
        refetchOnWindowFocus: (query) =>
          query.state.status === 'error' &&
          !isStructuredBackendError(query.state.error),
      },
    },
  });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The tab is looked at again: what react-query's focus manager listens
 * for. Settles the fetch it may start. */
async function lookAgainAt(minutes: number) {
  vi.setSystemTime(SIGNED_AT + minutes * MINUTE);
  await act(async () => {
    window.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useFileUrls on a page that stays open', () => {
  it('fetches new links when the tab is looked at again before the old ones run out', async () => {
    const { result } = renderHook(() => useFileUrls(['s3:acme/lighthouse']), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(backend.count(URLS)).toBe(1);
    const first = result.current.data?.[0]?.url;

    // Nine minutes in, the links have six left: the batch stays.
    await lookAgainAt(9);
    expect(backend.count(URLS)).toBe(1);
    expect(result.current.data?.[0]?.url).toBe(first);

    // Eleven minutes in, four left: the batch is fetched again, and the
    // picture's next load reads a link signed now.
    await lookAgainAt(11);
    await waitFor(() => expect(backend.count(URLS)).toBe(2));
    await waitFor(() =>
      expect(result.current.data?.[0]?.url).toBe(
        `https://store.test/s3:acme/lighthouse?signed=${SIGNED_AT + 11 * MINUTE}`,
      ),
    );
  });

  it('keeps a refusal as it is when the tab is looked at again', async () => {
    backend.on(URLS, () =>
      Response.json({ error: 'FORBIDDEN', code: 'FORBIDDEN' }, { status: 403 }),
    );
    const { result } = renderHook(() => useFileUrls(['s3:acme/lighthouse']), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const attempts = backend.count(URLS);

    await lookAgainAt(11);
    expect(backend.count(URLS)).toBe(attempts);
  });
});
