import { describe, expect, it } from 'vitest';

import type { ActionCtx } from '../lib/ctx.ts';
import {
  steerTaskAgentTurnImpl,
  type SteerTaskAgentTurnArgs,
} from './agent_run_host.ts';

/**
 * Regression lock for the steer-miss fallback (job-liveness class): when a
 * `task.agent_steer` finds its run already settled — the exact case the
 * fallback exists for — it kicks a fresh mention run through
 * `kickMentionRunAfterSteerMiss`, whose shim handler binds `organizationId`
 * into SQL. The host once omitted it, so postgres.js threw UNDEFINED_VALUE and
 * the kick was lost (steer has retryLimit 0). The payload MUST carry the org.
 */

function steerArgs(): SteerTaskAgentTurnArgs {
  // Branded Convex ids in the host type; the fallback path never dereferences
  // them, so plain strings cast through are faithful to the job payload shape.
  return {
    organizationId: 'org_steer_fallback',
    runId: 'run_1',
    taskId: 'task_1',
    agentId: 'agent_1',
    execId: 'exec_1',
    sessionId: 'sess_1',
    harness: 'claude-code',
    deadlineAt: Date.now() + 60_000,
    model: 'anthropic/claude',
    skills: [],
    connectors: [],
    tools: [],
    secrets: [],
    feedback: 'please also check the invoice total',
    author: 'Dana',
    authorId: 'user_1',
    attempt: 0,
  } as unknown as SteerTaskAgentTurnArgs;
}

describe('steerTaskAgentTurnImpl settled-run fallback', () => {
  it('passes organizationId to the mention-kick fallback', async () => {
    const args = steerArgs();
    const mutationCalls: Array<{ ref: unknown; payload: unknown }> = [];
    const ctx = {
      // The run settled while the comment was in flight — the fallback path.
      runQuery: async () => ({
        status: 'settled',
        execId: args.execId,
        sessionId: args.sessionId,
        organizationId: args.organizationId,
      }),
      runMutation: async (ref: unknown, payload: unknown) => {
        mutationCalls.push({ ref, payload });
        return { started: true };
      },
      runAction: async () => null,
      scheduler: {
        runAfter: async () => 'job',
        runAt: async () => 'job',
        cancel: async () => undefined,
      },
    } as unknown as ActionCtx;

    await steerTaskAgentTurnImpl(ctx, args);

    expect(mutationCalls).toHaveLength(1);
    const payload = mutationCalls[0]?.payload as Record<string, unknown>;
    expect(payload.organizationId).toBe(args.organizationId);
    expect(payload.taskId).toBe(args.taskId);
    expect(payload.feedback).toBe(args.feedback);
  });
});
