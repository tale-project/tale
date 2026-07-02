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

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
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
    /**
     * Page-resume cursor (lower bound). When set, the walk loads rows with
     * `timestamp >= fromTimestamp` and skips the head-anchor check because
     * the caller is resuming mid-chain. Pass the previous page's
     * `lastVerifiedTimestamp`. For a correct resume, pair it with `afterId`
     * + `previousExpectedHash` (see below) — `fromTimestamp` alone trusts
     * the first row of the resumed page as the boundary rather than
     * cross-checking its linkage. #1846 item 3.
     */
    fromTimestamp: v.optional(v.number()),
    /**
     * `_id` of the last row verified on the previous page. Rows up to and
     * INCLUDING it are skipped. Keyed on `_id` (not a coarse `timestamp + 1`
     * bump) so same-`timestamp` siblings of the last verified row — which
     * `gte(fromTimestamp)` re-returns — are verified rather than silently
     * skipped past. #1846 item 3.
     */
    afterId: v.optional(v.string()),
    /**
     * `integrityHash` of the last row verified on the previous page. Seeds
     * the linkage check so the first row of the resumed page is verified
     * against the real previous hash, not the empty-string genesis sentinel
     * (which guaranteed a false `firstBrokenAt` pre-fix). #1846 item 3.
     */
    previousExpectedHash: v.optional(v.string()),
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
     * `_id` of the last row the walk verified. Pass back as `afterId` on the
     * next page so the resume cursor is exact even across same-`timestamp`
     * rows. Undefined when nothing was verified this call. #1846 item 3.
     */
    lastVerifiedId: v.optional(v.string()),
    /**
     * `integrityHash` of the last row the walk verified. Pass back as
     * `previousExpectedHash` on the next page to seed its linkage check.
     * Undefined when nothing was verified this call. #1846 item 3.
     */
    lastVerifiedHash: v.optional(v.string()),
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

    return verifyAuditChain(ctx, args);
  },
});

/**
 * Admin-only snapshot of an org's scheduled-integrity-check state (#1845),
 * backing the audit-log integrity panel. Reads the single per-org
 * `auditIntegrityProgress` row the cron maintains: how far the chain has been
 * verified, whether the last run reached the live head, and — for the
 * actionable alert — the fingerprint + timestamp of the incident this org was
 * last alerted about. `alertActive` is a convenience derived flag: true iff an
 * un-recovered incident is currently armed (a fingerprint is stored). Returns
 * `null` when the org has no progress row yet (never checked). Gate mirrors
 * `verifyIntegrity` — read-only, but the alert state is security-sensitive.
 */
export const getIntegrityStatus = query({
  args: { organizationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      lastVerifiedTimestamp: v.optional(v.number()),
      lastVerifiedId: v.optional(v.string()),
      headReached: v.boolean(),
      updatedAt: v.number(),
      lastAlertedFingerprint: v.optional(v.string()),
      lastAlertedAt: v.optional(v.number()),
      alertActive: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'forbidden', message: 'Unauthenticated' });
    }
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only admins can read audit log integrity status',
      });
    }

    const progress = await ctx.db
      .query('auditIntegrityProgress')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    if (!progress) return null;

    return {
      lastVerifiedTimestamp: progress.lastVerifiedTimestamp,
      lastVerifiedId: progress.lastVerifiedId,
      headReached: progress.headReached,
      updatedAt: progress.updatedAt,
      lastAlertedFingerprint: progress.lastAlertedFingerprint,
      lastAlertedAt: progress.lastAlertedAt,
      alertActive: progress.lastAlertedFingerprint !== undefined,
    };
  },
});

/**
 * Core hash-chain verification shared by the admin-gated `verifyIntegrity`
 * query above and the unauthenticated `verifyAuditChainForOrg` internal query
 * that the scheduled integrity-check cron runs (#1505). Pure read over
 * `ctx.db` — callers own access control.
 */
export async function verifyAuditChain(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    maxEntries?: number;
    fromTimestamp?: number;
    afterId?: string;
    previousExpectedHash?: string;
  },
) {
  const maxEntries = args.maxEntries ?? 1000;
  let verifiedCount = 0;
  let checkpointsVerified = 0;
  let unsignedScrubCount = 0;
  let lastVerifiedTimestamp: number | undefined;
  let lastVerifiedId: string | undefined;
  let lastVerifiedHash: string | undefined;
  const signingKey = process.env[SIGNING_KEY_ENV];
  const hasSigningKey = typeof signingKey === 'string' && signingKey.length > 0;

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
        lastVerifiedId,
        lastVerifiedHash,
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
        lastVerifiedId,
        lastVerifiedHash,
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
  //    tampering past the cut. Resume from `fromTimestamp` when the
  //    caller is paging mid-chain.
  //
  //    Resume skip: drop the already-verified prefix up to AND including
  //    `afterId`, and do NOT count those skipped rows toward `maxEntries` so a
  //    resumed page still verifies a full window of NEW rows. Keyed on `_id`
  //    (not a coarse `timestamp + 1` bump) so same-`timestamp` siblings of the
  //    last verified row — which `gte(fromTimestamp)` re-returns — are
  //    verified rather than skipped past and never checked. #1846 item 3.
  const buildIndexQuery = () =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_timestamp', (q) =>
        args.fromTimestamp !== undefined
          ? q
              .eq('organizationId', args.organizationId)
              .gte('timestamp', args.fromTimestamp)
          : q.eq('organizationId', args.organizationId),
      )
      .order('asc');

  const entries: Doc<'auditLogs'>[] = [];
  let truncated = false;
  let skipping = args.afterId !== undefined;
  for await (const log of buildIndexQuery()) {
    if (skipping) {
      if (String(log._id) === args.afterId) skipping = false;
      continue;
    }
    if (entries.length >= maxEntries) {
      truncated = true;
      break;
    }
    entries.push(log);
  }

  // `afterId` was given but never seen (e.g. retention hard-deleted it since
  // the last run): re-walk from the range start without skipping so coverage
  // continues instead of the cursor stalling on a deleted row.
  //
  // Crucially we MUST NOT trust the supplied `previousExpectedHash` for the
  // first surviving row here: when retention deleted the cursor row AND one or
  // more rows after it (the realistic case — a daily cutoff jumps past the
  // cursor by more than one row), the first surviving row's `previousHash` is
  // the hash of some row BETWEEN the deleted cursor and itself, not the stale
  // cursor hash, so comparing them yields a guaranteed false `firstBrokenAt`
  // with zero tampering — a critical false tamper alarm that re-fires every run
  // (the cursor never advances past a "break"). Instead re-seed from the first
  // surviving row's own `previousHash` (boundary trusted, exactly as the
  // `fromTimestamp`-only resume path does) via `afterIdDeleted` → `needsSeed`
  // below. #1846 item 3 / PR #2218 review BLOCKING 1.
  const afterIdDeleted = args.afterId !== undefined && skipping;
  if (afterIdDeleted) {
    entries.length = 0;
    truncated = false;
    for await (const log of buildIndexQuery()) {
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push(log);
    }
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
  const isResume = args.fromTimestamp !== undefined;
  // Suppress the head-anchor check when paging mid-chain: the caller is
  // resuming and has already verified the anchor on a prior page. Treating
  // row N (mid-chain) as a "first entry" would force its previousHash to
  // match a checkpoint, which it never does for non-anchor rows.
  let isFirstEntry = !isResume;
  // Seed the linkage check. On a resume the caller passes the previous page's
  // last `integrityHash` as `previousExpectedHash`, so the first row of this
  // page is cross-checked against the REAL previous hash. Pre-fix this stayed
  // `''` and the only seeding site lived inside the skipped `isFirstEntry`
  // block, so the first resumed row's real previousHash was compared against
  // `''` → a guaranteed false `firstBrokenAt` with zero tampering. When
  // resuming without a supplied hash we adopt the first row's own previousHash
  // (boundary trusted) via `needsSeed` rather than emitting a false break.
  // #1846 item 3.
  //
  // `afterIdDeleted` forces the same re-seed even though a hash WAS supplied:
  // the supplied hash belongs to a retention-deleted cursor row and no longer
  // links to the first surviving row (PR #2218 review BLOCKING 1).
  let previousExpectedHash = args.previousExpectedHash ?? '';
  let needsSeed = args.previousExpectedHash === undefined || afterIdDeleted;

  // Build per-subject scrub windows from SIGNED pii_scrub checkpoints
  // only. A row whose actor OR (user-)resource is subject X is allowed
  // to skip hash recompute only when there is a signed checkpoint
  // covering `(X, timestamp ≤ maxDeletedTimestamp)` — see the per-row
  // coverage test below, which mirrors the scrub's two selection
  // passes. Without this scoping
  // (the prior membership-only Set), a single pii_scrub checkpoint
  // for subject X authorized hash skip on every row that subject ever
  // touched, including future rows the checkpoint never attested.
  // Unsigned legacy scrub checkpoints are tracked separately below.
  type ScrubWindow = { maxTimestamp: number; checkpointId: string };
  const subjectScrubWindows = new Map<string, ScrubWindow[]>();
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
    }
    // Unsigned scrub checkpoints (legacy / pre-signing-key) are
    // intentionally NOT tracked in a per-subject set: the only gate
    // that grants trust to bare `piiScrubbed: true` rows is the
    // `!hasSigningKey` branch below, which is a deployment-wide
    // signal independent of subject identity. Adding a per-subject
    // set here would let an attacker plant an unsigned pii_scrub row
    // on a signed deployment to bypass recompute (round-2 v02 H2 F6).
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
  // Match `canonicalCheckpointPayload`'s `?? 'retention'` fallback for
  // pre-`subtype`-field rows. Strict equality dropped legacy retention
  // checkpoints (`subtype: undefined`) so any deployment that ran retention
  // before the subtype field was introduced fails verifyIntegrity at the
  // first run after upgrade — chain head's previousHash references a
  // deleted row, anchor candidate set is empty, valid=false.
  // Round-2 review CRITICAL #9.
  const anchorCandidates = checkpoints
    .filter((cp) => cp.subtype === 'retention' || cp.subtype === undefined)
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
    // signed pii_scrub checkpoint whose subject covers this row AND
    // whose maxDeletedTimestamp is at or after this row.
    //
    // Coverage MUST mirror `scrubSubjectAuditLogs`'s two selection
    // passes, both keyed on the scrubbed subject:
    //   - pass 1: the subject is the row's ACTOR
    //     (`actorId === scrubbedSubjectId`), or
    //   - pass 2: the subject is the row's RESOURCE
    //     (`resourceType === 'user' && resourceId === scrubbedSubjectId`).
    // The scrub windows are keyed by `scrubbedSubjectId`, so we probe
    // them under both candidate keys. Pre-fix the lookup used `actorId`
    // only, so every pass-2 row (admin actor, subject resource) missed
    // its window and fell through to the `!hasSigningKey` legacy branch
    // — unreachable on a signed deployment — leaving `isScrubbed` false.
    // The hash was then recomputed over the blanked body and mismatched
    // the stored `integrityHash`, raising a false "hash chain broken"
    // alarm after every GDPR erasure (#1843). The signed checkpoint
    // binds `scrubbedSubjectId` into the v2 HMAC, so widening coverage
    // to pass-2 rows only trusts rows the scrub actually attested.
    //
    // A bare `piiScrubbed: true` flag with no covering window is
    // suspicious and fails closed (recompute), unless the deployment
    // has no signing key configured at all (legacy unsigned mode).
    const actorId = typeof entry.actorId === 'string' ? entry.actorId : null;
    const resourceId =
      typeof entry.resourceId === 'string' ? entry.resourceId : null;
    let isScrubbed = false;
    if (piiScrubbed === true) {
      const candidateSubjectKeys: string[] = [];
      if (actorId !== null) candidateSubjectKeys.push(actorId);
      if (entry.resourceType === 'user' && resourceId !== null) {
        candidateSubjectKeys.push(resourceId);
      }
      const covered = candidateSubjectKeys.some((key) => {
        const windows = subjectScrubWindows.get(key);
        return (
          windows !== undefined &&
          windows.some((w) => entry.timestamp <= w.maxTimestamp)
        );
      });
      if (covered) {
        isScrubbed = true;
      } else if (!hasSigningKey) {
        // Legacy / unsigned-mode deployment: no signing key configured,
        // so signed-checkpoint coverage is impossible and the bare
        // `piiScrubbed` flag is the best signal we have. Surface the
        // count so operators see the unsigned trust window. Round-2 v02
        // H2 F6: this branch is strictly gated on `!hasSigningKey` so a
        // checkpoint-downgrade attacker on a signed deployment cannot
        // plant an unsigned `pii_scrub` row to bypass recompute.
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
            lastVerifiedId,
            lastVerifiedHash,
            firstBrokenAt: {
              logId: _id,
              timestamp: entry.timestamp,
              expected: '<known checkpoint anchor for previousHash>',
              actual: entryPreviousHash,
            },
          };
        }
      }
      isFirstEntry = false;
    }

    // Seed the expected hash from the first verified row when the caller did
    // not supply one (fresh walk, or a resume without `previousExpectedHash`):
    // adopt this row's own previousHash so its linkage check passes and the
    // walk anchors forward from here.
    if (needsSeed) {
      previousExpectedHash = entryPreviousHash;
      needsSeed = false;
    }

    if (entryPreviousHash !== previousExpectedHash) {
      return {
        valid: false,
        verifiedCount,
        checkpointsVerified,
        truncated,
        unsignedScrubCount,
        lastVerifiedTimestamp,
        lastVerifiedId,
        lastVerifiedHash,
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
          lastVerifiedId,
          lastVerifiedHash,
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
    lastVerifiedId = String(_id);
    lastVerifiedHash = integrityHash;
    verifiedCount++;
  }

  return {
    valid: true,
    verifiedCount,
    checkpointsVerified,
    truncated,
    unsignedScrubCount,
    lastVerifiedTimestamp,
    lastVerifiedId,
    lastVerifiedHash,
  };
}
