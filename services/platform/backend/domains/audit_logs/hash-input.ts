import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { AuditLogRow, CreateAuditLogArgs } from './types.ts';

/**
 * Pure audit-record shaping — redaction, diffing, and the canonical hash
 * input. Ported from `convex/audit_logs/helpers.ts` (which dies with the
 * component); the hash ALGORITHM itself is reused unported from
 * `convex/lib/helpers/audit_hash.ts` so 0.4 chains stay verifiable after the
 * cutover data import.
 */

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
    if (
      stableStringify(previousState[key]) !== stableStringify(newState[key])
    ) {
      changedFields.push(key);
    }
  }
  return changedFields;
}

/**
 * The canonical record payload for `computeAuditHash`. Field list and shape
 * MUST stay byte-identical to the 0.4 writer (`buildAuditRecordHashInput`)
 * — the verifier reconstructs this from a persisted row and both must
 * produce the same canonical string.
 */
export function buildAuditRecordHashInput(
  source: CreateAuditLogArgs & { timestamp: number },
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

/**
 * Rebuild the hash input from a PERSISTED row. Postgres surfaces absent
 * optionals as NULL where the writer had `undefined`; the canonicalizer
 * treats those differently (`null` is emitted, `undefined` keys are
 * skipped), so every optional maps null→undefined here. Mirrors the role
 * Convex's undefined-dropping played in 0.4.
 */
export function rowToHashInput(row: AuditLogRow): Record<string, unknown> {
  const changedFields = row.changedFields ?? undefined;
  return buildAuditRecordHashInput({
    organizationId: row.organizationId,
    actorId: row.actorId,
    actorEmail: row.actorEmail ?? undefined,
    actorEmailHash: row.actorEmailHash ?? undefined,
    actorRole: row.actorRole ?? undefined,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- persisted rows were written through the typed writer
    actorType: row.actorType as CreateAuditLogArgs['actorType'],
    action: row.action,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- persisted rows were written through the typed writer
    category: row.category as CreateAuditLogArgs['category'],
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? undefined,
    resourceName: row.resourceName ?? undefined,
    previousState: row.previousState ?? undefined,
    newState: row.newState ?? undefined,
    changedFields,
    sessionId: row.sessionId ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    actorIpHash: row.actorIpHash ?? undefined,
    userAgent: row.userAgent ?? undefined,
    requestId: row.requestId ?? undefined,
    timestamp: row.timestamp,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- persisted rows were written through the typed writer
    status: row.status as CreateAuditLogArgs['status'],
    errorMessage: row.errorMessage ?? undefined,
    metadata: row.metadata ?? undefined,
  });
}
