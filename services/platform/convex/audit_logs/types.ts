import type { Infer } from 'convex/values';
import {
  auditLogActorTypeValidator,
  auditLogCategoryValidator,
  auditLogStatusValidator,
  auditLogItemValidator,
  auditLogFilterValidator,
} from './validators';

export type AuditLogActorType = Infer<typeof auditLogActorTypeValidator>;
export type AuditLogCategory = Infer<typeof auditLogCategoryValidator>;
export type AuditLogStatus = Infer<typeof auditLogStatusValidator>;
export type AuditLogItem = Infer<typeof auditLogItemValidator>;
export type AuditLogFilter = Infer<typeof auditLogFilterValidator>;

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
