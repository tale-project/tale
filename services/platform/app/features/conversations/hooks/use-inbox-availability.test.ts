/**
 * The Inbox gate. Every org is seeded with the mail packs as DRAFTS, so the
 * seeded files alone must not surface a shared inbox — only a deployed pack
 * that declares the `inbox` builtin view opens the nav entry and the routes.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { convexQuery } = vi.hoisted(() => ({ convexQuery: vi.fn() }));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (ref: unknown, args: unknown) => convexQuery(ref, args),
}));

import { useInboxAvailability } from './use-inbox-availability';

/** One row as `listAutomations` returns it: presentation rides the newest
 * version, `deployedVersion` appears only once someone deploys. */
function automationRow(
  name: string,
  presentation: unknown,
  deployedVersion?: number,
): Record<string, unknown> {
  return {
    name,
    latest: 1,
    presentation,
    ...(deployedVersion !== undefined ? { deployedVersion } : {}),
  };
}

const SYNC_PRESENTATION = {
  name: 'Sync emails via SMTP/IMAP',
  builtinViews: [{ id: 'inbox' }],
  requiredConnectors: ['imap-smtp', 'conversation'],
};

function stubList(
  data: unknown[] | undefined,
  isLoading = false,
  sources: string[] = [],
): void {
  convexQuery.mockImplementation((ref: unknown, args: unknown) =>
    args === 'skip'
      ? { data: undefined, isLoading: false }
      : {
          data: ref === 'conversations/queries:apiSources' ? sources : data,
          isLoading,
          isError: false,
          isFetching: isLoading,
          errorUpdateCount: 0,
          refetch: vi.fn(),
        },
  );
}

beforeEach(() => {
  convexQuery.mockReset();
});

describe('useInboxAvailability', () => {
  it.each([
    'automations/queries:listAutomations',
    'conversations/queries:apiSources',
  ])(
    'keeps %s failures visible and the retry stable until discovery recovers',
    async (source) => {
      const refetchAutomations = vi.fn();
      const refetchSources = vi.fn();
      let failed = true;
      let fetching = false;
      convexQuery.mockImplementation((name: string) => ({
        data: failed && name === source ? undefined : [],
        isLoading: fetching,
        isError: failed && name === source && !fetching,
        isFetching: fetching,
        errorUpdateCount: failed && name === source ? 1 : 0,
        refetch:
          name === 'automations/queries:listAutomations'
            ? refetchAutomations
            : refetchSources,
      }));
      const { result, rerender } = renderHook(() =>
        useInboxAvailability('org_1'),
      );
      const retry = result.current.retry;
      expect(result.current.hasInbox).toBe(false);
      expect(result.current.showInbox).toBe(true);
      expect(result.current.readState.unavailable).toBe(true);
      await retry();
      expect(refetchAutomations).toHaveBeenCalledOnce();
      expect(refetchSources).toHaveBeenCalledOnce();
      fetching = true;
      rerender();
      expect(result.current.retry).toBe(retry);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.showInbox).toBe(true);
      expect(result.current.readState.retrying).toBe(true);
      failed = false;
      fetching = false;
      rerender();
      expect(result.current.showInbox).toBe(false);
      expect(result.current.readState.unavailable).toBe(false);
    },
  );

  it('reports a failed refresh even when cached empty discovery data exists', () => {
    convexQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      isFetching: false,
      errorUpdateCount: 1,
      refetch: vi.fn(),
    });
    const { result } = renderHook(() => useInboxAvailability('org_1'));
    expect(result.current.hasInbox).toBe(false);
    expect(result.current.showInbox).toBe(true);
    expect(result.current.readState.stale).toBe(true);
    expect(result.current.readState.unavailable).toBe(false);
  });

  it('opens the native Inbox for an API source without a mail automation', () => {
    stubList([], false, ['vatplus']);
    const { result } = renderHook(() => useInboxAvailability('org_1'));
    expect(result.current.hasInbox).toBe(true);
    expect(result.current.inboxAutomations).toEqual([]);
  });
  it('opens the Inbox for a deployed pack and reports its mail provider', () => {
    stubList([
      automationRow('imap-smtp/sync-emails', SYNC_PRESENTATION, 1),
      automationRow(
        'github/triage-issues',
        { name: 'Triage GitHub issues' },
        1,
      ),
    ]);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(true);
    expect(result.current.inboxAutomations).toEqual([
      { slug: 'imap-smtp/sync-emails', requiredConnectors: ['imap-smtp'] },
    ]);
  });

  it('keeps the Inbox closed while the pack is only seeded, never deployed', () => {
    stubList([automationRow('imap-smtp/sync-emails', SYNC_PRESENTATION)]);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(false);
    expect(result.current.inboxAutomations).toEqual([]);
  });

  it('ignores a deployed automation that opens no builtin view', () => {
    stubList([
      automationRow(
        'gmail/triage-inbox',
        { name: 'Triage the Gmail inbox' },
        2,
      ),
    ]);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(false);
  });

  it('stays closed and loading until the automations read resolves — no flash', () => {
    stubList(undefined, true);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasInbox).toBe(false);
  });

  it('reads an unparsable presentation as no view instead of throwing', () => {
    stubList([
      automationRow('broken/pack', { builtinViews: 'inbox' }, 1),
      automationRow('worse/pack', 'not an object', 1),
    ]);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(false);
  });

  it('skips the read entirely without an organization', () => {
    stubList([automationRow('imap-smtp/sync-emails', SYNC_PRESENTATION, 1)]);

    const { result } = renderHook(() => useInboxAvailability(''));

    expect(convexQuery).toHaveBeenCalledWith(
      'automations/queries:listAutomations',
      'skip',
    );
    expect(result.current.hasInbox).toBe(false);
  });
});
