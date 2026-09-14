/**
 * The Inbox gate. Every org is seeded with the mail packs as DRAFTS, so the
 * seeded files alone must not surface a shared inbox — only a deployed pack
 * that declares the `inbox` builtin view opens the nav entry and the routes.
 *
 * A second signal opens it too: threads that already exist in any status. An
 * org fed over `/api/v1/conversations` installs no mail pack and connects no
 * mailbox, so the automation signal alone would hide the Inbox from an org
 * actively using one.
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

/** The hook makes one automation query and four status queries; the stub has
 * to answer them apart or the automations array would be handed back as a
 * conversation count. */
function stubBackend(
  automations: unknown[] | undefined,
  conversations: number | Partial<Record<string, number>> = 0,
  isLoading = false,
): void {
  convexQuery.mockImplementation((ref: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined, isLoading: false };
    if (String(ref).includes('approxCountConversationsByStatus')) {
      const status =
        typeof args === 'object' && args !== null && 'status' in args
          ? String(args.status)
          : 'open';
      return {
        data:
          typeof conversations === 'number'
            ? conversations
            : (conversations[status] ?? 0),
        isLoading,
      };
    }
    return { data: automations, isLoading };
  });
}

function stubList(data: unknown[] | undefined, isLoading = false): void {
  stubBackend(data, 0, isLoading);
}

beforeEach(() => {
  convexQuery.mockReset();
});

describe('useInboxAvailability', () => {
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

describe('useInboxAvailability — orgs fed over the API', () => {
  it('opens the Inbox when threads exist and no pack is deployed', () => {
    // What a product that owns its own customer surface looks like: it posts
    // conversations to /api/v1/conversations and installs nothing.
    stubBackend([], 3);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(true);
    // No mail pack means no compose provider, which is correct — there is no
    // mailbox to compose from.
    expect(result.current.inboxAutomations).toEqual([]);
  });

  it('opens the Inbox when only a non-open thread exists', () => {
    stubBackend([], { closed: 2 });

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(true);
  });

  it('keeps the Inbox closed for an org with neither packs nor threads', () => {
    stubBackend([], 0);

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(false);
  });

  it('still opens for a deployed pack before any thread arrives', () => {
    stubBackend(
      [automationRow('imap-smtp/sync-emails', SYNC_PRESENTATION, 1)],
      0,
    );

    const { result } = renderHook(() => useInboxAvailability('org_1'));

    expect(result.current.hasInbox).toBe(true);
  });
});
