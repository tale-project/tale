import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';

import { buildWorkflowUserProfile } from './build_workflow_user_profile';

interface MockCtx {
  ctx: ActionCtx;
  runQuery: ReturnType<typeof vi.fn>;
}

function createMockCtx(responses: Record<string, unknown>): MockCtx {
  const runQuery = vi
    .fn()
    .mockImplementation((_ref: unknown, args: unknown) => {
      const { model, where } = args as {
        model: string;
        where: Array<{ field: string; value: string }>;
      };

      if (model === 'organization') {
        return Promise.resolve(responses.organization ?? null);
      }
      if (model === 'user') {
        return Promise.resolve(responses.user ?? null);
      }
      if (model === 'member') {
        const hasOrgId = where.some((w) => w.field === 'organizationId');
        const hasUserId = where.some((w) => w.field === 'userId');
        if (hasOrgId && hasUserId) {
          return Promise.resolve(responses.member ?? null);
        }
      }
      return Promise.resolve(null);
    });

  return { ctx: { runQuery } as unknown as ActionCtx, runQuery };
}

describe('buildWorkflowUserProfile', () => {
  it('returns empty string when userId is not a string', async () => {
    const { ctx, runQuery } = createMockCtx({});
    expect(await buildWorkflowUserProfile(ctx, 'org_1', undefined)).toBe('');
    expect(await buildWorkflowUserProfile(ctx, 'org_1', null)).toBe('');
    expect(await buildWorkflowUserProfile(ctx, 'org_1', 123)).toBe('');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns formatted profile when all data exists', async () => {
    const { ctx } = createMockCtx({
      organization: { _id: 'org_1', name: 'Acme Corp' },
      user: { _id: 'user_1', name: 'Jane Doe', email: 'jane@acme.com' },
      member: { _id: 'member_1', role: 'admin' },
    });

    const result = await buildWorkflowUserProfile(ctx, 'org_1', 'user_1');

    expect(result).toContain('## Current User');
    expect(result).toContain('- Name: Jane Doe');
    expect(result).toContain('- Email: jane@acme.com');
    expect(result).toContain('- Role: admin');
    expect(result).toContain('- Organization: Acme Corp');
    expect(result).toContain('- Current Time:');
  });

  it('returns partial profile when some data is missing', async () => {
    const { ctx } = createMockCtx({
      organization: null,
      user: { _id: 'user_1', name: 'Jane Doe', email: 'jane@acme.com' },
      member: null,
    });

    const result = await buildWorkflowUserProfile(ctx, 'org_1', 'user_1');

    expect(result).toContain('- Name: Jane Doe');
    expect(result).not.toContain('- Organization:');
    expect(result).not.toContain('- Role:');
  });

  it('fetches all data in parallel', async () => {
    const { ctx, runQuery } = createMockCtx({
      organization: { _id: 'org_1', name: 'Acme Corp' },
      user: { _id: 'user_1', name: 'Jane', email: 'jane@acme.com' },
      member: { _id: 'member_1', role: 'member' },
    });

    await buildWorkflowUserProfile(ctx, 'org_1', 'user_1');

    expect(runQuery).toHaveBeenCalledTimes(3);
  });
});
