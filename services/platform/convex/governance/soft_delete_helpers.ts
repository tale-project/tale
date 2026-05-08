import { v } from 'convex/values';

import type { Id, TableNames } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { assertSafeRetentionDelete } from './internal_mutations_retention';
import {
  type SoftDeleteResourceType,
  softDeleteResourceTypeValidator,
} from './soft_delete_validators';

/**
 * Resource registry — maps each `SoftDeleteResourceType` to:
 *
 * - `tableName`: physical table the rows live in
 * - `statusField`: which column holds the lifecycle status (legacy threads
 *   use `status`; everyone else uses `lifecycleStatus`)
 * - `auditPrefix`: prefix for audit log action strings
 *   (`<prefix>.retention_expired`, `<prefix>.retention_deleted`,
 *   `<prefix>.restored_by_admin`)
 * - `displayNameField`: best-effort row-level field for trash UI display
 *   (falls back to id)
 *
 * Single source of truth for the generic Pass A / restore / list-trashed
 * machinery. New categories register here.
 *
 * `thread` is included for the generic restore + listing dispatch but the
 * restore actually delegates to the existing `restoreChatThread` because
 * threads have a richer cascade (un-archive agent thread).
 */
export interface ResourceConfig {
  readonly tableName: TableNames;
  readonly statusField: 'status' | 'lifecycleStatus';
  readonly auditPrefix: string;
  readonly auditResourceType: string;
  readonly displayNameField?: string;
}

export const SOFT_DELETE_RESOURCE_CONFIG: Record<
  SoftDeleteResourceType,
  ResourceConfig
> = {
  thread: {
    tableName: 'threadMetadata',
    statusField: 'status',
    auditPrefix: 'chat_thread',
    auditResourceType: 'thread',
    displayNameField: 'title',
  },
  document: {
    tableName: 'documents',
    statusField: 'lifecycleStatus',
    auditPrefix: 'document',
    auditResourceType: 'document',
    displayNameField: 'title',
  },
  fileMetadata: {
    tableName: 'fileMetadata',
    statusField: 'lifecycleStatus',
    auditPrefix: 'file_metadata',
    auditResourceType: 'file',
    displayNameField: 'fileName',
  },
  promptTemplate: {
    tableName: 'promptTemplates',
    statusField: 'lifecycleStatus',
    auditPrefix: 'prompt_template',
    auditResourceType: 'prompt_template',
    displayNameField: 'title',
  },
  messageFeedback: {
    tableName: 'messageFeedback',
    statusField: 'lifecycleStatus',
    auditPrefix: 'message_feedback',
    auditResourceType: 'message_feedback',
  },
  customer: {
    tableName: 'customers',
    statusField: 'lifecycleStatus',
    auditPrefix: 'customer',
    auditResourceType: 'customer',
    displayNameField: 'name',
  },
  vendor: {
    tableName: 'vendors',
    statusField: 'lifecycleStatus',
    auditPrefix: 'vendor',
    auditResourceType: 'vendor',
    displayNameField: 'name',
  },
  externalConversation: {
    tableName: 'conversations',
    statusField: 'lifecycleStatus',
    auditPrefix: 'external_conversation',
    auditResourceType: 'external_conversation',
    displayNameField: 'subject',
  },
  messageMetadata: {
    tableName: 'messageMetadata',
    statusField: 'lifecycleStatus',
    auditPrefix: 'message_metadata',
    auditResourceType: 'message_metadata',
  },
  workflowExecution: {
    tableName: 'wfExecutions',
    statusField: 'lifecycleStatus',
    auditPrefix: 'workflow_execution',
    auditResourceType: 'workflow_execution',
    displayNameField: 'workflowSlug',
  },
  workflowTriggerLog: {
    // Trigger logs cascade with executions; included for completeness, not
    // user-restorable in the Trash UI.
    tableName: 'wfExecutions',
    statusField: 'lifecycleStatus',
    auditPrefix: 'workflow_trigger_log',
    auditResourceType: 'workflow_trigger_log',
  },
  usageLedger: {
    tableName: 'usageLedger',
    statusField: 'lifecycleStatus',
    auditPrefix: 'usage_ledger',
    auditResourceType: 'usage_ledger',
    displayNameField: 'periodKey',
  },
  auditLog: {
    tableName: 'auditLogs',
    statusField: 'lifecycleStatus',
    auditPrefix: 'audit_log',
    auditResourceType: 'audit_log',
    displayNameField: 'action',
  },
  chatFilterEvent: {
    tableName: 'chatFilterEvents',
    statusField: 'lifecycleStatus',
    auditPrefix: 'chat_filter_event',
    auditResourceType: 'chat_filter_event',
  },
  memoryAudit: {
    tableName: 'userMemoryAuditLog',
    statusField: 'lifecycleStatus',
    auditPrefix: 'memory_audit',
    auditResourceType: 'memory_audit',
    displayNameField: 'action',
  },
};

interface SoftDeletableRow {
  _id: Id<TableNames>;
  _creationTime: number;
  organizationId?: string;
  status?: string;
  lifecycleStatus?: string;
  statusChangedAt?: number;
  updatedAt?: number;
  createdAt?: number;
}

/**
 * Pass A flip helper. Sets `lifecycleStatus = 'expired'` (or `status =
 * 'expired'` for the legacy threads table) and stamps `statusChangedAt`,
 * gated by `assertSafeRetentionDelete`. Idempotent: rows already
 * trashed/expired/deleted no-op.
 *
 * Per-resource thin wrappers (e.g. `markDocumentExpired`) live in
 * `internal_mutations_soft_delete.ts` and delegate here. Threads keep
 * their bespoke `markThreadExpired` because the existing implementation
 * has audit semantics this generic helper does not reproduce
 * byte-for-byte.
 */
export const markRowExpiredGeneric = internalMutation({
  args: {
    resourceType: softDeleteResourceTypeValidator,
    rowId: v.string(),
    organizationId: v.string(),
    cutoffMs: v.optional(v.number()),
    /** Field on the row holding the retention-effective timestamp. */
    timestampField: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = SOFT_DELETE_RESOURCE_CONFIG[args.resourceType];
    const id = ctx.db.normalizeId(config.tableName, args.rowId);
    if (!id) return null;
    const row = (await ctx.db.get(id)) as SoftDeletableRow | null;
    if (!row) return null;

    const tsField = args.timestampField ?? '_creationTime';
    const tsValue = readField(row, tsField);
    const rowEffectiveMs = typeof tsValue === 'number' ? tsValue : undefined;
    if (typeof rowEffectiveMs !== 'number') {
      console.warn(
        `[SoftDelete] row ${args.resourceType}/${String(id)} has no timestamp field "${tsField}" — skipping`,
      );
      return null;
    }

    const guard = await assertSafeRetentionDelete(ctx, {
      rowOrganizationId: row.organizationId,
      expectedOrganizationId: args.organizationId,
      rowEffectiveMs,
      cutoffMs: args.cutoffMs,
    });
    if (!guard.proceed) {
      console.info(
        `[SoftDelete] markRowExpired skip ${args.resourceType}/${String(id)}: ${guard.reason}`,
      );
      return null;
    }

    const status = row[config.statusField] ?? 'active';
    if (status !== 'active') return null;

    const now = Date.now();
    const patch: Record<string, unknown> = {
      [config.statusField]: 'expired',
      statusChangedAt: now,
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- patch is shape-compatible with the row's table
    await ctx.db.patch(id, patch as never);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorEmail: 'system@tale.so',
      actorType: 'system',
      action: `${config.auditPrefix}.retention_expired`,
      category: 'data',
      resourceType: config.auditResourceType,
      resourceId: String(id),
      resourceName: getDisplayName(row, config) ?? String(id),
      status: 'success',
      newState: { previousStatus: status, newStatus: 'expired' },
    });
    return null;
  },
});

export function getDisplayName(
  row: SoftDeletableRow,
  config: ResourceConfig,
): string | undefined {
  if (!config.displayNameField) return undefined;
  const value = readField(row, config.displayNameField);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Generic field accessor for runtime-by-name lookup on rows whose schema
 * varies per table. Encapsulates the unsafe cast so callers stay clean.
 */
function readField(row: unknown, field: string): unknown {
  if (row === null || typeof row !== 'object') return undefined;
  if (!Object.hasOwn(row, field)) return undefined;
  return Reflect.get(row, field);
}

/**
 * Generic restore back to `'active'`. Used by the public restore mutation
 * for non-thread resources. Thread restore is delegated to the existing
 * `restoreChatThread` because of agent-component cascade.
 *
 * Caller is responsible for permission gates (admin / owner) and audit
 * logging the restore action with context (e.g. type-to-confirm flow on
 * expired rows).
 */
export async function restoreRowToActive(
  ctx: MutationCtx,
  resourceType: SoftDeleteResourceType,
  rowId: string,
): Promise<
  { ok: true; previousStatus: string } | { ok: false; reason: string }
> {
  const config = SOFT_DELETE_RESOURCE_CONFIG[resourceType];
  const id = ctx.db.normalizeId(config.tableName, rowId);
  if (!id) return { ok: false, reason: 'not_found' };
  const row = await ctx.db.get(id);
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'not_found' };
  }

  const statusValue = readField(row, config.statusField);
  const status = typeof statusValue === 'string' ? statusValue : 'active';
  if (status === 'active') return { ok: false, reason: 'not_trashed' };
  if (status === 'deleted') return { ok: false, reason: 'already_purged' };

  const patch: Record<string, unknown> = {
    [config.statusField]: 'active',
    statusChangedAt: Date.now(),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- patch is shape-compatible with the row's table
  await ctx.db.patch(id, patch as never);
  return { ok: true, previousStatus: status };
}

// Per-category Pass-B grace-expired queries are defined in
// `internal_queries.ts` (e.g. `listGraceExpiredThreads`). The generic
// listing path lives in `queries.ts` (`listTrashedRows`) and dispatches
// to per-resource branches because Convex `withIndex` typing is
// table-specific and a single query can't satisfy all index shapes.
