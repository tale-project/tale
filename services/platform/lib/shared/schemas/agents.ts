import { z } from 'zod/v4';

import { isValidModelRef } from '../utils/model-ref';
import { SKILL_NAME_REGEX } from './skills';

/**
 * Hard cap on the number of skill slugs a single agent may list in
 * `skillBindings`. Shared so the UI counter and the schema validator
 * cannot drift.
 */
export const MAX_SKILL_BINDINGS_PER_AGENT = 10;

const retrievalModeLiterals = ['off', 'tool', 'context', 'both'] as const;
type RetrievalMode = (typeof retrievalModeLiterals)[number];

export function isRetrievalMode(value: string): value is RetrievalMode {
  return retrievalModeLiterals.some((mode) => mode === value);
}

const retrievalModeSchema = z.enum(retrievalModeLiterals);

const primaryBehaviorLiterals = [
  'chat',
  'image-generation',
  'external-agent',
] as const;
const primaryBehaviorSchema = z.enum(primaryBehaviorLiterals);

// Which external agent runtime handles an `external-agent` turn. The turn runs
// in a sandbox session driven by @/lib/agent-adapters; the platform never runs
// its own tool loop for these.
const agentKindLiterals = ['claude-code', 'cursor', 'hermes', 'codex'] as const;
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
 * Canonical agent slug — a flat, file-location-INDEPENDENT identity stored in
 * the config itself (the `slug` field below). Because identity lives in the
 * file rather than the path, an agent file can be moved between folders
 * (`chat/` → `workforce/`) or renamed without breaking delegates, mentions,
 * installations, or thread references. Folders are organizational only; the
 * slug stays a flat single segment (no `/`), so routes need no URL-encoding.
 * Reserved slugs (`auto`, `organigram`) still apply.
 */
const AGENT_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Install/catalog/cascade metadata. Brings agents to parity with workflows and
 * prompts (which already carry `metadata.autoInstall`). All optional — an agent
 * file with no `metadata` behaves exactly as before.
 *
 *  - `autoInstall`     — seed an enabled installation row into every org at
 *                        creation (the workforce default-on set).
 *  - `templateCatalog` — visible in the agent catalog UI (default true);
 *                        `false` hides integration-bundled agents.
 *  - `labels`          — catalog tags (e.g. ["Engineering", "Security"]). The
 *                        FIRST label is the catalog section (department); the
 *                        rest are filter tags. Decoupled from the on-disk
 *                        folder so system agents keep stable flat slugs.
 *  - `requires.integrations` — HARD dependency: the agent is cascade-disabled
 *                        when any listed integration is not connected.
 *  - `requires.env`          — env/secret keys the agent needs set (chiefly a
 *                        BYO external agent's own credential); drives the app
 *                        install wizard's secrets step + readiness checklist.
 *  - `bundledByIntegration`  — the integration whose connection installs this
 *                        agent (provenance also tracked on the install row).
 */
const agentMetadataSchema = z.object({
  autoInstall: z.boolean().optional(),
  templateCatalog: z.boolean().optional(),
  labels: z.array(z.string().min(1).max(80)).max(12).optional(),
  requires: z
    .object({
      integrations: z.array(z.string().min(1)).optional(),
      // Env / secret keys the agent needs set before it can run — chiefly a BYO
      // external agent bringing its own credential. Declared so the app-install
      // wizard can collect them and the readiness checklist can flag missing
      // ones (the values live in the per-agent `agentEnv` store, never here).
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
    /**
     * Canonical, file-location-independent identity. Stored in the config so
     * moving the file between folders or renaming it never breaks
     * delegates/mentions/installations/thread refs. When absent, the loader
     * falls back to the file basename (backward compat for legacy flat files).
     * Must be unique across the org's agent catalog.
     */
    slug: z.string().min(1).max(64).regex(AGENT_SLUG_REGEX).optional(),
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    avatarUrl: z.string().url().optional(),
    /**
     * Root behavior this agent runs. Omitted = 'chat' (default tool-calling chat
     * loop). 'image-generation' routes the user message straight to an image
     * model. 'external-agent' routes the whole turn to a coding agent (Claude
     * Code / Cursor) running in a sandbox session — the thread IS that
     * session. In the non-chat cases toolNames/integrationBindings/workflows
     * are ignored (the agent's tools are its own).
     */
    primaryBehavior: primaryBehaviorSchema.optional(),
    /**
     * For `primaryBehavior: 'external-agent'` only — which external agent
     * runtime handles the turn. Defaults to 'claude-code' at runtime.
     */
    agentKind: agentKindSchema.optional(),
    /**
     * For `primaryBehavior: 'external-agent'` only — credential / auth mode.
     * 'managed' (default): the platform mints a gateway virtual key, routes the
     * agent through the gateway, and enforces allowed_models + usage metering +
     * the budget gate. 'byo': the platform injects no virtual key or gateway;
     * the agent authenticates with whatever credentials the user injected into
     * the sandbox env, the model is a raw provider passthrough (no platform
     * slug resolution / catalog), and native web tools are not force-disabled.
     * The per-agent authMode is the sole control — configuring an agent is
     * already a privileged action, so there is no separate org-level gate.
     */
    authMode: z.enum(['managed', 'byo']).optional(),
    /**
     * For `primaryBehavior: 'external-agent'` only — opt the agent into its
     * runtime's NATIVE web tools (Claude Code `WebSearch`/`WebFetch`). Managed
     * runs force-disable these by default and route web access through a
     * connected search integration (governed: audit + metering + untrusted-source
     * wrapping). `true` lifts that denial so the agent uses its native web tools
     * directly — appropriate when the gateway model supports them (e.g. OpenRouter)
     * and ungoverned web access is acceptable. Absent/`false` keeps the governed
     * default. BYO is unaffected (already native).
     */
    nativeWebTools: z.boolean().optional(),
    /**
     * For `primaryBehavior: 'external-agent'` with `authMode: 'managed'` only —
     * the vision model used to polyfill image reading when this agent's own
     * model is text-only. A text-only managed agent's image reads are
     * intercepted by a hook that transcribes them through THIS model via the
     * gateway (no provider key enters the sandbox). When unset the runtime falls
     * back to the provider registry's `vision`-tagged default. Ignored for BYO
     * (never polyfilled) and when the agent's own model already sees images.
     */
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
     * Enforced at the integration-tool wrapper. Agents that cannot call
     * integrations should leave this unset.
     */
    maxIntegrationCallsPerRun: z.number().int().min(1).max(500).optional(),
    composerMode: composerModeSchema.optional(),
    /** Per-agent routing / cascade behaviour; see `agentRoutingSchema`. */
    routing: agentRoutingSchema.optional(),
    roleRestriction: z.literal('admin_developer').optional(),
    conversationStarters: z.array(z.string().max(200)).max(4).optional(),
    visibleInChat: z.boolean().optional(),
    /**
     * @deprecated Organigram edges: the slugs of this agent's direct
     * reports. The `delegate_*` chat tools these edges used to produce were
     * replaced by `spawn_agent` (agent-on-demand jobs) — a config carrying
     * `delegates` still loads WITHOUT error, and the edges still feed the
     * org chart for the task-domain manager behaviors (`escalate`, epic
     * decompose, SLA hand-up) until the workforce follow-up replaces the
     * chart with explicit project settings. Shape-only validation here —
     * dangling targets are dropped with a warning at read time.
     */
    delegates: z
      .array(z.string().min(1).max(64).regex(AGENT_SLUG_REGEX))
      .max(100)
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
     * Opt-in: run this agent's task runs (`run_on_task`) as a DURABLE sandbox
     * step instead of the inline LLM loop — the agent runs Claude Code in a
     * container (bash/files, `output/summary.md` handoff) and the run spans the
     * action ceiling via the durable-step re-entry. Mutually exclusive with
     * `runtime` (external daemon dispatch); the superRefine below enforces it.
     * For code/file task agents (e.g. an issue-desk implementer).
     */
    preferDurableStepForTasks: z.boolean().optional(),
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

    // `skillBindings` is the agent's hard allowlist of skill slugs. An empty
    // or absent list means the agent has zero skills available — there is no
    // implicit "all org skills" fallback. Cross-reference to actual org skills
    // is left to runtime (a stale slug is silently dropped from the snapshot),
    // so an operator can list a skill that will be uploaded later without
    // tripping schema validation.

    // image-generation and external-agent both bypass the platform tool loop,
    // so the loop-only fields are meaningless for them — with one exception:
    // an external-agent reuses `integrationBindings` as the grant set for the
    // sandbox MCP integration bridge (the coding agent dispatches any bound
    // integration from inside its container), so it stays allowed there.
    // `toolNames`/`workflows` remain loop-only and disallowed for both.
    if (
      data.primaryBehavior === 'image-generation' ||
      data.primaryBehavior === 'external-agent'
    ) {
      const disallowed: Array<keyof typeof data> =
        data.primaryBehavior === 'external-agent'
          ? ['toolNames', 'workflows']
          : ['toolNames', 'integrationBindings', 'workflows'];
      for (const key of disallowed) {
        const value = data[key];
        if (Array.isArray(value) && value.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${String(key)} is not supported when primaryBehavior is "${data.primaryBehavior}" — the agent bypasses the platform tool loop.`,
          });
        }
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

    // Cursor runs BYO only. The Cursor CLI authenticates with only
    // `--api-key` / `CURSOR_API_KEY` and exposes no OpenAI-compatible base-URL
    // override, so it cannot route through the platform LLM gateway the way
    // managed mode requires. Force `authMode: "byo"` (reject managed / absent).
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
