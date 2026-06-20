import { describe, it, expect, vi } from 'vitest';

import type { QueryCtx } from '../../../_generated/server';
import {
  getLastExecutionTimeForOrg,
  getLastExecutionTimesForOrgs,
  orgWorkflowKey,
} from './get_last_execution_time';

type MockExecution = {
  _id: string;
  organizationId: string;
  workflowSlug: string;
  startedAt: number;
};

// Mirrors has_running_execution.test.ts. The helper builds an org+slug index
// range then `.order('desc').first()`, so the mock filters by the two eq()
// fields, sorts by startedAt descending, and returns the head row.
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

        const matches = executions
          .filter(
            (e) =>
              e.organizationId === filters['organizationId'] &&
              e.workflowSlug === filters['workflowSlug'],
          )
          .sort((a, b) => b.startedAt - a.startedAt);

        return {
          order: vi.fn((_direction: 'asc' | 'desc') => ({
            first: vi.fn(async () => matches[0] ?? null),
          })),
        };
      }),
    })),
  };

  return { db } as unknown as QueryCtx;
}

const orgA = 'org_a';
const orgB = 'org_b';
const packSlug = 'projects/tasks/send-daily-digest';

describe('orgWorkflowKey', () => {
  it('joins org and slug with the documented separator', () => {
    expect(
      orgWorkflowKey({ organizationId: orgA, workflowSlug: packSlug }),
    ).toBe(`${orgA}::${packSlug}`);
  });
});

describe('getLastExecutionTimeForOrg', () => {
  it('returns the most recent startedAt for the org+slug', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 1000,
      },
      {
        _id: 'exec_2',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 5000,
      },
      {
        _id: 'exec_3',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 3000,
      },
    ]);

    const result = await getLastExecutionTimeForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(5000);
  });

  it('returns null when the org has no execution for the slug', async () => {
    const ctx = createMockCtx([]);

    const result = await getLastExecutionTimeForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBeNull();
  });

  // Regression: identical default-pack slugs exist in every org. Org A's
  // execution time must never be read as org B's last execution, or B's
  // schedule dedup would be silently starved.
  it('does not read another org execution of the same slug', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 9000,
      },
    ]);

    const result = await getLastExecutionTimeForOrg(ctx, {
      organizationId: orgB,
      workflowSlug: packSlug,
    });

    expect(result).toBeNull();
  });

  it('does not read another slug execution in the same org', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: 'projects/tasks/enforce-task-slas',
        startedAt: 9000,
      },
    ]);

    const result = await getLastExecutionTimeForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBeNull();
  });
});

describe('getLastExecutionTimesForOrgs', () => {
  it('returns per-(org, slug) latest times keyed by org::slug', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 1000,
      },
      {
        _id: 'exec_2',
        organizationId: orgA,
        workflowSlug: packSlug,
        startedAt: 4000,
      },
      {
        _id: 'exec_3',
        organizationId: orgB,
        workflowSlug: 'projects/tasks/enforce-task-slas',
        startedAt: 7000,
      },
    ]);

    const result = await getLastExecutionTimesForOrgs(ctx, {
      keys: [
        { organizationId: orgA, workflowSlug: packSlug },
        { organizationId: orgB, workflowSlug: packSlug },
        {
          organizationId: orgB,
          workflowSlug: 'projects/tasks/enforce-task-slas',
        },
      ],
    });

    expect(result.get(`${orgA}::${packSlug}`)).toBe(4000);
    expect(result.get(`${orgB}::${packSlug}`)).toBeNull();
    expect(result.get(`${orgB}::projects/tasks/enforce-task-slas`)).toBe(7000);
  });

  it('queries duplicate keys once', async () => {
    const ctx = createMockCtx([]);

    const result = await getLastExecutionTimesForOrgs(ctx, {
      keys: [
        { organizationId: orgA, workflowSlug: packSlug },
        { organizationId: orgA, workflowSlug: packSlug },
      ],
    });

    expect(result.size).toBe(1);
    expect(result.get(`${orgA}::${packSlug}`)).toBeNull();
  });
});
