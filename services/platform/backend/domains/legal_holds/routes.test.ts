// @vitest-environment node

/**
 * The legal-hold router's role doors. The holds register carries the
 * litigation facts (reason, matter, who placed it, why it was released)
 * that the single-hold read strips for members, so the list is admin-only;
 * the badge read (`/targets`) stays member-readable.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const viewerRole = vi.hoisted(() => ({ current: 'admin' }));

const { listLegalHolds, listActiveHoldTargetIds } = vi.hoisted(() => ({
  listLegalHolds: vi.fn(),
  listActiveHoldTargetIds: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return { ...actual, listLegalHolds, listActiveHoldTargetIds };
});

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: viewerRole.current } as never);
        await next();
      },
  };
});

import { createLegalHoldRoutes } from './routes.ts';

function makeApp() {
  return createLegalHoldRoutes({ sql: {} as never, auth: {} as never });
}

describe('legal-hold routes — role doors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewerRole.current = 'admin';
    listLegalHolds.mockResolvedValue([]);
    listActiveHoldTargetIds.mockResolvedValue({ targetIds: [] });
  });

  it('GET / lists holds for an admin', async () => {
    const res = await makeApp().request('/?orgId=o1&status=all');
    expect(res.status).toBe(200);
    expect(listLegalHolds).toHaveBeenCalledWith(expect.anything(), 'o1', {
      status: 'all',
    });
  });

  it('GET / refuses a member — the register is the admin surface', async () => {
    viewerRole.current = 'member';
    const res = await makeApp().request('/?orgId=o1&status=all');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
    expect(listLegalHolds).not.toHaveBeenCalled();
  });

  it('GET /targets stays member-readable (the badge read)', async () => {
    viewerRole.current = 'member';
    const res = await makeApp().request('/targets?orgId=o1&targetType=thread');
    expect(res.status).toBe(200);
    expect(listActiveHoldTargetIds).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'thread',
    );
  });
});
