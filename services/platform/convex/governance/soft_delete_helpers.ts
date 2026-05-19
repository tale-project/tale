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
  /**
   * Field on the row that identifies the row's "author" / "owner" for
   * the user-membership legal-hold cascade. When set, restore + delete
   * paths consult `holds.userMembershipIds.has(row[authorField])` and
   * refuse if the author is on a custodian hold. When unset (e.g. CRM
   * tables that aren't user-attributed), the cascade is a no-op and
   * only org-wide holds apply.
   */
  readonly authorField?:
    | 'userId'
    | 'createdBy'
    | 'uploadedBy'
    | 'actorId'
    | 'subjectUserId';
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
    authorField: 'userId',
  },
  document: {
    tableName: 'documents',
    statusField: 'lifecycleStatus',
    auditPrefix: 'document',
    auditResourceType: 'document',
    displayNameField: 'title',
    authorField: 'createdBy',
  },
  fileMetadata: {
    tableName: 'fileMetadata',
    statusField: 'lifecycleStatus',
    auditPrefix: 'file_metadata',
    auditResourceType: 'file',
    displayNameField: 'fileName',
    authorField: 'uploadedBy',
  },
  promptTemplate: {
    tableName: 'promptTemplates',
    statusField: 'lifecycleStatus',
    auditPrefix: 'prompt_template',
    auditResourceType: 'prompt_template',
    displayNameField: 'title',
    authorField: 'createdBy',
  },
  messageFeedback: {
    tableName: 'messageFeedback',
    statusField: 'lifecycleStatus',
    auditPrefix: 'message_feedback',
    auditResourceType: 'message_feedback',
    authorField: 'userId',
  },
  customer: {
    tableName: 'customers',
    statusField: 'lifecycleStatus',
    auditPrefix: 'customer',
    auditResourceType: 'customer',
    displayNameField: 'name',
    // No author field — CRM rows aren't user-attributed; only org-wide
    // holds gate restore for these.
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
  workflowExecution: {
    tableName: 'wfExecutions',
    statusField: 'lifecycleStatus',
    auditPrefix: 'workflow_execution',
    auditResourceType: 'workflow_execution',
    displayNameField: 'workflowSlug',
    authorField: 'userId',
  },
  usageLedger: {
    tableName: 'usageLedger',
    statusField: 'lifecycleStatus',
    auditPrefix: 'usage_ledger',
    auditResourceType: 'usage_ledger',
    displayNameField: 'periodKey',
    authorField: 'userId',
  },
  auditLog: {
    tableName: 'auditLogs',
    statusField: 'lifecycleStatus',
    auditPrefix: 'audit_log',
    auditResourceType: 'audit_log',
    displayNameField: 'action',
    authorField: 'actorId',
  },
  chatFilterEvent: {
    tableName: 'chatFilterEvents',
    statusField: 'lifecycleStatus',
    auditPrefix: 'chat_filter_event',
    auditResourceType: 'chat_filter_event',
    // No direct author; cascade flows via the parent thread's `userId`
    // and is enforced by `retention_cleanup.ts:cleanupChatFilterEvents`.
  },
  memoryAudit: {
    tableName: 'userMemoryAuditLog',
    statusField: 'lifecycleStatus',
    auditPrefix: 'memory_audit',
    auditResourceType: 'memory_audit',
    displayNameField: 'action',
    authorField: 'subjectUserId',
  },
  sandboxExecution: {
    tableName: 'sandboxExecutions',
    statusField: 'lifecycleStatus',
    auditPrefix: 'sandbox_execution',
    auditResourceType: 'sandbox_execution',
    displayNameField: 'purpose',
    authorField: 'uploadedBy',
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
  /**
   * Caller's organizationId. The helper refuses to restore a row whose
   * `organizationId` does not match — without this gate, an admin of
   * org A who knows or guesses an org B row id can patch the row to
   * `active`, bypass legal-hold checks (which load against caller's
   * org), and emit an audit row attributing the restore to the wrong
   * org. Mirrors `markRowExpiredGeneric`'s symmetric org guard.
   *
   * Returns `not_found` (NOT a distinguished `forbidden`) on cross-org
   * mismatch so the caller cannot use the helper as an id-existence
   * oracle for foreign orgs.
   */
  organizationId: string,
  /**
   * Set of user ids on an active custodian (`userMembership`) legal
   * hold for `organizationId`. The helper refuses to restore when the
   * row's author (per `config.authorField`) is in this set, so
   * generic admin-trash restore enforces the same custodian cascade
   * the user-facing `restoreChatThread` and the public delete paths
   * already enforce. Pass an empty Set to skip the cascade check
   * (e.g. when no user-membership holds are active).
   */
  userMembershipIds: Set<string>,
): Promise<
  | { ok: true; previousStatus: string }
  | { ok: false; reason: string; authorUserId?: string }
> {
  const config = SOFT_DELETE_RESOURCE_CONFIG[resourceType];
  const id = ctx.db.normalizeId(config.tableName, rowId);
  if (!id) return { ok: false, reason: 'not_found' };
  const row = await ctx.db.get(id);
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'not_found' };
  }

  const rowOrgIdRaw = readField(row, 'organizationId');
  const rowOrgId = typeof rowOrgIdRaw === 'string' ? rowOrgIdRaw : undefined;
  if (rowOrgId !== organizationId) {
    return { ok: false, reason: 'not_found' };
  }

  if (config.authorField) {
    const authorRaw = readField(row, config.authorField);
    const authorUserId = typeof authorRaw === 'string' ? authorRaw : undefined;
    if (authorUserId && userMembershipIds.has(authorUserId)) {
      return {
        ok: false,
        reason: 'user_custodian_hold',
        authorUserId,
      };
    }
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
