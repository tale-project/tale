/**
 * The kick of an automation agent step records, on the op it opens, why the
 * turn runs on its harness (`harness_reason`, migration 0240): the step names
 * it, or nothing did and the serving put it there — a model only a
 * subscription serves runs on the runtime that subscription is bound to, any
 * other on the default. The run's details tell it as one sentence.
 */
import { describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import type { AgentTurnServing } from '../lib/providers/agent_serving';

vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));

const { automationAgentHost } = await import('./agent_host');

/** The subscription serving a Claude plan answers with. */
const SUBSCRIPTION: AgentTurnServing = {
  lane: 'subscription',
  providerSlug: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  apiBaseUrl: 'https://api.anthropic.com',
  vision: { readable: true },
};

/** A directly served model on the relay. */
const GATEWAY: AgentTurnServing = {
  lane: 'gateway',
  providerSlug: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4.6',
};

function kickCtx() {
  const opens: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (
        functionRefName(ref) === 'sandbox/session_mutations:upsertSessionOp'
      ) {
        opens.push(args);
      }
      return null;
    }),
    runAction: vi.fn(async () => null),
    scheduler: { runAfter: async () => 'job' },
  } as unknown as ActionCtx;
  return { ctx, opens };
}

/** The serving walk for a model `serving` stands for: a subscription bound
 * to Claude Code serves it there alone, refusing every other runtime as the
 * real walk does; a directly served model runs anywhere. */
function walkFor(serving: AgentTurnServing) {
  return async (_ctx: unknown, args: { harness: string }) => {
    if (serving.lane === 'subscription' && args.harness !== 'claude-code') {
      throw new Error(
        `no configured provider serves model "${serving.modelId}" for this agent turn`,
      );
    }
    return serving;
  };
}

describe('the op an automation agent step opens', () => {
  it.each([
    [
      'a step that names its runtime',
      'claude-code',
      SUBSCRIPTION,
      'claude-code',
      'pinned',
    ],
    [
      'a step on the default whose model only a subscription serves',
      undefined,
      SUBSCRIPTION,
      'claude-code',
      'subscription_bound',
    ],
    [
      'a step on the default whose model is served directly',
      undefined,
      GATEWAY,
      'pi',
      'default',
    ],
  ] as const)(
    'records why %s runs where it runs',
    async (_label, harness, serving, ranOn, reason) => {
      const { ctx, opens } = kickCtx();

      const kicked = await automationAgentHost(ctx, 'org-1', {
        resolveServing: walkFor(serving),
      }).kick({
        runId: 'run-1',
        nodeId: 'triage',
        request: {
          model: serving.modelId,
          prompt: 'Triage the inbox.',
          ...(harness !== undefined ? { harness } : {}),
        },
      });

      expect(kicked.harness).toBe(ranOn);
      // The cursor keeps what the kick decided, for the conversation's later
      // turns (an answered question's resume).
      expect(kicked.harnessReason).toBe(reason);
      expect(opens).toHaveLength(1);
      expect(opens[0]).toMatchObject({
        kind: 'workflow-agent',
        status: 'running',
        harness: ranOn,
        harnessReason: reason,
      });
    },
  );
});
