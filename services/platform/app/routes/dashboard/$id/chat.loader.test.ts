import { beforeEach, describe, expect, it, vi } from 'vitest';

// The confidentiality notice sits under the composer. Read only when the
// surface mounts, its policy answered a round-trip after the composer painted
// and the notice then pushed the usable composer up by its own height. The
// section loader warms that read with the surface's other org-wide reads, on
// the very key the footer's hook reads.

const { prefetchAdaptedPaginatedQuery, prefetchAdaptedQuery } = vi.hoisted(
  () => ({
    prefetchAdaptedPaginatedQuery: vi.fn(),
    prefetchAdaptedQuery: vi.fn(),
  }),
);

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Outlet: () => null,
  useParams: () => ({}),
  useSearch: () => ({}),
}));
vi.mock('@/app/lib/backend/prefetch', () => ({
  prefetchAdaptedPaginatedQuery,
  prefetchAdaptedQuery,
}));
vi.mock('@/app/features/chat/components/chat-surface', () => ({
  ChatSurface: () => null,
}));

/** Runs the section loader for org-1 with `queryClient` in its context. */
async function runLoader(queryClient: unknown) {
  const { Route } = await import('./chat');
  const loader = (
    Route as unknown as {
      loader: (args: {
        context: { queryClient: unknown };
        params: { id: string };
      }) => void;
    }
  ).loader;
  loader({ context: { queryClient }, params: { id: 'org-1' } });
}

describe('chat section loader', () => {
  beforeEach(() => {
    prefetchAdaptedPaginatedQuery.mockClear();
    prefetchAdaptedQuery.mockClear();
  });

  it('warms the data notice policy the footer reads', async () => {
    const { dataNoticePolicyArgs } =
      await import('@/app/features/governance/lib/data-notice');
    const queryClient = {};

    await runLoader(queryClient);

    expect(prefetchAdaptedQuery).toHaveBeenCalledWith(
      queryClient,
      'governance/queries:getPolicy',
      dataNoticePolicyArgs('org-1'),
    );
  });

  // The thread list pages (#5153): its first page is warmed as the surface's
  // paged read asks for it — the same name, args and page size.
  it('warms the first page of the thread list', async () => {
    const { CHAT_THREADS_PAGE_SIZE } =
      await import('@/app/features/chat/data/chat-backend');
    const queryClient = {};

    await runLoader(queryClient);

    expect(prefetchAdaptedPaginatedQuery).toHaveBeenCalledWith(
      queryClient,
      'chat/threads:listThreads',
      { organizationId: 'org-1' },
      CHAT_THREADS_PAGE_SIZE,
    );
    expect(prefetchAdaptedQuery).not.toHaveBeenCalledWith(
      queryClient,
      'chat/threads:listThreads',
      expect.anything(),
    );
  });
});
