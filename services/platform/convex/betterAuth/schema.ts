/**
 * Better Auth Schema with Custom Indexes
 *
 * This file extends the auto-generated schema with custom indexes
 * for optimized query performance.
 *
 * Base schema regeneration:
 * cd convex/betterAuth && bunx @better-auth/cli generate -y --output generated_schema.ts
 */

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

import { tables as generatedTables } from './generated_schema';

// Extend the generated tables with custom indexes
export const tables = {
  ...generatedTables,
  // Override apikey: relax `configId` / `referenceId` to optional and keep
  // `userId` for pre-1.5 docs. better-auth 1.5 renamed `userId` →
  // `referenceId` and added a required `configId`; existing rows have neither.
  // Remove once a migration backfills the new fields.
  //
  // `suffix` is our addition: the last few plaintext characters of the
  // key, captured at creation time via an after-hook in `auth.ts` (the
  // upstream plugin only stores `start`). Used to render
  // `start … suffix` so users can match keys against the one they hold.
  // Nullable for pre-existing rows — no backfill since the plaintext is
  // irrecoverable from the hash.
  apikey: defineTable(
    v.object({
      ...generatedTables.apikey.validator.fields,
      configId: v.optional(v.string()),
      referenceId: v.optional(v.string()),
      userId: v.optional(v.string()),
      suffix: v.optional(v.union(v.null(), v.string())),
    }),
  ).index('key', ['key']),
  user: generatedTables.user.index('email', ['email']),
  // Add custom index for [organizationId, userId] queries on member table
  member: generatedTables.member.index('organizationId_userId', [
    'organizationId',
    'userId',
  ]),
  // Add composite index for efficient membership lookups (teamId, userId)
  teamMember: generatedTables.teamMember.index('teamId_userId', [
    'teamId',
    'userId',
  ]),
};

const schema = defineSchema(tables);

export default schema;
