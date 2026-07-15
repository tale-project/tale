import { v } from 'convex/values';

/**
 * Convex arg validators for the knowledge-DB connection, shared by the public
 * `actions.ts` (V8) and the internal `file_actions.ts` (`'use node'`). V8-safe
 * (no `node:*`) so both can import it. The SHAPE authority is still
 * `knowledgeConnectionFileSchema` (Zod) — the public action re-validates with it
 * (host regex, port range) before anything touches disk.
 */

/** Matches the `pgConnectionSchema` sslmode enum. */
export const sslmodeValidator = v.union(
  v.literal('disable'),
  v.literal('prefer'),
  v.literal('require'),
  v.literal('verify-ca'),
  v.literal('verify-full'),
);

export const knowledgeConnectionArgs = {
  host: v.string(),
  port: v.number(),
  database: v.string(),
  user: v.string(),
  sslmode: sslmodeValidator,
} as const;

/**
 * Result of a knowledge-DB connection probe. Optional fields (matching the
 * deployment-wide datastore test's UI contract) are absent when the probe could
 * not reach the DB.
 */
export interface KnowledgeConnectionProbeResult {
  ok: boolean;
  latencyMs?: number;
  version?: string;
  vectorAvailable?: boolean;
  paradedbAvailable?: boolean;
  error?: string;
  hint?: string;
}
