// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for #1977: the `$agentId` loader warms the agent config
// by calling the Convex action directly (bypassing the auth gate that
// `useActionQuery` applies to `useReadAgent`). Firing it on a cold load — before
// the WebSocket auth handshake completes — ran the action unauthenticated and
// logged a `UNAUTHENTICATED` console Server Error. The loader now gates on the
// same signal the app's authed queries use: the `getCurrentUser` auth probe
// having resolved a user into the shared cache.

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: () => ({ id: 'org-1', agentId: 'agent-1' }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  createRootRouteWithContext: () => () => (config: Record<string, unknown>) =>
    config,
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  Outlet: () => null,
}));

// A sentinel query key so the test can assert the loader probes `getCurrentUser`.
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (fn: unknown, args: unknown) => ({
    queryKey: ['convex-query', fn, args],
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    users: { queries: { getCurrentUser: 'getCurrentUser-ref' } },
    agents: { file_actions: { readAgent: 'readAgent-ref' } },
  },
}));

type LoaderContext = {
  queryClient: {
    getQueryData: ReturnType<typeof vi.fn>;
    prefetchQuery: ReturnType<typeof vi.fn>;
  };
  convexQueryClient: { convexClient: { action: ReturnType<typeof vi.fn> } };
};

// The router mock replaces `createFileRoute`, so `Route` is the plain config
// object and `Route.loader` is the loader function under test.
let loader: (args: {
  context: LoaderContext;
  params: { id: string; agentId: string };
}) => void;

function makeContext(currentUser: unknown): LoaderContext {
  return {
    queryClient: {
      getQueryData: vi.fn().mockReturnValue(currentUser),
      prefetchQuery: vi.fn(),
    },
    convexQueryClient: { convexClient: { action: vi.fn() } },
  };
}

beforeEach(async () => {
  const mod = await import('@/app/routes/dashboard/$id/agents/$agentId');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader = (mod.Route as any).loader;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('$agentId route loader auth gating (#1977)', () => {
  it('does not prefetch the agent config before auth is established', () => {
    // Cold load / reload: the getCurrentUser auth probe has not resolved yet,
    // so its cache entry is empty. The loader must skip the direct action call
    // so no UNAUTHENTICATED error is thrown/logged; the auth-gated useReadAgent
    // hook fetches once the handshake completes.
    const context = makeContext(undefined);

    loader({ context, params: { id: 'org-1', agentId: 'agent-1' } });

    expect(context.queryClient.getQueryData).toHaveBeenCalledWith([
      'convex-query',
      'getCurrentUser-ref',
      {},
    ]);
    expect(context.queryClient.prefetchQuery).not.toHaveBeenCalled();
  });

  it('prefetches the agent config once authenticated (warm hover preload)', () => {
    // In-app row-hover preload: the getCurrentUser probe has resolved a user
    // into the cache, so the WebSocket is authenticated and the warm prefetch
    // may fire.
    const context = makeContext({ _id: 'user-1' });

    loader({ context, params: { id: 'org-1', agentId: 'agent-1' } });

    expect(context.queryClient.prefetchQuery).toHaveBeenCalledTimes(1);
  });
});
