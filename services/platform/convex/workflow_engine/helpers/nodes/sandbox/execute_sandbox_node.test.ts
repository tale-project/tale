import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../../_generated/server';
import type { SandboxNodeConfig } from '../../../types/nodes';
import { executeSandboxNode } from './execute_sandbox_node';

// executeSandboxNode routes the unified sandbox result onto a port. A DURABLE
// agent run that handed off mid-window (status 'running', the exec still
// running) must surface on the 'running' port so the handler re-enters the SAME
// step; every TERMINAL outcome (completed/failed/cancelled/timeout) — and every
// script run — stays on 'success', with the ok/error verdict in output.data so
// a following condition branches as before.
//
// It also threads the task-metrics binding: a sandbox AGENT step under a
// task-bound workflow execution feeds taskId/wfExecutionId/workflowSlug into
// runSandboxAgent (the durable taskAgentRuns admission gate). Non-task
// executions and script steps pass nothing and skip metrics.

const agentConfig = (): SandboxNodeConfig => ({
  run: {
    agent: 'issue-desk/desk-implementer',
    budget: { maxCents: 100, maxWallClockMs: 5_400_000 },
  },
});

const scriptConfig = (): SandboxNodeConfig => ({
  run: { script: 'pack://issue-desk/x.py', language: 'python' },
});

// Minimal ActionCtx: runQuery answers getRawExecution (the subject lookup);
// runAction routes the env-resolution call to an empty env map and the
// sandbox-exec call (agent or script args) to the supplied terminal `data`.
function makeCtx(opts: { data: Record<string, unknown>; exec?: unknown }) {
  const runAction = vi.fn((_ref: unknown, args: Record<string, unknown>) =>
    Promise.resolve(
      args && ('agentSlug' in args || 'script' in args)
        ? opts.data
        : { workflowEnv: {}, stepEnv: {} },
    ),
  );
  const runQuery = vi.fn(() => Promise.resolve(opts.exec ?? null));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: minimal ActionCtx surface
  const ctx = { runAction, runQuery } as unknown as ActionCtx;
  return { ctx, runAction, runQuery };
}

const sandboxCallArgs = (runAction: ReturnType<typeof vi.fn>) =>
  runAction.mock.calls.find(
    ([, a]) => a && typeof a === 'object' && 'agentSlug' in a,
  )?.[1] as Record<string, unknown> | undefined;

describe('executeSandboxNode port mapping', () => {
  it('maps an agent handoff (status "running") to the "running" port', async () => {
    const { ctx } = makeCtx({
      data: { mode: 'agent', ok: false, status: 'running', outputFileIds: [] },
    });
    const result = await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(result.port).toBe('running');
    expect(result.output).toMatchObject({ type: 'sandbox' });
  });

  it('maps a completed agent run to the "success" port', async () => {
    const { ctx } = makeCtx({
      data: { mode: 'agent', ok: true, status: 'completed', outputFileIds: [] },
    });
    const result = await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(result.port).toBe('success');
  });

  it('keeps a TERMINAL agent failure on "success" (verdict lives in output.data)', async () => {
    for (const status of ['failed', 'cancelled', 'timeout']) {
      const { ctx } = makeCtx({
        data: { mode: 'agent', ok: false, status, outputFileIds: [] },
      });
      const result = await executeSandboxNode(
        ctx,
        agentConfig(),
        { organizationId: 'org-1' },
        'exec-1',
        'implement',
      );
      expect(result.port, `status=${status}`).toBe('success');
    }
  });

  it('a deterministic script run never takes the "running" port', async () => {
    const { ctx } = makeCtx({
      data: {
        mode: 'script',
        ok: true,
        status: 'completed',
        outputFileIds: [],
      },
    });
    const result = await executeSandboxNode(
      ctx,
      scriptConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'verify',
    );
    expect(result.port).toBe('success');
  });
});

describe('executeSandboxNode task-metrics binding', () => {
  const terminal = {
    mode: 'agent',
    ok: true,
    status: 'completed',
    outputFileIds: [],
  };

  it('threads taskId + wfExecutionId into runSandboxAgent for a task-bound execution', async () => {
    const { ctx, runAction } = makeCtx({
      data: terminal,
      exec: {
        organizationId: 'org-1',
        subjectType: 'task',
        subjectId: 'task-abc',
      },
    });
    await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(sandboxCallArgs(runAction)).toMatchObject({
      taskId: 'task-abc',
      wfExecutionId: 'exec-1',
    });
  });

  it('also threads workflowSlug when the execution carries one', async () => {
    const { ctx, runAction } = makeCtx({
      data: terminal,
      exec: {
        organizationId: 'org-1',
        subjectType: 'task',
        subjectId: 'task-abc',
      },
    });
    await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1', wfDefinitionId: 'issue-desk/desk-process' },
      'exec-1',
      'implement',
    );
    expect(sandboxCallArgs(runAction)).toMatchObject({
      taskId: 'task-abc',
      workflowSlug: 'issue-desk/desk-process',
    });
  });

  it('passes NO binding when the execution is not about a task', async () => {
    const { ctx, runAction } = makeCtx({
      data: terminal,
      exec: {
        organizationId: 'org-1',
        subjectType: 'discussion',
        subjectId: 'disc-1',
      },
    });
    await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(sandboxCallArgs(runAction)).not.toHaveProperty('taskId');
  });

  it('passes NO binding (and never queries the execution) for a script run', async () => {
    const { ctx, runQuery, runAction } = makeCtx({
      data: {
        mode: 'script',
        ok: true,
        status: 'completed',
        outputFileIds: [],
      },
      exec: {
        organizationId: 'org-1',
        subjectType: 'task',
        subjectId: 'task-abc',
      },
    });
    await executeSandboxNode(
      ctx,
      scriptConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'verify',
    );
    expect(runQuery).not.toHaveBeenCalled();
    // the script-exec call carries no taskId
    const scriptArgs = runAction.mock.calls.find(
      ([, a]) => a && typeof a === 'object' && 'script' in a,
    )?.[1];
    expect(scriptArgs).not.toHaveProperty('taskId');
  });
});
