/**
 * Better Auth Schema with Custom Indexes
 *
 * This file extends the auto-generated schema with custom indexes
 * for optimized query performance.
 *
 * Base schema regeneration:
 * cd convex/betterAuth && npx @better-auth/cli generate -y --output generated_schema.ts
 */

import { defineSchema } from 'convex/server';
import { tables as generatedTables } from './generated_schema';

// Extend the generated tables with custom indexes
export const tables = {
  ...generatedTables,
  // Add custom index for [organizationId, userId] queries on member table
  member: generatedTables.member.index('organizationId_userId', [
    'organizationId',
    'userId',
  ]),
};

const schema = defineSchema(tables);

export default schema;
