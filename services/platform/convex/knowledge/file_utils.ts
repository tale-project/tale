'use node';

/**
 * Per-organization knowledge-DB config file utilities.
 *
 * Pure path + (de)serialization + resolution helpers for the `knowledge` config
 * domain (admin-on-demand, one file per org, no builtin catalog). On disk,
 * mirroring `providers`/`sso`:
 *   {TALE_CONFIG_DIR}/<orgSlug>/knowledge/connection.json          (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/knowledge/connection.secrets.json  (SOPS secret)
 *
 * The connection is read here by the RAG pool resolver (`knowledge_db.ts`,
 * `'use node'`) to route an org's `private_knowledge` corpus at its own
 * Postgres. The admin read/save/delete actions live in `config/file_actions.ts`;
 * the org-gated public actions in `config/actions.ts`.
 */

import path from 'node:path';

import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  KNOWLEDGE_CONFIG_DOMAIN,
  KNOWLEDGE_CONNECTION_KEY,
  knowledgeConnectionFileSchema,
  knowledgeConnectionSecretsSchema,
  type KnowledgeConnectionFile,
  type KnowledgeConnectionSecrets,
} from '../../lib/shared/schemas/knowledge';
import {
  errnoCode,
  getConfigRoot,
  readFileSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';

export type { KnowledgeConnectionFile, KnowledgeConnectionSecrets };
export { KNOWLEDGE_CONFIG_DOMAIN, KNOWLEDGE_CONNECTION_KEY };

export const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB

/** `<orgSlug>/knowledge/` — the org's knowledge-DB config directory. */
export function resolveKnowledgeDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot(KNOWLEDGE_CONFIG_DOMAIN),
    orgSlug,
    KNOWLEDGE_CONFIG_DOMAIN,
  );
}

/** `<orgSlug>/knowledge/connection.json` — non-secret connection config. */
export function resolveKnowledgeConnectionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveKnowledgeDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.json`,
  );
}

/** `<orgSlug>/knowledge/connection.secrets.json` — SOPS password sidecar. */
export function resolveKnowledgeConnectionSecretsFilePath(
  orgSlug: string,
): string {
  return safeJoinWithinDir(
    resolveKnowledgeDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.secrets.json`,
  );
}

/** `<orgSlug>/knowledge/.history/connection` — config history snapshots. */
export function resolveKnowledgeHistoryDir(orgSlug: string): string {
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveKnowledgeDir(orgSlug), '.history'),
    KNOWLEDGE_CONNECTION_KEY,
  );
}

/** Serialize the connection config to its canonical on-disk form. */
export function serializeKnowledgeConnectionJson(
  config: KnowledgeConnectionFile,
): string {
  return (
    JSON.stringify(knowledgeConnectionFileSchema.parse(config), null, 2) + '\n'
  );
}

/** Parse + validate `connection.json`. Throws on invalid input. */
export function parseKnowledgeConnectionJson(
  content: string,
): KnowledgeConnectionFile {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeConnectionFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge connection config', result.error),
    );
  }
  return result.data;
}

/** Serialize the secrets sidecar (omit absent keys). */
export function serializeKnowledgeSecretsJson(
  secrets: KnowledgeConnectionSecrets,
): string {
  return (
    JSON.stringify(knowledgeConnectionSecretsSchema.parse(secrets), null, 2) +
    '\n'
  );
}

/** Parse + validate `connection.secrets.json`. Throws on invalid input. */
export function parseKnowledgeSecretsJson(
  content: string,
): KnowledgeConnectionSecrets {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeConnectionSecretsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge secrets file', result.error),
    );
  }
  return result.data;
}

export interface ResolvedKnowledgeConnection {
  connection: KnowledgeConnectionFile;
  password: string;
}

/**
 * Read + resolve an org's knowledge-DB connection.
 *
 * Returns `null` when the org has NO `connection.json` — the caller then uses
 * the deployment default (today's behaviour). Returns the connection + resolved
 * password when present.
 *
 * FAIL-CLOSED: throws when `connection.json` is present but invalid, or when the
 * password sidecar exists but cannot be decrypted (missing SOPS key). Never
 * falls back to the shared default DB for a misconfigured per-org store —
 * mis-routing a tenant's corpus into the shared database is worse than erroring.
 */
export async function readOrgKnowledgeConnection(
  orgSlug: string,
): Promise<ResolvedKnowledgeConnection | null> {
  const configRaw = await readFileSafe(
    resolveKnowledgeConnectionFilePath(orgSlug),
  );
  if (configRaw === null) {
    return null;
  }
  const connection = parseKnowledgeConnectionJson(configRaw);
  const password = await readKnowledgePassword(orgSlug);
  return { connection, password };
}

/**
 * Read the org's knowledge-DB password from the SOPS sidecar. Absent sidecar →
 * `''` (passwordless auth is valid). Present-but-undecryptable → throws (fail
 * closed).
 */
async function readKnowledgePassword(orgSlug: string): Promise<string> {
  const secretsPath = resolveKnowledgeConnectionSecretsFilePath(orgSlug);
  let raw: Record<string, unknown>;
  try {
    raw = await decryptSecretsFile(secretsPath);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') {
      return '';
    }
    throw err;
  }
  const parsed = knowledgeConnectionSecretsSchema.safeParse(raw);
  return parsed.success && parsed.data.password ? parsed.data.password : '';
}

/**
 * Assemble a `postgresql://` URL for an org's knowledge DB.
 *
 * `user`, `password`, and `database` are percent-encoded; the `host` is already
 * restricted to URL-safe characters by `pgConnectionSchema` (its regex rejects
 * URL metacharacters precisely so it is safe to interpolate here). `sslmode` is
 * applied via the `?sslmode=` query param — postgres.js honours it (v3.4.7 maps
 * `disable`→plaintext, `require`/`prefer`→TLS, `verify-*`→verified TLS), which
 * is the established way the RAG runtime consumes sslmode.
 */
export function buildKnowledgeUrl(
  resolved: ResolvedKnowledgeConnection,
): string {
  const c = resolved.connection;
  const auth = `${encodeURIComponent(c.user)}:${encodeURIComponent(resolved.password)}`;
  const database = encodeURIComponent(c.database);
  return `postgresql://${auth}@${c.host}:${c.port}/${database}?sslmode=${c.sslmode}`;
}
