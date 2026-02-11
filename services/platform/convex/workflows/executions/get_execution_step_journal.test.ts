import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

import { getExecutionStepJournal } from './get_execution_step_journal';

function createMockCtx(
  execution: Record<string, unknown> | null = null,
  journalsByWorkflowId: Record<
    string,
    { journalEntries: Array<Record<string, unknown>> } | 'throw'
  > = {},
) {
  return {
    db: {
      get: vi.fn().mockResolvedValue(execution),
    },
    runQuery: vi.fn(async (_ref: unknown, args: { workflowId: string }) => {
      const entry = journalsByWorkflowId[args.workflowId];
      if (entry === 'throw') {
        throw new Error(`Workflow not found: ${args.workflowId}`);
      }
      return entry ?? { journalEntries: [] };
    }),
  };
}

describe('getExecutionStepJournal', () => {
  it('returns empty array when execution does not exist', async () => {
    const ctx = createMockCtx(null);

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'missing' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when no workflow IDs are present', async () => {
    const ctx = createMockCtx({
      _id: 'exec_1',
      metadata: null,
      componentWorkflowId: undefined,
    });

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([]);
  });

  it('returns sorted journal entries from a single workflow', async () => {
    const ctx = createMockCtx(
      {
        _id: 'exec_1',
        metadata: null,
        componentWorkflowId: 'wf_1',
      },
      {
        wf_1: {
          journalEntries: [
            { stepNumber: 2, name: 'step2' },
            { stepNumber: 1, name: 'step1' },
          ],
        },
      },
    );

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([
      { stepNumber: 1, name: 'step1', _componentWorkflowId: 'wf_1' },
      { stepNumber: 2, name: 'step2', _componentWorkflowId: 'wf_1' },
    ]);
  });

  it('combines entries from multiple workflow IDs', async () => {
    const ctx = createMockCtx(
      {
        _id: 'exec_1',
        metadata: JSON.stringify({ componentWorkflowIds: ['wf_a', 'wf_b'] }),
        componentWorkflowId: undefined,
      },
      {
        wf_a: {
          journalEntries: [{ stepNumber: 1, name: 'a1' }],
        },
        wf_b: {
          journalEntries: [{ stepNumber: 1, name: 'b1' }],
        },
      },
    );

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([
      { stepNumber: 1, name: 'a1', _componentWorkflowId: 'wf_a' },
      { stepNumber: 1, name: 'b1', _componentWorkflowId: 'wf_b' },
    ]);
  });

  it('gracefully skips workflows that throw "Workflow not found"', async () => {
    const ctx = createMockCtx(
      {
        _id: 'exec_1',
        metadata: JSON.stringify({
          componentWorkflowIds: ['wf_exists', 'wf_deleted'],
        }),
        componentWorkflowId: undefined,
      },
      {
        wf_exists: {
          journalEntries: [{ stepNumber: 1, name: 'ok' }],
        },
        wf_deleted: 'throw',
      },
    );

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([
      { stepNumber: 1, name: 'ok', _componentWorkflowId: 'wf_exists' },
    ]);
  });

  it('returns empty array when all workflows throw', async () => {
    const ctx = createMockCtx(
      {
        _id: 'exec_1',
        metadata: null,
        componentWorkflowId: 'wf_gone',
      },
      {
        wf_gone: 'throw',
      },
    );

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(result).toEqual([]);
  });

  it('deduplicates workflow IDs from metadata and componentWorkflowId', async () => {
    const ctx = createMockCtx(
      {
        _id: 'exec_1',
        metadata: JSON.stringify({ componentWorkflowIds: ['wf_1'] }),
        componentWorkflowId: 'wf_1',
      },
      {
        wf_1: {
          journalEntries: [{ stepNumber: 1, name: 'step' }],
        },
      },
    );

    const result = await getExecutionStepJournal(ctx as unknown as QueryCtx, {
      executionId: 'exec_1' as Id<'wfExecutions'>,
    });

    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});
