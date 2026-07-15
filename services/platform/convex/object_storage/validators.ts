import { v } from 'convex/values';

/**
 * Shared arg + view shapes for the per-org object-storage connection admin
 * actions. V8-safe (only `convex/values` + types) so both the public
 * `actions.ts` and the `'use node'` `file_actions.ts` can import them.
 */

/** Non-secret bucket-coordinate args (mirrors the `connection.json` schema). */
export const objectStorageConnectionArgs = {
  region: v.string(),
  endpoint: v.optional(v.string()),
  forcePathStyle: v.optional(v.boolean()),
  bucket: v.string(),
  prefix: v.optional(v.string()),
} as const;

/** Masked admin view of a saved connection — never carries the credentials. */
export interface ObjectStorageConnectionView {
  configured: boolean;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket?: string;
  prefix?: string;
  /** Whether an encrypted credentials sidecar is present (never the values). */
  hasCredentials?: boolean;
}

/** Result of a test-connection probe (real PUT+GET+DELETE round-trip). */
export interface ObjectStorageProbeResult {
  ok: boolean;
  error?: string;
}
