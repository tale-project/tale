'use node';

/**
 * Router-orchestration coordinator.
 *
 * The single entry point `chatWithAgent` calls in "Auto" mode when the org's
 * router is configured to orchestrate. It:
 *   1. loads the routing candidate roster + the router's orchestration mode,
 *   2. runs the zero-cost escalation gate (cheap signals; no LLM),
 *   3. resolves a structured multi-agent plan (one LLM call),
 *   4. executes the plan over the shared delegate executor (sub-threads,
 *      budget, partial-failure), and
 *   5. returns the synthesizing agent + an orchestration-results context block.
 *
 * Returns `{ orchestrated: false }` whenever orchestration is disabled, the gate
 * doesn't fire, or planning fails — the caller then routes single-agent. The
 * orchestrator is never a regression.
 */

import { v } from 'convex/values';

import { ROUTER_AGENT_SLUG } from '../../../lib/shared/constants/agents';
import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
import { runDelegateStep } from '../../agent_tools/delegation/run_delegate_step';
import { detectDomain } from '../../lib/agent_response/model_routing/domain';
import { scoreDifficulty } from '../../lib/agent_response/reasoning/signals';
import { classFromIntensity } from '../../lib/agent_response/reasoning/types';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import {
  type AgentListEntry,
  filterRoutingCandidates,
} from '../auto_route_helpers';
import type { AgentReadResult } from '../file_utils';
import { buildChartFromRoster, readWorkforceRoster } from '../workforce_ops';
import { executePlan } from './execute_plan';
import { resolveOrchestrationPlan } from './plan';
import { buildOrchestrationContext, shouldOrchestrate } from './plan_helpers';

/** Total wall-clock budget for the whole orchestration (plan + all steps). */
const ORCHESTRATION_BUDGET_MS = 90_000;

interface OrchestrationResult {
  orchestrated: boolean;
  primaryAgentSlug?: string;
  orchestrationContext?: string;
}

async function readOrchestrationMode(
  ctx: ActionCtx,
  orgSlug: string,
): Promise<'single' | 'orchestrate' | 'auto'> {
  try {
    const read: AgentReadResult = await ctx.runAction(
      internal.agents.internal_actions.readAgentInternal,
      { orgSlug, agentName: ROUTER_AGENT_SLUG },
    );
    if (read.ok) return read.config.routing?.orchestration ?? 'single';
  } catch (err) {
    console.warn(
      '[orchestration] router config read failed; orchestration off',
      err instanceof Error ? err.message : err,
    );
  }
  return 'single';
}

export const runRouterOrchestration = internalAction({
  args: {
    organizationId: v.string(),
    message: v.string(),
    parentThreadId: v.string(),
    userId: v.optional(v.string()),
    allowedAgentSlugs: v.optional(v.array(v.string())),
  },
  returns: v.object({
    orchestrated: v.boolean(),
    primaryAgentSlug: v.optional(v.string()),
    orchestrationContext: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<OrchestrationResult> => {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    const mode = await readOrchestrationMode(ctx, orgSlug);
    if (mode === 'single') return { orchestrated: false };

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listAgentsInternal returns v.any()
    const raw = (await ctx.runAction(
      internal.agents.internal_actions.listAgentsInternal,
      { orgSlug },
    )) as AgentListEntry[];
    let candidates = filterRoutingCandidates(raw, args.allowedAgentSlugs);
    if (candidates.length < 2) return { orchestrated: false };

    // Chart-aware shaping: budget-paused agents are not plannable (their
    // delegate steps would refuse at run time anyway), and managers are
    // annotated with their direct reports so the planner sees the org
    // structure. Both reads ride the 60s agent-list cache.
    try {
      const snapshots = await ctx.runQuery(
        internal.agents.guardrails.budget_guard.getWorkforceSnapshots,
        {
          organizationId: args.organizationId,
          agentSlugs: candidates.map((c) => c.name),
        },
      );
      const paused = new Set(
        snapshots.filter((s) => s.budgetPaused).map((s) => s.slug),
      );
      if (paused.size > 0) {
        candidates = candidates.filter((c) => !paused.has(c.name));
        if (candidates.length < 2) return { orchestrated: false };
      }
      const chart = buildChartFromRoster(await readWorkforceRoster(orgSlug));
      if (chart.parents.size > 0) {
        candidates = candidates.map((c) => {
          const reports = chart.reports.get(c.name) ?? [];
          if (reports.length === 0) return c;
          return {
            ...c,
            description: `${c.description ?? ''} [manager of: ${reports.join(', ')}]`,
          };
        });
      }
    } catch (error) {
      console.warn(
        '[orchestration] chart/guardrail shaping failed; planning with the raw candidate list',
        error instanceof Error ? error.message : error,
      );
    }

    // Zero-cost escalation gate.
    const domain = detectDomain(args.message);
    const difficulty = scoreDifficulty({
      kind: 'chat',
      promptText: args.message,
    });
    if (mode === 'auto') {
      const gate = shouldOrchestrate({
        domainScores: domain.scores,
        intensity: difficulty.intensity,
        questionCount: difficulty.features.questionCount,
        structure: difficulty.features.structure,
      });
      if (!gate.escalate) return { orchestrated: false };
    }

    const plan = await resolveOrchestrationPlan(ctx, {
      organizationId: args.organizationId,
      orgSlug,
      message: args.message,
      candidates,
      hints: {
        domain: domain.domain,
        complexity: classFromIntensity(difficulty.intensity),
      },
    });
    if (!plan || !plan.decompose) return { orchestrated: false };

    // Load each distinct step agent as a runnable delegate.
    const orgLocale = await ctx
      .runQuery(
        internal.organizations.internal_queries.getOrganizationDefaultLocale,
        { organizationId: args.organizationId },
      )
      .catch((err: unknown) => {
        console.warn(
          '[orchestration] org-locale lookup failed; using default',
          err instanceof Error ? err.message : err,
        );
        return undefined;
      });
    const distinctSlugs = [...new Set(plan.steps.map((s) => s.agentSlug))];
    const delegates = await loadDelegateAgents(
      ctx,
      distinctSlugs,
      args.organizationId,
      orgSlug,
      orgLocale ?? undefined,
    );
    const bySlug = new Map(delegates.map((d) => [d.agentSlug, d]));
    // If any step's agent failed to load, fall back to single-agent.
    if (distinctSlugs.some((s) => !bySlug.has(s))) {
      return { orchestrated: false };
    }

    const deadlineMs = Date.now() + ORCHESTRATION_BUDGET_MS;
    const { steps, deadlineHit } = await executePlan({
      steps: plan.steps,
      deadlineMs,
      runStep: async (slug, prompt) => {
        const delegate = bySlug.get(slug);
        if (!delegate) return { text: '', error: `unknown delegate ${slug}` };
        const res = await runDelegateStep(ctx, {
          parentThreadId: args.parentThreadId,
          organizationId: args.organizationId,
          userId: args.userId,
          delegate,
          prompt,
          deadlineMs,
          stripDelegation: true, // router owns decomposition; leaves just answer
        });
        return res.success
          ? { text: res.response }
          : { text: '', error: res.error ?? 'delegate failed' };
      },
    });

    // Observability (fire-and-forget): record the plan + per-step outcomes.
    void ctx
      .runMutation(internal.threads.internal_mutations.setLastOrchestration, {
        threadId: args.parentThreadId,
        primaryAgentSlug: plan.primaryAgentSlug,
        deadlineHit,
        steps: steps.map((s) => ({
          id: s.id,
          agentSlug: s.agentSlug,
          status: s.status,
        })),
        createdAt: Date.now(),
      })
      .catch((err: unknown) =>
        console.warn(
          '[orchestration] setLastOrchestration failed:',
          err instanceof Error ? err.message : err,
        ),
      );

    return {
      orchestrated: true,
      primaryAgentSlug: plan.primaryAgentSlug,
      orchestrationContext: buildOrchestrationContext(steps),
    };
  },
});
