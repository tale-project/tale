/**
 * The stepper consuming a failed agent attempt — the REAL walk, with a
 * recording agent host and ctx. What it re-kicks with is the retry plan
 * (`planWorkflowAgentRetry`): an ordinary failure spends the budget and
 * burns its broker account; a credential rotation — the broker refreshed the
 * account under the turn (observed live 2026-09-28: "401 OAuth access token
 * has been revoked") — resumes the conversation on a fresh vend for free.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { AUTO_RETRY_MAX_ATTEMPTS } from '../tasks/task_auto_retry.ts';
import type { AutomationAgentHost } from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';
import { setAutomationAgentHostFactory, stepRunImpl } from './stepper.ts';

afterEach(() => {
  setAutomationAgentHostFactory(null);
  vi.restoreAllMocks();
});

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

function harness(parked: AgentCursor, executions = 1) {
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
              executions,
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

  it('marks the retry of a 429 so waiting out its cooldown costs nothing more', async () => {
    const { ctx, suspended } = harness(
      parkedAttempt({
        attempt: 1,
        result: {
          errored: true,
          reason: 'the agent turn failed: API Error: 429 rate limited',
          failureCode: 'harness_error',
          apiErrorStatus: 429,
          agentSessionId: 'conv-1',
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(parkedCursor(suspended)).toMatchObject({
      attempt: 2,
      retriedRateLimit: true,
      resumedFrom: 'conv-1',
      resumeReason: 'the agent turn failed: API Error: 429 rate limited',
    });
  });

  it('holds the re-kick until a cooling broker pool has an account back, resuming what the refused start was to resume', async () => {
    // The pool cooled down after this node's own 429, and the retry that
    // was to resume `conv-1` was refused before it launched. Re-kicking at
    // once met the same refusal and spent the budget in seconds.
    const retryAtMs = Date.now() + 42_000;
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: 2,
        launchedAt: undefined,
        brokerTokenHash: undefined,
        retriedRateLimit: true,
        resumedFrom: 'conv-1',
        resumeReason: 'the agent turn failed: API Error: 429 rate limited',
        result: {
          errored: true,
          reason:
            'the agent turn could not start: Every account behind credential "Pool" is cooling down after a rate limit — try again in 42 seconds.',
          failureCode: 'credential_cooldown',
          retryAtMs,
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toMatchObject({
      notBefore: retryAtMs,
      resume: {
        agentSessionId: 'conv-1',
        reason: 'the agent turn failed: API Error: 429 rate limited',
      },
    });
    // The 429 already counted; the wait for its cooldown does not.
    const cursor = parkedCursor(suspended);
    expect(cursor).toMatchObject({ attempt: 2, resumedFrom: 'conv-1' });
    // A second refusal in a row would count.
    expect(cursor).not.toHaveProperty('retriedRateLimit');
  });

  it('counts a refused start that did not retry its own 429', async () => {
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: 1,
        launchedAt: undefined,
        brokerTokenHash: undefined,
        result: {
          errored: true,
          failureCode: 'credential_cooldown',
          retryAtMs: Date.now() + 42_000,
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(parkedCursor(suspended)).toMatchObject({ attempt: 2 });
  });

  it("waits for sandbox room without charging the run's execution guard", async () => {
    // A run whose guard is spent still re-kicks: the refused start ran
    // nothing, and a long wait must not leave later nodes without budget.
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        launchedAt: undefined,
        result: {
          errored: true,
          reason:
            'the agent turn is waiting for sandbox room: the sandbox host is busy',
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 15_000,
          text: '',
          files: [],
        },
      }),
      100,
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(kicks[0]?.notBefore).toBeGreaterThan(Date.now());
    // The run says it waits for room, not that an agent works.
    expect(suspended[0]).toMatchObject({
      executions: 100,
      detail: 'room:repair',
    });
    expect(parkedCursor(suspended)).toMatchObject({
      attempt: AUTO_RETRY_MAX_ATTEMPTS,
      waitingForRoomSince: expect.any(Number),
    });
  });

  it('backs a room wait off past the retry hint, more with each refusal in a row', async () => {
    // The top of each window: the hint doubled per refusal in a row.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        launchedAt: undefined,
        waitingForRoomSince: Date.now() - 5 * 60_000,
        roomRefusals: 2,
        result: {
          errored: true,
          reason:
            'the agent turn is waiting for sandbox room: the sandbox host is busy',
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 10_000,
          retryAfterMs: 10_000,
          text: '',
          files: [],
        },
      }),
    );
    const before = Date.now();

    await stepRunImpl(ctx, RUN);

    // The third refusal in a row: up to eight times the hint, not the hint.
    expect(kicks[0]?.notBefore).toBeGreaterThanOrEqual(before + 80_000);
    expect(kicks[0]?.notBefore).toBeLessThanOrEqual(Date.now() + 80_000);
    expect(parkedCursor(suspended)).toMatchObject({ roomRefusals: 3 });
  });

  it('comes back when its place in the spawner’s line comes up, without backing off', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { ctx, kicks } = harness(
      parkedAttempt({
        launchedAt: undefined,
        waitingForRoomSince: Date.now() - 5 * 60_000,
        roomRefusals: 6,
        result: {
          errored: true,
          reason:
            'the agent turn is waiting for sandbox room: the sandbox host is busy',
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 15_000,
          retryAfterMs: 15_000,
          roomQueued: true,
          text: '',
          files: [],
        },
      }),
    );
    const before = Date.now();

    await stepRunImpl(ctx, RUN);

    // The hint, and at most a second more — not the doubled window.
    expect(kicks[0]?.notBefore).toBeGreaterThanOrEqual(before + 15_000);
    expect(kicks[0]?.notBefore).toBeLessThanOrEqual(Date.now() + 16_000);
  });

  it('waits afresh for room when a turn that ran meets a refusal hours after its first wait', async () => {
    // The node waited for room, then got it and ran; the agent asked a
    // question, and the resume after a late answer found no room. That is
    // a new wait, not the old one past its two hours.
    const { ctx, kicks, suspended, finished } = harness(
      parkedAttempt({
        launchedAt: Date.now() - 3 * 60 * 60_000 + 60_000,
        waitingForRoomSince: Date.now() - 3 * 60 * 60_000,
        result: {
          errored: true,
          reason:
            'the agent turn is waiting for sandbox room: the sandbox host is busy',
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 15_000,
          retryAfterMs: 15_000,
          text: '',
          files: [],
        },
      }),
    );
    const before = Date.now();

    await stepRunImpl(ctx, RUN);

    expect(finished).toEqual([]);
    expect(kicks).toHaveLength(1);
    expect(parkedCursor(suspended)?.waitingForRoomSince).toBeGreaterThanOrEqual(
      before,
    );
  });

  it('resumes the asking conversation when the delivery of an answer found no room', async () => {
    const { ctx, kicks, suspended } = harness(
      parkedAttempt({
        execId: 'exec-asking',
        result: {
          errored: true,
          reason:
            "the agent turn is waiting for sandbox room: the organization's workflow sessions are all in use",
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 15_000,
          retryAfterMs: 15_000,
          agentSessionId: 'conv-ask',
          undeliveredAskId: 'ask-1',
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks[0]?.resume).toEqual({
      agentSessionId: 'conv-ask',
      reason:
        "the agent turn is waiting for sandbox room: the organization's workflow sessions are all in use",
      askId: 'ask-1',
    });
    expect(parkedCursor(suspended)).toMatchObject({
      resumedFrom: 'conv-ask',
      resumeAskId: 'ask-1',
    });
  });

  it('gives up on sandbox room after two hours, saying so', async () => {
    const { ctx, kicks, finished } = harness(
      parkedAttempt({
        launchedAt: undefined,
        waitingForRoomSince: Date.now() - 2 * 60 * 60_000 - 1,
        result: {
          errored: true,
          reason:
            "the agent turn is waiting for sandbox room: the organization's workflow sessions are all in use",
          failureCode: 'sandbox_capacity',
          retryAtMs: Date.now() + 15_000,
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toEqual([]);
    expect(finished[0]).toMatchObject({
      status: 'failed',
      failureCode: 'start_failed',
    });
    expect(String(finished[0]?.detail)).toContain(
      "waited 120 minutes for sandbox room without getting any (the organization's workflow sessions are all in use)",
    );
  });

  it('keeps saying a step waits for room while its kicked start has not launched, and an agent works once it has', async () => {
    const waiting = harness(
      parkedAttempt({
        launchedAt: undefined,
        waitingForRoomSince: Date.now() - 60_000,
      }),
    );
    await stepRunImpl(waiting.ctx, RUN);
    expect(waiting.suspended[0]).toMatchObject({ detail: 'room:repair' });

    const launched = harness(
      parkedAttempt({
        launchedAt: Date.now() - 1_000,
        waitingForRoomSince: Date.now() - 60_000,
      }),
    );
    await stepRunImpl(launched.ctx, RUN);
    expect(launched.suspended[0]).toMatchObject({ detail: 'agent:repair' });
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

  it('fails a run whose last attempts a cooling pool refused as `start_failed`, the code a refused start always carried', async () => {
    // Other work kept the pool cooling: each refused start counted, and the
    // last one leaves the budget spent. The turn never started, so the run
    // must not read `harness_error` on the wire.
    const { ctx, kicks, finished } = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        launchedAt: undefined,
        brokerTokenHash: undefined,
        result: {
          errored: true,
          reason:
            'the agent turn could not start: Every account behind credential "Pool" is cooling down after a rate limit — try again in 42 seconds.',
          failureCode: 'credential_cooldown',
          retryAtMs: Date.now() + 42_000,
          text: '',
          files: [],
        },
      }),
    );

    await stepRunImpl(ctx, RUN);

    expect(kicks).toEqual([]);
    expect(finished[0]).toMatchObject({
      status: 'failed',
      failureCode: 'start_failed',
    });
  });

  it('fails a run whose dead grant kept rotating as `harness_error`, as a 401 always read', async () => {
    const { ctx, kicks, finished } = harness(
      parkedAttempt({
        attempt: AUTO_RETRY_MAX_ATTEMPTS,
        credentialRotations: 2,
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

    expect(kicks).toEqual([]);
    expect(finished[0]).toMatchObject({
      status: 'failed',
      failureCode: 'harness_error',
    });
  });
});
