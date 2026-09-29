/**
 * The paginated listing lane over the real Inbox list adapter, with only the
 * fetch answered by the test. A read whose retries gave up hands its error
 * to the list, which shows the failure instead of an empty collection
 * (#3709) — and `retry` must then ask again for the request that failed:
 * the first page, or the page after the ones already loaded. A refetch
 * reloads only the loaded pages, so a failed next page was never asked for.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCachedPaginatedQuery } from './use-cached-paginated-query';

const LIST = 'conversations/queries:listConversationsPaginated';
const ARGS = { organizationId: 'org-1', status: 'open' } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const row = (id: string) => ({ _id: id, id, title: id });

/** The address a `fetch` call names, whichever form it came in. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** The list door, one answer per request in order; `cursors` records the
 * `cursor` each request asked for (`null` for the first page). */
function listDoor(answers: Array<() => Response | Promise<Response>>) {
  const cursors: Array<string | null> = [];
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(urlOf(input), 'http://localhost');
    cursors.push(url.searchParams.get('cursor'));
    const answer = answers.shift();
    return Promise.resolve(
      answer ? answer() : json(500, { error: 'no answer' }),
    );
  });
  return cursors;
}

const unavailable = () => json(503, { error: 'Service unavailable' });

function renderListing() {
  const client = new QueryClient({
    // The production retry count, without its back-off wait.
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useCachedPaginatedQuery(LIST, ARGS, { initialNumItems: 2 }),
    { wrapper },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCachedPaginatedQuery — a failed read and its retry', () => {
  it('hands over the error of a first page every attempt failed, then loads it again on retry', async () => {
    let answerRetry = (): void => {};
    const cursors = listDoor([
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      () =>
        new Promise((resolve) => {
          answerRetry = () =>
            resolve(
              json(200, {
                items: [row('c1')],
                isDone: true,
                continueCursor: '',
              }),
            );
        }),
    ]);
    const { result } = renderListing();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(cursors).toHaveLength(4);
    expect(result.current.status).toBe('Exhausted');
    expect(result.current.results).toEqual([]);

    act(() => result.current.retry());
    // Retrying reads as loading the first page again, never as empty.
    await waitFor(() => expect(result.current.status).toBe('LoadingFirstPage'));
    act(() => answerRetry());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(cursors).toEqual([null, null, null, null, null]);
  });

  it('settles a refused first page at once', async () => {
    const cursors = listDoor([
      () => json(403, { error: 'FORBIDDEN', message: 'Forbidden' }),
    ]);
    const { result } = renderListing();

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(cursors).toHaveLength(1);
    expect(result.current.status).toBe('Exhausted');
  });

  it('asks again for the page that failed, not the pages already loaded', async () => {
    const cursors = listDoor([
      () =>
        json(200, {
          items: [row('c1'), row('c2')],
          isDone: false,
          continueCursor: 'after-c2',
        }),
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      () => json(200, { items: [row('c3')], isDone: true, continueCursor: '' }),
    ]);
    const { result } = renderListing();
    await waitFor(() => expect(result.current.status).toBe('CanLoadMore'));

    act(() => result.current.loadMore(2));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    // The loaded rows stay; the list shows them with the failure.
    expect(result.current.results).toHaveLength(2);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.results).toHaveLength(3));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('Exhausted');
    expect(cursors.at(-1)).toBe('after-c2');
    // The first page was read once: the retry did not reload it.
    expect(cursors.filter((cursor) => cursor === null)).toHaveLength(1);
  });

  // #3777: a search drain and the scroll sentinel call `loadMore` on every
  // render, so a failed page was re-requested in a loop.
  it('does not ask for a failed next page again until the retry', async () => {
    let answerRetry = (): void => {};
    const cursors = listDoor([
      () =>
        json(200, {
          items: [row('c1'), row('c2')],
          isDone: false,
          continueCursor: 'after-c2',
        }),
      unavailable,
      unavailable,
      unavailable,
      unavailable,
      () =>
        new Promise((resolve) => {
          answerRetry = () =>
            resolve(
              json(200, {
                items: [row('c3')],
                isDone: true,
                continueCursor: '',
              }),
            );
        }),
    ]);
    const { result } = renderListing();
    await waitFor(() => expect(result.current.status).toBe('CanLoadMore'));

    act(() => result.current.loadMore(2));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.errorCount).toBe(1);
    expect(result.current.isRetrying).toBe(false);

    act(() => result.current.loadMore(2));
    act(() => result.current.loadMore(2));
    expect(cursors).toHaveLength(5);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isRetrying).toBe(true));
    act(() => answerRetry());
    await waitFor(() => expect(result.current.results).toHaveLength(3));
    expect(result.current.isRetrying).toBe(false);
    expect(cursors).toHaveLength(6);
  });
});
