/**
 * Audit log hash chain integrity verification.
 *
 * Walks backward through the organization's audit log chain and
 * verifies that each entry's integrityHash matches the expected
 * SHA-256(previousHash + canonicalized record content).
 *
 * Admin-only access.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { computeAuditHash } from '../lib/helpers/audit_hash';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

export const verifyIntegrity = query({
  args: {
    organizationId: v.string(),
    maxEntries: v.optional(v.number()),
  },
  returns: v.object({
    valid: v.boolean(),
    verifiedCount: v.number(),
    firstBrokenAt: v.optional(
      v.object({
        logId: v.string(),
        timestamp: v.number(),
        expected: v.string(),
        actual: v.string(),
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
    let previousExpectedHash = '';
    let isFirstEntry = true;

    // Walk the chain in ascending order (oldest first) to verify forward links
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
      .order('desc')) {
      entries.push({
        ...log,
        _id: String(log._id),
      });

      if (entries.length >= maxEntries) {
        break;
      }
    }

    // Reverse to process oldest first
    entries.reverse();

    for (const entry of entries) {
      // Skip entries that predate the hash chain (no integrityHash)
      if (!entry.integrityHash) {
        continue;
      }

      // Build record for hash recomputation (exclude hash chain fields and Convex internals)
      const { integrityHash, previousHash, _id, _creationTime, ...record } =
        entry;

      if (isFirstEntry) {
        previousExpectedHash = previousHash ?? '';
        isFirstEntry = false;
      }

      // Verify the previousHash field matches what we expect from the chain
      const entryPreviousHash = previousHash ?? '';
      if (entryPreviousHash !== previousExpectedHash) {
        return {
          valid: false,
          verifiedCount,
          firstBrokenAt: {
            logId: _id,
            timestamp: entry.timestamp,
            expected: previousExpectedHash,
            actual: entryPreviousHash,
          },
        };
      }

      // Recompute the hash and compare
      const recomputed = await computeAuditHash(entryPreviousHash, record);
      if (recomputed !== integrityHash) {
        return {
          valid: false,
          verifiedCount,
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

    return { valid: true, verifiedCount };
  },
});
