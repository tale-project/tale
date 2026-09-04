import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { AuditLogRow, CreateAuditLogArgs } from './types.ts';

/**
 * Pure audit-record shaping — redaction, diffing, the STORED-form
 * normalization the writer hashes, and the canonical hash input. Ported from
 * `convex/audit_logs/helpers.ts` (which dies with the component); the hash
 * ALGORITHM itself is reused unported from `convex/lib/helpers/audit_hash.ts`
 * so 0.4 chains stay verifiable after the cutover data import.
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
 * The two things a JS string can carry that Postgres cannot store: a lone
 * UTF-16 surrogate (the UTF-8 encoder writes U+FFFD in its place — a
 * `.slice()` through an emoji is the usual source) and U+0000 (text and
 * jsonb both reject it, failing the INSERT and the user's transaction with
 * it). Both become U+FFFD, the same visible replacement mark, so the string
 * the writer hashes is the string a later read hands back. Identity on every
 * storable string.
 */
export function normalizeStoredText(value: string): string {
  const wellFormed = value.toWellFormed();
  return wellFormed.includes('\u0000')
    ? wellFormed.replaceAll('\u0000', '\uFFFD')
    : wellFormed;
}

function normalizeJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return normalizeStoredText(value);
  if (Array.isArray(value)) return value.map(normalizeJsonStrings);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[normalizeStoredText(key)] = normalizeJsonStrings(item);
    }
    return out;
  }
  return value;
}

/**
 * A jsonb payload in the form the column hands back: one JSON round-trip
 * (drops undefined-valued keys, turns undefined array items and sparse holes
 * into null, Date/`toJSON` objects into their JSON form, NaN/±Infinity into
 * null), then every key and string value text-normalized. Key ORDER is not
 * part of the contract — Postgres reorders keys and the canonicalizer sorts
 * them.
 */
export function normalizeStoredJson(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const roundTripped: unknown = JSON.parse(JSON.stringify(value));
  const normalized = normalizeJsonStrings(roundTripped);
  return isRecord(normalized) ? normalized : {};
}

/** The writer's record once every field carries its final value. */
export type StoredAuditRecord = CreateAuditLogArgs & {
  changedFields: string[];
  timestamp: number;
};

const OPTIONAL_TEXT_FIELDS = [
  'actorEmail',
  'actorEmailHash',
  'actorRole',
  'resourceId',
  'resourceName',
  'sessionId',
  'ipAddress',
  'actorIpHash',
  'userAgent',
  'requestId',
  'errorMessage',
] as const;

const JSON_FIELDS = ['previousState', 'newState', 'metadata'] as const;

/**
 * Shape the record into its STORED form before it is hashed and inserted:
 * the hash must cover what a later read rebuilds (`rowToHashInput`), not
 * what the caller held in memory. Without this, a lone surrogate in an
 * error message verified as TAMPERED forever (stored U+FFFD, hashed as the
 * `\udXXX` escape `JSON.stringify` emits for it), and a NUL or lone
 * surrogate inside a jsonb field failed the INSERT — and the user action or
 * run settle with it. Identity on a record every field of which is
 * storable, so rows already written keep recomputing to their own hash.
 */
export function toStoredAuditRecord(
  source: StoredAuditRecord,
): StoredAuditRecord {
  const stored: StoredAuditRecord = {
    ...source,
    actorId: normalizeStoredText(source.actorId),
    action: normalizeStoredText(source.action),
    resourceType: normalizeStoredText(source.resourceType),
    changedFields: source.changedFields.map(normalizeStoredText),
  };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = stored[field];
    if (value !== undefined) stored[field] = normalizeStoredText(value);
  }
  for (const field of JSON_FIELDS) {
    const value = stored[field];
    if (value !== undefined) stored[field] = normalizeStoredJson(value);
  }
  return stored;
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
