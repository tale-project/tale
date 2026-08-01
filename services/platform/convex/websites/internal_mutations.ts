import { ConvexError, v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as WebsitesHelpers from './helpers';
import {
  isValidScanInterval,
  SCAN_INTERVAL_VALUES,
  websiteKindValidator,
  websiteStatusValidator,
} from './validators';

// Every website write funnels through `provisionWebsite`/`patchWebsite`, so
// guarding the scan interval here rejects an out-of-enum value from any caller
// (REST, the agent write tool, the Convex actions) before it is stored and
// silently crawled at the 6h default. The DB column stays `v.string()`, so no
// migration is needed — the guard is a runtime check, not a schema change.
function assertScanInterval(scanInterval: string): void {
  if (!isValidScanInterval(scanInterval)) {
    throw new ConvexError({
      code: 'INVALID_SCAN_INTERVAL',
      scanInterval,
      allowed: [...SCAN_INTERVAL_VALUES],
    });
  }
}

export const provisionWebsite = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    kind: v.optional(websiteKindValidator),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    assertScanInterval(args.scanInterval);
    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

export const deleteWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await WebsitesHelpers.deleteWebsite(ctx, args.websiteId);
  },
});

export const patchWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    kind: v.optional(websiteKindValidator),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    pageCount: v.optional(v.number()),
    crawledPageCount: v.optional(v.number()),
    metadata: v.optional(jsonRecordValidator),
    // Caller's org — when set, updateWebsite rejects a target row in another
    // tenant. REST handlers + the agent website_write tool MUST pass this.
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.scanInterval !== undefined) {
      assertScanInterval(args.scanInterval);
    }
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});
