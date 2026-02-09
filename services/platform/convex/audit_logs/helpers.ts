import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type {
  CreateAuditLogArgs,
  ListAuditLogsArgs,
  GetResourceAuditTrailArgs,
  GetActivitySummaryArgs,
  ActivitySummary,
  AuditLogItem,
  AuditLogCategory,
  AuditContext,
} from './types';

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'secret',
  'apiKey',
  'apiSecret',
  'token',
  'accessToken',
  'refreshToken',
  'privateKey',
  'clientSecret',
  'credentials',
  'authorization',
  'auth',
  'bearer',
  'jwt',
  'sessionToken',
  'cookieValue',
  'oauthToken',
  'encryptionKey',
  'decryptionKey',
  'symmetricKey',
  'asymmetricKey',
  'salt',
  'iv',
  'nonce',
  'hmac',
  'signature',
]);

const REDACTED_VALUE = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    SENSITIVE_FIELDS.has(lowerKey) ||
    lowerKey.includes('password') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('token') ||
    lowerKey.includes('apikey') ||
    lowerKey.includes('api_key') ||
    lowerKey.includes('credential')
  );
}

export function redactSensitiveFields(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      redacted[key] = REDACTED_VALUE;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? redactSensitiveFields(item as Record<string, unknown>)
          : item,
      );
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function stableStringify(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = (value as Record<string, unknown>)[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
}

export function computeChangedFields(
  previousState: Record<string, unknown> | undefined,
  newState: Record<string, unknown> | undefined,
): string[] {
  if (!previousState && !newState) {
    return [];
  }

  if (!previousState) {
    return newState ? Object.keys(newState) : [];
  }

  if (!newState) {
    return Object.keys(previousState);
  }

  const changedFields: string[] = [];
  const allKeys = new Set([
    ...Object.keys(previousState),
    ...Object.keys(newState),
  ]);

  for (const key of allKeys) {
    const prevValue = previousState[key];
    const newValue = newState[key];

    if (stableStringify(prevValue) !== stableStringify(newValue)) {
      changedFields.push(key);
    }
  }

  return changedFields;
}

export async function createAuditLog(
  ctx: MutationCtx,
  args: CreateAuditLogArgs,
): Promise<Id<'auditLogs'>> {
  const redactedPreviousState = redactSensitiveFields(args.previousState);
  const redactedNewState = redactSensitiveFields(args.newState);

  const changedFields =
    args.changedFields ??
    computeChangedFields(args.previousState, args.newState);

  const auditLogId = await ctx.db.insert('auditLogs', {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    actorRole: args.actorRole,
    actorType: args.actorType,
    action: args.action,
    category: args.category,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    resourceName: args.resourceName,
    previousState: redactedPreviousState,
    newState: redactedNewState,
    changedFields: changedFields.length > 0 ? changedFields : undefined,
    sessionId: args.sessionId,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
    requestId: args.requestId,
    timestamp: Date.now(),
    status: args.status,
    errorMessage: args.errorMessage,
    metadata: args.metadata,
  });

  return auditLogId;
}

export async function logSuccess(
  ctx: MutationCtx,
  auditCtx: AuditContext,
  action: string,
  category: AuditLogCategory,
  resourceType: string,
  resourceId?: string,
  resourceName?: string,
  previousState?: Record<string, unknown>,
  newState?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: auditCtx.organizationId,
    actorId: auditCtx.actor.id,
    actorEmail: auditCtx.actor.email,
    actorRole: auditCtx.actor.role,
    actorType: auditCtx.actor.type,
    action,
    category,
    resourceType,
    resourceId,
    resourceName,
    previousState,
    newState,
    sessionId: auditCtx.sessionId,
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    status: 'success',
    metadata,
  });
}

export async function logFailure(
  ctx: MutationCtx,
  auditCtx: AuditContext,
  action: string,
  category: AuditLogCategory,
  resourceType: string,
  errorMessage: string,
  resourceId?: string,
  resourceName?: string,
  metadata?: Record<string, unknown>,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: auditCtx.organizationId,
    actorId: auditCtx.actor.id,
    actorEmail: auditCtx.actor.email,
    actorRole: auditCtx.actor.role,
    actorType: auditCtx.actor.type,
    action,
    category,
    resourceType,
    resourceId,
    resourceName,
    sessionId: auditCtx.sessionId,
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    status: 'failure',
    errorMessage,
    metadata,
  });
}

export async function logDenied(
  ctx: MutationCtx,
  auditCtx: AuditContext,
  action: string,
  category: AuditLogCategory,
  resourceType: string,
  reason: string,
  resourceId?: string,
  resourceName?: string,
  metadata?: Record<string, unknown>,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: auditCtx.organizationId,
    actorId: auditCtx.actor.id,
    actorEmail: auditCtx.actor.email,
    actorRole: auditCtx.actor.role,
    actorType: auditCtx.actor.type,
    action,
    category,
    resourceType,
    resourceId,
    resourceName,
    sessionId: auditCtx.sessionId,
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    status: 'denied',
    errorMessage: reason,
    metadata,
  });
}

function buildAuditLogQuery(
  ctx: QueryCtx,
  organizationId: string,
  filter: ListAuditLogsArgs['filter'] & {},
) {
  if (filter.category && filter.startDate) {
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_org_category_timestamp', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('category', filter.category!)
            .gte('timestamp', filter.startDate!),
        ),
      indexedFields: { category: true, startDate: true } as const,
    };
  }

  if (filter.resourceType && filter.startDate) {
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_org_resourceType_timestamp', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('resourceType', filter.resourceType!)
            .gte('timestamp', filter.startDate!),
        ),
      indexedFields: { resourceType: true, startDate: true } as const,
    };
  }

  if (filter.category) {
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_category', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('category', filter.category!),
        ),
      indexedFields: { category: true } as const,
    };
  }

  if (filter.actorId) {
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_actorId', (q) =>
          q.eq('organizationId', organizationId).eq('actorId', filter.actorId!),
        ),
      indexedFields: { actorId: true } as const,
    };
  }

  if (filter.resourceType) {
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_resourceType', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('resourceType', filter.resourceType!),
        ),
      indexedFields: { resourceType: true } as const,
    };
  }

  return {
    query: ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', organizationId),
      ),
    indexedFields: {} as const,
  };
}

export async function listAuditLogs(
  ctx: QueryCtx,
  args: ListAuditLogsArgs,
): Promise<{ logs: AuditLogItem[]; nextCursor?: string }> {
  const limit = args.limit ?? 50;
  const filter = args.filter ?? {};

  const { query, indexedFields } = buildAuditLogQuery(
    ctx,
    args.organizationId,
    filter,
  );
  const startDateHandledByIndex = 'startDate' in indexedFields;

  const logs: AuditLogItem[] = [];
  const startCursor = args.cursor;
  let foundCursor = !startCursor;

  for await (const log of query.order('desc')) {
    if (!foundCursor) {
      if (String(log._id) === startCursor) {
        foundCursor = true;
      }
      continue;
    }

    if (filter.endDate && log.timestamp > filter.endDate) {
      continue;
    }

    if (
      !startDateHandledByIndex &&
      filter.startDate &&
      log.timestamp < filter.startDate
    ) {
      break;
    }

    if (filter.status && log.status !== filter.status) {
      continue;
    }

    if (filter.resourceId && log.resourceId !== filter.resourceId) {
      continue;
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const matchesSearch =
        log.action.toLowerCase().includes(searchLower) ||
        log.resourceType.toLowerCase().includes(searchLower) ||
        log.resourceName?.toLowerCase().includes(searchLower) ||
        log.actorEmail?.toLowerCase().includes(searchLower);

      if (!matchesSearch) {
        continue;
      }
    }

    logs.push(log as AuditLogItem);

    if (logs.length >= limit + 1) {
      break;
    }
  }

  const hasMore = logs.length > limit;
  const resultLogs = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor =
    hasMore && resultLogs.length > 0
      ? resultLogs[resultLogs.length - 1]._id
      : undefined;

  return { logs: resultLogs, nextCursor };
}

export async function getResourceAuditTrail(
  ctx: QueryCtx,
  args: GetResourceAuditTrailArgs,
): Promise<AuditLogItem[]> {
  const limit = args.limit ?? 100;
  const logs: AuditLogItem[] = [];

  for await (const log of ctx.db
    .query('auditLogs')
    .withIndex('by_resourceType_and_resourceId', (q) =>
      q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId),
    )
    .order('desc')) {
    if (log.organizationId !== args.organizationId) {
      continue;
    }

    logs.push(log as AuditLogItem);

    if (logs.length >= limit) {
      break;
    }
  }

  return logs;
}

export async function getActivitySummary(
  ctx: QueryCtx,
  args: GetActivitySummaryArgs,
): Promise<ActivitySummary> {
  const now = Date.now();
  const startDate = args.startDate ?? now - 7 * 24 * 60 * 60 * 1000;
  const endDate = args.endDate ?? now;

  const summary: ActivitySummary = {
    totalActions: 0,
    successCount: 0,
    failureCount: 0,
    deniedCount: 0,
    byCategory: {},
    byResourceType: {},
    topActors: [],
  };

  const actorCounts = new Map<string, { email?: string; count: number }>();

  for await (const log of ctx.db
    .query('auditLogs')
    .withIndex('by_organizationId_and_timestamp', (q) =>
      q.eq('organizationId', args.organizationId).gte('timestamp', startDate),
    )
    .order('desc')) {
    if (log.timestamp > endDate) {
      continue;
    }

    if (log.timestamp < startDate) {
      break;
    }

    summary.totalActions++;

    if (log.status === 'success') {
      summary.successCount++;
    } else if (log.status === 'failure') {
      summary.failureCount++;
    } else if (log.status === 'denied') {
      summary.deniedCount++;
    }

    summary.byCategory[log.category] =
      (summary.byCategory[log.category] ?? 0) + 1;
    summary.byResourceType[log.resourceType] =
      (summary.byResourceType[log.resourceType] ?? 0) + 1;

    const actorData = actorCounts.get(log.actorId) ?? {
      email: log.actorEmail,
      count: 0,
    };
    actorData.count++;
    if (!actorData.email && log.actorEmail) {
      actorData.email = log.actorEmail;
    }
    actorCounts.set(log.actorId, actorData);
  }

  summary.topActors = Array.from(actorCounts.entries())
    .map(([actorId, data]) => ({
      actorId,
      actorEmail: data.email,
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return summary;
}
