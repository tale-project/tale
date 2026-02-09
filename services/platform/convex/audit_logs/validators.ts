import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import {
  AUDIT_LOG_ACTOR_TYPES,
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_STATUSES,
} from './schema';

export const auditLogActorTypeValidator = v.union(
  ...AUDIT_LOG_ACTOR_TYPES.map((t) => v.literal(t)),
);
export const auditLogCategoryValidator = v.union(
  ...AUDIT_LOG_CATEGORIES.map((c) => v.literal(c)),
);
export const auditLogStatusValidator = v.union(
  ...AUDIT_LOG_STATUSES.map((s) => v.literal(s)),
);

export const auditLogItemValidator = v.object({
  _id: v.id('auditLogs'),
  _creationTime: v.number(),
  organizationId: v.string(),

  actorId: v.string(),
  actorEmail: v.optional(v.string()),
  actorRole: v.optional(v.string()),
  actorType: auditLogActorTypeValidator,

  action: v.string(),
  category: auditLogCategoryValidator,

  resourceType: v.string(),
  resourceId: v.optional(v.string()),
  resourceName: v.optional(v.string()),

  previousState: v.optional(jsonRecordValidator),
  newState: v.optional(jsonRecordValidator),
  changedFields: v.optional(v.array(v.string())),

  sessionId: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  requestId: v.optional(v.string()),

  timestamp: v.number(),
  status: auditLogStatusValidator,
  errorMessage: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
});

export const auditLogFilterValidator = v.object({
  category: v.optional(auditLogCategoryValidator),
  actorId: v.optional(v.string()),
  resourceType: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  status: v.optional(auditLogStatusValidator),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  search: v.optional(v.string()),
});
