import { isRecord } from '../../lib/utils/type-guards';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { computeAuditHash } from '../lib/helpers/audit_hash';
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
  // Two-factor authentication (issue #1507) — TOTP codes and backup
  // codes are credential-equivalent; must never appear in audit state.
  'totpcode',
  'totpsecret',
  'backupcode',
  'backupcodes',
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
    lowerKey.includes('credential') ||
    lowerKey.includes('totp') ||
    lowerKey.includes('backupcode')
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
    } else if (isRecord(value)) {
      redacted[key] = redactSensitiveFields(value);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        isRecord(item) ? redactSensitiveFields(item) : item,
      );
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

function stableStringify(value: unknown): string {
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = value[key];
    }
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

/**
 * Single source of truth for the canonical record payload that goes into
 * `computeAuditHash`. Both the writer (`createAuditLog`) and the inline
 * self-check use this — keeping the field list in one place eliminates
 * drift risk: adding a field to the writer literal without adding it
 * here would silently change the hash output across writes vs. the
 * self-checker, producing false-positive tamper detections. Round-2
 * review C.5.
 */
export function buildAuditRecordHashInput(
  source:
    | (CreateAuditLogArgs & {
        timestamp: number;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
        changedFields?: string[];
      })
    | Doc<'auditLogs'>,
): Record<string, unknown> {
  return {
    organizationId: source.organizationId,
    actorId: source.actorId,
    actorEmail: source.actorEmail,
    actorEmailHash: source.actorEmailHash,
    actorRole: source.actorRole,
    actorType: source.actorType,
    action: source.action,
    category: source.category,
    resourceType: source.resourceType,
    resourceId: source.resourceId,
    resourceName: source.resourceName,
    previousState: source.previousState,
    newState: source.newState,
    changedFields:
      source.changedFields && source.changedFields.length > 0
        ? source.changedFields
        : undefined,
    sessionId: source.sessionId,
    ipAddress: source.ipAddress,
    actorIpHash: source.actorIpHash,
    userAgent: source.userAgent,
    requestId: source.requestId,
    timestamp: source.timestamp,
    status: source.status,
    errorMessage: source.errorMessage,
    metadata: source.metadata,
  };
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

  const timestamp = Date.now();

  // Genesis sentinel: read + patch a per-org row to force OCC
  // serialization on the very first audit write per org. Without this,
  // two concurrent first-writers both observe `lastEntry === null`,
  // both insert with `previousHash: ''`, and the chain forks
  // permanently with no schema unique constraint to catch it. Lazily
  // upserted on first write per org. Round-2 review CRITICAL #10.
  const genesis = await ctx.db
    .query('auditLogChainGenesis')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .first();
  if (genesis) {
    // Patch forces OCC contention with any concurrent writer for the
    // same org. The loser's transaction aborts and retries; on retry it
    // observes the winner's just-committed audit row as `lastEntry`.
    await ctx.db.patch(genesis._id, { lastInsertedAt: timestamp });
  } else {
    await ctx.db.insert('auditLogChainGenesis', {
      organizationId: args.organizationId,
      lastInsertedAt: timestamp,
    });
  }

  // Look up the most recent audit log for this organization to chain hashes
  const lastEntry = await ctx.db
    .query('auditLogs')
    .withIndex('by_organizationId_and_timestamp', (q) =>
      q.eq('organizationId', args.organizationId),
    )
    .order('desc')
    .first();

  // Inline self-check: recompute the prior row's integrity hash and compare
  // to the stored value. Catches naive tampering (field changed but hash
  // not updated) at the next legitimate audit write — the only automated
  // tamper detection we have today (verifyIntegrity is a manual query
  // with no operational wiring). MUST NOT abort the legitimate write
  // under any failure mode: console.error/warn, then proceed.
  // Round-2 review C.5.
  if (lastEntry && lastEntry.piiScrubbed !== true) {
    try {
      const recomputed = await computeAuditHash(
        lastEntry.previousHash ?? '',
        buildAuditRecordHashInput(lastEntry),
      );
      if (recomputed !== lastEntry.integrityHash) {
        console.error('[audit-chain] tamper detected on prior row', {
          orgId: args.organizationId,
          rowId: lastEntry._id,
          stored: lastEntry.integrityHash,
          recomputed,
        });
      }
    } catch (err) {
      console.warn('[audit-chain] self-check threw, skipping', {
        err: String(err),
      });
    }
  }

  const previousHash = lastEntry?.integrityHash ?? '';

  // Build the record payload for hashing via the shared helper. The
  // returned shape MUST be the same one the verifier reconstructs from
  // the persisted row (driven by the same helper), so the chain hash
  // round-trips byte-for-byte.
  const recordForHash = buildAuditRecordHashInput({
    ...args,
    previousState: redactedPreviousState,
    newState: redactedNewState,
    changedFields,
    timestamp,
  });

  // Compute integrity hash: SHA-256(previousHash + canonicalized record)
  const integrityHash = await computeAuditHash(previousHash, recordForHash);

  const auditLogId = await ctx.db.insert('auditLogs', {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    actorEmailHash: args.actorEmailHash,
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
    actorIpHash: args.actorIpHash,
    userAgent: args.userAgent,
    requestId: args.requestId,
    timestamp,
    status: args.status,
    errorMessage: args.errorMessage,
    metadata: args.metadata,
    integrityHash,
    previousHash: previousHash || undefined,
  });

  // Patch the predecessor with our id so concurrent writers serialize
  // via Convex OCC. Two transactions that both read `lastEntry` and
  // both try to patch it conflict at commit time; the loser auto-
  // retries, re-reads `lastEntry` (which is now the row inserted by
  // the winner), and chains correctly off it instead of forking.
  if (lastEntry) {
    await ctx.db.patch(lastEntry._id, { chainSuccessor: auditLogId });
  }

  return auditLogId;
}

interface LogSuccessOptions {
  auditCtx: AuditContext;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function logSuccess(
  ctx: MutationCtx,
  options: LogSuccessOptions,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: options.auditCtx.organizationId,
    actorId: options.auditCtx.actor.id,
    actorEmail: options.auditCtx.actor.email,
    actorRole: options.auditCtx.actor.role,
    actorType: options.auditCtx.actor.type,
    action: options.action,
    category: options.category,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    resourceName: options.resourceName,
    previousState: options.previousState,
    newState: options.newState,
    sessionId: options.auditCtx.sessionId,
    ipAddress: options.auditCtx.ipAddress,
    userAgent: options.auditCtx.userAgent,
    requestId: options.auditCtx.requestId,
    status: 'success',
    metadata: options.metadata,
  });
}

interface LogJoinedOrganizationOptions {
  organizationId: string;
  userId: string;
  userEmail: string;
  userRole: string;
}

/**
 * Log a `joined_organization` audit row for the given user.
 *
 * Lifecycle event — should fire exactly once per (org, user) pair.
 * Skips the write (returns null) if an entry already exists for this
 * actor/org pair, regardless of how long ago. Uses the
 * `by_organizationId_and_actorId` index for the existence check; a typical
 * actor has only tens of rows, so the in-memory action filter is cheap.
 */
export async function logJoinedOrganization(
  ctx: MutationCtx,
  options: LogJoinedOrganizationOptions,
): Promise<Id<'auditLogs'> | null> {
  for await (const entry of ctx.db
    .query('auditLogs')
    .withIndex('by_organizationId_and_actorId', (q) =>
      q
        .eq('organizationId', options.organizationId)
        .eq('actorId', options.userId),
    )) {
    if (entry.action === 'joined_organization') {
      return null;
    }
  }

  return logSuccess(ctx, {
    auditCtx: {
      organizationId: options.organizationId,
      actor: {
        id: options.userId,
        email: options.userEmail,
        role: options.userRole,
        type: 'user',
      },
    },
    action: 'joined_organization',
    category: 'member',
    resourceType: 'organization',
    resourceId: options.organizationId,
  });
}

interface LogFailureOptions {
  auditCtx: AuditContext;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  errorMessage: string;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

export async function logFailure(
  ctx: MutationCtx,
  options: LogFailureOptions,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: options.auditCtx.organizationId,
    actorId: options.auditCtx.actor.id,
    actorEmail: options.auditCtx.actor.email,
    actorRole: options.auditCtx.actor.role,
    actorType: options.auditCtx.actor.type,
    action: options.action,
    category: options.category,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    resourceName: options.resourceName,
    sessionId: options.auditCtx.sessionId,
    ipAddress: options.auditCtx.ipAddress,
    userAgent: options.auditCtx.userAgent,
    requestId: options.auditCtx.requestId,
    status: 'failure',
    errorMessage: options.errorMessage,
    metadata: options.metadata,
  });
}

interface LogDeniedOptions {
  auditCtx: AuditContext;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  reason: string;
  resourceId?: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

export async function logDenied(
  ctx: MutationCtx,
  options: LogDeniedOptions,
): Promise<Id<'auditLogs'>> {
  return createAuditLog(ctx, {
    organizationId: options.auditCtx.organizationId,
    actorId: options.auditCtx.actor.id,
    actorEmail: options.auditCtx.actor.email,
    actorRole: options.auditCtx.actor.role,
    actorType: options.auditCtx.actor.type,
    action: options.action,
    category: options.category,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    resourceName: options.resourceName,
    sessionId: options.auditCtx.sessionId,
    ipAddress: options.auditCtx.ipAddress,
    userAgent: options.auditCtx.userAgent,
    requestId: options.auditCtx.requestId,
    status: 'denied',
    errorMessage: options.reason,
    metadata: options.metadata,
  });
}

function buildAuditLogQuery(
  ctx: QueryCtx,
  organizationId: string,
  filter: ListAuditLogsArgs['filter'] & {},
) {
  if (filter.category && filter.startDate) {
    const { category, startDate } = filter;
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_org_category_timestamp', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('category', category)
            .gte('timestamp', startDate),
        ),
      indexedFields: { category: true, startDate: true } as const,
    };
  }

  if (filter.resourceType && filter.startDate) {
    const { resourceType, startDate } = filter;
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_org_resourceType_timestamp', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('resourceType', resourceType)
            .gte('timestamp', startDate),
        ),
      indexedFields: { resourceType: true, startDate: true } as const,
    };
  }

  if (filter.category) {
    const { category } = filter;
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_category', (q) =>
          q.eq('organizationId', organizationId).eq('category', category),
        ),
      indexedFields: { category: true } as const,
    };
  }

  if (filter.actorId) {
    const { actorId } = filter;
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_actorId', (q) =>
          q.eq('organizationId', organizationId).eq('actorId', actorId),
        ),
      indexedFields: { actorId: true } as const,
    };
  }

  if (filter.resourceType) {
    const { resourceType } = filter;
    return {
      query: ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_resourceType', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('resourceType', resourceType),
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
    .withIndex('by_org_resourceType_resourceId', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId),
    )
    .order('desc')) {
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
