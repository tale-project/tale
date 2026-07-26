import { v } from 'convex/values';

/**
 * Convex arg validators for the knowledge-DB connection and the embedding
 * config, shared by the public `actions.ts` (V8) and the internal
 * `file_actions.ts` (`'use node'`). V8-safe (no `node:*`) so both can import
 * it. The SHAPE authority is still the Zod pair in
 * `lib/shared/schemas/knowledge.ts` — the public actions re-validate with it
 * (host regex, port range, dimensions bounds) before anything touches disk.
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

/** Masked connection view for the admin form — never carries the password. */
export interface KnowledgeConnectionView {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  hasPassword?: boolean;
}

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

export const knowledgeEmbeddingArgs = {
  providerSlug: v.string(),
  credentialId: v.optional(v.string()),
  model: v.string(),
  dimensions: v.number(),
  baseUrl: v.optional(v.string()),
} as const;

/** The org's embedding config as the admin form reads it (nothing secret in
 * it — the credential itself lives in the credentials table, not here). */
export interface KnowledgeEmbeddingView {
  configured: boolean;
  providerSlug?: string;
  credentialId?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}
