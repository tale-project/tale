/**
 * Pure, dependency-free helpers for router-driven orchestration.
 *
 * Kept separate from the `'use node'` action modules (`plan.ts`,
 * `execute_plan.ts`) so they can be unit-tested without the Convex runtime —
 * the same split `auto_route_helpers.ts` uses for the single-agent router.
 *
 * The router decomposes a multi-domain / high-complexity message into an
 * ordered plan of sub-tasks, each routed to the best specialist agent. Agents
 * delegate poorly on their own, so the router owns decomposition instead.
 */

import { z } from 'zod/v4';

import { renderPrompt } from '../../lib/prompts/registry';
import { escapeForXmlTag } from '../../lib/untrusted_content';
import {
  type AgentListEntry,
  matchSlug,
  pickDefault,
  type RouterHints,
} from '../auto_route_helpers';

/** Hard ceiling on plan size — the runaway-decomposition guard. */
export const MAX_ORCHESTRATION_STEPS = 6;
/** Max steps that may run concurrently in one DAG level. */
export const MAX_PARALLEL_WIDTH = 4;

/** Intensity at/above which a multi-question or structured turn escalates. */
export const HIGH_COMPLEXITY_INTENSITY = 0.7;
/** Intensity at/above which an explicit multi-step turn escalates. */
export const MEDIUM_COMPLEXITY_INTENSITY = 0.45;
/** A domain must score at least this fraction of the top score to count as "strong". */
export const STRONG_DOMAIN_RATIO = 0.5;

/** Zero-cost signals the escalation gate reads before any planning LLM call. */
export interface OrchestrationSignals {
  /** Raw weighted score per domain from `detectDomain` (telemetry shape). */
  domainScores: Partial<Record<string, number>>;
  /** Continuous difficulty in [0,1] from `scoreDifficulty`. */
  intensity: number;
  /** Number of question marks in the message. */
  questionCount: number;
  /** Structure score in [0,1] (tables, enumeration, multi-step). */
  structure: number;
}

export interface EscalationDecision {
  escalate: boolean;
  reasons: string[];
}

/**
 * Count domains scoring within `STRONG_DOMAIN_RATIO` of the top domain — a
 * cheap proxy for "this message spans multiple specialties".
 */
export function countStrongDomains(
  domainScores: Partial<Record<string, number>>,
): number {
  const scores = Object.values(domainScores).filter(
    (s): s is number => s !== undefined && s > 0,
  );
  if (scores.length === 0) return 0;
  // All scores are > 0 here, so Math.max is > 0 — no extra zero-guard needed.
  const top = Math.max(...scores);
  return scores.filter((s) => s >= top * STRONG_DOMAIN_RATIO).length;
}

/**
 * Decide whether a turn warrants multi-agent orchestration, using only
 * already-computed zero-cost signals (no LLM call). Conservative by design: the
 * single-agent fast path must remain the common case.
 */
export function shouldOrchestrate(
  signals: OrchestrationSignals,
): EscalationDecision {
  const reasons: string[] = [];
  const strongDomains = countStrongDomains(signals.domainScores);
  const multiQuestion = signals.questionCount >= 2;
  const structured = signals.structure >= 0.5;

  if (strongDomains >= 2) reasons.push(`multi-domain(${strongDomains})`);
  if (
    signals.intensity >= HIGH_COMPLEXITY_INTENSITY &&
    (multiQuestion || structured)
  ) {
    reasons.push('high-complexity+structure');
  }
  if (
    signals.intensity >= MEDIUM_COMPLEXITY_INTENSITY &&
    structured &&
    multiQuestion
  ) {
    reasons.push('multi-step');
  }

  return { escalate: reasons.length > 0, reasons };
}

// --- Plan schema (structured output) ---

export const planStepSchema = z.object({
  id: z.string().min(1).max(16),
  agentSlug: z.string().min(1),
  subTask: z.string().min(1).max(2000),
  dependsOn: z.array(z.string()).max(MAX_ORCHESTRATION_STEPS).default([]),
});

export const orchestrationPlanSchema = z.object({
  decompose: z.boolean(),
  primaryAgentSlug: z.string().optional(),
  steps: z.array(planStepSchema).max(MAX_ORCHESTRATION_STEPS).default([]),
  rationale: z.string().max(500).optional(),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>;

export interface ValidatedPlan {
  /** True only when the plan survived validation with ≥2 distinct steps. */
  decompose: boolean;
  /** Slug that writes the final synthesized answer. */
  primaryAgentSlug: string;
  /** Topologically-orderable, slug-constrained, de-duped steps. */
  steps: PlanStep[];
}

/** Detect a cycle in the dependency graph via DFS. */
function hasCycle(steps: PlanStep[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 'done') return false;
    if (st === 'visiting') return true; // back-edge → cycle
    const step = byId.get(id);
    if (!step) return false;
    state.set(id, 'visiting');
    for (const dep of step.dependsOn) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    state.set(id, 'done');
    return false;
  };
  return steps.some((s) => visit(s.id));
}

/**
 * Constrain a raw model plan to the candidate roster and structural invariants.
 *
 * - Every `agentSlug` is resolved against the roster (`matchSlug`); unknown
 *   slugs fall back to the default candidate.
 * - `primaryAgentSlug` is resolved the same way (default when absent/unknown).
 * - Duplicate `(agentSlug, subTask)` steps collapse.
 * - `dependsOn` is filtered to ids that exist in the kept set.
 * - A cyclic graph, >1 distinct step shrinking to ≤1, or `decompose:false`
 *   yields `decompose:false` (caller falls back to single-agent routing).
 */
export function validatePlan(
  plan: OrchestrationPlan,
  candidates: AgentListEntry[],
): ValidatedPlan {
  const fallback = pickDefault(candidates)?.name ?? '';
  const primary =
    (plan.primaryAgentSlug && matchSlug(plan.primaryAgentSlug, candidates)) ||
    fallback;

  if (!plan.decompose) {
    return { decompose: false, primaryAgentSlug: primary, steps: [] };
  }

  // Resolve slugs, cap, and de-dupe by (slug, subTask) AND by step id. Unique
  // ids are load-bearing: the executor keys its result map by `step.id`, so a
  // duplicate id (the LLM can emit one) would silently overwrite a sibling's
  // result and corrupt dependency wiring.
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const kept: PlanStep[] = [];
  for (const step of plan.steps.slice(0, MAX_ORCHESTRATION_STEPS)) {
    const slug = matchSlug(step.agentSlug, candidates) ?? fallback;
    if (!slug) continue;
    if (seenIds.has(step.id)) continue;
    const dedupeKey = `${slug}::${step.subTask.trim()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    seenIds.add(step.id);
    kept.push({ ...step, agentSlug: slug });
  }

  // Filter dangling dependsOn references, then reject cycles.
  const ids = new Set(kept.map((s) => s.id));
  for (const step of kept) {
    step.dependsOn = step.dependsOn.filter((d) => ids.has(d) && d !== step.id);
  }

  if (kept.length <= 1 || hasCycle(kept)) {
    return { decompose: false, primaryAgentSlug: primary, steps: [] };
  }

  return { decompose: true, primaryAgentSlug: primary, steps: kept };
}

/**
 * Topologically layer the plan: steps with no unmet dependency form level 0,
 * their dependents level 1, etc. Steps within a level are independent and may
 * run in parallel. Assumes an acyclic graph (guaranteed by `validatePlan`).
 */
export function layerPlan(steps: PlanStep[]): PlanStep[][] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const levelOf = new Map<string, number>();
  const compute = (id: string, stack: Set<string>): number => {
    const cached = levelOf.get(id);
    if (cached !== undefined) return cached;
    const step = byId.get(id);
    if (!step || step.dependsOn.length === 0) {
      levelOf.set(id, 0);
      return 0;
    }
    stack.add(id);
    let max = 0;
    for (const dep of step.dependsOn) {
      if (stack.has(dep)) continue; // defensive: ignore residual cycles
      max = Math.max(max, compute(dep, stack) + 1);
    }
    stack.delete(id);
    levelOf.set(id, max);
    return max;
  };
  for (const s of steps) compute(s.id, new Set());

  const levels: PlanStep[][] = [];
  for (const s of steps) {
    const lvl = levelOf.get(s.id) ?? 0;
    (levels[lvl] ??= []).push(s);
  }
  return levels.filter((l) => l && l.length > 0);
}

/** Build the planner system prompt (fixed scaffold from the registry + roster). */
export function buildPlannerInstructions(
  candidates: AgentListEntry[],
  defaultSlug: string,
  hints?: RouterHints,
): string {
  const lines = candidates.map((a) => {
    const desc = (a.description ?? '').trim() || 'General-purpose assistant.';
    const tools =
      a.toolNames && a.toolNames.length > 0
        ? ` | tools: ${a.toolNames.slice(0, 8).join(', ')}`
        : '';
    return `- ${a.name}: ${desc}${tools}`;
  });

  const hintParts: string[] = [];
  if (hints?.domain && hints.domain !== 'general') {
    hintParts.push(`domain: ${hints.domain}`);
  }
  if (hints?.complexity) hintParts.push(`complexity: ${hints.complexity}`);
  const hintBlock =
    hintParts.length > 0
      ? `\n\nDetected signals (advisory): ${hintParts.join(', ')}.`
      : '';

  const header = renderPrompt('orchestrator.planner.header');
  const footer = renderPrompt('orchestrator.planner.footer', {
    defaultSlug,
    maxSteps: String(MAX_ORCHESTRATION_STEPS),
  });
  return `${header}
${lines.join('\n')}${hintBlock}

${footer}`;
}

/** A delegate step's outcome, as fed to dependents and the synthesizer. */
export interface StepResult {
  id: string;
  agentSlug: string;
  subTask: string;
  status: 'ok' | 'error' | 'skipped';
  response: string;
  error?: string;
}

const MAX_DEP_CONTEXT_CHARS = 4000;

/**
 * Build a delegate step's prompt: its sub-task plus a capped context block of
 * its dependencies' outputs (or a failure note when a dependency failed). A
 * dependency's output is model-generated and may have folded in untrusted web
 * content, so it's escaped against the wrapping `<prior_step>` tag — it can't
 * inject a closing tag and break out of the context block.
 */
export function buildStepPrompt(
  subTask: string,
  depResults: StepResult[],
): string {
  if (depResults.length === 0) return subTask;
  const blocks = depResults.map((dep) => {
    if (dep.status === 'ok') {
      const body = escapeForXmlTag(
        dep.response.slice(0, MAX_DEP_CONTEXT_CHARS),
        'prior_step',
      );
      return `<prior_step agent="${dep.agentSlug}">\n${body}\n</prior_step>`;
    }
    const note = escapeForXmlTag(dep.error ?? 'no output', 'prior_step');
    return `<prior_step agent="${dep.agentSlug}" status="failed">\n${note}\n</prior_step>`;
  });
  return `${subTask}

Context from earlier steps (use as input; do not repeat verbatim):
${blocks.join('\n')}`;
}

/** Render step results as `<step agent=…>Task/Result</step>` blocks. The
 *  sub-task and model-generated result are escaped against BOTH the inner
 *  `<step>` wrapper and the outer `<orchestration_results>` wrapper they nest
 *  in, so a step's output can't emit either closing tag and break the framing
 *  the synthesizer relies on. */
function formatStepResults(steps: StepResult[]): string {
  const escape = (value: string) =>
    escapeForXmlTag(escapeForXmlTag(value, 'step'), 'orchestration_results');
  return steps
    .map((s) => {
      const status = s.status === 'ok' ? '' : ` status="${s.status}"`;
      const body = escape(
        s.status === 'ok' ? s.response : (s.error ?? 'no output'),
      );
      return `<step agent="${s.agentSlug}"${status}>\nTask: ${escape(s.subTask)}\nResult: ${body}\n</step>`;
    })
    .join('\n');
}

/**
 * Build the orchestration-results block + synthesis directive for injection via
 * `additionalContext` (the original user message stays the saved user turn).
 * The primary agent reads this as structured context and synthesizes.
 */
export function buildOrchestrationContext(steps: StepResult[]): string {
  return `Specialist sub-results were gathered to help answer the user's message. Synthesize them into a single coherent reply. Do not mention this orchestration or the individual steps; just give the answer.

<orchestration_results>
${formatStepResults(steps)}
</orchestration_results>`;
}
