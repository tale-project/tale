// @vitest-environment node

/**
 * Regression lock for the workflow agent start's liveness gate (run-race
 * class): the cancel door only flips rows, so a run cancelled after its
 * agent node kicked still had the scheduled start re-admit the session,
 * stage files, mint a gateway key and open a harness window — an agent turn
 * beginning AFTER the cancel, on the org's slot cap, until the drive's first
 * 90 s window reaped it. The start now reads the run first and refuses
 * before any side effect. The gate is lenient on purpose: the kick enqueues
 * the start before the stepper's wait commits the cursor, so an absent
 * cursor or one still naming the previous settled attempt must NOT refuse.
 */

import { describe, expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs.ts';
import type { ActionCtx } from '../lib/ctx.ts';
import {
  isWorkflowTurnLive,
  startWorkflowAgentTurnImpl,
  type StartWorkflowAgentTurnArgs,
  workflowTurnStartRefusal,
} from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';

const keys = { nodeId: 'draft', execId: 'exec_2' };

function agent(overrides: Partial<AgentCursor> = {}): AgentCursor {
  return {
    execId: 'exec_2',
    sessionId: 'sess_run_1',
    deadlineAt: Date.now() + 60_000,
    providerSlug: 'anthropic',
    gatewayModel: 'claude',
    harness: 'claude-code',
    input: {},
    ...overrides,
  };
}

describe('workflowTurnStartRefusal', () => {
  it('refuses a run that ended or is gone, naming the run as ended', () => {
    expect(workflowTurnStartRefusal(null, keys)).toEqual({
      reason: 'the run is gone',
      runEnded: true,
    });
    for (const status of ['cancelled', 'failed', 'success']) {
      expect(workflowTurnStartRefusal({ status }, keys)).toEqual({
        reason: `the run is ${status}`,
        runEnded: true,
      });
    }
  });

  it('lets a first kick start before the stepper committed its cursor', () => {
    expect(workflowTurnStartRefusal({ status: 'running' }, keys)).toBeNull();
    expect(workflowTurnStartRefusal({ status: 'waiting' }, keys)).toBeNull();
  });

  it('lets a re-kick start while the cursor still names the settled attempt', () => {
    const state = {
      status: 'running',
      cursor: {
        node: 'draft',
        agent: agent({
          execId: 'exec_1',
          result: { errored: true, text: '', files: [] },
        }),
      },
    };
    expect(workflowTurnStartRefusal(state, keys)).toBeNull();
  });

  it('lets the live exec start once its cursor is durable', () => {
    const state = {
      status: 'waiting',
      cursor: { node: 'draft', agent: agent() },
    };
    expect(workflowTurnStartRefusal(state, keys)).toBeNull();
    expect(isWorkflowTurnLive(state, keys)).toBe(true);
  });

  it('refuses when the run moved on, the exec settled, or a newer exec is live', () => {
    expect(
      workflowTurnStartRefusal(
        { status: 'running', cursor: { node: 'send' } },
        keys,
      ),
    ).toEqual({ reason: 'the run moved on to node send', runEnded: false });
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          cursor: {
            node: 'draft',
            agent: agent({ result: { errored: false, text: 'x', files: [] } }),
          },
        },
        keys,
      ),
    ).toEqual({ reason: 'this turn already settled', runEnded: false });
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          cursor: { node: 'draft', agent: agent({ execId: 'exec_3' }) },
        },
        keys,
      ),
    ).toEqual({ reason: 'exec exec_3 superseded it', runEnded: false });
  });
});

describe('isWorkflowTurnLive', () => {
  it('is strict: the cursor must name this node and exec with no result', () => {
    expect(isWorkflowTurnLive(null, keys)).toBe(false);
    expect(isWorkflowTurnLive({ status: 'running' }, keys)).toBe(false);
    expect(
      isWorkflowTurnLive(
        { status: 'cancelled', cursor: { node: 'draft', agent: agent() } },
        keys,
      ),
    ).toBe(false);
    expect(
      isWorkflowTurnLive(
        {
          status: 'running',
          cursor: { node: 'draft', agent: agent({ execId: 'exec_1' }) },
        },
        keys,
      ),
    ).toBe(false);
  });
});

function startArgs(): StartWorkflowAgentTurnArgs {
  return {
    organizationId: 'org_1',
    runId: 'run_1',
    nodeId: 'draft',
    execId: 'exec_2',
    sessionId: 'sess_run_1',
    harness: 'claude-code',
    providerSlug: 'anthropic',
    modelId: 'claude',
    gatewayModel: 'claude',
    deadlineAt: Date.now() + 60_000,
    request: { model: 'claude', prompt: 'draft the reply' },
  } as unknown as StartWorkflowAgentTurnArgs;
}

describe('startWorkflowAgentTurnImpl', () => {
  it('cuts a cancelled run’s start before any side effect', async () => {
    const queries: string[] = [];
    const mutations: Array<{ name: string; payload: unknown }> = [];
    const ctx = {
      runQuery: async (ref: unknown) => {
        const name = functionRefName(ref);
        queries.push(name);
        if (name === 'automations/queries:readAgentCursor') {
          return { status: 'cancelled' };
        }
        if (name === 'sandbox/session_queries:getExternalTurnOpForFinalize') {
          // No key was minted: the op row carries none to revoke.
          return { execId: 'exec_2' };
        }
        throw new Error(`unexpected query ${name}`);
      },
      runMutation: async (ref: unknown, payload: unknown) => {
        const name = functionRefName(ref);
        mutations.push({ name, payload });
        if (name === 'sandbox/session_mutations:claimSessionOpFinalize') {
          return true;
        }
        if (
          name === 'sandbox/session_mutations:upsertSessionOp' ||
          name === 'sandbox/session_mutations:hibernateAutomationScopedSession'
        ) {
          return null;
        }
        throw new Error(`unexpected mutation ${name}`);
      },
      runAction: async (ref: unknown) => {
        throw new Error(`unexpected action ${functionRefName(ref)}`);
      },
      scheduler: {
        runAfter: async () => {
          throw new Error('a refused start schedules nothing');
        },
      },
    } as unknown as ActionCtx;

    await expect(
      startWorkflowAgentTurnImpl(ctx, startArgs()),
    ).resolves.toBeNull();

    // The only read is the gate itself plus the finalize's op lookup — no
    // session ensure, no skill/file staging, no mint, no exec.
    expect(queries).toEqual([
      'automations/queries:readAgentCursor',
      'sandbox/session_queries:getExternalTurnOpForFinalize',
    ]);
    expect(mutations.map((m) => m.name)).toEqual([
      'sandbox/session_mutations:claimSessionOpFinalize',
      'sandbox/session_mutations:upsertSessionOp',
      'sandbox/session_mutations:hibernateAutomationScopedSession',
    ]);
    // The op row the kick created is finalized as cancelled, never left
    // 'running' for the watchdog, and no result is recorded on the run.
    expect(mutations[1]?.payload).toMatchObject({
      execId: 'exec_2',
      kind: 'workflow-agent',
      status: 'cancelled',
    });
    expect(mutations[2]?.payload).toEqual({ executionId: 'run_1' });
  });
});
