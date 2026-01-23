import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';

export const auditLogActorTypeLiterals = ['user', 'system', 'api', 'workflow'] as const;
export const auditLogActorTypeSchema = z.enum(auditLogActorTypeLiterals);
export type AuditLogActorType = z.infer<typeof auditLogActorTypeSchema>;

export const auditLogCategoryLiterals = [
  'auth',
  'member',
  'data',
  'integration',
  'workflow',
  'security',
  'admin',
] as const;
export const auditLogCategorySchema = z.enum(auditLogCategoryLiterals);
export type AuditLogCategory = z.infer<typeof auditLogCategorySchema>;

export const auditLogStatusLiterals = ['success', 'failure', 'denied'] as const;
export const auditLogStatusSchema = z.enum(auditLogStatusLiterals);
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
