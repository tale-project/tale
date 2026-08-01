/**
 * Convex validators for website operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const websiteStatusValidator = v.union(
  v.literal('idle'),
  v.literal('scanning'),
  v.literal('active'),
  v.literal('error'),
  v.literal('deleting'),
);

/** What a websites row IS: a crawled site (pages discovered via
 * robots/sitemaps/links) or a curated list of URLs fetched verbatim. Absent
 * on rows that predate the distinction — read absent as 'site'. */
export const websiteKindValidator = v.union(
  v.literal('site'),
  v.literal('list'),
);

/**
 * The allowed scan-interval cadences. This is the single source of truth for
 * every write path (REST, the agent write tool, and the Convex actions) —
 * `scanIntervalToSeconds` maps exactly these values, so an unrecognized value
 * would silently fall back to the 6h default and get crawled at the wrong rate.
 */
export const SCAN_INTERVAL_VALUES = [
  '60m',
  '6h',
  '12h',
  '1d',
  '5d',
  '7d',
  '30d',
] as const;

export type ScanInterval = (typeof SCAN_INTERVAL_VALUES)[number];

export function isValidScanInterval(value: unknown): value is ScanInterval {
  return (
    typeof value === 'string' &&
    (SCAN_INTERVAL_VALUES as readonly string[]).includes(value)
  );
}

export const websiteValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  kind: v.optional(websiteKindValidator),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(websiteStatusValidator),
  pageCount: v.optional(v.number()),
  crawledPageCount: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});
