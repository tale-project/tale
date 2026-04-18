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
  apikey: defineTable(
    v.object({
      ...generatedTables.apikey.validator.fields,
      configId: v.optional(v.string()),
      referenceId: v.optional(v.string()),
      userId: v.optional(v.string()),
    }),
  ).index('key', ['key']),
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
