/**
 * Audit log hash chain integrity verification.
 *
 * Walks an organization's `auditLogs` chain in chronological order and
 * verifies each entry's `integrityHash` matches the SHA-256 of
 * `previousHash + canonicalize(record)`. When the chain head's
 * `previousHash` is non-empty and the row it points to is GONE (because
 * retention has hard-deleted older rows), the verifier re-anchors via
 * `auditLogCheckpoints`:
 *
 *   - `lastDeletedHash` on a checkpoint MUST match the
 *     `previousHash` of the first surviving entry created after the
 *     checkpoint — proves nothing was inserted across the cut.
 *   - When `TALE_AUDIT_SIGNING_KEY` is set, the checkpoint's
 *     `signature` is verified via HMAC-SHA256 over the canonical
 *     payload. A previous secret kept in
 *     `TALE_AUDIT_SIGNING_KEY_PREVIOUS` is also tried so a key
 *     rotation doesn't fail older checkpoints.
 *
 * Admin-only access. Returns a structured `{ valid, verifiedCount,
 * checkpointsVerified, firstBrokenAt?, checkpointMismatch? }`.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { computeAuditHash } from '../lib/helpers/audit_hash';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

const SIGNING_KEY_ENV = 'TALE_AUDIT_SIGNING_KEY';
const SIGNING_KEY_PREVIOUS_ENV = 'TALE_AUDIT_SIGNING_KEY_PREVIOUS';

interface CheckpointRow {
  _id: string;
  _creationTime: number;
  organizationId: string;
  lastDeletedHash: string;
  firstRetainedPreviousHash?: string;
  maxDeletedTimestamp: number;
  deletedCount: number;
  signature?: string;
  createdAt: number;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function canonicalCheckpointPayload(row: {
  organizationId: string;
  lastDeletedHash: string;
  firstRetainedPreviousHash?: string | undefined;
  maxDeletedTimestamp: number;
  deletedCount: number;
}): string {
  // MUST mirror the canonicalization used by `signCheckpoint` in
  // audit_logs/internal_mutations.ts. Field order is significant.
  return JSON.stringify({
    organizationId: row.organizationId,
    lastDeletedHash: row.lastDeletedHash,
    firstRetainedPreviousHash: row.firstRetainedPreviousHash ?? null,
    maxDeletedTimestamp: row.maxDeletedTimestamp,
    deletedCount: row.deletedCount,
  });
}

/**
 * Verify a checkpoint signature against the active key, falling back
 * to the previous key during a rotation window. Returns:
 *   - `'valid'` — signature matches one of the configured keys
 *   - `'mismatch'` — checkpoint has a signature but no key matched
 *   - `'unsigned'` — checkpoint has no signature stored (legacy or
 *     deploy with no key configured)
 *   - `'no-key'` — checkpoint has a signature but the deployment has
 *     no signing key configured (can't verify; surface to operator)
 */
async function verifyCheckpointSignature(
  row: CheckpointRow,
): Promise<'valid' | 'mismatch' | 'unsigned' | 'no-key'> {
  if (!row.signature) return 'unsigned';
  const activeKey = process.env[SIGNING_KEY_ENV];
  const previousKey = process.env[SIGNING_KEY_PREVIOUS_ENV];
  if (!activeKey && !previousKey) return 'no-key';
  const payload = canonicalCheckpointPayload(row);
  for (const key of [activeKey, previousKey].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  )) {
    const recomputed = await hmacSha256Hex(key, payload);
    if (constantTimeEqual(recomputed, row.signature)) return 'valid';
  }
  return 'mismatch';
}

export const verifyIntegrity = query({
  args: {
    organizationId: v.string(),
    maxEntries: v.optional(v.number()),
  },
  returns: v.object({
    valid: v.boolean(),
    verifiedCount: v.number(),
    checkpointsVerified: v.number(),
    firstBrokenAt: v.optional(
      v.object({
        logId: v.string(),
        timestamp: v.number(),
        expected: v.string(),
        actual: v.string(),
      }),
    ),
    checkpointMismatch: v.optional(
      v.object({
        checkpointId: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can verify audit log integrity');
    }

    const maxEntries = args.maxEntries ?? 1000;
    let verifiedCount = 0;
    let checkpointsVerified = 0;

    // 1. Load every checkpoint for this org, ordered by createdAt asc.
    //    Each represents a retention cut: rows older than the cut were
    //    hard-deleted and `lastDeletedHash` is the integrityHash of the
    //    last row removed in that pass.
    const checkpoints: CheckpointRow[] = [];
    for await (const cp of ctx.db
      .query('auditLogCheckpoints')
      .withIndex('by_organizationId_createdAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      checkpoints.push({
        _id: String(cp._id),
        _creationTime: cp._creationTime,
        organizationId: cp.organizationId,
        lastDeletedHash: cp.lastDeletedHash,
        firstRetainedPreviousHash: cp.firstRetainedPreviousHash,
        maxDeletedTimestamp: cp.maxDeletedTimestamp,
        deletedCount: cp.deletedCount,
        signature: cp.signature,
        createdAt: cp.createdAt,
      });
    }

    // 2. Verify each checkpoint's HMAC signature (when applicable).
    for (const cp of checkpoints) {
      const verdict = await verifyCheckpointSignature(cp);
      if (verdict === 'mismatch') {
        return {
          valid: false,
          verifiedCount,
          checkpointsVerified,
          checkpointMismatch: {
            checkpointId: cp._id,
            reason: 'HMAC signature does not match the active or previous key.',
          },
        };
      }
      if (verdict === 'no-key') {
        return {
          valid: false,
          verifiedCount,
          checkpointsVerified,
          checkpointMismatch: {
            checkpointId: cp._id,
            reason:
              'Checkpoint is signed but TALE_AUDIT_SIGNING_KEY is not configured — operator must restore the key to verify.',
          },
        };
      }
      checkpointsVerified++;
    }

    // 3. Load the live chain (oldest first) up to `maxEntries`.
    const entries: Array<{
      _id: string;
      timestamp: number;
      integrityHash?: string;
      previousHash?: string;
      [key: string]: unknown;
    }> = [];
    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      entries.push({ ...log, _id: String(log._id) });
      if (entries.length >= maxEntries) break;
    }

    // 4. Re-anchor across deletion boundaries. The chain head's
    //    expected previousHash is either:
    //      - empty string (chain genesis, no checkpoint),
    //      - the lastDeletedHash of the most recent checkpoint whose
    //        firstRetainedPreviousHash matches the head's previousHash.
    //
    //    We verify the most recent checkpoint's anchor invariant
    //    against the live head: a re-write attack post-cut would bend
    //    `previousHash` away from `lastDeletedHash`, surfacing here.
    let previousExpectedHash = '';
    let isFirstEntry = true;

    for (const entry of entries) {
      if (!entry.integrityHash) {
        // Pre-chain row. Skip — the chain officially begins at the first
        // row that carries an integrityHash.
        continue;
      }

      const { integrityHash, previousHash, _id, _creationTime, ...record } =
        entry;
      const entryPreviousHash = previousHash ?? '';

      if (isFirstEntry) {
        // Anchor the head: if previousHash references a row that no
        // longer exists, look for a checkpoint whose `lastDeletedHash`
        // matches. That's the cut where the prior row was deleted.
        if (entryPreviousHash !== '') {
          const anchor = checkpoints.find(
            (cp) =>
              cp.firstRetainedPreviousHash === entryPreviousHash ||
              cp.lastDeletedHash === entryPreviousHash,
          );
          if (anchor === undefined) {
            return {
              valid: false,
              verifiedCount,
              checkpointsVerified,
              firstBrokenAt: {
                logId: _id,
                timestamp: entry.timestamp,
                expected: '<known checkpoint anchor for previousHash>',
                actual: entryPreviousHash,
              },
            };
          }
        }
        previousExpectedHash = entryPreviousHash;
        isFirstEntry = false;
      }

      if (entryPreviousHash !== previousExpectedHash) {
        return {
          valid: false,
          verifiedCount,
          checkpointsVerified,
          firstBrokenAt: {
            logId: _id,
            timestamp: entry.timestamp,
            expected: previousExpectedHash,
            actual: entryPreviousHash,
          },
        };
      }

      const recomputed = await computeAuditHash(entryPreviousHash, record);
      if (recomputed !== integrityHash) {
        return {
          valid: false,
          verifiedCount,
          checkpointsVerified,
          firstBrokenAt: {
            logId: _id,
            timestamp: entry.timestamp,
            expected: recomputed,
            actual: integrityHash,
          },
        };
      }

      previousExpectedHash = integrityHash;
      verifiedCount++;
    }

    return { valid: true, verifiedCount, checkpointsVerified };
  },
});
