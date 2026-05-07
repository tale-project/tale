import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from './helpers';
import {
  auditLogActorTypeValidator,
  auditLogCategoryValidator,
  auditLogStatusValidator,
} from './validators';

/**
 * HMAC-SHA256 sign the checkpoint contents with the operator's
 * deploy-time signing key. Returns `undefined` when no key is set —
 * the chain is still tamper-evident via the SHA-256 chain; the
 * signature is defense-in-depth against an attacker who can both
 * delete the chain prefix AND forge a checkpoint over it.
 *
 * Key rotation: when an operator rotates `TALE_AUDIT_SIGNING_KEY`,
 * older checkpoints verify against the old key (kept in
 * `TALE_AUDIT_SIGNING_KEY_PREVIOUS` until the next rotation cycle).
 * `verify_integrity.ts` tries both during walk.
 */
/**
 * Signature payload schema version. v1 (the original) signed only the
 * cut-window descriptor. v2 also binds `subtype` and `scrubbedSubjectId`,
 * so an attacker who captures a `retention` checkpoint's HMAC cannot
 * replay it as a forged `pii_scrub` checkpoint with an arbitrary subject
 * id. Verifier dispatches by version; v1 stays valid for the lifetime
 * of historical rows (audit chain is append-only).
 */
const SIGNATURE_VERSION = 2 as const;

async function signCheckpoint(payload: {
  organizationId: string;
  subtype: 'retention' | 'pii_scrub';
  lastDeletedHash: string;
  firstRetainedPreviousHash: string | undefined;
  maxDeletedTimestamp: number;
  deletedCount: number;
  scrubbedSubjectId: string | undefined;
}): Promise<string | undefined> {
  const key = process.env.TALE_AUDIT_SIGNING_KEY;
  if (!key) return undefined;
  // v2 canonical form. Field order is significant — DO NOT reorder, and
  // append new fields at the end if v3 is ever introduced. The verifier
  // re-builds the same string from stored row fields.
  const canonical = JSON.stringify({
    organizationId: payload.organizationId,
    lastDeletedHash: payload.lastDeletedHash,
    firstRetainedPreviousHash: payload.firstRetainedPreviousHash ?? null,
    maxDeletedTimestamp: payload.maxDeletedTimestamp,
    deletedCount: payload.deletedCount,
    subtype: payload.subtype,
    scrubbedSubjectId: payload.scrubbedSubjectId ?? null,
  });
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    enc.encode(canonical),
  );
  // V8 mutation runtime does NOT reliably provide `Buffer`; this file has no
  // `'use node'` directive (mutations run in Convex V8). Use the same hex
  // pattern as `lib/helpers/audit_hash.ts:computeAuditHash`.
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const createAuditLog = internalMutation({
  args: {
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
    status: auditLogStatusValidator,
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await AuditLogHelpers.createAuditLog(ctx, args);
  },
});

/**
 * Internal mutation wrapper around `logJoinedOrganization` so Better Auth
 * hooks (which run in an HTTP ActionCtx, not a MutationCtx) can write the
 * audit row via `ctx.runMutation`.
 */
export const logJoinedOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userRole: v.string(),
  },
  handler: async (ctx, args) => {
    return await AuditLogHelpers.logJoinedOrganization(ctx, args);
  },
});

/**
 * Hard-delete audit-log rows older than `olderThanTimestamp`.
 *
 * Phase 9 — chain integrity:
 *   The audit_logs table maintains a SHA-256 chain via
 *   `previousHash`/`integrityHash` (audit_logs/helpers.ts). Hard-deleting
 *   the chain prefix breaks `verify_integrity.ts` for every retained
 *   successor: the oldest retained row's `previousHash` references a
 *   row that no longer exists. To preserve detectability across the
 *   archive boundary, this mutation writes a row to
 *   `auditLogCheckpoints` capturing the last deleted row's
 *   `integrityHash` and the count + max timestamp of deleted rows.
 *   `verify_integrity.ts` walks checkpoint→checkpoint to re-anchor the
 *   chain after a retention cut.
 *
 * Was named `archiveOldLogs` despite hard-deleting; renamed for honesty.
 * The legacy export name is re-exported below for backward compat with
 * any external scheduler-config that still references it.
 */
export const deleteOldLogs = internalMutation({
  args: {
    organizationId: v.string(),
    olderThanTimestamp: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    let deletedCount = 0;
    let lastDeletedHash = '';
    let maxDeletedTimestamp = 0;

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      if (log.timestamp >= args.olderThanTimestamp) {
        break;
      }

      // Track the chain head we're deleting so the checkpoint can
      // anchor the retained chain.
      if (log.integrityHash) {
        lastDeletedHash = log.integrityHash;
      }
      if (log.timestamp > maxDeletedTimestamp) {
        maxDeletedTimestamp = log.timestamp;
      }

      await ctx.db.delete(log._id);
      deletedCount++;

      if (deletedCount >= batchSize) {
        break;
      }
    }

    if (deletedCount > 0) {
      // Look up the first retained row's previousHash so verifiers can
      // re-anchor the chain at this checkpoint.
      const firstRetained = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_timestamp', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .order('asc')
        .first();

      // Phase 9 — deploy-key signature. The signing key lives in
      // `TALE_AUDIT_SIGNING_KEY` (operator-set, ideally rotated via
      // SOPS in production). Without a key the checkpoint is still
      // written but `signature` stays undefined — the chain is
      // tamper-evident through the SHA-256 chain itself; the signature
      // is defense-in-depth against an attacker who can both delete a
      // chain row AND write a fresh checkpoint over it.
      const signature = await signCheckpoint({
        organizationId: args.organizationId,
        subtype: 'retention',
        lastDeletedHash,
        firstRetainedPreviousHash: firstRetained?.previousHash,
        maxDeletedTimestamp,
        deletedCount,
        scrubbedSubjectId: undefined,
      });
      await ctx.db.insert('auditLogCheckpoints', {
        organizationId: args.organizationId,
        subtype: 'retention',
        lastDeletedHash,
        firstRetainedPreviousHash: firstRetained?.previousHash,
        maxDeletedTimestamp,
        deletedCount,
        signature,
        signatureVersion: signature ? SIGNATURE_VERSION : undefined,
        createdAt: Date.now(),
      });

      await AuditLogHelpers.createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'audit_log.retention_deleted',
        category: 'admin',
        resourceType: 'audit_log_archive',
        status: 'success',
        metadata: {
          deletedCount,
          olderThanTimestamp: args.olderThanTimestamp,
          checkpointHash: lastDeletedHash,
        },
      });
    }

    return {
      deletedCount,
      hasMore: deletedCount >= batchSize,
    };
  },
});

/**
 * @deprecated — renamed to `deleteOldLogs`. Re-exported so callers
 * registered with the cron scheduler under the old name keep working
 * during the rename window.
 */
export const archiveOldLogs = deleteOldLogs;

/**
 * GDPR Art 17 audit-chain PII scrub.
 *
 * Strategy: KEEP the row (so the audit trail of "user X did Y at time
 * T" remains for compliance / forensics), but blank the PII payload —
 * `actorEmail`, `ipAddress`, `userAgent`, `previousState`, `newState`,
 * `metadata`. The row is marked `piiScrubbed: true`, `piiScrubbedAt`
 * captured. After scrubbing the per-org integrity chain hashes stop
 * matching the canonical recompute on these rows; an
 * `auditLogCheckpoints` row with `subtype: 'pii_scrub'` is inserted +
 * signed so `verifyIntegrity` accepts the divergence as intentional.
 *
 * Per Art 17(3)(b)/(e), the row's existence (timestamp, action,
 * resource type) is permitted to remain — the scrubbed body
 * extinguishes the personal data while preserving the operator's
 * compliance + accountability obligations.
 *
 * Idempotent: rows already marked `piiScrubbed: true` are skipped.
 */
export const scrubSubjectAuditLogs = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.object({ scrubbedRowCount: v.number() }),
  handler: async (ctx, args) => {
    let scrubbedRowCount = 0;
    let lastScrubbedHash = '';
    let maxScrubbedTimestamp = 0;
    const now = Date.now();

    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_actorId', (q) =>
        q.eq('organizationId', args.organizationId).eq('actorId', args.userId),
      )) {
      if (log.piiScrubbed === true) continue;
      const patch: Partial<typeof log> & {
        piiScrubbed: true;
        piiScrubbedAt: number;
      } = {
        actorEmail: undefined,
        actorRole: undefined,
        ipAddress: undefined,
        userAgent: undefined,
        previousState: undefined,
        newState: undefined,
        metadata: undefined,
        piiScrubbed: true,
        piiScrubbedAt: now,
      };
      await ctx.db.patch(log._id, patch);
      scrubbedRowCount++;
      if (log.integrityHash) lastScrubbedHash = log.integrityHash;
      if (log.timestamp > maxScrubbedTimestamp) {
        maxScrubbedTimestamp = log.timestamp;
      }
    }

    if (scrubbedRowCount === 0) return { scrubbedRowCount: 0 };

    // Insert a signed boundary so the verifier knows hash recomputes
    // on scrubbed rows are expected to mismatch. v2 binds `subtype` and
    // `scrubbedSubjectId` into the HMAC payload so the signature
    // attests *which* subject's rows the scrub authorized — without
    // this, a captured retention HMAC could be replayed with arbitrary
    // subject ids.
    const signature = await signCheckpoint({
      organizationId: args.organizationId,
      subtype: 'pii_scrub',
      lastDeletedHash: lastScrubbedHash,
      firstRetainedPreviousHash: undefined,
      maxDeletedTimestamp: maxScrubbedTimestamp,
      deletedCount: scrubbedRowCount,
      scrubbedSubjectId: args.userId,
    });
    await ctx.db.insert('auditLogCheckpoints', {
      organizationId: args.organizationId,
      subtype: 'pii_scrub',
      lastDeletedHash: lastScrubbedHash,
      firstRetainedPreviousHash: undefined,
      maxDeletedTimestamp: maxScrubbedTimestamp,
      deletedCount: scrubbedRowCount,
      scrubbedSubjectId: args.userId,
      scrubbedRowCount,
      signature,
      signatureVersion: signature ? SIGNATURE_VERSION : undefined,
      createdAt: now,
    });

    return { scrubbedRowCount };
  },
});
