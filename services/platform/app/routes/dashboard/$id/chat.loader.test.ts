import { beforeEach, describe, expect, it, vi } from 'vitest';

// The confidentiality notice sits under the composer. Read only when the
// surface mounts, its policy answered a round-trip after the composer painted
// and the notice then pushed the usable composer up by its own height. The
// section loader warms that read with the surface's other org-wide reads, on
// the very key the footer's hook reads.

const { prefetchAdaptedQuery } = vi.hoisted(() => ({
  prefetchAdaptedQuery: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Outlet: () => null,
  useParams: () => ({}),
  useSearch: () => ({}),
}));
vi.mock('@/app/lib/backend/prefetch', () => ({ prefetchAdaptedQuery }));
vi.mock('@/app/features/chat/components/chat-surface', () => ({
  ChatSurface: () => null,
}));

describe('chat section loader', () => {
  beforeEach(() => {
    prefetchAdaptedQuery.mockClear();
  });

  it('warms the data notice policy the footer reads', async () => {
    const { Route } = await import('./chat');
    const { dataNoticePolicyArgs } =
      await import('@/app/features/governance/lib/data-notice');
    const queryClient = {};
    const loader = (
      Route as unknown as {
        loader: (args: {
          context: { queryClient: unknown };
          params: { id: string };
        }) => void;
      }
    ).loader;

    loader({ context: { queryClient }, params: { id: 'org-1' } });

    expect(prefetchAdaptedQuery).toHaveBeenCalledWith(
      queryClient,
      'governance/queries:getPolicy',
      dataNoticePolicyArgs('org-1'),
    );
  });
});
