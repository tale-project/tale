/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * ADDITIONAL frozen dependency (not one of the modules the task enumerated
 * up front): `legacy/frozen/agents_file_utils.ts`'s `parseAgentJson` /
 * `serializeAgentJson` need the FULL `agentJsonSchema` (not just the hand-
 * written `AgentJsonConfig` type) to validate/canonicalize a real org agent
 * JSON file byte-identically to the retired
 * `lib/shared/schemas/agents.ts`, so that whole schema
 * is frozen here rather than inlined into `agents_file_utils.ts` (kept as its
 * own file — it is ~200 lines of schema + business-rule `superRefine` — for
 * the same reason the task calls out separate `schemas_*` modules elsewhere).
 *
 * Two dependency substitutions from the original:
 *  - `isValidModelRef` (`lib/shared/utils/model-ref.ts`) is STILL LIVE (not
 *    part of the ripout) — imported directly, unchanged.
 *  - `SKILL_NAME_REGEX` (`lib/shared/schemas/skills.ts`) retired with the
 *    skills domain — inlined below verbatim (a single regex constant) rather
 *    than freezing a whole sibling module for it.
 */

import { z } from 'zod/v4';

import { isValidModelRef } from '../../../lib/shared/utils/model-ref';

// -----------------------------------------------------------------------------
// retired lib/shared/schemas/skills.ts (only
// SKILL_NAME_REGEX is needed here, for `skillBindings` below).
// -----------------------------------------------------------------------------
const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Hard cap on the number of skill slugs a single agent may list in
 * `skillBindings`.
 */
export const MAX_SKILL_BINDINGS_PER_AGENT = 10;

/**
 * Platform tools an `external-agent` may carry in `toolNames` — the sandbox
 * workspace-tool bridge subset.
 */
export const EXTERNAL_AGENT_TOOL_NAMES = [
  'rag_search',
  'document_find',
  'document_retrieve',
  'document_write',
] as const;

const retrievalModeLiterals = ['off', 'tool', 'context', 'both'] as const;
const retrievalModeSchema = z.enum(retrievalModeLiterals);

const primaryBehaviorLiterals = [
  'chat',
  'image-generation',
  'external-agent',
] as const;
const primaryBehaviorSchema = z.enum(primaryBehaviorLiterals);

// Which external agent runtime handles an `external-agent` turn.
const agentKindLiterals = [
  'claude-code',
  'cursor',
  'opencode',
  'hermes',
  'gemini',
  'codex',
  'pi',
  'openclaw',
] as const;
const agentKindSchema = z.enum(agentKindLiterals);

const composerModeSchema = z.object({
  label: z.string().min(1).max(80),
  icon: z.string().max(80).optional(),
  tooltip: z.string().max(300).optional(),
  order: z.number().int().optional(),
});

/**
 * Per-agent routing/cascade behaviour (opt-in; defaults preserve today's
 * config-order model selection with no cascade).
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
   */
  orchestration: z.enum(['single', 'orchestrate', 'auto']).optional(),
  /** Per-agent override of the plan step cap (1–6). */
  maxOrchestrationSteps: z.number().int().min(1).max(6).optional(),
});

export type AgentRoutingConfig = z.infer<typeof agentRoutingSchema>;

/**
 * Canonical agent slug — a flat, file-location-INDEPENDENT identity stored in
 * the config itself.
 */
const AGENT_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Install/catalog/cascade metadata.
 */
const agentMetadataSchema = z.object({
  autoInstall: z.boolean().optional(),
  templateCatalog: z.boolean().optional(),
  labels: z.array(z.string().min(1).max(80)).max(12).optional(),
  requires: z
    .object({
      integrations: z.array(z.string().min(1)).optional(),
      env: z
        .array(
          z.object({
            key: z.string().min(1).max(128),
            secret: z.boolean().optional(),
            description: z.string().max(300).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  bundledByIntegration: z.string().min(1).max(80).optional(),
});

export type AgentMetadata = z.infer<typeof agentMetadataSchema>;

/**
 * Fields that can be overridden per locale via the i18n key.
 */
const translatableFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  conversationStarters: z.array(z.string().max(200)).max(4).optional(),
  systemInstructions: z.string().max(20_000).optional(),
});

/**
 * Schema for the agent JSON file format. Matches the `AgentJsonConfig` type
 * in `legacy/frozen/agents_file_utils.ts`.
 */
export const agentJsonSchema = z
  .object({
    slug: z.string().min(1).max(64).regex(AGENT_SLUG_REGEX).optional(),
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    avatarUrl: z.string().url().optional(),
    primaryBehavior: primaryBehaviorSchema.optional(),
    agentKind: agentKindSchema.optional(),
    authMode: z.enum(['managed', 'byo']).optional(),
    nativeWebTools: z.boolean().optional(),
    visionModel: z
      .string()
      .min(1)
      .refine(isValidModelRef, {
        message: 'Invalid model ref (expected "[provider:]model-id")',
      })
      .optional(),
    systemInstructions: z.string().optional(),
    toolNames: z.array(z.string()).optional(),
    integrationBindings: z.array(z.string().min(1)).optional(),
    workflows: z.array(z.string()).optional(),
    skillBindings: z
      .array(z.string().min(1).max(64).regex(SKILL_NAME_REGEX))
      .max(MAX_SKILL_BINDINGS_PER_AGENT)
      .optional(),
    // At least one model is required for every agent EXCEPT a BYO external
    // agent (its model is an optional raw passthrough — empty means "use the
    // credential's default"). The ≥1 rule is enforced conditionally in the
    // superRefine below rather than as a field-level `.min(1)`.
    supportedModels: z
      .array(
        z.string().min(1).refine(isValidModelRef, {
          message: 'Invalid model ref (expected "[provider:]model-id")',
        }),
      )
      // Defaults to [] when absent so a BYO agent file with no model still
      // parses; the superRefine below enforces ≥1 for every non-BYO agent.
      .default([]),
    provider: z.string().min(1).max(100).regex(AGENT_SLUG_REGEX).optional(),
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
     */
    maxIntegrationCallsPerRun: z.number().int().min(1).max(500).optional(),
    composerMode: composerModeSchema.optional(),
    /** Per-agent routing / cascade behaviour; see `agentRoutingSchema`. */
    routing: agentRoutingSchema.optional(),
    roleRestriction: z.literal('admin_developer').optional(),
    conversationStarters: z.array(z.string().max(200)).max(4).optional(),
    visibleInChat: z.boolean().optional(),
    /**
     * Monthly spend guardrail (Paperclip-style).
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
     * = unlimited.
     */
    maxConcurrentTasks: z.number().int().min(1).max(50).optional(),
    /**
     * External runtime binding (tale-daemon): task runs for this agent are
     * dispatched to a coding-agent CLI on a registered daemon instead of
     * the internal LLM loop.
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
     * Opt-in: run this agent's task runs (`run_on_task`) as a DURABLE sandbox
     * step instead of the inline LLM loop.
     */
    preferDurableStepForTasks: z.boolean().optional(),
    /**
     * Per-agent personalization toggle. 'off' suppresses user memory and
     * customInstructions injection AND strips the propose_memory tool.
     */
    personalizationMode: z.enum(['on', 'off']).optional(),
    /**
     * Marks the system "Auto" router agent.
     */
    isRouter: z.boolean().optional(),
    /**
     * When explicitly `false`, the agent is system-managed and cannot be
     * created/edited/deleted through the UI.
     */
    uiConfigurable: z.boolean().optional(),
    i18n: z
      .record(
        z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        translatableFieldsSchema,
      )
      .optional(),
    /** Install / catalog / cascade metadata; see {@link agentMetadataSchema}. */
    metadata: agentMetadataSchema.optional(),
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

    // image-generation and external-agent both bypass the platform tool loop,
    // so the loop-only fields are meaningless for them — with two exceptions,
    // both dispatched from inside the container over the sandbox MCP bridge:
    // an external-agent reuses `integrationBindings` as the integration-bridge
    // grant set, and `toolNames` as the workspace-tool grant set (restricted
    // to EXTERNAL_AGENT_TOOL_NAMES below — loop-coupled registry tools cannot
    // run without the loop). `workflows` remains loop-only for both.
    if (
      data.primaryBehavior === 'image-generation' ||
      data.primaryBehavior === 'external-agent'
    ) {
      const disallowed: Array<keyof typeof data> =
        data.primaryBehavior === 'external-agent'
          ? ['workflows']
          : ['toolNames', 'integrationBindings', 'workflows'];
      for (const key of disallowed) {
        const value = data[key];
        if (Array.isArray(value) && value.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is not supported when primaryBehavior is "${data.primaryBehavior}" — the agent bypasses the platform tool loop.`,
          });
        }
      }
    }

    // An external-agent's `toolNames` is the sandbox workspace-tool grant
    // set; only the bridgeable subset is valid.
    if (
      data.primaryBehavior === 'external-agent' &&
      Array.isArray(data.toolNames)
    ) {
      const invalid = data.toolNames.filter(
        (name) =>
          !(EXTERNAL_AGENT_TOOL_NAMES as readonly string[]).includes(name),
      );
      if (invalid.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['toolNames'],
          message:
            `not available to an external agent: ${invalid.join(', ')} — ` +
            `the sandbox bridge supports only ` +
            `${EXTERNAL_AGENT_TOOL_NAMES.join(', ')} (loop-coupled tools ` +
            'cannot run outside the platform tool loop).',
        });
      }
    }

    // agentKind only applies to external-agent.
    if (
      data.agentKind !== undefined &&
      data.primaryBehavior !== 'external-agent'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['agentKind'],
        message:
          'agentKind is only valid when primaryBehavior is "external-agent".',
      });
    }

    // authMode only applies to external-agent.
    if (
      data.authMode !== undefined &&
      data.primaryBehavior !== 'external-agent'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authMode'],
        message:
          'authMode is only valid when primaryBehavior is "external-agent".',
      });
    }

    // Cursor runs BYO only.
    if (
      data.primaryBehavior === 'external-agent' &&
      data.agentKind === 'cursor' &&
      data.authMode !== 'byo'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authMode'],
        message:
          'Cursor supports BYO only — set authMode to "byo". The Cursor CLI cannot route through the platform gateway (no OpenAI-compatible base-URL override), so managed mode is unavailable.',
      });
    }

    // OpenCode runs managed-only.
    if (
      data.primaryBehavior === 'external-agent' &&
      data.agentKind === 'opencode' &&
      data.authMode === 'byo'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authMode'],
        message:
          'OpenCode supports managed mode only — authMode "byo" is not supported. OpenCode authenticates through the platform gateway with a session virtual key.',
      });
    }

    // nativeWebTools only applies to external-agent.
    if (
      data.nativeWebTools !== undefined &&
      data.primaryBehavior !== 'external-agent'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['nativeWebTools'],
        message:
          'nativeWebTools is only valid when primaryBehavior is "external-agent".',
      });
    }

    // visionModel only applies to external-agent (the managed vision polyfill).
    if (
      data.visionModel !== undefined &&
      data.primaryBehavior !== 'external-agent'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['visionModel'],
        message:
          'visionModel is only valid when primaryBehavior is "external-agent".',
      });
    }

    // `preferDurableStepForTasks` (durable sandbox dispatch) and `runtime`
    // (external daemon dispatch) are two different task-run dispatch paths —
    // an agent picks at most one.
    if (data.preferDurableStepForTasks === true && data.runtime !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['preferDurableStepForTasks'],
        message:
          'preferDurableStepForTasks cannot be combined with runtime — they are two different task-run dispatch paths; choose one.',
      });
    }

    // Every agent needs at least one model — EXCEPT a BYO external agent (optional
    // raw passthrough), Cursor (env-managed runtime; models are optional hints),
    // or gateway-managed Claude Code (dynamic governance/platform defaults).
    const isGatewayManagedClaudeCode =
      data.primaryBehavior === 'external-agent' &&
      data.authMode === 'managed' &&
      (data.agentKind === undefined || data.agentKind === 'claude-code');
    const isOptionalModelExternal =
      data.primaryBehavior === 'external-agent' &&
      (data.authMode === 'byo' ||
        data.agentKind === 'cursor' ||
        isGatewayManagedClaudeCode);
    if (!isOptionalModelExternal && data.supportedModels.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['supportedModels'],
        message: 'At least one model is required.',
      });
    }
  });
