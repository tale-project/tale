/**
 * Compose's mailbox list: the providers the deployed inbox packs require,
 * resolved against the org's ACTIVE connector credentials. A pack without a
 * live credential must not offer a sender it cannot send through.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { convexQuery } = vi.hoisted(() => ({ convexQuery: vi.fn() }));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: (ref: unknown, args: unknown) => convexQuery(ref, args),
}));

vi.mock('@/app/hooks/use-cached-paginated-query', () => ({
  useCachedPaginatedQuery: () => ({ results: [], status: 'Exhausted' }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    automations: { queries: { listAutomations: 'listAutomations' } },
    connector_credentials: { queries: { listCredentials: 'listCredentials' } },
  },
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
  status: 'active' | 'revoked',
  config: Record<string, unknown> = {},
): Record<string, unknown> {
  return { connectorSlug, name, status, config };
}

function stub(options: {
  automations?: unknown[];
  credentials?: unknown[];
  loading?: { automations?: boolean; credentials?: boolean };
}): void {
  convexQuery.mockImplementation((ref: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined, isLoading: false };
    if (ref === 'listAutomations') {
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
        slug: 'imap-smtp',
        title: 'Support mailbox',
        type: 'imap_smtp',
        fromAddress: 'support@example.com',
      },
      {
        slug: 'gmail',
        title: 'Sales inbox',
        type: 'oauth',
        fromAddress: undefined,
      },
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it('drops a provider whose credential is not active', () => {
    stub({
      automations: [inboxPack('outlook/sync-emails', 'outlook')],
      credentials: [credential('outlook', 'Old mailbox', 'revoked')],
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
