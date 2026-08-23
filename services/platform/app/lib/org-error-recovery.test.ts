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
  isDeadOrgError,
  resetOrgErrorRecoveryForTests,
} = await import('./org-error-recovery');

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

  it('ignores forbidden and unstructured errors', async () => {
    handleOrgScopedQueryError(convexError('ORG_FORBIDDEN'));
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
