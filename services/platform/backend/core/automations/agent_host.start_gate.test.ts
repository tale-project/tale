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

import { AppError } from '../../../lib/shared/errors/app-error.ts';
import { functionRefName } from '../../../lib/shared/handlers/function-refs.ts';
import { ModelEndpointRefusal } from '../governance/model_endpoint_gate.ts';
import type { ActionCtx } from '../lib/ctx.ts';
import {
  SessionMemoryBusyError,
  SpawnerBusyError,
} from '../node_only/sandbox/helpers/session_client.ts';
import { SANDBOX_DESTROY_PENDING_MESSAGE } from '../sandbox/session_constants.ts';
import {
  classifyWorkflowStartFailure,
  isWorkflowTurnLive,
  startWorkflowAgentTurnImpl,
  type StartWorkflowAgentTurnArgs,
  workflowTurnStartRefusal,
} from './agent_host.ts';
import { isWorkflowAgentRetryable } from './agent_retry.ts';
import type { AgentCursor } from './checkpoints.ts';
import { agentFailureCodeOf } from './failure.ts';

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

describe('workflowTurnStartRefusal for a start the kick held', () => {
  // A re-kick held until a model at capacity, a cooling pool or sandbox
  // room might take it again. Long before it runs, the walker that kicked
  // it has parked the run on it — unless that walker lost the run first,
  // and then nothing would ever wait on the turn it launched.
  const held = { ...keys, claimEpoch: 7 };
  const predecessor = {
    node: 'draft',
    agent: agent({
      execId: 'exec_1',
      result: {
        errored: true,
        failureCode: 'model_capacity',
        text: '',
        files: [],
      },
    }),
  };
  const lostTheRun = {
    reason: 'the walker that held it no longer holds the run',
    runEnded: false,
  };

  it('runs once its run is parked on it, whoever claimed the run since', () => {
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          claimEpoch: 9,
          leased: false,
          cursor: { node: 'draft', agent: agent() },
        },
        held,
      ),
    ).toBeNull();
  });

  it('runs before the park while the walker that held it still holds the run', () => {
    expect(
      workflowTurnStartRefusal(
        { status: 'running', claimEpoch: 7, leased: true, cursor: predecessor },
        held,
      ),
    ).toBeNull();
  });

  it('is refused once the walker that held it lost the run without parking it there', () => {
    // Another walker took the run over: a newer claim, before or after its
    // own re-kick of the same node.
    expect(
      workflowTurnStartRefusal(
        { status: 'running', claimEpoch: 8, leased: true, cursor: predecessor },
        held,
      ),
    ).toEqual(lostTheRun);
    expect(
      workflowTurnStartRefusal(
        { status: 'running', claimEpoch: 8, leased: true },
        held,
      ),
    ).toEqual(lostTheRun);
    // The walker died before its park: its lease lapsed.
    expect(
      workflowTurnStartRefusal(
        {
          status: 'running',
          claimEpoch: 7,
          leased: false,
          cursor: predecessor,
        },
        held,
      ),
    ).toEqual(lostTheRun);
    // Its park was refused and the run waits on what it had before.
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          claimEpoch: 7,
          leased: false,
          cursor: predecessor,
        },
        held,
      ),
    ).toEqual(lostTheRun);
    // A run read without the claim (an older reader) is no proof either.
    expect(
      workflowTurnStartRefusal(
        { status: 'running', cursor: predecessor },
        held,
      ),
    ).toEqual(lostTheRun);
  });

  it('is refused like any start when the run ended, moved on, settled it or another turn superseded it', () => {
    expect(
      workflowTurnStartRefusal(
        {
          status: 'cancelled',
          claimEpoch: 7,
          leased: false,
          cursor: { node: 'draft', agent: agent() },
        },
        held,
      ),
    ).toEqual({ reason: 'the run is cancelled', runEnded: true });
    expect(
      workflowTurnStartRefusal(
        {
          status: 'running',
          claimEpoch: 7,
          leased: true,
          cursor: { node: 'send' },
        },
        held,
      ),
    ).toEqual({ reason: 'the run moved on to node send', runEnded: false });
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          claimEpoch: 7,
          leased: false,
          cursor: {
            node: 'draft',
            agent: agent({ result: { errored: false, text: 'x', files: [] } }),
          },
        },
        held,
      ),
    ).toEqual({ reason: 'this turn already settled', runEnded: false });
    expect(
      workflowTurnStartRefusal(
        {
          status: 'waiting',
          claimEpoch: 7,
          leased: false,
          cursor: { node: 'draft', agent: agent({ execId: 'exec_3' }) },
        },
        held,
      ),
    ).toEqual({ reason: 'exec exec_3 superseded it', runEnded: false });
  });

  it('leaves a start the kick did not hold as lenient as before', () => {
    expect(
      workflowTurnStartRefusal(
        {
          status: 'running',
          claimEpoch: 8,
          leased: false,
          cursor: predecessor,
        },
        keys,
      ),
    ).toBeNull();
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

  it('cuts a held start whose walker lost the run before any side effect, leaving the run’s session to the run', async () => {
    // The walker that kicked this capacity retry was taken over before its
    // park: the newer walker owns the run and its re-kick.
    const queries: string[] = [];
    const mutations: Array<{ name: string; payload: unknown }> = [];
    const ctx = {
      runQuery: async (ref: unknown) => {
        const name = functionRefName(ref);
        queries.push(name);
        if (name === 'automations/queries:readAgentCursor') {
          return {
            status: 'running',
            claimEpoch: 8,
            leased: true,
            cursor: {
              node: 'draft',
              agent: agent({
                execId: 'exec_1',
                result: {
                  errored: true,
                  failureCode: 'model_capacity',
                  text: '',
                  files: [],
                },
              }),
            },
          };
        }
        if (name === 'sandbox/session_queries:getExternalTurnOpForFinalize') {
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
        if (name === 'sandbox/session_mutations:upsertSessionOp') return null;
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
      startWorkflowAgentTurnImpl(ctx, { ...startArgs(), claimEpoch: 7 }),
    ).resolves.toBeNull();

    // No session ensure, no staging, no mint, no exec, no settle.
    expect(queries).toEqual([
      'automations/queries:readAgentCursor',
      'sandbox/session_queries:getExternalTurnOpForFinalize',
    ]);
    // The op row is finalized as cancelled; the session stays: the run is
    // live and its newer walker's turn shares it.
    expect(mutations.map((m) => m.name)).toEqual([
      'sandbox/session_mutations:claimSessionOpFinalize',
      'sandbox/session_mutations:upsertSessionOp',
    ]);
    expect(mutations[1]?.payload).toMatchObject({
      execId: 'exec_2',
      status: 'cancelled',
    });
  });
});

describe('classifyWorkflowStartFailure', () => {
  const NOW = 1_800_000_000_000;

  it('marks a refusal that names a place in the spawner’s line', () => {
    expect(
      classifyWorkflowStartFailure(
        new SpawnerBusyError(20_000, { position: 3, waiting: 8 }),
        NOW,
      ),
    ).toMatchObject({
      failureCode: 'sandbox_capacity',
      retryAfterMs: 20_000,
      roomQueued: true,
    });
    expect(
      classifyWorkflowStartFailure(new SpawnerBusyError(20_000), NOW),
    ).not.toHaveProperty('roomQueued');
  });

  it('waits for sandbox room, host or organization, until the refusal’s retry hint', () => {
    expect(
      classifyWorkflowStartFailure(new SpawnerBusyError(15_000), NOW),
    ).toEqual({
      reason:
        'the agent turn is waiting for sandbox room: the sandbox host is busy',
      failureCode: 'sandbox_capacity',
      retryAtMs: NOW + 15_000,
      retryAfterMs: 15_000,
    });
    expect(
      classifyWorkflowStartFailure(
        Object.assign(new Error('At most 2 workflow sandbox sessions'), {
          code: 'QUOTA_EXCEEDED',
        }),
        NOW,
      ),
    ).toMatchObject({
      failureCode: 'sandbox_capacity',
      retryAtMs: NOW + 15_000,
    });
  });

  it('waits for room in a run sandbox short of memory, and says so', () => {
    expect(
      classifyWorkflowStartFailure(
        new SessionMemoryBusyError(
          'wf-run-1',
          'exec_2',
          5_000,
          'the session is using 90% or more of its memory limit',
        ),
        NOW,
      ),
    ).toEqual({
      reason:
        "the agent turn is waiting for sandbox room: the run's sandbox is short of memory",
      failureCode: 'sandbox_capacity',
      retryAtMs: NOW + 15_000,
      retryAfterMs: 15_000,
    });
  });

  it('fails a start whose workspace an administrator is destroying with the reason, never waiting for room', () => {
    // The shim's refusal of a session whose Destroy is pending: a room wait
    // would start the step over in the fresh, empty workspace the Destroy
    // leaves (#4122).
    expect(
      classifyWorkflowStartFailure(
        new AppError({
          code: 'QUOTA_EXCEEDED',
          message: SANDBOX_DESTROY_PENDING_MESSAGE,
          reason: 'destroy_pending',
        }),
        NOW,
      ),
    ).toEqual({
      reason:
        'the agent turn could not start: An administrator is deleting this sandbox workspace. No new work starts in it until the deletion has finished.',
      failureCode: 'sandbox_destroying',
    });
  });

  it('fails a start the EU/EEA rule refused with the refusal’s own sentence, never retried, reading as a refused start on the wire [GOV-R17]', () => {
    const message =
      'This organization processes prompts only in the EU/EEA, and api.anthropic.com is not an endpoint known to process there, so the call was not sent.';
    const refusal = classifyWorkflowStartFailure(
      new ModelEndpointRefusal({
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        message,
        provider: 'anthropic',
        host: 'api.anthropic.com',
        reason: 'not-attested',
      }),
      NOW,
    );
    expect(refusal).toEqual({
      reason: `the agent turn could not start: ${message}`,
      failureCode: 'endpoint_refused',
    });
    expect(isWorkflowAgentRetryable(refusal.failureCode)).toBe(false);
    expect(agentFailureCodeOf(refusal.failureCode)).toBe('start_failed');
  });

  it('leaves every other start failure a start failure', () => {
    expect(
      classifyWorkflowStartFailure(
        new Error('runnerd did not become ready'),
        NOW,
      ),
    ).toEqual({
      reason: 'the agent turn could not start: runnerd did not become ready',
      failureCode: 'start_failed',
    });
  });
});
