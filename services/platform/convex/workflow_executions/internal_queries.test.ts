import { describe, expect, it, vi } from 'vitest';

import { getActiveExecutionForSubject } from './internal_queries';

// The mock-ctx idiom (see external_runs/state_machine.test.ts): mock the
// generated server so the wrapper returns its config, exposing `.handler`.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };

/** A ctx whose by_org_subject `.order('desc').first()` yields the given latest row. */
function ctxWithLatest(latest: Record<string, unknown> | null) {
  const builder = {
    withIndex: () => builder,
    order: () => builder,
    first: async () => latest,
  };
  return { db: { query: () => builder } };
}

const ARGS = {
  organizationId: 'org_1',
  subjectType: 'task',
  subjectId: 'task_1',
};

describe('getActiveExecutionForSubject', () => {
  const handler = (getActiveExecutionForSubject as unknown as Handler).handler;

  it('returns the latest run when it is running', async () => {
    const ctx = ctxWithLatest({ _id: 'exec_1', status: 'running' });
    expect(await handler(ctx, ARGS)).toEqual({
      executionId: 'exec_1',
      status: 'running',
    });
  });

  it('returns the latest run when it is pending', async () => {
    const ctx = ctxWithLatest({ _id: 'exec_2', status: 'pending' });
    expect(await handler(ctx, ARGS)).toEqual({
      executionId: 'exec_2',
      status: 'pending',
    });
  });

  it('returns null when the latest run is terminal (no race to guard)', async () => {
    for (const status of ['completed', 'failed']) {
      const ctx = ctxWithLatest({ _id: 'exec_3', status });
      expect(await handler(ctx, ARGS)).toBeNull();
    }
  });

  it('returns null when the subject has no run', async () => {
    expect(await handler(ctxWithLatest(null), ARGS)).toBeNull();
  });
});
