import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useListAuditLogsPaginated,
  useListErrorLogsPaginated,
} from './queries';

/**
 * The logs page watches the listing its active tab reads, so the two must be
 * one cache entry fetched once, with one page size; and a caller with no
 * organization to read for (the tab not on show, a refused page) must fetch
 * nothing. Real hooks, real adapter rows and a real query client; only
 * `fetch` is stubbed, answering an empty trail.
 */

let queryClient: QueryClient;
/** Every listing request, as path and query string. */
let gets: string[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  gets = [];
  window.__ENV__ = { BASE_PATH: '' };
  // On the logs page, as in the app: an adapter row falls back to the URL's
  // organization, so only the hooks' skip keeps an org-less read from going
  // out.
  window.history.pushState({}, '', '/dashboard/org-1/settings/logs');
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    gets.push(`${url.pathname}${url.search}`);
    return Promise.resolve(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
  window.history.pushState({}, '', '/');
});

describe.each([
  ['useListAuditLogsPaginated', useListAuditLogsPaginated, '/audit-logs'],
  [
    'useListErrorLogsPaginated',
    useListErrorLogsPaginated,
    '/audit-logs/errors',
  ],
] as const)('%s', (_name, useListing, route) => {
  it('reads one page of 30, once, for the page and its tab alike', async () => {
    const { result } = renderHook(
      () => [
        useListing({ organizationId: 'org-1', category: 'security' }),
        useListing({ organizationId: 'org-1', category: 'security' }),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.map((listing) => listing.status)).toEqual([
        'Exhausted',
        'Exhausted',
      ]),
    );
    expect(gets).toEqual([
      `/api/app${route}?limit=30&category=security&orgId=org-1`,
    ]);
  });

  it('fetches nothing when there is no organization to read for', async () => {
    const { result } = renderHook(
      () => useListing({ organizationId: undefined, category: 'security' }),
      { wrapper },
    );
    // Let any request the hook might start reach the stub.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.status).toBe('LoadingFirstPage');
    expect(result.current.results).toEqual([]);
    expect(gets).toEqual([]);
  });
});
