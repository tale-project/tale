import safe from 'safe-regex2';
import { z } from 'zod/v4';

import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_MAX_MINUTES,
  SESSION_IDLE_TIMEOUT_MIN_MINUTES,
} from '../session-idle';
import { piiConfigSchema } from './pii';

// Single source of truth for policy types. The Convex side
// `governance/schema.ts::GOVERNANCE_POLICY_TYPES` MUST stay in sync;
// drift causes silent type holes and `as const` casts at call sites.
export const POLICY_TYPES = [
  'system_prompt',
  'budgets',
  'default_models',
  'upload_policy',
  'retention_policy',
  'feature_flags',
  'pii_config',
  'model_access',
  'login_policy',
  'password_policy',
  'two_factor_policy',
  // Org-level session idle timeout (#1502). Tightens the deployment-wide
  // `SESSION_IDLE_TIMEOUT_MINUTES` backstop for this org; drives the client
  // watchdog. See `sessionIdleTimeoutConfigSchema`.
  'session_idle_timeout',
  'chat_filter',
  'moderation_provider',
  'custom_instructions',
  'user_memories',
  // Org-level default for the voice-output (TTS) feature. Missing row →
  // effective default ON; row with `config.enabled === false` is the
  // org-wide kill switch admins use to block voice for the whole tenant
  // (e.g., during a billing freeze).
  'voice_output',
  // Phase 12 — admin-customizable confidentiality notice.
  'data_classification_notice',
  // GDPR DSAR governance — cooling-off window, dual approval, and
  // per-admin daily filing rate limit. See `dsarGovernanceConfigSchema`
  // for the config shape and defaults.
  'dsar_governance',
  // Agent-on-demand job guardrails (spawn_agent): org concurrency cap,
  // terminal-row TTL, stuck-run threshold. Missing row ⇒ schema defaults.
  // See `agentJobsConfigSchema`.
  'agent_jobs',
  // Master switch for the task-ops automation pack. Missing row → enabled.
  // See `taskAutomationConfigSchema`.
  'task_automation',
  // Org-level package allowlist/denylist for the `run_code` tool. Missing file
  // → denylist + empty lists = every package allowed. See
  // `runCodePolicyConfigSchema`; the execution gate is in
  // `agent_tools/run_code_tool.ts`.
  'run_code',
  // Per-org opt-out for the weekly in-instance provider-config auto-sync cron.
  // Missing file → enabled. See `modelSyncConfigSchema`.
  'model_sync',
  // Per-org sandbox session budgets (user / thread / workflow / render — every
  // sandbox is a session). The deployment-wide host-capacity ceiling is spawner
  // env `SANDBOX_MAX_SESSIONS`; this policy is the per-tenant slice under it an
  // org admin tunes. See `sandboxQuotaConfigSchema`.
  'sandbox_quota',
  // Deprecated / ignored. Conversation assignment privacy is built into RLS
  // (always on). Kept so existing org-config / configCache rows still validate.
  // See `conversationAccessConfigSchema`.
  'conversation_access',
  // Address→assignee routing rules, applied inline when an inbound conversation
  // is created (a governance feature, not an automation). Missing row / empty
  // rules ⇒ no routing. See `conversationRoutingConfigSchema`.
  'conversation_routing',
  // Which live WRITES hold for a human. Missing row / empty rules ⇒ the
  // built-in rule: a write that LEAVES the tenant asks, a write on the
  // platform's own surface (a `platform`-auth connector — tasks, documents,
  // the org's sandbox) does not. See `approvalPolicyConfigSchema`; applied in
  // `approvals/policy.ts` and enforced by `approvals/gate.ts`.
  'approval_policy',
  // Which model transcribes images for a TEXT-ONLY harness (the vision
  // polyfill behind `Read`ing a screenshot). Missing row / empty config ⇒
  // Auto: the platform picks, preferring a curated vision model. Pinning one
  // here is how an admin stops the auto-pick from drifting onto whatever the
  // live catalog currently prices lowest. See `visionModelConfigSchema`.
  'vision_model',
  // Independent-review requirements for the task-review gate. Missing row /
  // empty config ⇒ no extra requirement — anyone with project edit access
  // may respond, exactly as today. See `reviewPolicyConfigSchema`; enforced
  // in `convex/tasks/review_mutations.ts::respondToTaskReview`.
  'review_policy',
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

/**
 * Agent-on-demand job guardrails (the `spawn_agent` tool). Missing row ⇒
 * these schema defaults; every field carries a `.default()` so
 * `agentJobsConfigSchema.parse({})` yields the effective config.
 */
export const agentJobsConfigSchema = z.object({
  /** Org-wide cap on concurrently RUNNING spawned jobs. */
  maxConcurrentJobs: z.number().int().min(1).max(100).default(10),
  /** Terminal job rows (and their transcript threads) older than this are GC'd. */
  ttlMs: z
    .number()
    .int()
    .min(60 * 60 * 1000)
    .default(30 * 24 * 60 * 60 * 1000),
  /** A `running` job older than this is presumed orphaned (its action died
   *  before finalize) and is flipped to `timed_out` by the recovery sweep. */
  jobStuckAfterMs: z
    .number()
    .int()
    .min(60 * 1000)
    .default(60 * 60 * 1000),
});
export type AgentJobsConfig = z.infer<typeof agentJobsConfigSchema>;

/**
 * Master switch for the task-ops automation pack. Gates the run-agent action
 * (code half) AND the pack's trigger rows (flipped by
 * `setTaskAutomationEnabled`). Missing row ⇒ enabled.
 */
export const taskAutomationConfigSchema = z.object({
  enabled: z.boolean(),
  pausedBy: z.string().optional(),
  pausedAt: z.number().optional(),
  reason: z.string().max(500).optional(),
});
export type TaskAutomationConfig = z.infer<typeof taskAutomationConfigSchema>;

/**
 * Per-org sandbox SESSION budgets. Missing row ⇒ these schema defaults.
 *
 * Every sandbox run is a session now, split into isolated per-workload budgets
 * so no one workload can starve another. Two-tier model: the GLOBAL host cap
 * (total sessions across every org) is spawner env `SANDBOX_MAX_SESSIONS`, sized
 * to the physical box. THIS policy is the per-tenant slice under it an org admin
 * tunes; a per-org value above the host cap simply never binds (the host cap
 * always wins).
 */
export const sandboxQuotaConfigSchema = z.object({
  /**
   * Max concurrently-active **project-agent** standing sandbox sessions (the
   * `project` budget). The field name predates the project-agent rename and
   * stays for shipped-config compatibility. The other workloads have their
   * own separate budgets below so they never compete for one pool.
   */
  maxSessionsPerOrg: z.number().int().min(1).max(500).default(2),
  /** Max concurrently-active per-**workflow-run** sandbox sessions. */
  maxWorkflowSessionsPerOrg: z.number().int().min(1).max(500).default(4),
  /**
   * Max concurrently-active crawler **render** sessions (headless-Chromium
   * document/page rendering). Isolated in its own budget so heavy crawling can't
   * starve interactive agent/run_code sessions — the session-model replacement
   * for the old one-shot render pool.
   */
  maxRenderSessionsPerOrg: z.number().int().min(1).max(500).default(4),
});
export type SandboxQuotaConfig = z.infer<typeof sandboxQuotaConfigSchema>;
export const DEFAULT_SANDBOX_QUOTA: SandboxQuotaConfig =
  sandboxQuotaConfigSchema.parse({});

// Org-level default for the custom-instructions feature. Per-user
// `userPreferences.customInstructionsEnabled` may override this default;
// absent user preference falls back to this value. Missing row entirely →
// effective default is OFF.
const customInstructionsConfigSchema = z.object({
  enabled: z.boolean(),
});

// Org-level default for the user-memories feature (memory injection +
// the `propose_memory` agent tool). Per-user
// `userPreferences.memoriesEnabled` may override; missing row → OFF.
const userMemoriesConfigSchema = z.object({
  enabled: z.boolean(),
});

// Org-level default for the voice-output (TTS) feature. Missing row →
// effective default ON (so existing deployments don't silently lose voice
// when this policy type lands). Setting `enabled: false` is the org-wide
// kill switch — overrides every user's `userPreferences.voiceOutput` and
// every thread's `voiceOutputOverride`. Per-user opt-in still requires a
// configured TTS provider regardless of this row.
export const voiceOutputConfigSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Org-wide mandatory instructions injected ahead of every agent's system
 * prompt.
 *
 * `mandatoryInstructions` is the ONE current field: new writes set only it.
 * `mandatoryPrefixPrompt`/`mandatorySuffixPrompt` are the pre-rewrite pair
 * (a prefix and suffix wrapped around the generated prompt) and stay
 * parseable so every on-disk policy file written before the cutover still
 * validates; readers resolve the effective text through
 * {@link effectiveMandatoryInstructions}, where the new field wins and the
 * legacy pair is concatenated as a fallback.
 *
 * The row-level `enabled` flag (checked as `policy.enabled !== false`) lives
 * on the policy row, NOT inside config — so it is not part of this config
 * schema. All fields are optional/bounded so an empty policy persists
 * cleanly.
 */
const systemPromptConfigSchema = z.object({
  /**
   * Whether the org's instructions are injected at all — the section's
   * toggle. Absent means "decide from the text": an org that configured
   * instructions before this flag existed keeps them, a fresh org (no text)
   * reads as off. Only an explicit `false` silences configured text.
   */
  enabled: z.boolean().optional(),
  mandatoryInstructions: z.string().max(20_000).optional(),
  mandatoryPrefixPrompt: z.string().max(20_000).optional(),
  mandatorySuffixPrompt: z.string().max(20_000).optional(),
});
export type SystemPromptConfig = z.infer<typeof systemPromptConfigSchema>;

/**
 * Resolve the effective mandatory instructions from a `system_prompt` policy
 * config: `mandatoryInstructions` wins whenever it carries non-whitespace
 * text; otherwise the legacy prefix and suffix are joined with a blank line.
 * Returns `undefined` when the policy carries no text at all, so callers can
 * distinguish "no instructions configured" from an empty string. Pure and
 * V8-safe — the chat pipeline injects the result as the first system-prompt
 * section.
 */
export function effectiveMandatoryInstructions(
  config: SystemPromptConfig,
): string | undefined {
  // An explicitly disabled section injects nothing, however much text it
  // still holds — turning the section off must not lose the draft.
  if (config.enabled === false) return undefined;
  const unified = config.mandatoryInstructions?.trim();
  if (unified) return unified;
  const parts = [config.mandatoryPrefixPrompt, config.mandatorySuffixPrompt]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/**
 * Phase 12 — admin-customizable confidentiality notice.
 *
 * Rendered in chat composer + upload dialog footers. `messages` is a
 * per-locale map (en/de/fr/de-AT/de-CH/fr-CH); resolution falls back
 * to platform default in `messages/{locale}.json` when an org's locale
 * key is absent.
 *
 * `requireAcknowledgment: true` triggers a one-time onboarding modal
 * on first message send + on every `version` bump (the bump is what
 * forces re-acknowledgment when admins update the notice).
 *
 * Per-locale char cap: 280 chars warn at 240. German is typically
 * +30% longer than English; aggregate caps would force translators to
 * truncate, so the cap is per-locale.
 */
export const dataNoticeConfigSchema = z.object({
  enabled: z.boolean(),
  requireAcknowledgment: z.boolean().optional(),
  /** locale-keyed (e.g., `en`, `de`, `fr-CH`); each value ≤ 280 chars. */
  messages: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid locale code'),
      z.string().min(1).max(280),
    )
    .optional(),
  /** Bump to force re-acknowledgment of the notice. */
  version: z.number().int().nonnegative().default(1),
});

export const budgetRuleSchema = z.object({
  scope: z.enum(['user', 'team', 'role', 'org', 'default', 'apiKey']),
  scopeId: z.string().optional(),
  /**
   * Target for the `apiKey` scope: the Better Auth `apikey._id` this rule caps.
   * A per-API-key budget binds independently of the key owner's user/team/org
   * budget, so a single credential can carry its own spend cap. Only meaningful
   * (and only read) when `scope === 'apiKey'`; kept as a separate field from
   * `scopeId` so the user/team/role targeting semantics are untouched.
   */
  apiKeyId: z.string().optional(),
  period: z.enum(['daily', 'weekly', 'monthly']),
  maxTokens: z.number().nonnegative().optional(),
  maxCostCents: z.number().nonnegative().optional(),
  maxRequests: z.number().nonnegative().optional(),
  warningThresholdPercent: z.number().min(0).max(100).optional(),
});
export type BudgetRule = z.infer<typeof budgetRuleSchema>;

export const budgetConfigSchema = z.object({
  rules: z.array(budgetRuleSchema),
  enabled: z.boolean(),
});
export type BudgetConfig = z.infer<typeof budgetConfigSchema>;

export const defaultModelRuleSchema = z.object({
  scope: z.enum(['team', 'role', 'default']),
  scopeId: z.string().optional(),
  providerName: z.string(),
  modelId: z.string(),
});
export type DefaultModelRule = z.infer<typeof defaultModelRuleSchema>;

export const defaultModelsConfigSchema = z.object({
  rules: z.array(defaultModelRuleSchema),
  enabled: z.boolean(),
});
export type DefaultModelsConfig = z.infer<typeof defaultModelsConfigSchema>;

/**
 * Which model reads images on behalf of a text-only harness — the vision
 * polyfill, not a model any user picks.
 *
 * Both fields absent ⇒ **Auto**: the platform resolves the model itself
 * (preferring a curated vision model, else the cheapest reachable one). An
 * empty config and a missing file therefore mean the same thing, which is why
 * `parse({})` has to succeed.
 *
 * Pinning is the escape hatch from auto-selection drift: the pick reads a
 * LIVE catalog, so "cheapest reachable" can land on whatever a provider
 * listed yesterday — observed live as a music generator whose token price is
 * 0 because it bills per clip. Both fields move together (a provider without
 * a model, or a model without its provider, cannot be routed).
 */
export const visionModelConfigSchema = z
  .object({
    providerSlug: z.string().min(1).max(64).optional(),
    modelId: z.string().min(1).max(200).optional(),
  })
  .refine(
    (config) =>
      (config.providerSlug === undefined) === (config.modelId === undefined),
    {
      message:
        'pin both providerSlug and modelId, or neither (neither = automatic selection)',
    },
  );
export type VisionModelConfig = z.infer<typeof visionModelConfigSchema>;

export const uploadPolicyConfigSchema = z.object({
  enabled: z.boolean(),
  allowedExtensions: z.array(z.string()).optional(),
  blockedExtensions: z.array(z.string()).optional(),
  allowedMimeTypes: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().nonnegative().optional(),
  // Optional per-MIME-prefix overrides. When the upload's MIME type matches
  // any `mimeTypePrefix` entry, that `maxBytes` wins over `maxFileSizeBytes`.
  // Example: `[{ mimeTypePrefix: 'audio/', maxBytes: 25 * 1024 * 1024 }]`
  // caps audio at 25 MB while leaving other types at the global limit.
  maxFileSizeLimits: z
    .array(
      z.object({
        mimeTypePrefix: z.string().min(1),
        maxBytes: z.number().nonnegative(),
      }),
    )
    .optional(),
  maxTotalVolumeBytesPerUser: z.number().nonnegative().optional(),
});
export type UploadPolicyConfig = z.infer<typeof uploadPolicyConfigSchema>;

/**
 * Per-org retention policy payload. Schema only validates structural
 * shape (integer + non-negative); category min/max bounds live in
 * `configs/platform/custom/governance/retention.yml` (or per-org override files) and are
 * enforced at write time by `assertWithinBounds` inside
 * `upsertRetentionPolicyAction`. Operators tighten or rename bounds by
 * editing the YAML file; the schema does not duplicate them.
 *
 * Policy-level "enabled" is NOT in this schema — it lives on the
 * `governancePolicies` row (`enabled: v.optional(v.boolean())`) and is
 * managed by the upsert mutation, not the config payload. Per-category
 * gates (`documentsEnabled` / `auditLogEnabled` / ...) are part of the
 * payload and live below.
 *
 * Exceptions: `batchSize` and `deletionGraceDays` are runtime knobs
 * with no file-layer counterpart, so their caps stay here.
 */
export const retentionPolicyConfigSchema = z.object({
  documentsEnabled: z.boolean().optional(),
  documentsRetentionDays: z.number().int().nonnegative().optional(),
  batchSize: z.number().int().min(1).max(10_000).optional(),
  userTempEnabled: z.boolean().optional(),
  userTempRetentionHours: z.number().int().nonnegative().optional(),
  agentTempEnabled: z.boolean().optional(),
  agentTempRetentionHours: z.number().int().nonnegative().optional(),
  chatHistoryEnabled: z.boolean().optional(),
  chatHistoryRetentionDays: z.number().int().nonnegative().optional(),
  auditLogEnabled: z.boolean().optional(),
  auditLogRetentionDays: z.number().int().nonnegative().optional(),
  workflowLogEnabled: z.boolean().optional(),
  workflowLogRetentionDays: z.number().int().nonnegative().optional(),
  usageLedgerEnabled: z.boolean().optional(),
  usageLedgerRetentionDays: z.number().int().nonnegative().optional(),
  loginAttemptEnabled: z.boolean().optional(),
  loginAttemptRetentionDays: z.number().int().nonnegative().optional(),
  chatFilterEventsEnabled: z.boolean().optional(),
  chatFilterEventsRetentionDays: z.number().int().nonnegative().optional(),
  messageFeedbackEnabled: z.boolean().optional(),
  messageFeedbackRetentionDays: z.number().int().nonnegative().optional(),
  contactsEnabled: z.boolean().optional(),
  contactsRetentionDays: z.number().int().nonnegative().optional(),
  externalConversationsEnabled: z.boolean().optional(),
  externalConversationsRetentionDays: z.number().int().nonnegative().optional(),
  /**
   * In-app notification retention. Notifications carry peppered email +
   * IP for security alerts (lockouts, etc.) and have no value past a
   * short admin review window. Default 30 days; bounded by the
   * `notifications` retention category in the JSON config.
   * Round-2 V6 P0-17.
   */
  notificationsEnabled: z.boolean().optional(),
  notificationsRetentionDays: z.number().int().nonnegative().optional(),
  /** Retention for `taskAgentRuns` (task-run records). Running rows
   * are never deleted regardless of age — the sweep targets terminal
   * states only. */
  agentRunsEnabled: z.boolean().optional(),
  agentRunsRetentionDays: z.number().int().nonnegative().optional(),
  deletionGraceDays: z.number().int().min(0).max(90).optional(),
});
export type RetentionPolicyConfig = z.infer<typeof retentionPolicyConfigSchema>;

/**
 * Server floor for `maxContextTokens` below. Exported so the feature-flags
 * editor can enforce the identical floor client-side (#2660) — without it, a
 * sub-floor value optimistically renders as a saved rule, the server rejects
 * it with an uncaught `AppError`, and nothing actually persists.
 */
export const MIN_MAX_CONTEXT_TOKENS = 4096;

export const featureFlagRuleSchema = z.object({
  scope: z.enum(['user', 'team', 'role', 'default']),
  scopeId: z.string().optional(),
  /**
   * @deprecated Never enforced — no server or client code ever read it — and
   * no longer written by the editor. Accepted only so `feature-flags.yml`
   * files written by earlier releases keep parsing; the editor drops it on
   * the rule's next save.
   */
  webSearch: z.boolean().optional(),
  /** @deprecated See {@link featureFlagRuleSchema} `webSearch`. */
  codeExecution: z.boolean().optional(),
  /** @deprecated See {@link featureFlagRuleSchema} `webSearch`. */
  fileUpload: z.boolean().optional(),
  maxContextTokens: z.number().min(MIN_MAX_CONTEXT_TOKENS).optional(),
});
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;

export const featureFlagsConfigSchema = z.object({
  rules: z.array(featureFlagRuleSchema),
  enabled: z.boolean(),
});
export type FeatureFlagsConfig = z.infer<typeof featureFlagsConfigSchema>;

// The PII policy schema lives with the other org-config schemas
// (`lib/shared/schemas/pii.ts`) — pure Zod, importable from client and
// server without dragging in the PII engine (`lib/pii`) or its
// locale datasets. Re-exported here because `pii_config` is a governance
// policy and existing consumers import it from this module.
export { piiConfigSchema };

export const modelAccessRuleSchema = z.object({
  scope: z.enum(['user', 'team', 'role', 'default']),
  scopeId: z.string().optional(),
  allowedModels: z.array(z.string()),
  blockedModels: z.array(z.string()).optional(),
});
export type ModelAccessRule = z.infer<typeof modelAccessRuleSchema>;

export const modelAccessConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['allowlist', 'blocklist']),
  rules: z.array(modelAccessRuleSchema),
});
export type ModelAccessConfig = z.infer<typeof modelAccessConfigSchema>;

export const DEFAULT_LOGIN_BACKOFF_MS = [1_000, 10_000, 60_000, 600_000];
export const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
// `proxy-addr` pre-defined groups: loopback (127/8, ::1) + uniquelocal
// (RFC 1918 private ranges + fc00::/7). Safe default for self-hosted
// deployments behind a single reverse proxy on the same host/network.
export const DEFAULT_TRUSTED_PROXIES = ['loopback', 'uniquelocal'];

export const loginPolicyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttemptsBeforeLockout: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(DEFAULT_LOGIN_MAX_ATTEMPTS),
  backoffSchedule: z
    .array(z.number().int().min(0))
    .min(1)
    .max(10)
    .default(DEFAULT_LOGIN_BACKOFF_MS),
  // IP address / CIDR / `proxy-addr` keyword (`loopback`, `uniquelocal`,
  // `linklocal`) — these are the reverse proxies the deployment sits
  // behind. Used to extract the real client IP from `X-Forwarded-For`
  // (walks right-to-left, skipping entries matching any of these, and
  // stops at the first non-trusted hop = real client).
  trustedProxies: z
    .array(z.string().min(1))
    .max(32)
    .default(DEFAULT_TRUSTED_PROXIES),
});
export type LoginPolicyConfig = z.infer<typeof loginPolicyConfigSchema>;

export const passwordPolicyConfigSchema = z.object({
  // Production-secure-by-default: a 12-char floor + all character classes is
  // applied automatically (no admin action, no setup prompt). This only
  // governs NEW password creation/validation — existing passwords are never
  // invalidated — so raising the floor strengthens a fresh deployment without
  // locking anyone out. Admins can still relax it per-org in Settings.
  minLength: z.number().int().min(6).max(128).default(12),
  requireUpper: z.boolean().default(true),
  requireLower: z.boolean().default(true),
  requireDigit: z.boolean().default(true),
  requireSpecial: z.boolean().default(true),
  rotationDays: z.number().int().min(0).max(3650).default(0),
});
export type PasswordPolicyConfig = z.infer<typeof passwordPolicyConfigSchema>;
export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig =
  passwordPolicyConfigSchema.parse({});

// Two-factor authentication policy (issue #1507).
// - enforced: when true, credential-authenticated users without 2FA are
//   redirected to enrollment (or blocked after grace).
// - gracePeriodDays: days from when enforcement first applies to a given
//   user (persisted per-user as `user.twoFactorGraceUntil`) during which
//   the user may continue to sign in while enrolment is pending.
// - exemptSsoUsers: exclude users who authenticate only via SSO (their
//   IdP handles MFA).
export const twoFactorPolicyConfigSchema = z.object({
  enforced: z.boolean().default(false),
  gracePeriodDays: z.number().int().min(0).max(30).default(7),
  exemptSsoUsers: z.boolean().default(true),
});
export type TwoFactorPolicyConfig = z.infer<typeof twoFactorPolicyConfigSchema>;
export const DEFAULT_TWO_FACTOR_POLICY: TwoFactorPolicyConfig =
  twoFactorPolicyConfigSchema.parse({});

// Session idle timeout (issue #1502).
// - enabled: when false (or the row is absent), the org defers to the
//   deployment-wide `SESSION_IDLE_TIMEOUT_MINUTES` backstop — no change.
// - idleTimeoutMinutes: the org's desired inactivity window. The effective
//   window can only TIGHTEN the deployment backstop, never loosen past it
//   (clamped in `resolveEffectiveIdleMinutes`). Bounds mirror the env parser
//   (1 min … 24 h).
export const sessionIdleTimeoutConfigSchema = z.object({
  enabled: z.boolean().default(false),
  idleTimeoutMinutes: z
    .number()
    .int()
    .min(SESSION_IDLE_TIMEOUT_MIN_MINUTES)
    .max(SESSION_IDLE_TIMEOUT_MAX_MINUTES)
    .default(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES),
});
export type SessionIdleTimeoutConfig = z.infer<
  typeof sessionIdleTimeoutConfigSchema
>;
export const DEFAULT_SESSION_IDLE_TIMEOUT: SessionIdleTimeoutConfig =
  sessionIdleTimeoutConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Chat filter (banned words + custom regex) — see governance/chat_filter/
// ---------------------------------------------------------------------------

const chatFilterCategoryIdRegex = /^[a-z0-9_]{1,32}$/;

const chatFilterWordSchema = z.string().min(1).max(100);

const chatFilterPatternSchema = z.object({
  name: z.string().min(1).max(80),
  regex: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid regex pattern')
    .refine((v) => {
      try {
        return safe(v);
      } catch {
        return false;
      }
    }, 'Pattern is unsafe — likely catastrophic backtracking'),
});

export const chatFilterCategorySchema = z.object({
  id: z.string().regex(chatFilterCategoryIdRegex),
  label: z.string().min(1).max(80),
  enabled: z.boolean(),
  mode: z.enum(['block', 'mask', 'flag']),
  words: z.array(chatFilterWordSchema).max(5000),
  patterns: z.array(chatFilterPatternSchema).max(200),
});
export type ChatFilterCategory = z.infer<typeof chatFilterCategorySchema>;

export const chatFilterConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maskReplacement: z.string().min(1).max(32).default('[BLOCKED]'),
  appliesTo: z
    .array(z.enum(['input', 'output']))
    .min(1)
    .default(['input']),
  preferNonStreamingForFiltering: z.boolean().default(false),
  configVersion: z.number().int().default(1),
  categories: z.array(chatFilterCategorySchema).max(20),
});
export type ChatFilterConfig = z.infer<typeof chatFilterConfigSchema>;

// ---------------------------------------------------------------------------
// Moderation provider (admin-configurable external HTTP moderation API)
// ---------------------------------------------------------------------------

const headerNameRegex = /^[A-Za-z0-9-]+$/;
const crlfNullRegex = /[\r\n\0]/;

/**
 * Validates a request-template string against the constraints the field-level
 * schema used to enforce unconditionally (#2657): non-empty, no `{{secret.}}`
 * placeholders, and valid JSON once `{{text}}` / `{{direction}}` are
 * substituted. Called from the top-level `superRefine` ONLY when
 * `enabled === true` — a disabled provider's stale/blank template is inert
 * and must not block a save that is turning the layer off.
 */
function validateModerationRequestTemplate(v: string): string | null {
  if (v.length < 1) {
    return 'Too small: expected string to have >=1 characters';
  }
  if (/\{\{secret\./.test(v)) {
    return 'Secrets not allowed in body template';
  }
  try {
    JSON.parse(
      v.replace(/\{\{text\}\}/g, '""').replace(/\{\{direction\}\}/g, '""'),
    );
  } catch {
    return 'Request template must be valid JSON';
  }
  return null;
}

const moderationBufferPolicyInnerSchema = z.object({
  minFlushChars: z.number().int().min(32).max(512).default(120),
  maxBufferChars: z.number().int().min(256).max(4096).default(800),
  idleFlushMs: z.number().int().min(100).max(2000).default(400),
  perStreamMaxConcurrent: z.number().int().min(1).max(4).default(2),
});
const MODERATION_BUFFER_POLICY_DEFAULT =
  moderationBufferPolicyInnerSchema.parse({});
const moderationBufferPolicySchema = moderationBufferPolicyInnerSchema.default(
  MODERATION_BUFFER_POLICY_DEFAULT,
);

/**
 * Validates a URL string against the constraints the field-level schema used
 * to enforce unconditionally (#2657): non-empty, well-formed, http(s) only.
 * Called from the top-level `superRefine` ONLY when `enabled === true` — see
 * `validateModerationRequestTemplate` above for why a disabled provider must
 * not be blocked by its own unconfigured/stale endpoint.
 */
function validateModerationUrl(u: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return 'Invalid URL';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'URL must be http(s)://';
  }
  return null;
}

const moderationEndpointSchema = z.object({
  // Accept http:// and https://. HTTPS is strongly recommended for public
  // endpoints (the request carries chat text in the clear) but HTTP is
  // valid for internal / localhost mocks. The URL's own host is auto-
  // allowlisted by `safeFetch`, so admins don't need to also configure an
  // SSRF allowlist — redirects to a different host still get rejected.
  //
  // Field-level validation intentionally stops at "is a string" — the
  // well-formed-http(s)-URL check only applies when the provider is enabled
  // (see `validateModerationUrl` + the top-level `superRefine` below, #2657).
  url: z.string(),
  method: z.literal('POST').default('POST'),
  headers: z.record(
    z.string().regex(headerNameRegex, 'Invalid header name'),
    z.string().refine((v) => !crlfNullRegex.test(v), 'CRLF not allowed'),
  ),
  // Field-level validation intentionally stops at "is a string" — see
  // `validateModerationRequestTemplate` + the top-level `superRefine` below.
  requestTemplate: z.string(),
  timeoutMs: z.number().int().min(500).max(30_000).default(3000),
  maxResponseBytes: z.number().int().min(1024).max(1_048_576).default(262_144),
  bufferPolicy: moderationBufferPolicySchema,
});

const responseShapeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('openai_moderation') }),
  z.object({ type: z.literal('azure_content_safety') }),
  z.object({ type: z.literal('perspective') }),
  z.object({
    type: z.literal('custom_jsonpath'),
    flaggedPath: z.string().optional(),
    // Required only while the provider is enabled (see the top-level
    // `superRefine` below, #2657) — a disabled provider mid-edit-draft
    // (responseShape switched to custom_jsonpath, path not filled in yet)
    // must still be able to save `enabled: false`.
    categoriesPath: z.string(),
    scoresPath: z.string().optional(),
    categoryShape: z.enum(['array', 'record_of_bool', 'record_of_score']),
  }),
]);
export type ModerationResponseShape = z.infer<typeof responseShapeSchema>;

export const moderationCategoryMappingSchema = z.object({
  providerCategory: z.string().min(1).max(64),
  internalLabel: z.string().min(1).max(80),
  enabled: z.boolean(),
  mode: z.enum(['block', 'mask', 'flag']).default('flag'),
  scoreThreshold: z.number().min(0).max(1).optional(),
});
export type ModerationCategoryMapping = z.infer<
  typeof moderationCategoryMappingSchema
>;

const moderationFailBehaviorInnerSchema = z.object({
  input: z.enum(['open', 'closed']).default('open'),
  output: z.enum(['open', 'closed']).default('closed'),
});
const MODERATION_FAIL_BEHAVIOR_DEFAULT =
  moderationFailBehaviorInnerSchema.parse({});
const moderationFailBehaviorSchema = moderationFailBehaviorInnerSchema.default(
  MODERATION_FAIL_BEHAVIOR_DEFAULT,
);

export const moderationProviderConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    appliesTo: z
      .array(z.enum(['input', 'output']))
      .min(1)
      .default(['input']),
    endpoint: moderationEndpointSchema,
    responseShape: responseShapeSchema,
    categoryMappings: z.array(moderationCategoryMappingSchema).max(30),
    failBehavior: moderationFailBehaviorSchema,
    configVersion: z.number().int().default(1),
  })
  .superRefine((data, ctx) => {
    // #2657: disabling this guardrail layer must never fail validation on
    // config it is turning off. Toggling `enabled` false persists whatever
    // endpoint / responseShape draft happens to be in local state (including
    // an unconfigured/blank one) — these fields are only load-bearing while
    // the provider actually runs, so only enforce them when `enabled: true`.
    if (!data.enabled) return;

    const urlError = validateModerationUrl(data.endpoint.url);
    if (urlError) {
      ctx.addIssue({
        code: 'custom',
        message: urlError,
        path: ['endpoint', 'url'],
      });
    }
    const templateError = validateModerationRequestTemplate(
      data.endpoint.requestTemplate,
    );
    if (templateError) {
      ctx.addIssue({
        code: 'custom',
        message: templateError,
        path: ['endpoint', 'requestTemplate'],
      });
    }
    if (
      data.responseShape.type === 'custom_jsonpath' &&
      data.responseShape.categoriesPath.length < 1
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Too small: expected string to have >=1 characters',
        path: ['responseShape', 'categoriesPath'],
      });
    }
  });
export type ModerationProviderConfig = z.infer<
  typeof moderationProviderConfigSchema
>;

// Merges multiple policies into the strictest ("strongest") one — longest
// minLength, OR of each require flag, shortest positive rotationDays.
// Used when a user belongs to multiple orgs with divergent policies:
// their single password must satisfy the strictest constraint.
export function mergeStrictestPasswordPolicy(
  policies: readonly PasswordPolicyConfig[],
): PasswordPolicyConfig {
  if (policies.length === 0) return DEFAULT_PASSWORD_POLICY;
  return policies.reduce<PasswordPolicyConfig>(
    (acc, p) => ({
      minLength: Math.max(acc.minLength, p.minLength),
      requireUpper: acc.requireUpper || p.requireUpper,
      requireLower: acc.requireLower || p.requireLower,
      requireDigit: acc.requireDigit || p.requireDigit,
      requireSpecial: acc.requireSpecial || p.requireSpecial,
      rotationDays:
        acc.rotationDays === 0
          ? p.rotationDays
          : p.rotationDays === 0
            ? acc.rotationDays
            : Math.min(acc.rotationDays, p.rotationDays),
    }),
    policies[0],
  );
}

// GDPR DSAR governance: cooling-off period, dual-admin approval, and
// per-admin daily filing limit. See `governance/dsar_policy.ts` for
// reads / writes; `governance/erasure.ts` consumes these on
// `requestErasure`.
//
// Defaults:
//   coolingOffHours: 24       — Art 12(3) one-month window minus 24h
//                                 still leaves >29 days for the cascade
//   requireDualApproval: false — opt-in; small orgs with one admin can
//                                 not satisfy filer ≠ approver
//   dailyLimitPerAdmin: 5     — typical legitimate use is far below this;
//                                 caps blast radius from compromised admin
export const dsarGovernanceConfigSchema = z.object({
  coolingOffHours: z.number().int().min(0).max(72).default(24),
  requireDualApproval: z.boolean().default(false),
  dailyLimitPerAdmin: z.number().int().min(1).max(50).default(5),
});
export type DsarGovernanceConfig = z.infer<typeof dsarGovernanceConfigSchema>;
export const DEFAULT_DSAR_GOVERNANCE: DsarGovernanceConfig =
  dsarGovernanceConfigSchema.parse({});

/**
 * Org-level package allowlist policy for the `run_code` tool. The on-disk
 * `<org>/governance/run-code.json` is the source of truth; a missing file means
 * `denylist` + empty lists = every package allowed (the historical "no DB row"
 * behaviour). Package names carry no version constraint and are matched against
 * a spec's base name, case-insensitively. The execution-time gate lives in
 * `convex/agent_tools/run_code_tool.ts`.
 */
export const runCodePolicyConfigSchema = z.object({
  defaultMode: z.enum(['allowlist', 'denylist']).default('denylist'),
  pythonAllow: z.array(z.string()).default([]),
  pythonDeny: z.array(z.string()).default([]),
  nodeAllow: z.array(z.string()).default([]),
  nodeDeny: z.array(z.string()).default([]),
});
export type RunCodePolicyConfig = z.infer<typeof runCodePolicyConfigSchema>;

/**
 * Per-org opt-out for the weekly in-instance provider-config auto-sync cron
 * (the job that 3-way-merges fresh OpenRouter facts into each org's provider
 * JSON). The on-disk `<org>/governance/model-sync.json` is the source of truth;
 * a missing file means enabled (default on).
 */
export const modelSyncConfigSchema = z.object({
  autoSyncEnabled: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Per-policy-type schema registry
// ---------------------------------------------------------------------------

/**
 * @deprecated Conversation assignment privacy is built into RLS (always on).
 * This schema remains so existing `$TALE_CONFIG_DIR/<org>/governance/` and
 * `configCache` rows with key `conversation_access` still validate; the
 * `restrictAssigned` field is ignored by the platform.
 */
export const conversationAccessConfigSchema = z.object({
  restrictAssigned: z.boolean().default(false),
});

/**
 * Address→assignee routing rules. Each rule maps an inbound recipient address to
 * a team and/or a person; the built-in ingest hook (`applyAddressRouting`)
 * assigns a newly-ingested, still-unassigned conversation by matching its
 * `metadata.to[0].address` (case-insensitive, exact) against these rules in
 * order. Missing row / empty `rules` ⇒ no routing.
 */
export const conversationRoutingConfigSchema = z.object({
  /**
   * Whether routing runs at all — the section's toggle. Absent means "decide
   * from the rules": an org that configured routing before this flag existed
   * keeps it, a fresh org (no rules) reads as off. Only an explicit `false`
   * silences configured rules.
   */
  enabled: z.boolean().optional(),
  rules: z
    .array(
      z.object({
        address: z.string().email(),
        teamId: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .default([]),
});
export type ConversationRoutingConfig = z.infer<
  typeof conversationRoutingConfigSchema
>;
export type ConversationRoutingRule =
  ConversationRoutingConfig['rules'][number];

/**
 * Which live WRITES hold for a human before they run — the operator's override
 * on top of the built-in rule.
 *
 * The built-in rule follows what the gate is for: a write that LEAVES the
 * tenant (a connector holding vendor credentials — mail, GitHub, Slack, a
 * WebDAV share) asks; a write on the platform's own surface (a connector
 * declaring `auth: platform` — tasks, documents, the org's own sandbox) does
 * not, because it is already bound by the platform's own authorization and the
 * automation that performs it was deploy-gated. Missing file / empty `rules` ⇒
 * exactly that.
 *
 * A rule names ONE target — a whole `connector`, or a single `action` as
 * `connector.action` — and the most specific rule wins, so an org can loosen a
 * single outbound action (`imap-smtp.send`) or tighten one internal connector
 * (`task`) without restating the rest.
 */
export const approvalPolicyConfigSchema = z.object({
  rules: z
    .array(
      z
        .object({
          /** A whole connector by slug, e.g. `github`. */
          connector: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[a-z][a-z0-9-]*$/, 'connector is a lowercase slug')
            .optional(),
          /** One action as `<connector>.<action>`, e.g. `imap-smtp.send`. */
          action: z
            .string()
            .min(3)
            .max(129)
            .regex(
              /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/,
              'action is "<connector>.<action>"',
            )
            .optional(),
          decision: z.enum(['auto_approve', 'require_approval']),
        })
        .refine(
          (rule) =>
            (rule.connector === undefined) !== (rule.action === undefined),
          {
            message:
              'a rule names exactly one target — either connector or action',
          },
        ),
    )
    .default([]),
});
export type ApprovalPolicyConfig = z.infer<typeof approvalPolicyConfigSchema>;
export type ApprovalPolicyRule = ApprovalPolicyConfig['rules'][number];

/**
 * Who may sign off agent work parked at review (`respondToTaskReview`).
 *
 * Both fields absent ⇒ today's behaviour exactly: any member with project
 * edit access may respond — which is why `parse({})` must succeed.
 *
 * - `requireIndependentReviewer` — the responder must differ from the
 *   reviewed run's driver (the human who kicked it, `projectAgentRuns.
 *   startedBy`); for workflow-era reviews with no resolvable run, from the
 *   task's creator. The four-eyes rule for agent deliverables.
 * - `requiredCompetences` — competence slugs the responder must ALL hold via
 *   unexpired, unrevoked `competenceRecords` rows
 *   (`convex/governance/competence.ts`).
 */
export const reviewPolicyConfigSchema = z.object({
  requireIndependentReviewer: z.boolean().optional(),
  requiredCompetences: z.array(z.string().min(1).max(120)).max(20).optional(),
});
export type ReviewPolicyConfig = z.infer<typeof reviewPolicyConfigSchema>;

/**
 * Maps each governance `PolicyType` to its config Zod schema. Single source
 * of truth replacing the per-type `safeParse` switch that used to live in
 * `governance/mutations.ts`. The file-based config store (`governance/file_utils.ts`)
 * validates each `<policyType>.json` against `POLICY_SCHEMAS[policyType]`, and
 * the cache-sync action uses it to validate before mirroring into Convex.
 *
 * `personalization` is intentionally absent — it is a legacy combined toggle
 * being drained into `custom_instructions` + `user_memories`; it has no file
 * representation and is never written through the new path.
 */
export const POLICY_SCHEMAS = {
  system_prompt: systemPromptConfigSchema,
  budgets: budgetConfigSchema,
  default_models: defaultModelsConfigSchema,
  upload_policy: uploadPolicyConfigSchema,
  retention_policy: retentionPolicyConfigSchema,
  feature_flags: featureFlagsConfigSchema,
  pii_config: piiConfigSchema,
  model_access: modelAccessConfigSchema,
  login_policy: loginPolicyConfigSchema,
  password_policy: passwordPolicyConfigSchema,
  two_factor_policy: twoFactorPolicyConfigSchema,
  session_idle_timeout: sessionIdleTimeoutConfigSchema,
  chat_filter: chatFilterConfigSchema,
  moderation_provider: moderationProviderConfigSchema,
  custom_instructions: customInstructionsConfigSchema,
  user_memories: userMemoriesConfigSchema,
  voice_output: voiceOutputConfigSchema,
  data_classification_notice: dataNoticeConfigSchema,
  dsar_governance: dsarGovernanceConfigSchema,
  agent_jobs: agentJobsConfigSchema,
  task_automation: taskAutomationConfigSchema,
  run_code: runCodePolicyConfigSchema,
  model_sync: modelSyncConfigSchema,
  sandbox_quota: sandboxQuotaConfigSchema,
  conversation_access: conversationAccessConfigSchema,
  conversation_routing: conversationRoutingConfigSchema,
  approval_policy: approvalPolicyConfigSchema,
  vision_model: visionModelConfigSchema,
  review_policy: reviewPolicyConfigSchema,
} satisfies Partial<Record<PolicyType, z.ZodType>>;

/** Policy types that have a file-based representation (every type except the
 *  legacy `personalization` toggle). */
export type FilePolicyType = keyof typeof POLICY_SCHEMAS;

export const FILE_POLICY_TYPES = Object.keys(
  POLICY_SCHEMAS,
) as FilePolicyType[];

export function isFilePolicyType(value: string): value is FilePolicyType {
  return Object.prototype.hasOwnProperty.call(POLICY_SCHEMAS, value);
}

/**
 * Policy types are snake_case internal identifiers (`password_policy`), but
 * on-disk filenames are kebab-case to match the rest of the file-based config
 * (`agents/`, `prompts/`, `workflows/`). Policy types never contain `-`, so
 * the `_`↔`-` mapping is unambiguous and round-trips losslessly.
 *
 * V8-safe (no `node:*`) so the config-domain registry
 * (`lib/shared/config/registry.ts`) can reference it directly.
 */
export function policyTypeToFileBase(policyType: FilePolicyType): string {
  return policyType.replaceAll('_', '-');
}

export function fileBaseToPolicyType(fileBase: string): FilePolicyType | null {
  const candidate = fileBase.replaceAll('-', '_');
  return isFilePolicyType(candidate) ? candidate : null;
}
