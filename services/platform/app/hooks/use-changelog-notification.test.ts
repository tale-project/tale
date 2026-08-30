import { describe, it, expect, vi, beforeEach } from 'vitest';

// The hook only calls the adapter-aware wrappers; with those mocked it runs
// as a plain function (same approach as use-current-member-context.test.ts).
// `data` is what the wrapper hands back, so the mock speaks that shape.
const mockUseQuery = vi.fn();
const mockMarkSeenMutation = vi.fn(() => Promise.resolve(null));
const mockMarkToastedMutation = vi.fn(() => Promise.resolve(null));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (...args: unknown[]) => ({ data: mockUseQuery(...args) }),
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (fn: unknown) => ({
    mutateAsync:
      fn === 'users/notification_state:markChangelogSeen'
        ? mockMarkSeenMutation
        : mockMarkToastedMutation,
  }),
}));

let mockVersion: string | undefined = 'v0.2.97';
vi.mock('@/lib/env', () => ({
  getEnv: () => mockVersion,
}));

import { useChangelogNotification } from './use-changelog-notification';

/** A loaded notification-state row, as `getUserNotificationState` returns it. */
function row(fields: {
  lastSeenChangelogVersion?: string;
  lastToastedVersion?: string;
}) {
  return { userId: 'u1', updatedAt: 0, ...fields };
}

describe('useChangelogNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVersion = 'v0.2.97';
  });

  it('shows neither dot nor toast on a fresh install (no row recorded)', () => {
    // No previous version recorded means fresh install, not an update.
    mockUseQuery.mockReturnValue(null);

    const result = useChangelogNotification();

    expect(result.stateLoaded).toBe(true);
    expect(result.hasUnseenVersion).toBe(false);
    expect(result.shouldShowToast).toBe(false);
    expect(result.needsBaseline).toBe(true);
  });

  it('holds everything back while the state query is loading', () => {
    mockUseQuery.mockReturnValue(undefined);

    const result = useChangelogNotification();

    expect(result.stateLoaded).toBe(false);
    expect(result.hasUnseenVersion).toBe(false);
    expect(result.shouldShowToast).toBe(false);
    expect(result.needsBaseline).toBe(false);
  });

  it('shows dot and toast when the recorded versions are older', () => {
    mockUseQuery.mockReturnValue(
      row({
        lastSeenChangelogVersion: 'v0.2.96',
        lastToastedVersion: 'v0.2.96',
      }),
    );

    const result = useChangelogNotification();

    expect(result.hasUnseenVersion).toBe(true);
    expect(result.shouldShowToast).toBe(true);
    expect(result.needsBaseline).toBe(false);
  });

  it('stays quiet when the recorded versions match the current one', () => {
    mockUseQuery.mockReturnValue(
      row({
        lastSeenChangelogVersion: 'v0.2.97',
        lastToastedVersion: 'v0.2.97',
      }),
    );

    const result = useChangelogNotification();

    expect(result.hasUnseenVersion).toBe(false);
    expect(result.shouldShowToast).toBe(false);
    expect(result.needsBaseline).toBe(false);
  });

  it('keeps the unseen dot for a user who was toasted but never viewed', () => {
    // A row exists (not a fresh install) but the user never opened the
    // release notes: the dot must persist, without re-toasting.
    mockUseQuery.mockReturnValue(row({ lastToastedVersion: 'v0.2.97' }));

    const result = useChangelogNotification();

    expect(result.hasUnseenVersion).toBe(true);
    expect(result.shouldShowToast).toBe(false);
    expect(result.needsBaseline).toBe(false);
  });

  it('skips the query and reports nothing without a TALE_VERSION', () => {
    mockVersion = undefined;
    mockUseQuery.mockReturnValue(undefined);

    const result = useChangelogNotification();

    expect(mockUseQuery).toHaveBeenCalledWith(
      'users/notification_state:getUserNotificationState',
      'skip',
    );
    expect(result.hasUnseenVersion).toBe(false);
    expect(result.shouldShowToast).toBe(false);
    expect(result.needsBaseline).toBe(false);
  });

  it('stays quiet on a non-semver build once its version is recorded (#2552)', () => {
    // docker:dev runs with TALE_VERSION=dev. Comparing 'dev' vs 'dev' cannot
    // be parsed as semver, but identical strings are never "newer": no toast,
    // no dot, and no compare-failed warning on every render.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockVersion = 'dev';
    mockUseQuery.mockReturnValue(
      row({ lastSeenChangelogVersion: 'dev', lastToastedVersion: 'dev' }),
    );

    const result = useChangelogNotification();

    expect(result.hasUnseenVersion).toBe(false);
    expect(result.shouldShowToast).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still treats differing unparseable versions as newer', () => {
    // The parse-failure fallback stays: a malformed *stored* value must not
    // lock the notification dot off.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockUseQuery.mockReturnValue(
      row({
        lastSeenChangelogVersion: 'garbage',
        lastToastedVersion: 'garbage',
      }),
    );

    const result = useChangelogNotification();

    expect(result.hasUnseenVersion).toBe(true);
    expect(result.shouldShowToast).toBe(true);
    warnSpy.mockRestore();
  });

  it('records the current version when markSeen is called', () => {
    mockUseQuery.mockReturnValue(null);

    useChangelogNotification().markSeen();

    expect(mockMarkSeenMutation).toHaveBeenCalledWith({ version: 'v0.2.97' });
  });
});
