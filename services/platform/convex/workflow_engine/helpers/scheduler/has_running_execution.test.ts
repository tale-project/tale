import { describe, it, expect, vi } from 'vitest';

import type { Id } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';

import {
  hasRunningExecution,
  hasRunningExecutions,
} from './has_running_execution';

type MockExecution = {
  _id: string;
  wfDefinitionId: string;
  status: string;
};

function createMockCtx(executions: MockExecution[]) {
  const db = {
    query: vi.fn((_table: string) => ({
      withIndex: vi.fn((_indexName: string, cb: (q: unknown) => unknown) => {
        const filters: Record<string, string> = {};
        const q = {
          eq: (field: string, value: string) => {
            filters[field] = value;
            return q;
          },
        };
        cb(q);

        const match = executions.find(
          (e) =>
            e.wfDefinitionId === filters['wfDefinitionId'] &&
            e.status === filters['status'],
        );

        return {
          first: vi.fn(async () => match ?? null),
        };
      }),
    })),
  };

  return { db } as unknown as QueryCtx;
}

const defId1 = 'def_1' as Id<'wfDefinitions'>;
const defId2 = 'def_2' as Id<'wfDefinitions'>;
const defId3 = 'def_3' as Id<'wfDefinitions'>;

describe('hasRunningExecution', () => {
  it('returns true when a running execution exists', async () => {
    const ctx = createMockCtx([
      { _id: 'exec_1', wfDefinitionId: 'def_1', status: 'running' },
    ]);

    const result = await hasRunningExecution(ctx, { wfDefinitionId: defId1 });

    expect(result).toBe(true);
  });

  it('returns true when a pending execution exists', async () => {
    const ctx = createMockCtx([
      { _id: 'exec_1', wfDefinitionId: 'def_1', status: 'pending' },
    ]);

    const result = await hasRunningExecution(ctx, { wfDefinitionId: defId1 });

    expect(result).toBe(true);
  });

  it('returns false when only completed/failed executions exist', async () => {
    const ctx = createMockCtx([
      { _id: 'exec_1', wfDefinitionId: 'def_1', status: 'completed' },
      { _id: 'exec_2', wfDefinitionId: 'def_1', status: 'failed' },
    ]);

    const result = await hasRunningExecution(ctx, { wfDefinitionId: defId1 });

    expect(result).toBe(false);
  });

  it('returns false when no executions exist', async () => {
    const ctx = createMockCtx([]);

    const result = await hasRunningExecution(ctx, { wfDefinitionId: defId1 });

    expect(result).toBe(false);
  });

  it('does not match executions from other definitions', async () => {
    const ctx = createMockCtx([
      { _id: 'exec_1', wfDefinitionId: 'def_2', status: 'running' },
    ]);

    const result = await hasRunningExecution(ctx, { wfDefinitionId: defId1 });

    expect(result).toBe(false);
  });
});

describe('hasRunningExecutions', () => {
  it('returns correct map for mixed results', async () => {
    const ctx = createMockCtx([
      { _id: 'exec_1', wfDefinitionId: 'def_1', status: 'running' },
      { _id: 'exec_2', wfDefinitionId: 'def_3', status: 'pending' },
    ]);

    const result = await hasRunningExecutions(ctx, {
      wfDefinitionIds: [defId1, defId2, defId3],
    });

    expect(result.get(defId1)).toBe(true);
    expect(result.get(defId2)).toBe(false);
    expect(result.get(defId3)).toBe(true);
  });

  it('returns all false for empty executions', async () => {
    const ctx = createMockCtx([]);

    const result = await hasRunningExecutions(ctx, {
      wfDefinitionIds: [defId1, defId2],
    });

    expect(result.get(defId1)).toBe(false);
    expect(result.get(defId2)).toBe(false);
  });
});
