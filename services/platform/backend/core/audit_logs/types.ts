import type { SoftDeleteStatus } from '../governance/soft_delete';

export const AUDIT_LOG_ACTOR_TYPES = [
  'user',
  'system',
  'api',
  'workflow',
] as const;
export const AUDIT_LOG_CATEGORIES = [
  'auth',
  'member',
  'data',
  'connector',
  // Legacy spelling of `connector` from before the integration→connector
  // rename (#2876). 0.4 deploys never write it; accepted so pre-rename LOCAL
  // dev rows keep validating (audit rows are immutable history — a hash
  // chain — so they are read as-is rather than rewritten).
  'integration',
  'workflow',
  'security',
  'admin',
  'ai',
  'skill',
  'agent',
] as const;
export const AUDIT_LOG_STATUSES = ['success', 'failure', 'denied'] as const;

export type AuditLogActorType = (typeof AUDIT_LOG_ACTOR_TYPES)[number];
export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];
export type AuditLogStatus = (typeof AUDIT_LOG_STATUSES)[number];

/** One audit-log row as the read surfaces return it. */
export interface AuditLogItem {
  _id: string;
  _creationTime: number;
  organizationId: string;

  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  actorType: AuditLogActorType;

  action: string;
  category: AuditLogCategory;

  resourceType: string;
  resourceId?: string;
  resourceName?: string;

  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  changedFields?: string[];

  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;

  timestamp: number;
  status: AuditLogStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;

  integrityHash?: string;
  previousHash?: string;
  chainSuccessor?: string;
  piiScrubbed?: boolean;
  piiScrubbedAt?: number;

  actorEmailHash?: string;
  actorIpHash?: string;

  // Patched onto the row by retention soft-delete (`markRowExpiredGeneric`).
  // Excluded from the integrity hash via `EXCLUDED_FIELDS` in
  // `audit_hash.ts`; declared here so read projections don't reject
  // soft-deleted rows.
  lifecycleStatus?: SoftDeleteStatus;
  statusChangedAt?: number;
}

export interface AuditLogFilter {
  category?: AuditLogCategory;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  status?: AuditLogStatus;
  startDate?: number;
  endDate?: number;
  search?: string;
}

export interface CreateAuditLogArgs {
  organizationId: string;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  actorType: AuditLogActorType;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  changedFields?: string[];
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  /**
   * Peppered hash of `actorEmail`. Mutually exclusive with `actorEmail`
   * on the same row — see schema.ts for the rationale.
   */
  actorEmailHash?: string;
  /**
   * Peppered hash of a coarse network prefix of `ipAddress`. Mutually
   * exclusive with `ipAddress` on the same row.
   */
  actorIpHash?: string;
  status: AuditLogStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsArgs {
  organizationId: string;
  filter?: AuditLogFilter;
  limit?: number;
  cursor?: string;
}

export interface GetResourceAuditTrailArgs {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  limit?: number;
}

export interface GetActivitySummaryArgs {
  organizationId: string;
  startDate?: number;
  endDate?: number;
}

export interface ActivitySummary {
  totalActions: number;
  successCount: number;
  failureCount: number;
  deniedCount: number;
  byCategory: Record<string, number>;
  byResourceType: Record<string, number>;
  topActors: Array<{ actorId: string; actorEmail?: string; count: number }>;
}

export interface AuditLogActor {
  id: string;
  email?: string;
  role?: string;
  type: AuditLogActorType;
}

export interface AuditContext {
  organizationId: string;
  actor: AuditLogActor;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface ArchiveAuditLogsArgs {
  organizationId: string;
  olderThanTimestamp: number;
  batchSize?: number;
}

export interface ExportAuditLogsArgs {
  organizationId: string;
  filter?: AuditLogFilter;
  format: 'csv' | 'json';
}
