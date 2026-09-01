'use node';

/**
 * Which lane serves one task-agent turn, and on which provider: the GATEWAY
 * lane (a direct api-key/env credential behind the session virtual key — the
 * default), or the SUBSCRIPTION lane (a vendor subscription credential that
 * authenticates the harness's own CLI directly, e.g. a brokered Claude OAuth
 * pool driving Claude Code).
 *
 * The subscription lane exists only behind an explicit provider pin
 * (`projectAgents.modelProvider`). Pinned resolution is the shared
 * {@link resolvePinnedAgentServing} split — one implementation with the
 * automation agent node's pin, so the two lanes cannot drift: the pinned
 * provider's DEFAULT credential shape decides the lane, every refusal throws
 * with the actionable reason, and a pin NEVER falls back to another provider
 * (the silent-swap billing surprise is the defect this module exists to
 * close).
 *
 * Unpinned agents (rows saved before the picker carried providers) keep the
 * legacy direct-only connector walk byte-for-byte via
 * {@link resolveServingTarget}.
 */

import { resolveServingTarget } from '../automations/llm_call';
import type { ActionCtx } from '../lib/ctx';
import {
  resolvePinnedAgentServing,
  type AgentTurnServing,
} from '../lib/providers/agent_serving';

export type TaskServing = AgentTurnServing;

/**
 * Resolve one task-agent turn's serving lane. Throws — failing the run with
 * the reason — whenever a PINNED provider cannot serve the model on its
 * default credential; unpinned resolution keeps the legacy walk's errors.
 */
export async function resolveTaskServing(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    model: string;
    modelProvider?: string;
    harness: string;
  },
): Promise<TaskServing> {
  if (args.modelProvider === undefined) {
    const target = await resolveServingTarget(
      ctx,
      args.organizationId,
      args.model,
    );
    return { lane: 'gateway', ...target };
  }
  return resolvePinnedAgentServing(ctx, {
    organizationId: args.organizationId,
    model: args.model,
    modelProvider: args.modelProvider,
    harness: args.harness,
  });
}
