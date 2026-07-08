// @vitest-environment jsdom
/**
 * The paginated bound read's gating contract. The raw Convex
 * `usePaginatedQuery` underneath is not auth-aware and RETHROWS a server error
 * into render — so the hook must hold the subscription in `skip` until the
 * WebSocket auth is established (mirroring `useConvexQuery`'s `requireAuth`
 * default), alongside the existing allowlist and unresolved-binding gates.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let authState = { isAuthenticated: true, isLoading: false };
vi.mock('convex/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexAuth: () => authState,
}));

// The Convex subscription layer — capture what the hook passes down.
let lastArgs: unknown;
vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: (_query: unknown, args: unknown) => {
    lastArgs = args;
    return {
      results: [],
      status: 'LoadingFirstPage',
      isLoading: true,
      loadMore: vi.fn(),
    };
  },
}));

import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { useBoundPaginatedQuery } from './use-bound-paginated-query';

const PATH = 'tasks/queries:listTasksByProjectPaginated';
const ARGS = { projectId: '$projectId', organizationId: '$orgId' };

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AutomationRuntimeProvider
      value={{
        organizationId: 'org-1',
        projectId: 'proj-1',
        automationSlug: 'issue-desk',
        allowlist: [{ path: PATH, mode: 'query' }],
        config: {},
      }}
    >
      {children}
    </AutomationRuntimeProvider>
  );
}

beforeEach(() => {
  lastArgs = undefined;
  authState = { isAuthenticated: true, isLoading: false };
});

describe('useBoundPaginatedQuery auth gating', () => {
  it('fires the resolved args once authenticated', () => {
    const { result } = renderHook(() => useBoundPaginatedQuery(PATH, ARGS), {
      wrapper,
    });
    expect(lastArgs).toEqual({
      projectId: 'proj-1',
      organizationId: 'org-1',
    });
    expect(result.current.blocked).toBe(false);
    expect(result.current.needsConfig).toBe(false);
  });

  it('holds the subscription in skip until the WS auth is established', () => {
    authState = { isAuthenticated: false, isLoading: true };
    const { result } = renderHook(() => useBoundPaginatedQuery(PATH, ARGS), {
      wrapper,
    });
    // No query fired pre-auth — the server would reject it and the Convex
    // client rethrows that rejection into render.
    expect(lastArgs).toBe('skip');
    // Reads as loading (skeleton), never as blocked/misconfigured.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.blocked).toBe(false);
    expect(result.current.needsConfig).toBe(false);
  });

  it('still skips a non-allowlisted path even when authenticated', () => {
    const { result } = renderHook(
      () => useBoundPaginatedQuery('tasks/queries:somethingElse', ARGS),
      { wrapper },
    );
    expect(lastArgs).toBe('skip');
    expect(result.current.blocked).toBe(true);
  });
});
