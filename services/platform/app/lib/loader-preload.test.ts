// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import type { QueryName } from '@/app/lib/backend/contract';
import {
  memberContextQuery,
  type MemberContextView,
} from '@/app/lib/backend/org';
import { AppError } from '@/lib/shared/errors/app-error';

// The registry is swapped for one controllable row: these tests cover the
// loader helpers' wiring (lane, retry, ability gate), not a shipped row.
const { row, queryFn } = vi.hoisted(() => {
  const fetchRow = vi.fn<() => Promise<unknown>>();
  return {
    queryFn: fetchRow,
    row: vi.fn(() => ({ queryKey: ['fake', 'adapted'], queryFn: fetchRow })),
  };
});
vi.mock('@/app/lib/backend/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/adapters')>()),
  READ_ADAPTERS: { 'fake:adapted': row },
  activeOrganizationId: () => 'org-1',
}));

import {
  cachedAbility,
  ensureConvexQuery,
  ensureOrgSettingsQuery,
} from './loader-preload';

const FAKE_ROW = 'fake:adapted' as QueryName;

function context() {
  return { queryClient: new QueryClient() };
}

function memberContext(
  role: 'member' | 'admin',
): Exclude<MemberContextView, null> {
  return {
    status: 'ok',
    memberId: 'm-1',
    organizationId: 'org-1',
    userId: 'u-1',
    role,
    createdAt: 0,
    displayName: undefined,
    isAdmin: role === 'admin',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureConvexQuery', () => {
  // E-05: the raw queryFn rode the router's default retry, which cannot tell
  // a bare 403 from a transport fault — a member deep-linking an admin page
  // sat on the skeleton through three back-offs before the denied state.
  it('answers a 403 once, as a structured error, never retried', async () => {
    queryFn.mockRejectedValue(new BackendApiError(403, 'Forbidden'));

    await expect(
      ensureConvexQuery(context(), FAKE_ROW, { organizationId: 'org-1' }),
    ).rejects.toBeInstanceOf(AppError);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("resolves the row's projection on success", async () => {
    queryFn.mockResolvedValue({ total: 3 });

    await expect(
      ensureConvexQuery(context(), FAKE_ROW, { organizationId: 'org-1' }),
    ).resolves.toEqual({ total: 3 });
  });
});

describe('ensureOrgSettingsQuery', () => {
  it('skips the read when the cached member context cannot read org settings', async () => {
    const ctx = context();
    ctx.queryClient.setQueryData(
      memberContextQuery('org-1').queryKey,
      memberContext('member'),
    );

    await expect(
      ensureOrgSettingsQuery(ctx, 'org-1', FAKE_ROW, {
        organizationId: 'org-1',
      }),
    ).resolves.toBeUndefined();
    expect(queryFn).not.toHaveBeenCalled();
    expect(cachedAbility(ctx, 'org-1')?.can('read', 'orgSettings')).toBe(false);
  });

  it('runs the read for an admin', async () => {
    const ctx = context();
    ctx.queryClient.setQueryData(
      memberContextQuery('org-1').queryKey,
      memberContext('admin'),
    );
    queryFn.mockResolvedValue({ total: 1 });

    await expect(
      ensureOrgSettingsQuery(ctx, 'org-1', FAKE_ROW, {
        organizationId: 'org-1',
      }),
    ).resolves.toEqual({ total: 1 });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  // A cold deep link: nothing cached yet, so the loader must not guess —
  // the server's own answer (bounded by the no-retry lane) decides.
  it('runs the read when no member context is cached yet', async () => {
    const ctx = context();
    queryFn.mockResolvedValue({ total: 1 });

    await ensureOrgSettingsQuery(ctx, 'org-1', FAKE_ROW, {
      organizationId: 'org-1',
    });
    expect(cachedAbility(ctx, 'org-1')).toBeNull();
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
