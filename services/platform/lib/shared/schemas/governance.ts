import { z } from 'zod/v4';

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
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

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
  maxTotalVolumeBytesPerUser: z.number().nonnegative().optional(),
});
export type UploadPolicyConfig = z.infer<typeof uploadPolicyConfigSchema>;

export const retentionPolicyConfigSchema = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().nonnegative(),
  batchSize: z.number().nonnegative().optional(),
  userTempEnabled: z.boolean().optional(),
  userTempRetentionHours: z.number().nonnegative().optional(),
  agentTempEnabled: z.boolean().optional(),
  agentTempRetentionHours: z.number().nonnegative().optional(),
  chatHistoryEnabled: z.boolean().optional(),
  chatHistoryRetentionDays: z.number().int().min(1).max(3650).optional(),
  auditLogsEnabled: z.boolean().optional(),
  auditLogRetentionDays: z.number().int().min(30).max(365).optional(),
  workflowLogsEnabled: z.boolean().optional(),
  workflowLogRetentionDays: z.number().int().min(1).max(365).optional(),
  usageLedgerEnabled: z.boolean().optional(),
  usageLedgerRetentionDays: z.number().int().min(30).max(3650).optional(),
  loginAttemptsEnabled: z.boolean().optional(),
  loginAttemptRetentionDays: z.number().int().min(7).max(365).optional(),
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
    }, 'Invalid regex pattern'),
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
