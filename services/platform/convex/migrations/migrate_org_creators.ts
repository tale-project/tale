/**
 * Migration: Set organization creators to 'owner' role.
 *
 * For each organization:
 * 1. Find the member with the earliest createdAt (the original creator)
 * 2. Update their role from 'admin' to 'owner'
 * 3. Store creatorId in the organization's metadata
 *
 * Idempotent: skips organizations that already have an owner.
 *
 * Usage:
 *   bunx convex run migrations/migrate_org_creators:migrateOrgCreators
 */

import { isRecord, getString, getNumber } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

interface MemberRecord {
  _id: string;
  userId: string;
  role: string;
  createdAt: number;
}

export const migrateOrgCreators = internalMutation({
  args: {},
  handler: async (ctx) => {
    let totalUpdated = 0;
    let totalSkipped = 0;

    const orgsResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'organization',
        paginationOpts: { cursor: null, numItems: 500 },
        where: [],
      },
    );

    if (!orgsResult?.page?.length) {
      console.log('[migrate_org_creators] No organizations found');
      return { totalUpdated, totalSkipped };
    }

    for (const orgRaw of orgsResult.page) {
      const org = isRecord(orgRaw) ? orgRaw : undefined;
      const orgId = org ? getString(org, '_id') : undefined;
      if (!orgId) continue;

      const membersResult = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 100 },
          where: [{ field: 'organizationId', value: orgId, operator: 'eq' }],
        },
      );

      if (!membersResult?.page?.length) {
        totalSkipped++;
        continue;
      }

      const members: MemberRecord[] = [];
      for (const raw of membersResult.page) {
        const rec = isRecord(raw) ? raw : undefined;
        const id = rec ? getString(rec, '_id') : undefined;
        const userId = rec ? getString(rec, 'userId') : undefined;
        if (!id || !userId) continue;
        members.push({
          _id: id,
          userId,
          role: getString(rec, 'role') ?? 'member',
          createdAt: getNumber(rec, 'createdAt') ?? Infinity,
        });
      }

      const hasOwner = members.some((m) => m.role.toLowerCase() === 'owner');
      if (hasOwner) {
        totalSkipped++;
        continue;
      }

      const creator = members.reduce((earliest, m) =>
        m.createdAt < earliest.createdAt ? m : earliest,
      );

      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'member',
          where: [{ field: '_id', value: creator._id, operator: 'eq' }],
          update: { role: 'owner' },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });

      const existingMetadata = org ? getString(org, 'metadata') : undefined;
      let metadata: Record<string, unknown> = {};
      if (existingMetadata) {
        try {
          const parsed = JSON.parse(existingMetadata);
          if (isRecord(parsed)) {
            metadata = parsed;
          }
        } catch {
          // ignore malformed metadata
        }
      }
      metadata.creatorId = creator.userId;

      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'organization',
          where: [{ field: '_id', value: orgId, operator: 'eq' }],
          update: { metadata: JSON.stringify(metadata) },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });

      totalUpdated++;
      console.log(
        `[migrate_org_creators] Org ${orgId}: set user ${creator.userId} as owner`,
      );
    }

    console.log(
      `[migrate_org_creators] Done. Updated: ${totalUpdated}, Skipped: ${totalSkipped}`,
    );
    return { totalUpdated, totalSkipped };
  },
});
