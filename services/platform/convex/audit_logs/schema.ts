import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const AUDIT_LOG_ACTOR_TYPES = ['user', 'system', 'api', 'workflow'] as const;
export const AUDIT_LOG_CATEGORIES = [
  'auth',
  'member',
  'data',
  'integration',
  'workflow',
  'security',
  'admin',
] as const;
export const AUDIT_LOG_STATUSES = ['success', 'failure', 'denied'] as const;

const actorTypeValidator = v.union(
  ...AUDIT_LOG_ACTOR_TYPES.map((t) => v.literal(t)),
);
const categoryValidator = v.union(
  ...AUDIT_LOG_CATEGORIES.map((c) => v.literal(c)),
);
const statusValidator = v.union(
  ...AUDIT_LOG_STATUSES.map((s) => v.literal(s)),
);

export const auditLogsTable = defineTable({
  organizationId: v.string(),

  actorId: v.string(),
  actorEmail: v.optional(v.string()),
  actorRole: v.optional(v.string()),
  actorType: actorTypeValidator,

  action: v.string(),
  category: categoryValidator,

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
  status: statusValidator,
  errorMessage: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_timestamp', ['organizationId', 'timestamp'])
  .index('by_organizationId_and_category', ['organizationId', 'category'])
  .index('by_organizationId_and_actorId', ['organizationId', 'actorId'])
  .index('by_organizationId_and_resourceType', ['organizationId', 'resourceType'])
  .index('by_org_category_timestamp', ['organizationId', 'category', 'timestamp'])
  .index('by_org_resourceType_timestamp', ['organizationId', 'resourceType', 'timestamp'])
  .index('by_resourceType_and_resourceId', ['resourceType', 'resourceId']);
