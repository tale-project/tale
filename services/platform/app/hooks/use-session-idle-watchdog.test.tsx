import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stable mock refs — a fresh object/function per render would change the
// effect deps and reset the idle timer every render.
const h = vi.hoisted(() => ({
  getEnv: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  toast: vi.fn((_props: { title?: string; description?: string }) => ({
    id: '1',
    dismiss: vi.fn(),
    update: vi.fn(),
  })),
  t: (key: string) => key,
  // Mutable state the query/org mocks read. A STABLE object reference is
  // returned each render (only `.policyRow`/`.orgId` mutate) so the hook's
  // memo dep doesn't churn and reset the timer.
  state: {
    orgId: undefined as string | undefined,
    isAuthenticated: true,
    // `undefined` models the in-flight query (loading); `null` = loaded, no row.
    policyRow: null as { config: unknown } | null | undefined,
  },
}));

vi.mock('@/lib/env', () => ({ getEnv: h.getEnv }));
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: h.signOut } }));
vi.mock('@/app/hooks/use-toast', () => ({ toast: h.toast }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => ({ t: h.t }) }));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => h.state.orgId,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isAuthenticated: h.state.isAuthenticated }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (_fn: unknown, args: unknown) => ({
    // Mirror the real skip semantics: a skipped query is still in-flight
    // (`undefined`), never a resolved value.
    data: args === 'skip' ? undefined : h.state.policyRow,
  }),
}));
vi.mock('@/convex/_generated/api', () => ({
  api: { governance: { queries: { getPolicy: 'getPolicy' } } },
}));

import { useSessionIdleWatchdog } from './use-session-idle-watchdog';

const MINUTE = 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  // Default: no org route, no policy → effective window comes from env alone.
  h.state.orgId = undefined;
  h.state.isAuthenticated = true;
  h.state.policyRow = null;
  // jsdom's Location.href is non-configurable; replace the whole object so the
  // watchdog's redirect is observable instead of triggering a navigation.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  });
  h.getEnv.mockImplementation((key: string) =>
    key === 'SESSION_IDLE_TIMEOUT_MINUTES'
      ? 10
      : key === 'BASE_PATH'
        ? ''
        : undefined,
  );
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function fireActivity() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
  });
}

describe('useSessionIdleWatchdog (#1502)', () => {
  it('is a no-op when no idle timeout is configured', async () => {
    h.getEnv.mockImplementation((key: string) =>
      key === 'BASE_PATH' ? '' : undefined,
    );

    renderHook(() => useSessionIdleWatchdog());
    await advance(30 * MINUTE);

    expect(h.toast).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('warns before the window elapses, then signs out', async () => {
    renderHook(() => useSessionIdleWatchdog());

    // 10-min window, 1-min warning lead → warning fires after 9 min idle.
    await advance(9 * MINUTE + 30_000);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toMatchObject({
      title: 'sessionIdle.warningTitle',
    });
    expect(h.signOut).not.toHaveBeenCalled();

    // Cross the hard cut-off.
    await advance(MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/log-in?reason=idle');
  });

  it('resets the timer on user activity', async () => {
    renderHook(() => useSessionIdleWatchdog());

    await advance(8 * MINUTE);
    fireActivity();
    // 8 more minutes — only 8 min idle since the keypress, under the window.
    await advance(8 * MINUTE);

    expect(h.signOut).not.toHaveBeenCalled();

    // …but it still fires once genuinely idle past the window.
    await advance(3 * MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('dismisses the warning when the user returns', async () => {
    renderHook(() => useSessionIdleWatchdog());

    await advance(9 * MINUTE + 30_000);
    expect(h.toast).toHaveBeenCalledTimes(1);
    const dismiss = h.toast.mock.results[0].value.dismiss;

    fireActivity();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('uses the org policy window when it tightens the env backstop', async () => {
    // env=10, org policy=5 → effective 5 min. Sign-out fires at 5 min idle.
    h.state.orgId = 'org-1';
    h.state.policyRow = { config: { enabled: true, idleTimeoutMinutes: 5 } };

    renderHook(() => useSessionIdleWatchdog());

    await advance(4 * MINUTE + 30_000);
    expect(h.signOut).not.toHaveBeenCalled();
    await advance(MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('cannot loosen past the env backstop (env is the hard cap)', async () => {
    // env=10, org policy=60 → effective clamps to 10 min.
    h.state.orgId = 'org-1';
    h.state.policyRow = { config: { enabled: true, idleTimeoutMinutes: 60 } };

    renderHook(() => useSessionIdleWatchdog());

    await advance(10 * MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('ignores a disabled org policy (falls back to env)', async () => {
    h.state.orgId = 'org-1';
    h.state.policyRow = { config: { enabled: false, idleTimeoutMinutes: 5 } };

    renderHook(() => useSessionIdleWatchdog());

    // Disabled → env (10 min) governs, so nothing fires at the 5-min mark.
    await advance(5 * MINUTE + 30_000);
    expect(h.signOut).not.toHaveBeenCalled();
    await advance(5 * MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out on the org window when no env backstop is set', async () => {
    h.getEnv.mockImplementation((key: string) =>
      key === 'BASE_PATH' ? '' : undefined,
    );
    h.state.orgId = 'org-1';
    h.state.policyRow = { config: { enabled: true, idleTimeoutMinutes: 3 } };

    renderHook(() => useSessionIdleWatchdog());

    await advance(3 * MINUTE);
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not arm on the env window while the org policy is still loading', async () => {
    // org route present but the policy query is unresolved (`data: undefined`).
    // Arming on the looser env window here would let a member already past the
    // org's tighter timeout linger until the query returns.
    h.state.orgId = 'org-1';
    h.state.policyRow = undefined;

    renderHook(() => useSessionIdleWatchdog());

    // env is 10 min, but the watchdog must stay a no-op until the policy loads.
    await advance(15 * MINUTE);
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
