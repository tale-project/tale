import { z } from 'zod/v4';
import {
  AUDIT_LOG_ACTOR_TYPES,
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_STATUSES,
} from '../../../convex/audit_logs/schema';
import { jsonRecordSchema } from './utils/json-value';

export const auditLogActorTypeSchema = z.enum(AUDIT_LOG_ACTOR_TYPES);
export type AuditLogActorType = z.infer<typeof auditLogActorTypeSchema>;

export const auditLogCategorySchema = z.enum(AUDIT_LOG_CATEGORIES);
export type AuditLogCategory = z.infer<typeof auditLogCategorySchema>;

export const auditLogStatusSchema = z.enum(AUDIT_LOG_STATUSES);
export type AuditLogStatus = z.infer<typeof auditLogStatusSchema>;

export const auditLogItemSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),

  actorId: z.string(),
  actorEmail: z.string().optional(),
  actorRole: z.string().optional(),
  actorType: auditLogActorTypeSchema,

  action: z.string(),
  category: auditLogCategorySchema,

  resourceType: z.string(),
  resourceId: z.string().optional(),
  resourceName: z.string().optional(),

  previousState: jsonRecordSchema.optional(),
  newState: jsonRecordSchema.optional(),
  changedFields: z.array(z.string()).optional(),

  sessionId: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  requestId: z.string().optional(),

  timestamp: z.number(),
  status: auditLogStatusSchema,
  errorMessage: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});

export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

export const auditLogFilterSchema = z.object({
  category: auditLogCategorySchema.optional(),
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  status: auditLogStatusSchema.optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
  search: z.string().optional(),
});

export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;
