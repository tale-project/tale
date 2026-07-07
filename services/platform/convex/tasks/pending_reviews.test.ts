import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  PENDING_REVIEW_SCAN_CAP,
  collectPendingReviewsByTask,
} from './pending_reviews';

const PROJECT_ID = 'project_1' as Id<'projects'>;

function approvalsCtx(rows: Array<Record<string, unknown>>) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
  };
  const ctx = { db: { query: vi.fn().mockReturnValue(builder) } };
  return { ctx: ctx as unknown as Pick<QueryCtx, 'db'>, raw: ctx, builder };
}

function approval(
  taskId: string,
  projectId: string,
  approvalId = `appr_${taskId}`,
): Record<string, unknown> {
  return {
    _id: approvalId,
    resourceId: taskId,
    metadata: { projectId, taskId },
  };
}

describe('collectPendingReviewsByTask', () => {
  it('maps this project’s pending reviews by task id via the org index', async () => {
    const { ctx, raw, builder } = approvalsCtx([
      approval('task_a', String(PROJECT_ID)),
      approval('task_b', 'project_other'),
      { _id: 'appr_x', resourceId: 'task_c', metadata: 'not-a-record' },
    ]);

    const byTask = await collectPendingReviewsByTask(ctx, 'org_1', PROJECT_ID);

    expect(raw.db.query).toHaveBeenCalledWith('approvals');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status_resourceType',
      expect.any(Function),
    );
    expect([...byTask.keys()]).toEqual(['task_a']);
    expect(byTask.get('task_a')).toBe('appr_task_a');
  });

  it('caps the scan so a pathological backlog stays bounded', async () => {
    const rows = Array.from({ length: PENDING_REVIEW_SCAN_CAP + 10 }, (_, i) =>
      approval(`task_${i}`, String(PROJECT_ID)),
    );
    const { ctx } = approvalsCtx(rows);

    const byTask = await collectPendingReviewsByTask(ctx, 'org_1', PROJECT_ID);

    expect(byTask.size).toBe(PENDING_REVIEW_SCAN_CAP);
  });
});
