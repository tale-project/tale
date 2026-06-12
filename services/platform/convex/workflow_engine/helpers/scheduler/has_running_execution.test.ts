import { describe, it, expect, vi } from 'vitest';

import type { QueryCtx } from '../../../_generated/server';
import {
  hasRunningExecutionForOrg,
  hasRunningExecutionsForOrgs,
} from './has_running_execution';

type MockExecution = {
  _id: string;
  organizationId: string;
  workflowSlug: string;
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
            e.organizationId === filters['organizationId'] &&
            e.workflowSlug === filters['workflowSlug'] &&
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

const orgA = 'org_a';
const orgB = 'org_b';
const packSlug = 'tasks/daily-digest';

describe('hasRunningExecutionForOrg', () => {
  it('returns true when a running execution exists in the org', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'running',
      },
    ]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(true);
  });

  it('returns true when a pending execution exists in the org', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'pending',
      },
    ]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(true);
  });

  it('returns false when only completed/failed executions exist', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'completed',
      },
      {
        _id: 'exec_2',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'failed',
      },
    ]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(false);
  });

  it('returns false when no executions exist', async () => {
    const ctx = createMockCtx([]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(false);
  });

  it('does not match executions from other workflows in the same org', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: 'tasks/other-workflow',
        status: 'running',
      },
    ]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgA,
      workflowSlug: packSlug,
    });

    expect(result).toBe(false);
  });

  // Regression: identical default-pack slugs exist in every org. Org A's
  // running execution must never suppress org B's schedule for the same slug.
  it('does not match executions of the same slug in another org', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'running',
      },
    ]);

    const result = await hasRunningExecutionForOrg(ctx, {
      organizationId: orgB,
      workflowSlug: packSlug,
    });

    expect(result).toBe(false);
  });
});

describe('hasRunningExecutionsForOrgs', () => {
  it('returns per-(org, slug) results keyed by org::slug', async () => {
    const ctx = createMockCtx([
      {
        _id: 'exec_1',
        organizationId: orgA,
        workflowSlug: packSlug,
        status: 'running',
      },
      {
        _id: 'exec_2',
        organizationId: orgB,
        workflowSlug: 'tasks/sla-enforcement',
        status: 'pending',
      },
    ]);

    const result = await hasRunningExecutionsForOrgs(ctx, {
      keys: [
        { organizationId: orgA, workflowSlug: packSlug },
        { organizationId: orgB, workflowSlug: packSlug },
        { organizationId: orgB, workflowSlug: 'tasks/sla-enforcement' },
      ],
    });

    expect(result.get(`${orgA}::${packSlug}`)).toBe(true);
    expect(result.get(`${orgB}::${packSlug}`)).toBe(false);
    expect(result.get(`${orgB}::tasks/sla-enforcement`)).toBe(true);
  });

  it('returns all false for empty executions', async () => {
    const ctx = createMockCtx([]);

    const result = await hasRunningExecutionsForOrgs(ctx, {
      keys: [
        { organizationId: orgA, workflowSlug: packSlug },
        { organizationId: orgB, workflowSlug: packSlug },
      ],
    });

    expect(result.get(`${orgA}::${packSlug}`)).toBe(false);
    expect(result.get(`${orgB}::${packSlug}`)).toBe(false);
  });

  it('queries duplicate keys once', async () => {
    const ctx = createMockCtx([]);

    const result = await hasRunningExecutionsForOrgs(ctx, {
      keys: [
        { organizationId: orgA, workflowSlug: packSlug },
        { organizationId: orgA, workflowSlug: packSlug },
      ],
    });

    expect(result.size).toBe(1);
    expect(result.get(`${orgA}::${packSlug}`)).toBe(false);
  });
});
