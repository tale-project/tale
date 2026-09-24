/**
 * Compose's mailbox list: the providers the deployed inbox packs require,
 * resolved against the org's ACTIVE connector credentials. A pack without a
 * live credential must not offer a sender it cannot send through.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { convexQuery } = vi.hoisted(() => ({ convexQuery: vi.fn() }));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (ref: unknown, args: unknown) => convexQuery(ref, args),
}));

vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

import { useEmailConnectors } from './queries';

function inboxPack(slug: string, connector: string): Record<string, unknown> {
  return {
    name: slug,
    latest: 1,
    deployedVersion: 1,
    presentation: {
      name: slug,
      builtinViews: [{ id: 'inbox' }],
      requiredConnectors: [connector, 'conversation'],
    },
  };
}

function credential(
  connectorSlug: string,
  name: string,
  status: 'active' | 'disabled',
  config: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: `cred-${name}`, connectorSlug, name, status, config };
}

function stub(options: {
  automations?: unknown[];
  credentials?: unknown[];
  loading?: { automations?: boolean; credentials?: boolean };
}): void {
  convexQuery.mockImplementation((ref: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined, isLoading: false };
    if (ref === 'automations/queries:listAutomations') {
      const isLoading = options.loading?.automations === true;
      return { data: isLoading ? undefined : options.automations, isLoading };
    }
    const isLoading = options.loading?.credentials === true;
    return { data: isLoading ? undefined : options.credentials, isLoading };
  });
}

beforeEach(() => {
  convexQuery.mockReset();
});

describe('useEmailConnectors', () => {
  it('offers one sender per deployed inbox pack with an active credential', () => {
    stub({
      automations: [
        inboxPack('imap-smtp/sync-emails', 'imap-smtp'),
        inboxPack('gmail/sync-emails', 'gmail'),
      ],
      credentials: [
        credential('imap-smtp', 'Support mailbox', 'active', {
          fromAddress: 'support@example.com',
        }),
        credential('gmail', 'Sales inbox', 'active'),
      ],
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(result.current.emailConnectors).toEqual([
      {
        credentialId: 'cred-Support mailbox',
        slug: 'imap-smtp',
        title: 'Support mailbox',
        type: 'imap_smtp',
        fromAddress: 'support@example.com',
      },
      {
        credentialId: 'cred-Sales inbox',
        slug: 'gmail',
        title: 'Sales inbox',
        type: 'oauth',
        fromAddress: undefined,
      },
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  // One connector, two mailboxes: each is its own sender. Keyed by slug, the
  // list kept only the name that sorted last and sent from the default.
  it('offers every active mailbox on one connector, in listing order', () => {
    stub({
      automations: [inboxPack('imap-smtp/sync-emails', 'imap-smtp')],
      credentials: [
        credential('imap-smtp', 'General Support', 'active', {
          fromAddress: 'hello@support.test',
        }),
        credential('imap-smtp', 'Old desk', 'disabled'),
        credential('imap-smtp', 'Recruitment Support', 'active', {
          fromAddress: 'jobs@support.test',
        }),
      ],
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(
      result.current.emailConnectors.map((option) => [
        option.credentialId,
        option.slug,
        option.fromAddress,
      ]),
    ).toEqual([
      ['cred-General Support', 'imap-smtp', 'hello@support.test'],
      ['cred-Recruitment Support', 'imap-smtp', 'jobs@support.test'],
    ]);
  });

  it('drops a provider whose credential is not active', () => {
    stub({
      automations: [inboxPack('outlook/sync-emails', 'outlook')],
      credentials: [credential('outlook', 'Old mailbox', 'disabled')],
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(result.current.emailConnectors).toEqual([]);
  });

  it('offers nothing when no inbox pack is deployed, even with a live mailbox', () => {
    stub({
      automations: [
        {
          name: 'gmail/triage-inbox',
          latest: 1,
          deployedVersion: 1,
          presentation: { name: 'Triage the Gmail inbox' },
        },
      ],
      credentials: [credential('gmail', 'Sales inbox', 'active')],
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(result.current.emailConnectors).toEqual([]);
  });

  it('ignores a required connector that is not a mail provider', () => {
    stub({
      automations: [inboxPack('github/review-pull-requests', 'github')],
      credentials: [credential('github', 'Repo bot', 'active')],
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(result.current.emailConnectors).toEqual([]);
  });

  it('reports loading while either half is still in flight', () => {
    stub({
      automations: [inboxPack('gmail/sync-emails', 'gmail')],
      credentials: [credential('gmail', 'Sales inbox', 'active')],
      loading: { credentials: true },
    });

    const { result } = renderHook(() => useEmailConnectors('org_1'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.emailConnectors).toEqual([]);
  });

  it('keeps a stable empty identity so consumers do not re-render on nothing', () => {
    stub({ automations: [], credentials: [] });

    const { result, rerender } = renderHook(() => useEmailConnectors('org_1'));
    const first = result.current.emailConnectors;
    rerender();

    expect(result.current.emailConnectors).toBe(first);
  });
});
