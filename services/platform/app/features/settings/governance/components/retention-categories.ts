/**
 * Phase 13 — single source of truth for the retention editor's category
 * config. Drives the grouped IA + preset defaults + bounds lookup.
 *
 * Each category maps to one (configKey + enabledKey) pair on the
 * `retentionPolicyConfigSchema`. The `group` field controls which
 * `<PageSection>` the row renders inside.
 *
 * `presetDefaults` carries Standard / Strict tuned defaults that the
 * preset row applies in one click. `Custom` reveals the per-category
 * inputs and lets the admin tune individual values.
 */

import type { RetentionPolicyConfig } from '@/lib/shared/schemas/governance';

export type CategoryGroup =
  | 'userContent'
  | 'operationalLogs'
  | 'securityAudit'
  | 'deletionBehavior';

export type CategoryUnit = 'days' | 'hours';

/** Backend RetentionCategory id (matches retention_floors.ts). */
export type CategoryId =
  | 'documents'
  | 'userTempHours'
  | 'agentTempHours'
  | 'chatHistory'
  | 'auditLog'
  | 'workflowLog'
  | 'usageLedger'
  | 'loginAttempt'
  | 'chatFilterEvents'
  | 'promptTemplates'
  | 'messageFeedback'
  | 'memoryAudit'
  | 'customers'
  | 'vendors'
  | 'externalConversations'
  | 'messageMetadata';

export interface CategoryDef {
  id: CategoryId;
  group: CategoryGroup;
  /** i18n key under `governance.retentionPolicy.<i18nKey>`. */
  i18nKey: string;
  /** Field name on the config object (numeric). */
  configKey: keyof RetentionPolicyConfig;
  /** Field name on the config object (boolean — enable toggle). undefined for
   *  the deletion-grace window which is always-on. */
  enabledKey?: keyof RetentionPolicyConfig;
  /** Default value when the preset is `Standard`. */
  standardDefault: number;
  /** Default value when the preset is `Strict` (typically half of standard). */
  strictDefault: number;
}

/**
 * Synchronous fallback for `unit` while bounds load. Backend JSON file
 * is the canonical source of truth (refined to match this convention),
 * so this fallback always agrees with `bound.unit` once it arrives.
 */
export function unitForCategoryId(id: CategoryId): CategoryUnit {
  return id.endsWith('Hours') ? 'hours' : 'days';
}

/**
 * Ordered list — the editor renders categories in this order within
 * each group.
 */
export const RETENTION_CATEGORIES: readonly CategoryDef[] = [
  // ---- User Content ----
  {
    id: 'chatHistory',
    group: 'userContent',
    i18nKey: 'chatHistory',
    configKey: 'chatHistoryRetentionDays',
    enabledKey: 'chatHistoryEnabled',
    standardDefault: 90,
    strictDefault: 30,
  },
  {
    id: 'documents',
    group: 'userContent',
    i18nKey: 'documents',
    configKey: 'retentionDays',
    enabledKey: 'documentsEnabled',
    standardDefault: 365,
    strictDefault: 180,
  },
  {
    id: 'userTempHours',
    group: 'userContent',
    i18nKey: 'userTemp',
    configKey: 'userTempRetentionHours',
    enabledKey: 'userTempEnabled',
    standardDefault: 24,
    strictDefault: 12,
  },
  {
    id: 'agentTempHours',
    group: 'userContent',
    i18nKey: 'agentTemp',
    configKey: 'agentTempRetentionHours',
    enabledKey: 'agentTempEnabled',
    standardDefault: 24,
    strictDefault: 12,
  },
  {
    id: 'promptTemplates',
    group: 'userContent',
    i18nKey: 'promptTemplates',
    configKey: 'promptTemplatesRetentionDays',
    enabledKey: 'promptTemplatesEnabled',
    standardDefault: 730,
    strictDefault: 365,
  },
  {
    id: 'messageFeedback',
    group: 'userContent',
    i18nKey: 'messageFeedback',
    configKey: 'messageFeedbackRetentionDays',
    enabledKey: 'messageFeedbackEnabled',
    standardDefault: 365,
    strictDefault: 180,
  },
  {
    id: 'customers',
    group: 'userContent',
    i18nKey: 'customers',
    configKey: 'customersRetentionDays',
    enabledKey: 'customersEnabled',
    standardDefault: 730,
    strictDefault: 365,
  },
  {
    id: 'vendors',
    group: 'userContent',
    i18nKey: 'vendors',
    configKey: 'vendorsRetentionDays',
    enabledKey: 'vendorsEnabled',
    standardDefault: 730,
    strictDefault: 365,
  },
  {
    id: 'externalConversations',
    group: 'userContent',
    i18nKey: 'externalConversations',
    configKey: 'externalConversationsRetentionDays',
    enabledKey: 'externalConversationsEnabled',
    standardDefault: 730,
    strictDefault: 365,
  },
  {
    id: 'messageMetadata',
    group: 'userContent',
    i18nKey: 'messageMetadata',
    configKey: 'messageMetadataRetentionDays',
    enabledKey: 'messageMetadataEnabled',
    standardDefault: 365,
    strictDefault: 180,
  },
  // ---- Operational Logs ----
  {
    id: 'workflowLog',
    group: 'operationalLogs',
    i18nKey: 'workflowLogs',
    configKey: 'workflowLogRetentionDays',
    enabledKey: 'workflowLogsEnabled',
    standardDefault: 30,
    strictDefault: 14,
  },
  {
    id: 'usageLedger',
    group: 'operationalLogs',
    i18nKey: 'usageLedger',
    configKey: 'usageLedgerRetentionDays',
    enabledKey: 'usageLedgerEnabled',
    standardDefault: 365,
    strictDefault: 180,
  },
  // ---- Security & Audit ----
  {
    id: 'auditLog',
    group: 'securityAudit',
    i18nKey: 'auditLogs',
    configKey: 'auditLogRetentionDays',
    enabledKey: 'auditLogsEnabled',
    // Standard sits at the platform default (730d / 2y) which is comfortably
    // above the hard-coded floor of 365d (PCI/SOC2/ISO baseline).
    standardDefault: 730,
    // Strict still respects the floor — operator's only knob is to RAISE it.
    strictDefault: 365,
  },
  {
    id: 'loginAttempt',
    group: 'securityAudit',
    i18nKey: 'loginAttempts',
    configKey: 'loginAttemptRetentionDays',
    enabledKey: 'loginAttemptsEnabled',
    standardDefault: 90,
    strictDefault: 90,
  },
  {
    id: 'chatFilterEvents',
    group: 'securityAudit',
    i18nKey: 'chatFilterEvents',
    configKey: 'chatFilterEventsRetentionDays',
    enabledKey: 'chatFilterEventsEnabled',
    standardDefault: 90,
    strictDefault: 30,
  },
  {
    id: 'memoryAudit',
    group: 'securityAudit',
    i18nKey: 'memoryAudit',
    configKey: 'memoryAuditRetentionDays',
    enabledKey: 'memoryAuditEnabled',
    standardDefault: 365,
    strictDefault: 180,
  },
];

export type Preset = 'standard' | 'strict' | 'custom';

/** Build a config object pre-filled for the given preset. */
export function buildPresetConfig(
  preset: Preset,
): Partial<RetentionPolicyConfig> {
  if (preset === 'custom') return {};
  const result: Record<string, unknown> = {
    deletionGraceDays: preset === 'standard' ? 30 : 7,
  };
  for (const cat of RETENTION_CATEGORIES) {
    const value =
      preset === 'standard' ? cat.standardDefault : cat.strictDefault;
    result[cat.configKey as string] = value;
    if (cat.enabledKey) {
      result[cat.enabledKey as string] = true;
    }
  }
  return result as Partial<RetentionPolicyConfig>;
}

export const GROUP_ORDER: readonly CategoryGroup[] = [
  'userContent',
  'operationalLogs',
  'securityAudit',
  'deletionBehavior',
];

export function categoriesInGroup(group: CategoryGroup): CategoryDef[] {
  return RETENTION_CATEGORIES.filter((c) => c.group === group);
}
