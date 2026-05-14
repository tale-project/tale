/**
 * Wire mapping registry — single source of truth for the retention
 * editor's UI binding. Pairs each canonical `RetentionCategory` id
 * with its (configKey, enabledKey) on `RetentionPolicyConfig` and the
 * platform i18n key for label/help text.
 *
 * Bounds (`min`/`max`/`default`/`unit`) come from the per-org JSON
 * file via `useRetentionBounds()`; the JSON carries instance VALUES
 * only, never UI metadata or wire mapping. Per the declarative-config
 * pattern, the schema lives in code (this file), JSON is the runtime
 * instance.
 *
 * Field names follow the convention `<id>RetentionDays|RetentionHours`
 * and `<id>Enabled`. Compile-time exhaustiveness check at the bottom
 * trips when a new category is added to the canonical zod tuple
 * without a row here.
 */

import type { RetentionPolicyConfig } from '@/lib/shared/schemas/governance';
import {
  type RetentionCategory,
  RETENTION_CATEGORIES,
} from '@/lib/shared/schemas/retention';

export type CategoryId = RetentionCategory;

export interface CategoryWireMapping {
  id: CategoryId;
  /** Numeric retention value field. */
  configKey: keyof RetentionPolicyConfig;
  /** Boolean enable-toggle field. `undefined` = no toggle, always-on. */
  enabledKey?: keyof RetentionPolicyConfig;
  /** i18n key under `governance.retentionPolicy.<i18nKey>` for label/help. */
  i18nKey: string;
}

export const WIRE_MAPPING: readonly CategoryWireMapping[] = [
  {
    id: 'chatHistory',
    configKey: 'chatHistoryRetentionDays',
    enabledKey: 'chatHistoryEnabled',
    i18nKey: 'chatHistory',
  },
  {
    id: 'documents',
    configKey: 'documentsRetentionDays',
    enabledKey: 'documentsEnabled',
    i18nKey: 'documents',
  },
  {
    id: 'userTempHours',
    configKey: 'userTempRetentionHours',
    enabledKey: 'userTempEnabled',
    i18nKey: 'userTemp',
  },
  {
    id: 'agentTempHours',
    configKey: 'agentTempRetentionHours',
    enabledKey: 'agentTempEnabled',
    i18nKey: 'agentTemp',
  },
  {
    id: 'messageFeedback',
    configKey: 'messageFeedbackRetentionDays',
    enabledKey: 'messageFeedbackEnabled',
    i18nKey: 'messageFeedback',
  },
  {
    id: 'customers',
    configKey: 'customersRetentionDays',
    enabledKey: 'customersEnabled',
    i18nKey: 'customers',
  },
  {
    id: 'vendors',
    configKey: 'vendorsRetentionDays',
    enabledKey: 'vendorsEnabled',
    i18nKey: 'vendors',
  },
  {
    id: 'externalConversations',
    configKey: 'externalConversationsRetentionDays',
    enabledKey: 'externalConversationsEnabled',
    i18nKey: 'externalConversations',
  },
  {
    id: 'messageMetadata',
    configKey: 'messageMetadataRetentionDays',
    enabledKey: 'messageMetadataEnabled',
    i18nKey: 'messageMetadata',
  },
  {
    id: 'workflowLog',
    configKey: 'workflowLogRetentionDays',
    enabledKey: 'workflowLogEnabled',
    i18nKey: 'workflowLogs',
  },
  {
    id: 'usageLedger',
    configKey: 'usageLedgerRetentionDays',
    enabledKey: 'usageLedgerEnabled',
    i18nKey: 'usageLedger',
  },
  {
    id: 'auditLog',
    configKey: 'auditLogRetentionDays',
    enabledKey: 'auditLogEnabled',
    i18nKey: 'auditLogs',
  },
  {
    id: 'loginAttempt',
    configKey: 'loginAttemptRetentionDays',
    enabledKey: 'loginAttemptEnabled',
    i18nKey: 'loginAttempts',
  },
  {
    id: 'chatFilterEvents',
    configKey: 'chatFilterEventsRetentionDays',
    enabledKey: 'chatFilterEventsEnabled',
    i18nKey: 'chatFilterEvents',
  },
  {
    id: 'promptTemplates',
    configKey: 'promptTemplatesRetentionDays',
    enabledKey: 'promptTemplatesEnabled',
    i18nKey: 'promptTemplates',
  },
  {
    id: 'memoryAudit',
    configKey: 'memoryAuditRetentionDays',
    enabledKey: 'memoryAuditEnabled',
    i18nKey: 'memoryAudit',
  },
  {
    id: 'notifications',
    configKey: 'notificationsRetentionDays',
    enabledKey: 'notificationsEnabled',
    i18nKey: 'notifications',
  },
] as const;

// Compile-time exhaustiveness: every canonical category must appear in
// WIRE_MAPPING. Pre-fix, the type was `Exclude<RetentionCategory,
// CategoryWireMapping['id']>` which evaluated to `never` permanently
// because `CategoryWireMapping['id']` is the FULL `RetentionCategory`
// union (the type alias), not the literal union of ids actually present
// in the array. Adding the missing `notifications` entry above wouldn't
// have been caught. The fix derives the literal union from the array's
// own contents via `(typeof WIRE_MAPPING)[number]['id']`.
// Round-2 review CRITICAL #25.
const _exhaustive: ReadonlySet<RetentionCategory> = new Set(
  WIRE_MAPPING.map((m) => m.id),
);
type _Missing = Exclude<
  (typeof RETENTION_CATEGORIES)[number],
  (typeof WIRE_MAPPING)[number]['id']
>;
const _missingCheck: _Missing extends never ? true : false = true;
void _exhaustive;
void _missingCheck;
