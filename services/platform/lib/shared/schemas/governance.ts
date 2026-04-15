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

export const auditRetentionConfigSchema = z.object({
  retentionDays: z.number().int().min(30).max(365),
});

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
