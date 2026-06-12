import { z } from 'zod/v4';

import { isValidModelRef } from '../utils/model-ref';
import { SKILL_NAME_REGEX } from './skills';

/**
 * Hard cap on the number of skill slugs a single agent may list in
 * `skillBindings`. Shared so the UI counter and the schema validator
 * cannot drift.
 */
export const MAX_SKILL_BINDINGS_PER_AGENT = 10;

/**
 * Canonical shape of one entry in an agent's `skillBindingsResolved`
 * array — the trusted snapshot the runtime reads at chat-turn start to
 * decide which tools / integrations / workflows a bound skill grants.
 *
 * A trust-boundary type consumed at several sites (Convex validator, the
 * runtime types, `agents/file_utils.ts`); sharing one schema makes drift a
 * build-time error instead of a runtime one.
 */
export const skillBindingResolvedEntrySchema = z.object({
  slug: z.string().min(1).max(64).regex(SKILL_NAME_REGEX),
  versionHash: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'versionHash must be a lowercase sha256 hex digest',
  }),
  toolNames: z.array(z.string().min(1)).default([]),
  integrationBindings: z.array(z.string().min(1)).default([]),
  workflowBindings: z.array(z.string().min(1)).default([]),
});

export type SkillBindingResolvedEntry = z.infer<
  typeof skillBindingResolvedEntrySchema
>;

const retrievalModeLiterals = ['off', 'tool', 'context', 'both'] as const;
type RetrievalMode = (typeof retrievalModeLiterals)[number];

export function isRetrievalMode(value: string): value is RetrievalMode {
  return retrievalModeLiterals.some((mode) => mode === value);
}

const retrievalModeSchema = z.enum(retrievalModeLiterals);

const primaryBehaviorLiterals = ['chat', 'image-generation'] as const;
const primaryBehaviorSchema = z.enum(primaryBehaviorLiterals);

const composerModeSchema = z.object({
  label: z.string().min(1).max(80),
  icon: z.string().max(80).optional(),
  tooltip: z.string().max(300).optional(),
  order: z.number().int().optional(),
});

/**
 * Per-agent "response tuning" — the agent-author home for what was previously
 * the per-message composer menu. Every field is optional; absence (or
 * `adaptive`) leaves the Adaptive Reasoning Governor fully in charge, so an
 * agent without this block behaves exactly as before.
 *
 *  - `effort` (fixed tier) BYPASSES the adaptive controller for that turn.
 *  - `effortFloor`/`effortCeiling` keep adaptivity but BOUND it.
 *  - `verbosity`/`style` append a system-prompt fragment.
 *  - `qualityProfile` selects the quality-feedback thresholds + controller
 *    deadband preset (`lenient`/`balanced`/`strict`).
 *
 * The settings UI surfaces the common knobs above. `budgetCaps` (per-class
 * hard cap on the thinking-token budget) and `temperatureRange` (override the
 * governor's temperature band) are advanced, JSON-only knobs — kept in the
 * schema for power users editing the agent config directly, but deliberately
 * left out of the UI to keep it simple.
 */
const EFFORT_TIER_RANK: Record<'off' | 'low' | 'medium' | 'high', number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const effortTierEnum = z.enum(['off', 'low', 'medium', 'high']);
export const responseTuningSchema = z
  .object({
    effort: z.enum(['adaptive', 'low', 'medium', 'high']).optional(),
    creativity: z
      .enum(['adaptive', 'precise', 'balanced', 'creative'])
      .optional(),
    style: z
      .enum(['adaptive', 'concise', 'detailed', 'formal', 'friendly'])
      .optional(),
    effortFloor: effortTierEnum.optional(),
    effortCeiling: effortTierEnum.optional(),
    budgetCaps: z
      .object({
        easy: z.number().int().min(256).max(32768).optional(),
        medium: z.number().int().min(256).max(32768).optional(),
        hard: z.number().int().min(256).max(32768).optional(),
      })
      .optional(),
    temperatureRange: z
      .object({
        min: z.number().min(0).max(2).optional(),
        max: z.number().min(0).max(2).optional(),
      })
      .refine((r) => r.min == null || r.max == null || r.min <= r.max, {
        message: 'temperatureRange.min must be ≤ temperatureRange.max',
      })
      .optional(),
    verbosity: z.enum(['adaptive', 'terse', 'normal', 'verbose']).optional(),
    qualityProfile: z.enum(['lenient', 'balanced', 'strict']).optional(),
  })
  .refine(
    (t) =>
      t.effortFloor == null ||
      t.effortCeiling == null ||
      EFFORT_TIER_RANK[t.effortFloor] <= EFFORT_TIER_RANK[t.effortCeiling],
    { message: 'effortFloor must be ≤ effortCeiling', path: ['effortFloor'] },
  );

export type ResponseTuningConfig = z.infer<typeof responseTuningSchema>;

/**
 * Per-agent routing/cascade behaviour (opt-in; defaults preserve today's
 * config-order model selection with no cascade).
 *
 *  - `modelSelection: 'auto'` picks the model TIER per turn from the turn's
 *    complexity + domain among the agent's `supportedModels` (cheap for easy
 *    turns, frontier for hard / high-stakes). `'config'` (default) uses the
 *    listed order.
 *  - `cascade: true` enables speculative cascade on non-streaming generations
 *    (cheap draft → quality-validate → escalate to a stronger model only when
 *    the draft fails). `cascadeDraftModel` optionally pins the drafter.
 */
export const agentRoutingSchema = z.object({
  modelSelection: z.enum(['config', 'auto']).optional(),
  cascade: z.boolean().optional(),
  cascadeDraftModel: z
    .string()
    .min(1)
    .refine(isValidModelRef, {
      message: 'Invalid model ref (expected "[provider:]model-id")',
    })
    .optional(),
  /**
   * Router-driven delegation mode (set on the `router` agent for org policy).
   *  - `'single'` (default): pick ONE agent; that agent self-delegates via
   *    tools. Today's behavior — backward compatible.
   *  - `'orchestrate'`: always attempt to decompose into a multi-agent plan.
   *  - `'auto'`: decompose only when the zero-cost escalation gate fires
   *    (multi-domain / high-complexity); otherwise behave as `'single'`.
   * Decomposition always degrades to single-agent on failure/timeout.
   */
  orchestration: z.enum(['single', 'orchestrate', 'auto']).optional(),
  /** Per-agent override of the plan step cap (1–6). */
  maxOrchestrationSteps: z.number().int().min(1).max(6).optional(),
});

export type AgentRoutingConfig = z.infer<typeof agentRoutingSchema>;

/**
 * Fields that can be overridden per locale via the i18n key.
 *
 * Canonical location for translatable fields under the i18n-first data model.
 * Top-level translatable fields on `agentJsonSchema` remain only as a legacy
 * fallback for agents authored before this model.
 */
const translatableFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  conversationStarters: z.array(z.string().max(200)).max(4).optional(),
  systemInstructions: z.string().max(20_000).optional(),
});

/**
 * Schema for the agent JSON file format.
 * Matches the AgentJsonConfig type in convex/agents/file_utils.ts.
 *
 * i18n-first: translatable fields live under `i18n.<locale>.*`. The top-level
 * translatable fields (`displayName`, `description`, `conversationStarters`,
 * `systemInstructions`) are legacy fallbacks — the superRefine below requires
 * the relevant ones to exist in *some* locale (top-level or any i18n entry).
 */
export const agentJsonSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    avatarUrl: z.string().url().optional(),
    /**
     * Root behavior this agent runs. Omitted = 'chat' (default tool-calling chat
     * loop). When set to 'image-generation', the user message is routed straight
     * to an image model; toolNames/integrationBindings/workflows are ignored.
     */
    primaryBehavior: primaryBehaviorSchema.optional(),
    systemInstructions: z.string().optional(),
    toolNames: z.array(z.string()).optional(),
    integrationBindings: z.array(z.string()).optional(),
    workflows: z.array(z.string()).optional(),
    skillBindings: z
      .array(z.string().min(1).max(64).regex(SKILL_NAME_REGEX))
      .max(MAX_SKILL_BINDINGS_PER_AGENT)
      .optional(),
    skillBindingsResolved: z
      .array(skillBindingResolvedEntrySchema)
      .max(MAX_SKILL_BINDINGS_PER_AGENT)
      .optional(),
    supportedModels: z
      .array(
        z.string().min(1).refine(isValidModelRef, {
          message: 'Invalid model ref (expected "[provider:]model-id")',
        }),
      )
      .min(1),
    provider: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
    knowledgeMode: retrievalModeSchema.optional(),
    webSearchMode: retrievalModeSchema.optional(),
    includeOrgKnowledge: z.boolean().optional(),
    includeTeamKnowledge: z.boolean().optional(),
    knowledgeTopK: z.number().int().min(1).max(50).optional(),
    structuredResponsesEnabled: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().min(1000).optional(),
    outputReserve: z.number().int().optional(),
    /**
     * Max number of integration tool calls allowed for a single agent run.
     * Enforced at the integration-tool wrapper. Agents that cannot call
     * integrations should leave this unset.
     */
    maxIntegrationCallsPerRun: z.number().int().min(1).max(500).optional(),
    composerMode: composerModeSchema.optional(),
    /** Per-agent response tuning; see `responseTuningSchema`. */
    responseTuning: responseTuningSchema.optional(),
    /** Per-agent routing / cascade behaviour; see `agentRoutingSchema`. */
    routing: agentRoutingSchema.optional(),
    roleRestriction: z.literal('admin_developer').optional(),
    conversationStarters: z.array(z.string().max(200)).max(4).optional(),
    visibleInChat: z.boolean().optional(),
    /**
     * Organigram delegation edges: the slugs of the agents THIS agent
     * delegates to (its direct reports). Many-to-many — an agent may be
     * delegated to by several agents, and delegate to many; the only
     * forbidden edge is a self-edge (cycles are allowed). Shape-only
     * validation here — existence is enforced at write time and degrades
     * gracefully at read time (dangling targets dropped + warning). The
     * organigram canvas/assistant are the single write paths.
     */
    delegates: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9_-]*$/),
      )
      .max(100)
      .optional(),
    /**
     * Legacy single-manager reporting line (slug of this agent's manager).
     * Superseded by `delegates` (the inverse edge); still read so
     * pre-migration configs keep rendering, and migrated away on the next
     * organigram write that touches this agent.
     */
    reportsTo: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
    /**
     * Monthly spend guardrail (Paperclip-style). Month-to-date spend comes
     * from the usageLedger per agentSlug; at `warnPct` the agent gets an
     * economy instruction injected and admins are notified once; at
     * `pausePct` new runs are refused and queued work is reassigned by the
     * budget-reassign automation. Resets at the calendar-month rollover.
     */
    budget: z
      .object({
        monthlyCents: z.number().int().positive().max(100_000_000),
        warnPct: z.number().int().min(1).max(100).optional(),
        pausePct: z.number().int().min(1).max(200).optional(),
      })
      .refine((b) => (b.warnPct ?? 80) <= (b.pausePct ?? 100), {
        message: 'warnPct must be ≤ pausePct',
      })
      .optional(),
    /**
     * Max concurrent task runs for this agent (internal + external). Omitted
     * falls back to the org `agent_workforce` policy default; both absent =
     * unlimited. Enforced at run admission (`startTaskAgentRun`) and at
     * external-run claim time — never on interactive chat turns.
     */
    maxConcurrentTasks: z.number().int().min(1).max(50).optional(),
    /**
     * External runtime binding (tale-daemon): task runs for this agent are
     * dispatched to a coding-agent CLI on a registered daemon instead of
     * the internal LLM loop. `permissionMode` is a SERVER-SIDE CEILING —
     * the effective mode is min(daemon-local, this); 'full_auto' therefore
     * requires double opt-in. Chat/delegation always stay internal.
     */
    runtime: z
      .object({
        adapterType: z
          .string()
          .min(1)
          .max(32)
          .regex(/^[a-z0-9][a-z0-9_]*$/),
        daemonId: z.string().min(1).max(128).optional(),
        permissionMode: z
          .enum(['safe', 'auto_edits', 'full_auto'])
          .default('safe'),
        workspaceKey: z.string().min(1).max(128).optional(),
      })
      .optional(),
    /**
     * Per-agent personalization toggle. 'off' suppresses user memory and
     * customInstructions injection AND strips the propose_memory tool.
     * Use 'off' for agents whose outputs have legal/significant effects
     * (GDPR Art 22 / EU AI Act high-risk use cases) — admin assistants,
     * compliance bots, etc. Default 'on'.
     */
    personalizationMode: z.enum(['on', 'off']).optional(),
    /**
     * Marks the system "Auto" router agent. When true, the agent's effective
     * instructions are generated at route time from `buildRouterInstructions`
     * (the static `systemInstructions` is unused), and the agent is used by
     * `resolveAutoRoute` purely to pick which other agent answers — it never
     * answers a user turn itself. There should be exactly one router agent.
     */
    isRouter: z.boolean().optional(),
    /**
     * When explicitly `false`, the agent is system-managed and cannot be
     * created/edited/deleted through the UI (the settings editor hides it and
     * `saveAgent` rejects writes to it). Used for the router. Omitted/`true`
     * means a normal, user-configurable agent.
     */
    uiConfigurable: z.boolean().optional(),
    i18n: z
      .record(
        z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        translatableFieldsSchema,
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    const i18nLocales = Object.values(data.i18n ?? {});

    // displayName must exist at top-level or in at least one locale override.
    const hasDisplayName =
      !!data.displayName ||
      i18nLocales.some((v) => v.displayName && v.displayName.length > 0);
    if (!hasDisplayName) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message:
          'displayName must be set at top-level or in at least one i18n locale',
      });
    }

    // Chat agents require systemInstructions in some locale (top-level or
    // i18n) — EXCEPT the router, whose instructions are generated per-request
    // from the candidate agents (`buildRouterInstructions`).
    if ((data.primaryBehavior ?? 'chat') === 'chat' && data.isRouter !== true) {
      const hasInstructions =
        (data.systemInstructions != null &&
          data.systemInstructions.length > 0) ||
        i18nLocales.some(
          (v) => v.systemInstructions && v.systemInstructions.length > 0,
        );
      if (!hasInstructions) {
        ctx.addIssue({
          code: 'custom',
          path: ['systemInstructions'],
          message:
            'systemInstructions is required for chat agents at top-level or in at least one i18n locale',
        });
      }
    }

    // `skillBindings` is the agent's hard allowlist of skill slugs. An empty
    // or absent list means the agent has zero skills available — there is no
    // implicit "all org skills" fallback. Cross-reference to actual org skills
    // is left to runtime (a stale slug is silently dropped from the snapshot),
    // so an operator can list a skill that will be uploaded later without
    // tripping schema validation.
    //
    // `skillBindingsResolved` is a legacy snapshot from the old transitive
    // tool-grant model and is no longer read at runtime; it remains optional
    // for back-compat reading of historical agent JSON.

    // Image-generation agents have no tool loop — these fields are meaningless.
    if (data.primaryBehavior === 'image-generation') {
      const disallowed: Array<keyof typeof data> = [
        'toolNames',
        'integrationBindings',
        'workflows',
      ];
      for (const key of disallowed) {
        const value = data[key];
        if (Array.isArray(value) && value.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${String(key)} is not supported when primaryBehavior is "image-generation" — the agent bypasses the tool loop.`,
          });
        }
      }
    }
  });
