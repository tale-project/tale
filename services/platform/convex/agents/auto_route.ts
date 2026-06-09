'use node';

/**
 * Auto-routing for the composer's "Auto" agent mode.
 *
 * When the user hasn't pinned a specific agent, the composer sends the
 * `AUTO_AGENT_SLUG` sentinel instead of a concrete slug. `resolveAutoRoute`
 * turns that sentinel into a real agent slug.
 *
 * Routing is performed by a single, fast, config-defined AI agent — the
 * `router` agent (`router.json`, `isRouter: true`). Its `supportedModels` pick
 * the (fast) classifier model; its instructions are generated per-request from
 * `buildRouterInstructions(candidates)`. No hand-tuned heuristics.
 *
 * Cost ladder (cheapest first):
 *   1. ≤1 candidate agent → return it. No LLM call.
 *   2. Cached decision    → reuse the prior pick for this message + roster.
 *   3. Otherwise          → one fast, timeout-raced router classification.
 *
 * The classifier saves no messages, forces reasoning off, and races a hard
 * timeout so a slow provider can never delay first-token beyond the budget — on
 * timeout/failure it falls back to the default agent.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import {
  DEFAULT_CHAT_AGENT_SLUG,
  ROUTER_AGENT_SLUG,
} from '../../lib/shared/constants/agents';
import { parseModelRef } from '../../lib/shared/utils/model-ref';
import { components, internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import { detectDomain } from '../lib/agent_response/model_routing/domain';
import { reasoningProviderOptionsFor } from '../lib/agent_response/reasoning/build_reasoning_options';
import { scoreDifficulty } from '../lib/agent_response/reasoning/signals';
import { classFromIntensity } from '../lib/agent_response/reasoning/types';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import {
  resolveLanguageModelById,
  type ResolvedModelData,
} from '../providers/resolve_model';
import {
  type AutoRouteReason,
  autoRouteReasonValidator,
} from '../streaming/validators';
import {
  type AgentListEntry,
  buildRouterInstructions,
  filterRoutingCandidates,
  hashCandidates,
  normalizeMessageKey,
  parseRouterDecision,
  pickDefault,
  type RouterDecision,
  type RouterTuningAdvice,
} from './auto_route_helpers';
import type { AgentReadResult } from './file_utils';
import { listAgentsForOrg } from './internal_actions';
import { routeTuningValidator } from './schema';

/** Hard ceiling on the classifier call — beyond this we use the default. Kept
 *  in step with the `router` agent's declared `timeoutMs` so a fast classifier
 *  model gets the full budget the config intends rather than being cut off
 *  early (the previous 6s clipped slower providers → silent fallback). */
const ROUTE_TIMEOUT_MS = 8_000;

/** Cap the candidate list shown to the router so a huge org doesn't bloat the
 *  prompt. A fast model handles this many slugs trivially. */
const MAX_CANDIDATES = 40;

interface AutoRouteResult {
  /** The resolved concrete agent slug. Never the sentinel. */
  agentSlug: string;
  /** Why this slug was chosen — for logging/telemetry, not user-facing. */
  reason: AutoRouteReason;
  /** Advisory reply-language hint (BCP-47 or language name); fallback only. */
  language?: string;
  /** Advisory qualitative response shaping (merged onto the agent's tuning). */
  tuning?: RouterTuningAdvice;
  /** Capability slugs the router suggests enabling (allowlist-gated by caller). */
  capabilities?: string[];
}

/** The advisory fields shared by a cached entry and a fresh decision. */
type RouteAdvice = Pick<
  AutoRouteResult,
  'language' | 'tuning' | 'capabilities'
>;

/**
 * Spread the optional advisory fields, omitting any that are unset, so cached
 * and freshly-classified results (and the cache write) build them identically.
 */
function advisoryFields(advice: RouteAdvice): RouteAdvice {
  return {
    ...(advice.language ? { language: advice.language } : {}),
    ...(advice.tuning ? { tuning: advice.tuning } : {}),
    ...(advice.capabilities ? { capabilities: advice.capabilities } : {}),
  };
}

function createRouter(
  languageModel: LanguageModelV3,
  instructions: string,
): Agent {
  return new Agent(components.agent, {
    name: 'agent-router',
    languageModel,
    instructions,
    // Cap output so a chatty model can't ramble, but leave room for the full
    // single-line decision object — slug PLUS the advisory fields (language,
    // style, verbosity, capabilities). Too tight and the JSON gets truncated
    // mid-object, the parser finds no closing brace, and the route silently
    // falls back to the default agent (notably for any reply that carries a
    // `language` hint, e.g. "translate this to German").
    callSettings: { maxOutputTokens: 128 },
  });
}

interface ResolvedRouterModel {
  languageModel: LanguageModelV3;
  modelData: ResolvedModelData;
}

/**
 * Resolve the router's classifier model: the first entry of the `router`
 * agent's `supportedModels` that resolves cleanly. A model that is not
 * configured / wrongly configured throws at RESOLUTION time (no HTTP) and is
 * skipped immediately. Falls back to the org's default `chat`-tagged model when
 * the router agent is absent or none of its models resolve.
 */
export async function resolveRouterModel(
  ctx: ActionCtx,
  orgSlug: string,
  organizationId: string,
  /**
   * The router agent's supportedModels, when the caller already has them.
   * `resolveAutoRoute` loads the full agent list (incl. the router entry) via
   * `listAgentsInternal`, so it passes the router's models here to skip a second
   * disk read + action hop. Falls back to reading `router.json` when absent.
   */
  preloadedSupportedModels?: string[],
): Promise<ResolvedRouterModel> {
  let supportedModels: string[] = preloadedSupportedModels ?? [];
  if (supportedModels.length === 0) {
    try {
      // readAgentInternal returns v.any(); annotate to the known shape.
      const read: AgentReadResult = await ctx.runAction(
        internal.agents.internal_actions.readAgentInternal,
        { orgSlug, agentName: ROUTER_AGENT_SLUG },
      );
      if (read.ok) supportedModels = read.config.supportedModels ?? [];
    } catch (err) {
      console.warn(
        '[resolveAutoRoute] router agent read failed; using default chat model',
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const ref of supportedModels) {
    const parsed = parseModelRef(ref);
    try {
      return await resolveLanguageModelById(ctx, {
        modelId: parsed.modelId,
        providerName: parsed.providerName,
        organizationId,
      });
    } catch (err) {
      // Not configured / wrongly configured → skip to the next model directly,
      // without attempting a request.
      console.warn(
        `[resolveAutoRoute] router model '${ref}' not usable; trying next`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // No router config (or none of its models resolved): default chat model.
  return resolveLanguageModelWithFallback(ctx, {
    tag: 'chat',
    organizationId,
  });
}

export const resolveAutoRoute = internalAction({
  args: {
    organizationId: v.string(),
    message: v.string(),
    /** When chatting inside a project that pins agents, restrict to these. */
    allowedAgentSlugs: v.optional(v.array(v.string())),
    /** Existing thread id — lets a later same-message manual override correct
     *  this decision (route-quality feedback). */
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    agentSlug: v.string(),
    reason: autoRouteReasonValidator,
    language: v.optional(v.string()),
    tuning: v.optional(routeTuningValidator),
    capabilities: v.optional(v.array(v.string())),
  }),
  handler: async (ctx: ActionCtx, args): Promise<AutoRouteResult> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    // Call the agent-list projection IN-PROCESS — we're already in the Node
    // runtime, so a cross-action `runAction` hop is pure dispatch overhead.
    // This runs on EVERY Auto turn (incl. cached/short-circuited reuse), so on a
    // self-hosted backend that hop dominated reuse latency. Shares the same
    // module-level 60s cache as the `listAgentsInternal` action wrapper.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listAgentsForOrg returns unknown[]; shape is the file-read projection
    const raw = (await listAgentsForOrg(orgSlug)) as AgentListEntry[];

    // Only agents that can actually answer in chat are routing candidates
    // (visible, not image-generation, on the project allow-list if any). The
    // router agent itself is `visibleInChat: false`, so it's excluded here.
    const candidates = filterRoutingCandidates(raw, args.allowedAgentSlugs);

    // The router agent is filtered out of candidates above but is present in the
    // raw list; reuse its supportedModels so `resolveRouterModel` doesn't re-read
    // router.json from disk on the classify path.
    const routerSupportedModels = raw.find(
      (a) => a.isRouter === true,
    )?.supportedModels;

    const fallback = pickDefault(candidates);
    if (!fallback) {
      // No usable agent at all — hand back the conventional default and let the
      // downstream resolve step raise its normal "agent not found" error.
      return { agentSlug: DEFAULT_CHAT_AGENT_SLUG, reason: 'fallback' };
    }

    // Gate 1: nothing to choose between.
    if (candidates.length === 1) {
      return { agentSlug: fallback.name, reason: 'single-candidate' };
    }

    // Gate 2: routing-decision cache. The same normalized message + roster has
    // already been routed → reuse it, skipping the classifier entirely. Keyed
    // partly on the roster hash, so a changed agent set auto-invalidates.
    const candidatesHash = hashCandidates(candidates);
    const messageKey = normalizeMessageKey(args.message);
    const candidateNames = new Set(candidates.map((c) => c.name));

    // Record the auto decision on the thread so a later same-message manual
    // override can correct it (route-quality feedback). Scheduled rather than
    // awaited inline: `scheduler.runAfter(0)` durably enqueues the write (a
    // bare dangling `runMutation` may be dropped when the action returns) while
    // keeping it off this turn's routing latency. A schedule failure must never
    // affect routing, so it's caught and logged.
    const persistLastAutoRoute = async (slug: string): Promise<void> => {
      if (!args.threadId) return;
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.threads.internal_mutations.setLastAutoRoute,
          {
            threadId: args.threadId,
            messageKey,
            candidatesHash,
            agentSlug: slug,
          },
        );
      } catch (err: unknown) {
        console.warn(
          '[resolveAutoRoute] setLastAutoRoute failed:',
          err instanceof Error ? err.message : err,
        );
      }
    };

    try {
      const cached = await ctx.runQuery(
        internal.agents.internal_queries.getAutoRouteCache,
        {
          organizationId: args.organizationId,
          candidatesHash,
          messageKey,
          nowMs: Date.now(),
        },
      );
      // Only trust a cached slug that's still a live candidate. The advisory
      // fields (language/tuning/capabilities) are message-derived, so the same
      // normalized message safely reuses them too.
      if (cached && candidateNames.has(cached.agentSlug)) {
        await persistLastAutoRoute(cached.agentSlug);
        return {
          agentSlug: cached.agentSlug,
          reason: 'cached',
          ...advisoryFields(cached),
        };
      }
    } catch (err) {
      console.warn(
        `[resolveAutoRoute] cache read failed org=${args.organizationId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Gate 3: the router agent classifies. Cap the shortlist; log any drops so
    // an org that outgrows single-call routing is visible in telemetry.
    const shortlist = candidates.slice(0, MAX_CANDIDATES);
    if (candidates.length > MAX_CANDIDATES) {
      const dropped = candidates.slice(MAX_CANDIDATES).map((c) => c.name);
      console.warn(
        `[resolveAutoRoute] org=${args.organizationId} has ${candidates.length} candidates; router shortlist capped at ${MAX_CANDIDATES}, dropped: ${dropped.join(', ')}`,
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const classifyPromise = (async (): Promise<RouterDecision | null> => {
        const { languageModel, modelData } = await resolveRouterModel(
          ctx,
          orgSlug,
          args.organizationId,
          routerSupportedModels,
        );
        // Zero-cost signals to sharpen the classifier on ambiguous messages.
        const { domain } = detectDomain(args.message);
        const difficulty = scoreDifficulty({
          kind: 'chat',
          promptText: args.message,
        });
        const router = createRouter(
          languageModel,
          buildRouterInstructions(shortlist, {
            domain,
            complexity: classFromIntensity(difficulty.intensity),
          }),
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
        const decision = parseRouterDecision(result.text ?? '', shortlist);
        // Diagnostic: surface what the classifier actually saw and emitted, so a
        // misroute (specialist not picked / truncated output / unparsable reply)
        // is visible in the logs without guessing. Shortlist confirms the
        // specialist was even a candidate; raw shows the model's actual reply.
        console.log(
          `[resolveAutoRoute] classified org=${args.organizationId} domain=${domain} shortlist=[${shortlist
            .map((c) => c.name)
            .join(
              ', ',
            )}] raw=${JSON.stringify((result.text ?? '').slice(0, 200))} -> ${decision?.slug ?? 'null'}`,
        );
        return decision;
      })().catch((err: unknown) => {
        // Loser-of-the-race safety: if the classifier rejects AFTER the
        // timeout already resolved the race, nothing else is awaiting this
        // promise, so an unguarded rejection would surface as an unhandled
        // rejection in the Convex action runtime. Swallow → fall back.
        console.warn(
          `[resolveAutoRoute] classifier rejected org=${args.organizationId}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      });

      const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ROUTE_TIMEOUT_MS);
      });

      const decision = await Promise.race([classifyPromise, timeoutPromise]);
      if (decision) {
        // Cache the full decision for identical future messages. Scheduled, not
        // a dangling `runMutation`: the cache write is the very thing that makes
        // future routing fast, so it must actually land — a dropped write would
        // silently defeat the cache. A write failure must never affect this
        // turn's routing, so the schedule is caught and logged.
        const advice = advisoryFields(decision);
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.agents.internal_mutations.upsertAutoRouteCache,
            {
              organizationId: args.organizationId,
              candidatesHash,
              messageKey,
              agentSlug: decision.slug,
              source: 'classified',
              nowMs: Date.now(),
              ...advice,
            },
          );
        } catch (err: unknown) {
          console.warn(
            `[resolveAutoRoute] cache write failed org=${args.organizationId}:`,
            err instanceof Error ? err.message : err,
          );
        }
        await persistLastAutoRoute(decision.slug);
        return {
          agentSlug: decision.slug,
          reason: 'classified',
          ...advice,
        };
      }
    } catch (error) {
      console.warn(
        `[resolveAutoRoute] classifier failed org=${args.organizationId}:`,
        error,
      );
    } finally {
      // Free the timer on the fast path so the action isn't kept alive by a
      // pending 6s timeout after the classifier already returned.
      if (timer) clearTimeout(timer);
    }

    return { agentSlug: fallback.name, reason: 'fallback' };
  },
});
