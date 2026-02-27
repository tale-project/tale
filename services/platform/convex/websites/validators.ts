/**
 * Convex validators for website operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { websiteStatusSchema } from '../../lib/shared/schemas/websites';

export {
  websiteStatusSchema,
  websiteSchema,
} from '../../lib/shared/schemas/websites';

// Simple schemas without z.lazy()
export const websiteStatusValidator = zodToConvex(websiteStatusSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const websiteValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(websiteStatusValidator),
  pageCount: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});
