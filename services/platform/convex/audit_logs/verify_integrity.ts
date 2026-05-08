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
  subtype?: 'retention' | 'pii_scrub';
  lastDeletedHash: string;
  firstRetainedPreviousHash?: string;
  maxDeletedTimestamp: number;
  deletedCount: number;
  scrubbedSubjectId?: string;
  scrubbedRowCount?: number;
  signature?: string;
  signatureVersion?: 1 | 2;
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

function canonicalCheckpointPayload(row: CheckpointRow): string {
  // MUST mirror the canonicalization used by `signCheckpoint` in
  // audit_logs/internal_mutations.ts. Field order is significant.
  // Dispatch by stored signatureVersion so historical v1 checkpoints
  // keep verifying after the v2 upgrade. Default (no version field) is
  // v1 — that's what every pre-upgrade row carries.
  const version = row.signatureVersion ?? 1;
  if (version === 2) {
    return JSON.stringify({
      organizationId: row.organizationId,
      lastDeletedHash: row.lastDeletedHash,
      firstRetainedPreviousHash: row.firstRetainedPreviousHash ?? null,
      maxDeletedTimestamp: row.maxDeletedTimestamp,
      deletedCount: row.deletedCount,
      subtype: row.subtype ?? 'retention',
      scrubbedSubjectId: row.scrubbedSubjectId ?? null,
    });
  }
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
    /**
     * `true` when the walk hit `maxEntries` before consuming the live
     * chain — caller should bump `maxEntries` or page from
     * `lastVerifiedTimestamp + 1`. Without this flag, a long chain
     * returned `valid: true` after only verifying the oldest 1000 rows,
     * silently masking any tampering after that boundary.
     */
    truncated: v.boolean(),
    /** Timestamp of the last row the walk verified — useful for paging. */
    lastVerifiedTimestamp: v.optional(v.number()),
    /**
     * Count of rows that verified ONLY because their `piiScrubbed` flag
     * was set without a corresponding signed scrub checkpoint covering
     * them. When the deployment has a signing key, this should always
     * be 0 in production; non-zero indicates legacy unsigned scrubs OR
     * an attempted forgery against an unkeyed deployment.
     */
    unsignedScrubCount: v.number(),
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
    let unsignedScrubCount = 0;
    let lastVerifiedTimestamp: number | undefined;
    const signingKey = process.env[SIGNING_KEY_ENV];
    const hasSigningKey =
      typeof signingKey === 'string' && signingKey.length > 0;

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
        subtype: cp.subtype,
        lastDeletedHash: cp.lastDeletedHash,
        firstRetainedPreviousHash: cp.firstRetainedPreviousHash,
        maxDeletedTimestamp: cp.maxDeletedTimestamp,
        deletedCount: cp.deletedCount,
        scrubbedSubjectId: cp.scrubbedSubjectId,
        scrubbedRowCount: cp.scrubbedRowCount,
        signature: cp.signature,
        signatureVersion: cp.signatureVersion,
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
          truncated: false,
          unsignedScrubCount,
          lastVerifiedTimestamp,
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
          truncated: false,
          unsignedScrubCount,
          lastVerifiedTimestamp,
          checkpointMismatch: {
            checkpointId: cp._id,
            reason:
              'Checkpoint is signed but TALE_AUDIT_SIGNING_KEY is not configured — operator must restore the key to verify.',
          },
        };
      }
      checkpointsVerified++;
    }

    // 3. Load the live chain (oldest first) up to `maxEntries`. Track
    //    truncation explicitly: returning `valid: true` for a long
    //    chain that we only walked the head of would silently mask
    //    tampering past the cut.
    const entries: Array<{
      _id: string;
      timestamp: number;
      integrityHash?: string;
      previousHash?: string;
      [key: string]: unknown;
    }> = [];
    let truncated = false;
    for await (const log of ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push({ ...log, _id: String(log._id) });
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

    // Build per-subject scrub windows from SIGNED pii_scrub checkpoints
    // only. A row carrying `actorId === X` is allowed to skip hash
    // recompute only when there is a signed checkpoint covering
    // `(X, timestamp ≤ maxDeletedTimestamp)`. Without this scoping
    // (the prior membership-only Set), a single pii_scrub checkpoint
    // for subject X authorized hash skip on every row that subject ever
    // touched, including future rows the checkpoint never attested.
    // Unsigned legacy scrub checkpoints are tracked separately below.
    type ScrubWindow = { maxTimestamp: number; checkpointId: string };
    const subjectScrubWindows = new Map<string, ScrubWindow[]>();
    const unsignedScrubSubjects = new Set<string>();
    for (const cp of checkpoints) {
      if (cp.subtype !== 'pii_scrub' || cp.scrubbedSubjectId === undefined) {
        continue;
      }
      if (cp.signature) {
        const list = subjectScrubWindows.get(cp.scrubbedSubjectId) ?? [];
        list.push({
          maxTimestamp: cp.maxDeletedTimestamp,
          checkpointId: cp._id,
        });
        subjectScrubWindows.set(cp.scrubbedSubjectId, list);
      } else {
        // Pre-signing-key checkpoints (or deployments that never set
        // TALE_AUDIT_SIGNING_KEY) cannot attest the scrub authority.
        // We still let the verifier accept them (otherwise upgrading to
        // signed checkpoints would fail every historical chain), but
        // the count surfaces in the return so operators see the
        // unsigned trust window.
        unsignedScrubSubjects.add(cp.scrubbedSubjectId);
      }
    }

    // Anchor pick: the most recent retention checkpoint (highest
    // createdAt) that matches the head's previousHash. Two scopings
    // applied here:
    //  1. Sort descending so the MOST recent match wins. `Array.find`
    //     against unsorted input picks the OLDEST match, letting an
    //     attacker delete mid-chain rows and re-anchor to a stale
    //     checkpoint.
    //  2. Filter to `subtype === 'retention'` only. `pii_scrub`
    //     checkpoints don't delete rows; their `lastDeletedHash` /
    //     `firstRetainedPreviousHash` fields aren't a deletion-boundary
    //     anchor and matching one would let an attacker re-anchor a
    //     forged head against an unrelated scrub checkpoint
    //     (round-2 v02 H2 F1).
    const anchorCandidates = checkpoints
      .filter((cp) => cp.subtype === 'retention')
      .sort((a, b) => b.createdAt - a.createdAt);

    for (const entry of entries) {
      if (!entry.integrityHash) {
        // Pre-chain row. Skip — the chain officially begins at the first
        // row that carries an integrityHash.
        continue;
      }

      const {
        integrityHash,
        previousHash,
        _id,
        _creationTime,
        piiScrubbed,
        ...record
      } = entry;
      const entryPreviousHash = previousHash ?? '';

      // Scrubbed rows: chain order + previousHash linkage stays intact,
      // but recomputing the SHA-256 over the now-blanked body would
      // mismatch. Trust the stored integrityHash only when there is a
      // signed pii_scrub checkpoint whose subject matches this row's
      // actorId AND whose maxDeletedTimestamp is at or after this row.
      // A bare `piiScrubbed: true` flag with no covering window is
      // suspicious and fails closed (recompute), unless the deployment
      // has no signing key configured at all (legacy unsigned mode).
      const actorId = typeof entry.actorId === 'string' ? entry.actorId : null;
      let isScrubbed = false;
      if (piiScrubbed === true) {
        if (actorId !== null) {
          const windows = subjectScrubWindows.get(actorId);
          if (
            windows &&
            windows.some((w) => entry.timestamp <= w.maxTimestamp)
          ) {
            isScrubbed = true;
          } else if (!hasSigningKey) {
            // Legacy / unsigned-mode deployment: no signing key
            // configured, so signed-checkpoint coverage is impossible
            // and the bare `piiScrubbed` flag is the best signal we
            // have. Surface the count so operators see the unsigned
            // trust window. Round-2 v02 H2 F6: this branch was
            // previously reachable even on signed deployments via the
            // `unsignedScrubSubjects` set — a checkpoint downgrade
            // attacker could plant an unsigned `pii_scrub` row to
            // bypass recompute. Now strictly gated on `!hasSigningKey`.
            isScrubbed = true;
            unsignedScrubCount++;
            // Best-effort: track that we accepted an unsigned subject
            // for the operator-visible count, but do not require it
            // for trust.
            if (unsignedScrubSubjects.has(actorId)) {
              // already counted above; no-op
            }
          }
        } else if (!hasSigningKey) {
          // No actorId on the row + legacy unsigned deployment.
          isScrubbed = true;
          unsignedScrubCount++;
        }
      }

      if (isFirstEntry) {
        // Anchor the head: if previousHash references a row that no
        // longer exists, look for the MOST RECENT checkpoint whose
        // anchor hashes match. Picking any match (Array.find) would let
        // an attacker re-anchor a forged head to a stale checkpoint.
        if (entryPreviousHash !== '') {
          const anchor = anchorCandidates.find(
            (cp) =>
              cp.firstRetainedPreviousHash === entryPreviousHash ||
              cp.lastDeletedHash === entryPreviousHash,
          );
          if (anchor === undefined) {
            return {
              valid: false,
              verifiedCount,
              checkpointsVerified,
              truncated,
              unsignedScrubCount,
              lastVerifiedTimestamp,
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
          truncated,
          unsignedScrubCount,
          lastVerifiedTimestamp,
          firstBrokenAt: {
            logId: _id,
            timestamp: entry.timestamp,
            expected: previousExpectedHash,
            actual: entryPreviousHash,
          },
        };
      }

      if (!isScrubbed) {
        const recomputed = await computeAuditHash(entryPreviousHash, record);
        if (recomputed !== integrityHash) {
          return {
            valid: false,
            verifiedCount,
            checkpointsVerified,
            truncated,
            unsignedScrubCount,
            lastVerifiedTimestamp,
            firstBrokenAt: {
              logId: _id,
              timestamp: entry.timestamp,
              expected: recomputed,
              actual: integrityHash,
            },
          };
        }
      }

      previousExpectedHash = integrityHash;
      lastVerifiedTimestamp = entry.timestamp;
      verifiedCount++;
    }

    return {
      valid: true,
      verifiedCount,
      checkpointsVerified,
      truncated,
      unsignedScrubCount,
      lastVerifiedTimestamp,
    };
  },
});
