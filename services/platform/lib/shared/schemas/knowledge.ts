import { z } from 'zod/v4';

import { pgConnectionSchema } from './deployment';

/**
 * Per-organization "bring your own Postgres" for the knowledge/RAG corpus.
 *
 * An org may point its `private_knowledge` (RAG) corpus — document metadata,
 * chunk text, embeddings, the BM25 index, the semantic cache — at its OWN
 * managed Postgres (pgvector + `pg_search`/ParadeDB) instead of the bundled,
 * deployment-wide `knowledge-db`. The crawler `public_web` corpus is org-shared
 * web content and ALWAYS stays on the deployment-default pool.
 *
 * This is a file-based config domain like `sso`: admin-created on demand, one
 * file per org, no builtin catalog. On disk (mirrors `providers`/`sso`):
 *   {TALE_CONFIG_DIR}/<orgSlug>/knowledge/connection.json          (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/knowledge/connection.secrets.json  (SOPS secret)
 *
 * The connection SHAPE is the same `pgConnectionSchema` the deployment-wide
 * `dataStores.knowledgePostgres` already uses ({host,port,database,user,sslmode})
 * — never a divergent second copy. The password lives ONLY in the SOPS-encrypted
 * secrets sidecar, exactly like `providers/*.secrets.json`.
 *
 * Absent `connection.json` ⇒ the org uses the deployment default (today's
 * behaviour, zero regression). Present ⇒ the RAG pool for that org resolves to
 * its own Postgres.
 */

export const KNOWLEDGE_CONFIG_DOMAIN = 'knowledge';
export const KNOWLEDGE_CONNECTION_KEY = 'connection';

/**
 * `connection.json` — the org's knowledge Postgres connection. Reuses the
 * deployment external-Postgres shape verbatim (the RAG service owns the whole
 * `private_knowledge` schema on the target DB, so there is no `table`/`schema`).
 */
export const knowledgeConnectionFileSchema = pgConnectionSchema;
export type KnowledgeConnectionFile = z.infer<
  typeof knowledgeConnectionFileSchema
>;

/**
 * `connection.secrets.json` — the password sidecar. SOPS-encrypted at rest when
 * a SOPS age key is configured; plaintext JSON otherwise (same hybrid model as
 * `providers`). Passwordless auth (peer/trust/cert) is valid, so `password` is
 * optional.
 */
export const knowledgeConnectionSecretsSchema = z.object({
  password: z.string().min(1).optional(),
});
export type KnowledgeConnectionSecrets = z.infer<
  typeof knowledgeConnectionSecretsSchema
>;
