import { getFunctionName } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';

import { resolveProjectContext } from './project_context';

/**
 * A ctx whose `runQuery` answers by function name, so a test can allow or deny
 * project access independently of what the project row says.
 */
function createCtx(opts: {
  allowed?: boolean;
  reason?: string;
  project?: Record<string, unknown> | null;
}) {
  const calls: string[] = [];
  const runQuery = vi.fn((ref: unknown, _args: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    calls.push(name);
    if (name.includes('assertProjectAccessForChat')) {
      return Promise.resolve(
        opts.allowed === false
          ? { allowed: false, reason: opts.reason ?? 'forbidden' }
          : { allowed: true },
      );
    }
    if (name.includes('getProjectForInjection')) {
      return Promise.resolve(
        opts.project === undefined
          ? { _id: 'project_1', name: 'Growth' }
          : opts.project,
      );
    }
    return Promise.reject(new Error(`unexpected query: ${name}`));
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
  return { ctx: { runQuery } as never, runQuery, calls };
}

const WHO = { organizationId: 'org_1', userId: 'user_1' };

describe('resolveProjectContext', () => {
  it('is absent for an unbound thread, without querying anything', async () => {
    const { ctx, runQuery } = createCtx({});
    const result = await resolveProjectContext(ctx, {
      ...WHO,
      projectId: null,
    });
    expect(result).toBeUndefined();
    // Most threads have no project; this must not cost two round-trips.
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('carries the name and instructions of a readable project', async () => {
    const { ctx } = createCtx({
      project: {
        _id: 'project_1',
        name: 'Growth',
        instructions: 'Quote the campaign id.',
      },
    });
    const result = await resolveProjectContext(ctx, {
      ...WHO,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test id
      projectId: 'project_1' as never,
    });
    expect(result).toEqual({
      name: 'Growth',
      instructions: 'Quote the campaign id.',
    });
  });

  // The reason this re-checks at turn time at all: a thread keeps its
  // `projectId` for life, so someone removed from the project must stop
  // receiving its standing instructions on the NEXT turn — not whenever
  // something else happens to reconcile.
  it('withholds the project when access is denied, and never reads the row', async () => {
    const { ctx, calls } = createCtx({ allowed: false });
    const result = await resolveProjectContext(ctx, {
      ...WHO,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test id
      projectId: 'project_1' as never,
    });
    expect(result).toBeUndefined();
    expect(calls.some((c) => c.includes('getProjectForInjection'))).toBe(false);
  });

  it('degrades rather than refusing when the project row is gone', async () => {
    const { ctx } = createCtx({ project: null });
    const result = await resolveProjectContext(ctx, {
      ...WHO,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test id
      projectId: 'project_1' as never,
    });
    // A deleted project must not strand a thread nobody can continue.
    expect(result).toBeUndefined();
  });

  it('omits instructions when the project has none', async () => {
    const { ctx } = createCtx({
      project: { _id: 'project_1', name: 'Growth' },
    });
    const result = await resolveProjectContext(ctx, {
      ...WHO,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test id
      projectId: 'project_1' as never,
    });
    expect(result).toEqual({ name: 'Growth' });
    expect(result).not.toHaveProperty('instructions');
  });
});
