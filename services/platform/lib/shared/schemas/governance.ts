import safe from 'safe-regex2';
import { z } from 'zod/v4';

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
  'chat_filter',
  'moderation_provider',
  'personalization',
  // Phase 12 — admin-customizable confidentiality notice.
  'data_classification_notice',
  // GDPR DSAR governance — cooling-off window, dual approval, and
  // per-admin daily filing rate limit. See `dsarGovernanceConfigSchema`
  // for the config shape and defaults.
  'dsar_governance',
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

// Org-level default for the personalization feature (custom instructions +
// memories + propose_memory tool). Per-user `userPreferences.enabled` may
// override this default; absent user preference falls back to this value.
// Missing row entirely → effective default is OFF.
export const personalizationConfigSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Org-wide system prompt override that gets prepended to every agent's
 * generated system prompt. Round-2 review CRITICAL #24 / E.1.3:
 * `upsertPolicy` had a Zod safeParse branch for every other policy type
 * but `system_prompt` — meaning arbitrary JSON could be persisted under
 * this policyType and read back without validation. Schema kept tight
 * (enabled flag + bounded prompt text) to fit the actual write surface.
 */
export const systemPromptConfigSchema = z.object({
  enabled: z.boolean(),
  prompt: z.string().max(20_000),
});

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
  scope: z.enum(['user', 'team', 'role', 'org', 'default']),
  scopeId: z.string().optional(),
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
 * `examples/retention/default.json` (or per-org override files) and are
 * enforced at write time by `assertWithinBounds` inside
 * `upsertRetentionPolicyAction`. Operators tighten or rename bounds by
 * editing the JSON file; the schema does not duplicate them.
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
  promptTemplatesEnabled: z.boolean().optional(),
  promptTemplatesRetentionDays: z.number().int().nonnegative().optional(),
  messageFeedbackEnabled: z.boolean().optional(),
  messageFeedbackRetentionDays: z.number().int().nonnegative().optional(),
  memoryAuditEnabled: z.boolean().optional(),
  memoryAuditRetentionDays: z.number().int().nonnegative().optional(),
  customersEnabled: z.boolean().optional(),
  customersRetentionDays: z.number().int().nonnegative().optional(),
  vendorsEnabled: z.boolean().optional(),
  vendorsRetentionDays: z.number().int().nonnegative().optional(),
  externalConversationsEnabled: z.boolean().optional(),
  externalConversationsRetentionDays: z.number().int().nonnegative().optional(),
  messageMetadataEnabled: z.boolean().optional(),
  messageMetadataRetentionDays: z.number().int().nonnegative().optional(),
  /**
   * In-app notification retention. Notifications carry peppered email +
   * IP for security alerts (lockouts, etc.) and have no value past a
   * short admin review window. Default 30 days; bounded by the
   * `notifications` retention category in the JSON config.
   * Round-2 V6 P0-17.
   */
  notificationsEnabled: z.boolean().optional(),
  notificationsRetentionDays: z.number().int().nonnegative().optional(),
  deletionGraceDays: z.number().int().min(0).max(90).optional(),
});
export type RetentionPolicyConfig = z.infer<typeof retentionPolicyConfigSchema>;

export const featureFlagRuleSchema = z.object({
  scope: z.enum(['user', 'team', 'role', 'default']),
  scopeId: z.string().optional(),
  webSearch: z.boolean().optional(),
  codeExecution: z.boolean().optional(),
  fileUpload: z.boolean().optional(),
  maxContextTokens: z.number().min(4096).optional(),
});
export type FeatureFlagRule = z.infer<typeof featureFlagRuleSchema>;

export const featureFlagsConfigSchema = z.object({
  rules: z.array(featureFlagRuleSchema),
  enabled: z.boolean(),
});
export type FeatureFlagsConfig = z.infer<typeof featureFlagsConfigSchema>;

const piiCustomPatternSchema = z.object({
  name: z.string().min(1),
  regex: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid regex pattern')
    // Static AST analysis: rejects nested-quantifier shapes like `(a+)+b`,
    // `(a|aa)+`, `(a|a?)+` that exhibit catastrophic backtracking. Without
    // this, an admin can save a pattern that hangs every guardrail-protected
    // message — `execWithBudget` checks the wall clock only between `exec()`
    // calls and cannot pre-empt a single pathological exec.
    .refine((v) => {
      try {
        return safe(v);
      } catch {
        return false;
      }
    }, 'Pattern is unsafe — likely catastrophic backtracking'),
  replacement: z.string().min(1),
});

export const piiConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['mask', 'block']),
  enabledPatterns: z.array(z.string()),
  customPatterns: z.array(piiCustomPatternSchema).optional(),
});

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
  perIpLimit: z
    .object({
      rate: z.number().int().min(1).max(1000),
      periodSec: z.number().int().min(1).max(3600),
    })
    .optional(),
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
  minLength: z.number().int().min(6).max(128).default(8),
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

const moderationRequestTemplateSchema = z
  .string()
  .min(1)
  .refine(
    (v) => !/\{\{secret\./.test(v),
    'Secrets not allowed in body template',
  )
  .refine((v) => {
    try {
      JSON.parse(
        v.replace(/\{\{text\}\}/g, '""').replace(/\{\{direction\}\}/g, '""'),
      );
      return true;
    } catch {
      return false;
    }
  }, 'Request template must be valid JSON');

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

const moderationEndpointSchema = z.object({
  // Accept http:// and https://. HTTPS is strongly recommended for public
  // endpoints (the request carries chat text in the clear) but HTTP is
  // valid for internal / localhost mocks. The URL's own host is auto-
  // allowlisted by `safeFetch`, so admins don't need to also configure an
  // SSRF allowlist — redirects to a different host still get rejected.
  url: z
    .string()
    .url()
    .refine((u) => {
      try {
        const p = new URL(u).protocol;
        return p === 'https:' || p === 'http:';
      } catch {
        return false;
      }
    }, 'URL must be http(s)://'),
  method: z.literal('POST').default('POST'),
  headers: z.record(
    z.string().regex(headerNameRegex, 'Invalid header name'),
    z.string().refine((v) => !crlfNullRegex.test(v), 'CRLF not allowed'),
  ),
  requestTemplate: moderationRequestTemplateSchema,
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
    categoriesPath: z.string().min(1),
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

export const moderationProviderConfigSchema = z.object({
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
