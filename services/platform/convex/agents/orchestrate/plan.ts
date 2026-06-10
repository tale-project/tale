'use node';

/**
 * Router-driven orchestration planner.
 *
 * When the escalation gate (see `plan_helpers.shouldOrchestrate`) decides a
 * message is multi-domain / high-complexity, this resolves a structured plan:
 * an ordered set of sub-tasks each mapped to the best specialist agent. Reuses
 * the `router` agent's model and the routing candidate roster.
 *
 * Always degrades safely: on any failure / timeout / non-decomposition it
 * returns null, and the caller falls back to single-agent routing. The
 * orchestrator must never be a regression.
 */

import { generateObject } from 'ai';

import type { ActionCtx } from '../../_generated/server';
import { reasoningProviderOptionsFor } from '../../lib/agent_response/reasoning/build_reasoning_options';
import { buildCallProviderOptions } from '../../lib/provider_options';
import { resolveRouterModel } from '../auto_route';
import {
  type AgentListEntry,
  pickDefault,
  type RouterHints,
} from '../auto_route_helpers';
import {
  buildPlannerInstructions,
  orchestrationPlanSchema,
  validatePlan,
  type ValidatedPlan,
} from './plan_helpers';

/** Hard ceiling on the planning call — beyond this we fall back to single-agent. */
const PLAN_TIMEOUT_MS = 8_000;

export interface ResolveOrchestrationPlanArgs {
  organizationId: string;
  orgSlug: string;
  message: string;
  candidates: AgentListEntry[];
  hints?: RouterHints;
}

/**
 * Resolve a validated multi-agent plan, or null when decomposition is not
 * warranted / fails (caller falls back to single-agent routing).
 */
export async function resolveOrchestrationPlan(
  ctx: ActionCtx,
  args: ResolveOrchestrationPlanArgs,
): Promise<ValidatedPlan | null> {
  const defaultSlug = pickDefault(args.candidates)?.name ?? '';
  if (!defaultSlug) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const planPromise = (async (): Promise<ValidatedPlan | null> => {
      const { languageModel, modelData } = await resolveRouterModel(
        ctx,
        args.orgSlug,
        args.organizationId,
      );
      const callProviderOptions = reasoningProviderOptionsFor(
        modelData,
        buildCallProviderOptions(modelData),
        { kind: 'utility' },
      );
      const { object } = await generateObject({
        model: languageModel,
        schema: orchestrationPlanSchema,
        system: buildPlannerInstructions(
          args.candidates,
          defaultSlug,
          args.hints,
        ),
        prompt: args.message.slice(0, 8000),
        ...(callProviderOptions
          ? { providerOptions: callProviderOptions }
          : {}),
      });
      const validated = validatePlan(object, args.candidates);
      return validated.decompose ? validated : null;
    })().catch((err: unknown) => {
      // Loser-of-the-race safety: a planner rejection AFTER the timeout won
      // the race has no other awaiter and would become an unhandled rejection
      // in the Convex action runtime. Swallow → caller falls back single-agent.
      console.warn(
        `[resolveOrchestrationPlan] planner rejected org=${args.organizationId}; falling back to single-agent`,
        err instanceof Error ? err.message : err,
      );
      return null;
    });

    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PLAN_TIMEOUT_MS);
    });
    return await Promise.race([planPromise, timeoutPromise]);
  } catch (err) {
    console.warn(
      `[resolveOrchestrationPlan] planning failed org=${args.organizationId}; falling back to single-agent`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
