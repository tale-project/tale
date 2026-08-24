import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setActive: vi.fn(),
  clearMemberContextCache: vi.fn(),
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  matches: [] as { routeId: string }[],
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { setActive: mocks.setActive } },
}));

vi.mock('@/app/lib/member-context-cache', () => ({
  clearMemberContextCache: mocks.clearMemberContextCache,
}));

// The recovery imports the router lazily (cycle avoidance) — vitest routes
// the dynamic import through this mock too.
vi.mock('@/app/router', () => ({
  router: {
    get state() {
      return { matches: mocks.matches };
    },
    navigate: mocks.navigate,
  },
  queryClient: { invalidateQueries: mocks.invalidateQueries },
}));

const {
  handleOrgScopedQueryError,
  installOrgErrorRecovery,
  isDeadOrgError,
  resetOrgErrorRecoveryForTests,
} = await import('./org-error-recovery');
const { QueryClient } = await import('@tanstack/react-query');

/** A ConvexError as the client sees it: duck-typed `data` payload. */
function convexError(code: string): Error {
  const error = new Error(`server failure ${code}`);
  Object.assign(error, { data: { code, message: 'boom' } });
  return error;
}

async function recoverySettled(): Promise<void> {
  // One macro-tick lets the fire-and-forget recovery (dynamic import + two
  // awaits) run to completion.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOrgErrorRecoveryForTests();
  mocks.setActive.mockResolvedValue(undefined);
  mocks.invalidateQueries.mockResolvedValue(undefined);
  mocks.matches = [
    { routeId: '/dashboard/$id' },
    { routeId: '/dashboard/$id/chat' },
  ];
});

describe('isDeadOrgError', () => {
  it('matches only ConvexError data with code ORG_NOT_FOUND', () => {
    expect(isDeadOrgError(convexError('ORG_NOT_FOUND'))).toBe(true);
    expect(isDeadOrgError(convexError('ORG_FORBIDDEN'))).toBe(false);
    expect(isDeadOrgError(new Error('[CONVEX Q(x)] Server Error'))).toBe(false);
    expect(isDeadOrgError(null)).toBe(false);
    expect(isDeadOrgError('ORG_NOT_FOUND')).toBe(false);
  });
});

describe('handleOrgScopedQueryError', () => {
  it('recovers from a dead org: clears hints, leaves the org routes, resets the session org', async () => {
    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    await recoverySettled();

    expect(mocks.clearMemberContextCache).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/dashboard',
      replace: true,
    });
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: null });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['auth', 'session'],
    });
  });

  it('does not navigate when the user is not inside an org dashboard', async () => {
    mocks.matches = [{ routeId: '/dashboard/' }];

    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    await recoverySettled();

    expect(mocks.navigate).not.toHaveBeenCalled();
    // Session cleanup still runs — the picker must not re-resolve the dead org.
    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: null });
  });

  it('runs a single recovery for a burst of failures', async () => {
    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    await recoverySettled();

    expect(mocks.setActive).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores forbidden, empty-arg, and unstructured errors', async () => {
    handleOrgScopedQueryError(convexError('ORG_FORBIDDEN'));
    // ORG_ID_REQUIRED = a component transiently sent "" (caller-side gap) —
    // recovering (navigating to the picker) over it would yank a WORKING
    // session out of its page, which is exactly what broke the E2E project
    // specs before the code split.
    handleOrgScopedQueryError(convexError('ORG_ID_REQUIRED'));
    handleOrgScopedQueryError(new Error('network flake'));
    await recoverySettled();

    expect(mocks.clearMemberContextCache).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it('survives a failing setActive call (best-effort cleanup)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.setActive.mockRejectedValue(new Error('offline'));

    handleOrgScopedQueryError(convexError('ORG_NOT_FOUND'));
    await recoverySettled();

    expect(mocks.navigate).toHaveBeenCalled();
    expect(mocks.invalidateQueries).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('installOrgErrorRecovery (real query cache)', () => {
  it('dispatches when a queryFn rejects with a dead-org error', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const uninstall = installOrgErrorRecovery(qc);

    await qc.prefetchQuery({
      queryKey: ['dead-org-fetch'],
      queryFn: () => Promise.reject(convexError('ORG_NOT_FOUND')),
    });
    await recoverySettled();

    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: null });
    uninstall();
    qc.clear();
  });

  it('dispatches when a live subscription writes the error state directly', async () => {
    // The @convex-dev/react-query bridge delivers WS-pushed failures via
    // query.setState — never through a queryFn rejection. This is the path an
    // OPEN tab sees when its org is deleted mid-session (verified manually);
    // QueryCache onError never fires for it.
    const qc = new QueryClient();
    const uninstall = installOrgErrorRecovery(qc);

    const query = qc
      .getQueryCache()
      .build(qc, { queryKey: ['dead-org-live'], queryFn: async () => null });
    const error = convexError('ORG_NOT_FOUND');
    query.setState({
      // Mirrors ConvexQueryClient.onUpdateQueryKeyHash's error delivery.
      error: error as never,
      errorUpdateCount: query.state.errorUpdateCount + 1,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: query.state.fetchFailureCount + 1,
      fetchFailureReason: error as never,
      fetchStatus: 'idle',
      status: 'error',
    });
    await recoverySettled();

    expect(mocks.setActive).toHaveBeenCalledWith({ organizationId: null });
    uninstall();
    qc.clear();
  });

  it('stays quiet for non-dead-org error states', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const uninstall = installOrgErrorRecovery(qc);

    await qc.prefetchQuery({
      queryKey: ['other-error'],
      queryFn: () => Promise.reject(convexError('ORG_FORBIDDEN')),
    });
    await recoverySettled();

    expect(mocks.setActive).not.toHaveBeenCalled();
    uninstall();
    qc.clear();
  });
});
