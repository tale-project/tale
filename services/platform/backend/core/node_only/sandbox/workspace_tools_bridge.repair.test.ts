import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx.ts';
import { runTaskTool } from './workspace_domain_tools.ts';

function fixture() {
  const runQuery = vi.fn().mockResolvedValue({
    _id: 'task',
    projectId: 'project',
    title: 'Repair the result',
    status: 'todo',
  });
  const runMutation = vi.fn().mockResolvedValue({
    outcome: 'started',
    runId: 'repair',
    taskId: 'task',
    agentId: 'implementer',
  });
  const ctx = { runQuery, runMutation } as unknown as ActionCtx;
  const call = (callArgs: Record<string, unknown>) =>
    runTaskTool(ctx, {
      organizationId: 'org',
      tool: 'task_start_agent',
      callArgs: { taskId: 'task', ...callArgs },
      authority: {
        actorId: 'manager',
        scope: { kind: 'project', projectId: 'project' },
      },
      session: { sessionId: 'session', taskRunExecId: 'exec' },
    });
  return { call, runQuery, runMutation };
}

describe('conditional repair at the real native tool boundary', () => {
  it('forwards the tagged source without inventing a pending-question identity', async () => {
    const { call, runMutation } = fixture();
    const resumeFrom = {
      kind: 'review_repair',
      approvalId: 'approval',
      runId: 'source',
    };
    expect(await call({ resumeFrom })).toMatchObject({
      status: 'ok',
      output: { started: true },
    });
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({ resumeFrom });
  });

  it('preserves the existing trimmed question and ordinary in-place start', async () => {
    const { call, runMutation } = fixture();
    await call({ resumeFrom: { runId: ' source ', approvalId: 'approval' } });
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      resumeFrom: { runId: 'source', approvalId: 'approval' },
    });
    await call({ moveToInProgress: false });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      moveToInProgress: false,
    });
  });
  it.each([
    { kind: 'review_repair', approvalId: 'approval' },
    { kind: 'review_repair', approvalId: 'approval', runId: ' ' },
    { kind: 'repair', approvalId: 'approval', runId: 'source' },
    { kind: 'review_repair', approvalId: 'a'.repeat(201), runId: 'source' },
    { approvalId: 'approval', runId: 'source', kind: undefined },
    {
      kind: 'review_repair',
      approvalId: 'approval',
      runId: 'source',
      agentId: 'other',
    },
  ])(
    'refuses malformed tagged identities before reads or mutations: %j',
    async (resumeFrom) => {
      const { call, runQuery, runMutation } = fixture();
      expect(await call({ resumeFrom })).toMatchObject({
        status: 'invalid_args',
      });
      expect(runQuery).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();
    },
  );

  it('refuses an in-place repair because it would never request the next review', async () => {
    const { call, runQuery, runMutation } = fixture();
    expect(
      await call({
        moveToInProgress: false,
        resumeFrom: {
          kind: 'review_repair',
          approvalId: 'approval',
          runId: 'source',
        },
      }),
    ).toMatchObject({ status: 'invalid_args' });
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('gives stale repair its own recovery guidance and preserves a historical replay', async () => {
    const { call, runMutation } = fixture();
    runMutation.mockResolvedValueOnce({
      outcome: 'stale_repair',
      taskId: 'task',
      agentId: 'implementer',
      staleBecause: 'intervening_decision',
    });
    expect(
      await call({
        resumeFrom: {
          kind: 'review_repair',
          approvalId: 'approval',
          runId: 'source',
        },
      }),
    ).toMatchObject({
      status: 'ok',
      output: {
        started: false,
        reason: 'stale_repair',
        guidance: expect.stringContaining('never fall back'),
        staleBecause: 'intervening_decision',
      },
    });
    runMutation.mockResolvedValueOnce({
      outcome: 'started',
      runId: 'prior',
      taskId: 'task',
      agentId: 'implementer',
      replayed: true,
      repairReceipt: { issuerRunId: 'original' },
    });
    expect(
      await call({
        resumeFrom: {
          kind: 'review_repair',
          approvalId: 'approval',
          runId: 'source',
        },
      }),
    ).toMatchObject({
      output: {
        started: true,
        replayed: true,
        runId: 'prior',
        repairReceipt: { issuerRunId: 'original' },
      },
    });
  });
});
