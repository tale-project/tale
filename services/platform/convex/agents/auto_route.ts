'use node';

/**
 * Auto-routing for the composer's "Auto" agent mode.
 *
 * When the user hasn't pinned a specific agent, the composer sends the
 * `AUTO_AGENT_SLUG` sentinel instead of a concrete slug. `resolveAutoRoute`
 * turns that sentinel into a real agent slug using the cheapest mechanism that
 * works (see the gate below), mirroring the philosophy of the Adaptive
 * Reasoning Governor: infer silently, spend an LLM call only when it actually
 * changes the answer, and always degrade to a safe default.
 *
 * Cost ladder (cheapest first):
 *   1. ≤1 candidate agent          → return it. No LLM call.
 *   2. Trivial greeting / ack      → return the default agent. No LLM call.
 *   3. Otherwise                   → one cheap, timeout-raced classifier call
 *                                    over the candidates' descriptions.
 *
 * The classifier reuses the exact pattern proven by `generateThreadTitle`:
 * a tiny `Agent`, reasoning forced off (`kind: 'utility'`), tag-resolved model
 * with org failover, `saveMessages: 'none'`, and a hard timeout race so a slow
 * provider can never delay first-token beyond the budget — it just falls back
 * to the default agent.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import {
  AUTO_AGENT_SLUG,
  DEFAULT_CHAT_AGENT_SLUG,
} from '../../lib/shared/constants/agents';
import { components, internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import { reasoningProviderOptionsFor } from '../lib/agent_response/reasoning/build_reasoning_options';
import { matchesTrivialAck } from '../lib/agent_response/reasoning/lexicon';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import {
  type AgentListEntry,
  buildRouterInstructions,
  filterRoutingCandidates,
  matchSlug,
  pickDefault,
} from './auto_route_helpers';

// Re-export so callers already importing from this module keep working.
export { AUTO_AGENT_SLUG };

/** Hard ceiling on the classifier call — beyond this we use the default. */
const ROUTE_TIMEOUT_MS = 6_000;

/** Don't pay the classifier tax once the candidate set gets large; the prompt
 *  would bloat and the marginal routing quality drops. Cap the shortlist. */
const MAX_CANDIDATES = 24;

export interface AutoRouteResult {
  /** The resolved concrete agent slug. Never the sentinel. */
  agentSlug: string;
  /** Why this slug was chosen — for logging/telemetry, not user-facing. */
  reason: 'single-candidate' | 'trivial' | 'classified' | 'fallback';
}

function createRouter(
  languageModel: LanguageModelV3,
  instructions: string,
): Agent {
  return new Agent(components.agent, {
    name: 'agent-router',
    languageModel,
    instructions,
    // A slug is short; cap output so a chatty model can't ramble.
    callSettings: { maxOutputTokens: 24 },
  });
}

export const resolveAutoRoute = internalAction({
  args: {
    organizationId: v.string(),
    message: v.string(),
    /** When chatting inside a project that pins agents, restrict to these. */
    allowedAgentSlugs: v.optional(v.array(v.string())),
  },
  returns: v.object({
    agentSlug: v.string(),
    reason: v.union(
      v.literal('single-candidate'),
      v.literal('trivial'),
      v.literal('classified'),
      v.literal('fallback'),
    ),
  }),
  handler: async (ctx: ActionCtx, args): Promise<AutoRouteResult> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listAgentsInternal returns v.any(); shape is the file-read projection above
    const raw = (await ctx.runAction(
      internal.agents.internal_actions.listAgentsInternal,
      { orgSlug },
    )) as AgentListEntry[];

    // Only agents that can actually answer in chat are routing candidates
    // (visible, not image-generation, on the project allow-list if any).
    const candidates = filterRoutingCandidates(raw, args.allowedAgentSlugs);

    const fallback = pickDefault(candidates);
    if (!fallback) {
      // No usable agent at all — the org has nothing visible to route to. We
      // can't conjure an agent, so hand back the conventional default and let
      // the downstream resolve step raise its normal "agent not found" error.
      // It may name `chat-agent` even if that too is absent, but this branch
      // only fires in an already-broken org (zero chat-capable agents); a
      // perfectly-worded error for that misconfiguration isn't worth threading
      // a new error channel through unified_chat.
      return { agentSlug: DEFAULT_CHAT_AGENT_SLUG, reason: 'fallback' };
    }

    // Gate 1: nothing to choose between.
    if (candidates.length === 1) {
      return { agentSlug: fallback.name, reason: 'single-candidate' };
    }

    // Gate 2: greetings / acknowledgements don't carry routing signal — the
    // general agent is the right home and a classifier call would be wasted.
    if (matchesTrivialAck(args.message)) {
      return { agentSlug: fallback.name, reason: 'trivial' };
    }

    // Gate 3: ask a cheap classifier, but never let it delay first-token past
    // the budget — on timeout or any failure we use the default agent.
    const shortlist = candidates.slice(0, MAX_CANDIDATES);
    try {
      const classifyPromise = (async (): Promise<string | null> => {
        const { languageModel, modelData } =
          await resolveLanguageModelWithFallback(ctx, {
            tag: 'chat',
            organizationId: args.organizationId,
          });
        const router = createRouter(
          languageModel,
          buildRouterInstructions(shortlist),
        );
        const callProviderOptions = reasoningProviderOptionsFor(
          modelData,
          buildCallProviderOptions(modelData),
          { kind: 'utility' },
        );
        const userId = `agent-router-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;
        const result = await router.generateText(
          ctx,
          { userId },
          {
            prompt: args.message.slice(0, 4000),
            ...(callProviderOptions
              ? { providerOptions: callProviderOptions }
              : {}),
          },
          { storageOptions: { saveMessages: 'none' } },
        );
        return matchSlug(result.text ?? '', shortlist);
      })();

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ROUTE_TIMEOUT_MS),
      );

      const slug = await Promise.race([classifyPromise, timeoutPromise]);
      if (slug) {
        return { agentSlug: slug, reason: 'classified' };
      }
    } catch (error) {
      console.warn(
        `[resolveAutoRoute] classifier failed org=${args.organizationId}:`,
        error,
      );
    }

    return { agentSlug: fallback.name, reason: 'fallback' };
  },
});
