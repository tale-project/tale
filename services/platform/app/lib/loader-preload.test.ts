// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import type { QueryName } from '@/app/lib/backend/contract';
import {
  memberContextQuery,
  type MemberContextView,
} from '@/app/lib/backend/org';
import { AppError } from '@/lib/shared/errors/app-error';

// The registry is swapped for one controllable row, also standing in for the
// policy read `ensureGovernancePolicies` names: these tests cover the loader
// helpers' wiring (lane, retry, ability gate), not a shipped row.
const { row, queryFn } = vi.hoisted(() => {
  const fetchRow = vi.fn<() => Promise<unknown>>();
  return {
    queryFn: fetchRow,
    row: vi.fn(() => ({ queryKey: ['fake', 'adapted'], queryFn: fetchRow })),
  };
});
vi.mock('@/app/lib/backend/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/adapters')>()),
  READ_ADAPTERS: { 'fake:adapted': row, 'governance/queries:getPolicy': row },
  activeOrganizationId: () => 'org-1',
}));

import {
  cachedAbility,
  ensureConvexQuery,
  ensureGovernancePolicies,
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

describe('ensureGovernancePolicies', () => {
  function answer(status: number, body: unknown) {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    queryFn.mockImplementation(() =>
      backendFetch('/governance/policies/default_models', { orgId: 'org-1' }),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The session door answers a lapsed session with the flat envelope's
  // `UNAUTHORIZED`. The preload waited for the Convex-era `UNAUTHENTICATED`
  // — and the client read the sentence as the code — so every such 401
  // reached the route's "failed to preload" warning.
  it("swallows the session door's 401", async () => {
    answer(401, {
      error:
        'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
      code: 'UNAUTHORIZED',
    });

    await expect(
      ensureGovernancePolicies(context(), 'org-1', ['default_models']),
    ).resolves.toEqual([undefined]);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  // A cold deep link: an admin-only policy waits for the caller's role
  // (#3098), so a member never asks for it and an admin still does.
  it.each([
    ['member', 0],
    ['admin', 1],
  ] as const)(
    "asks a %s's cold deep link for an admin-only policy %i time(s)",
    async (role, reads) => {
      vi.spyOn(window, 'fetch').mockImplementation(async () =>
        Response.json(memberContext(role)),
      );
      queryFn.mockResolvedValue({ policy: null });

      await ensureGovernancePolicies(context(), 'org-1', ['budgets']);

      expect(queryFn).toHaveBeenCalledTimes(reads);
    },
  );

  it("swallows the session door's 401 on the member-context read", async () => {
    answer(401, {
      error:
        'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
      code: 'UNAUTHORIZED',
    });

    await expect(
      ensureGovernancePolicies(context(), 'org-1', ['budgets']),
    ).resolves.toEqual([undefined]);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('propagates any other refusal', async () => {
    answer(403, {
      error: 'RBAC_FORBIDDEN',
      message: 'Your role cannot perform this action in this organization.',
    });

    await expect(
      ensureGovernancePolicies(context(), 'org-1', ['default_models']),
    ).rejects.toMatchObject({ data: { code: 'RBAC_FORBIDDEN' } });
  });
});
