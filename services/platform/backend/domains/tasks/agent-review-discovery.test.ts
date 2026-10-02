import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { readAgentTaskReviewSummaries } from './agent-review-discovery.ts';

describe('captured review discovery', () => {
  it.each([1, 51, 200])(
    'reads %i page identities in one org-scoped query without source or policy reads',
    async (count) => {
      const ids = Array.from({ length: count }, (_, index) => `task-${index}`);
      const query = vi.fn(async () =>
        ids.map((taskId) => ({
          taskId,
          approvalId: `approval-${taskId}`,
          metadata: {
            runId: `run-${taskId}`,
            reviewer: { kind: 'agent', agentId: 'deleted-agent' },
          },
        })),
      );
      const result = await readAgentTaskReviewSummaries(
        query as unknown as Sql,
        'org-1',
        ids,
      );
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.anything(), 'org-1', ids);
      expect(result.size).toBe(count);
      expect(result.get(ids[0]!)).toEqual({
        approvalId: `approval-${ids[0]}`,
        runId: `run-${ids[0]}`,
        reviewer: { kind: 'agent', agentId: 'deleted-agent' },
      });
    },
  );

  it('does not read an empty page', async () => {
    const query = vi.fn();
    expect(
      await readAgentTaskReviewSummaries(query as unknown as Sql, 'org-1', []),
    ).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves the canonical typed-or-legacy recipient rules and source nulls', async () => {
    const query = vi.fn(async () => [
      {
        taskId: 'human',
        approvalId: 'a-1',
        metadata: { requestedFor: 'person-1' },
      },
      {
        taskId: 'typed',
        approvalId: 'a-2',
        metadata: {
          reviewer: { kind: 'agent', agentId: 'gone' },
          requestedFor: 'ignored',
          runId: 'run-2',
        },
      },
      {
        taskId: 'invalid',
        approvalId: 'a-3',
        metadata: {
          reviewer: { kind: 'agent', agentId: 'gone', extra: true },
          requestedFor: 'no-fallback',
          runId: 7,
        },
      },
      { taskId: 'null', approvalId: 'a-4', metadata: null },
    ]);
    const result = await readAgentTaskReviewSummaries(
      query as unknown as Sql,
      'org-1',
      ['human', 'typed', 'invalid', 'null'],
    );
    expect([...result.values()]).toEqual([
      {
        approvalId: 'a-1',
        runId: null,
        reviewer: { kind: 'user', userId: 'person-1' },
      },
      {
        approvalId: 'a-2',
        runId: 'run-2',
        reviewer: { kind: 'agent', agentId: 'gone' },
      },
      { approvalId: 'a-3', runId: null, reviewer: null },
      { approvalId: 'a-4', runId: null, reviewer: null },
    ]);
  });
});
