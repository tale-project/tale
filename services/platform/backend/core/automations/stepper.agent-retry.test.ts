/**
 * The stepper consuming a failed agent attempt — the REAL walk, with a
 * recording agent host and ctx. What it re-kicks with is the retry plan
 * (`planWorkflowAgentRetry`): an ordinary failure spends the budget and
 * burns its broker account; a credential rotation — the broker refreshed the
 * account under the turn (observed live 2026-09-28: "401 OAuth access token
 * has been revoked") — resumes the conversation on a fresh vend for free.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { AUTO_RETRY_MAX_ATTEMPTS } from '../tasks/task_auto_retry.ts';
import type { AutomationAgentHost } from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';
import { setAutomationAgentHostFactory, stepRunImpl } from './stepper.ts';

afterEach(() => setAutomationAgentHostFactory(null));

type KickArgs = Parameters<AutomationAgentHost['kick']>[0];

/** A failed attempt parked on the run's cursor, one minute after launch. */
function parkedAttempt(overrides: Partial<AgentCursor>): AgentCursor {
  return {
    execId: 'exec-1',
    sessionId: 'wf-run-1',
    deadlineAt: Date.now() + 60 * 60_000,
    providerSlug: 'anthropic',
    gatewayModel: 'claude-sonnet',
    harness: 'claude-code',
    input: { model: 'anthropic/claude-sonnet', prompt: 'Repair the setup' },
    launchedAt: Date.now() - 60_000,
    brokerTokenHash: 'account-b',
    burnedBrokerTokenHashes: ['account-a'],
    ...overrides,
  };
}

function harness(parked: AgentCursor) {
  const kicks: KickArgs[] = [];
  const suspended: Array<Record<string, unknown>> = [];
  const finished: Array<Record<string, unknown>> = [];
  setAutomationAgentHostFactory(() => ({
    kick: async (args) => {
      kicks.push(args);
      return {
        execId: 'exec-2',
        sessionId: 'wf-run-1',
        deadlineAt: Date.now() + 60 * 60_000,
        providerSlug: 'anthropic',
        gatewayModel: 'claude-sonnet',
        harness: 'claude-code',
      };
    },
    poll: async () => null,
    cancel: async () => undefined,
  }));
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      if (name.endsWith(':loadRunForStep')) {
        return {
          run: {
            name: 'repair',
            mode: 'live',
            input: {},
            checkpoints: {
              nodes: {},
              executions: 1,
              cursor: {
                node: 'repair',
                index: 0,
                passes: 0,
                outs: [],
                agent: parked,
              },
            },
          },
          document: {
            name: 'repair',
            nodes: [
              {
                id: 'repair',
                type: 'agent',
                model: 'anthropic/claude-sonnet',
                prompt: 'Repair the setup',
              },
            ],
            output: '{{ nodes.repair.output }}',
          },
        };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':suspendRun')) {
        suspended.push(args);
        return { suspended: true };
      }
      if (name.endsWith(':finishRun')) {
        finished.push(args);
        return { status: args.status };
      }
      return { status: 'running' };
    },
  };
  return { ctx: ctx as never, kicks, suspended, finished };
}

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

/** The cursor the re-kick parked under. */
function parkedCursor(suspended: Array<Record<string, unknown>>) {
  const cursor = suspended[0]?.cursor as { agent?: AgentCursor } | undefined;
  return cursor?.agent;
}

describe('the stepper re-kicking a failed agent attempt', () => {
  it('resumes a credential rotation on the same account pool, without spending an attempt', async () => {
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        result: {
          errored: true,
          reason: 'API Error: 401 OAuth access token has been revoked.',
          failureCode: 'credential_rotated',
          apiErrorStatus: 401,
          agentSessionId: 'conv-1',
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    // The budget was spent, yet the cut conversation resumes — and the
    // account whose token was refreshed stays in the pool.
    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toMatchObject({
      excludeBrokerTokenHashes: ['account-a'],
      resume: { agentSessionId: 'conv-1' },
    });
    expect(parkedCursor(suspended)).toMatchObject({
      execId: 'exec-2',
      attempt: AUTO_RETRY_MAX_ATTEMPTS,
      burnedBrokerTokenHashes: ['account-a'],
      credentialRotations: 1,
      resumedFrom: 'conv-1',
    });
  });

  it('spends an attempt on an ordinary failure and burns its account', async () => {
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: 1,
        credentialRotations: 1,
        result: {
          errored: true,
          reason: 'API Error: 502 upstream connect error',
          failureCode: 'harness_error',
          agentSessionId: 'conv-1',
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks[0]?.excludeBrokerTokenHashes).toEqual([
      'account-a',
      'account-b',
    ]);
    // Nothing to wait for: the re-kick starts at once.
    expect(kicks[0]).not.toHaveProperty('notBefore');
    const cursor = parkedCursor(suspended);
    expect(cursor).toMatchObject({ attempt: 2 });
    // Any other failure ends a streak of rotations.
    expect(cursor).not.toHaveProperty('credentialRotations');
  });

  it('carries a progress reset across a free rotation into the next ordinary retry', async () => {
    const rotated = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        launchedAt: Date.now() - 20 * 60_000,
        result: {
          errored: true,
          failureCode: 'credential_rotated',
          agentSessionId: 'conv-1',
          text: '',
          files: [],
        },
      }),
    );
    await stepRunImpl(rotated.ctx, RUN);
    expect(rotated.kicks).toHaveLength(1);
    const continued = parkedCursor(rotated.suspended);
    expect(continued).toMatchObject({ attempt: 0, credentialRotations: 1 });

    const failed = harness(
      parkedAttempt({
        ...continued,
        launchedAt: Date.now() - 60_000,
        result: {
          errored: true,
          failureCode: 'harness_error',
          agentSessionId: 'conv-1',
          text: '',
          files: [],
        },
      }),
    );
    await stepRunImpl(failed.ctx, RUN);
    expect(failed.kicks).toHaveLength(1);
    expect(parkedCursor(failed.suspended)).toMatchObject({ attempt: 1 });
  });

  it('holds the re-kick until a cooling broker pool has an account back', async () => {
    // Every account of the pool was cooling down after a 429: re-kicking at
    // once met the same refusal and spent the budget in seconds.
    const retryAtMs = Date.now() + 42_000;
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: 1,
        launchedAt: undefined,
        brokerTokenHash: undefined,
        result: {
          errored: true,
          reason:
            'the agent turn could not start: Every account behind credential "Pool" is cooling down after a rate limit — try again in 42 seconds.',
          failureCode: 'start_failed',
          retryAtMs,
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toMatchObject({ notBefore: retryAtMs });
    // The attempt still counts, so a pool other work keeps cooling cannot
    // hold the node in a wait loop.
    expect(parkedCursor(suspended)).toMatchObject({ attempt: 2 });
  });

  it('fails the run once the budget is spent on ordinary failures', async () => {
    const { ctx, kicks, finished } = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        result: {
          errored: true,
          reason: 'API Error: 502 upstream connect error',
          failureCode: 'harness_error',
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toEqual([]);
    expect(finished[0]).toMatchObject({
      status: 'failed',
      failureCode: 'harness_error',
    });
  });
});
