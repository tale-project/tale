/**
 * The `knowledge` org-config domain: which database an organization's corpus
 * lives in, and which embedding model writes into it.
 *
 * Per-org configuration is files, never rows, so both live under
 * `$TALE_CONFIG_DIR/<org>/knowledge/`:
 *
 *   connection.json          — the organization's own Postgres, when it brings
 *                              one. Absent means the deployment default.
 *   connection.secrets.json  — the database password (SOPS-encrypted at rest).
 *   embedding.json           — the embedding model, stated in full.
 *
 * `connection.json` reuses `pgConnectionSchema` verbatim rather than declaring
 * a second connection shape — the deployment-wide external-Postgres setting and
 * an organization's own database are the same kind of thing, and two schemas
 * for it would drift.
 */

import { z } from 'zod/v4';

import { pgConnectionSchema } from '../shared/schemas/deployment';

export const KNOWLEDGE_CONFIG_DOMAIN = 'knowledge';
export const KNOWLEDGE_CONNECTION_KEY = 'connection';
export const KNOWLEDGE_EMBEDDING_KEY = 'embedding';

/**
 * `connection.json` — the organization's own knowledge Postgres.
 *
 * The corpus owns whole schemas on the target database (`private_knowledge` and
 * `public_web`), so there is no table or schema field to configure: pointing an
 * organization at a database hands it that database's knowledge schemas
 * entirely.
 */
export const knowledgeConnectionSchema = pgConnectionSchema;
export type KnowledgeConnection = z.infer<typeof knowledgeConnectionSchema>;

/**
 * `connection.secrets.json` — the password sidecar.
 *
 * Optional because passwordless authentication (peer, trust, client
 * certificate) is a legitimate setup; a missing sidecar is not a
 * misconfiguration, whereas a present-but-undecryptable one is.
 */
export const knowledgeConnectionSecretsSchema = z.object({
  password: z.string().min(1).optional(),
});
export type KnowledgeConnectionSecrets = z.infer<
  typeof knowledgeConnectionSecretsSchema
>;

/**
 * `embedding.json` — the embedding model, stated explicitly.
 *
 * `dimensions` is REQUIRED, has no default, and is never derived from the model
 * name. A corpus stores one vector column of one fixed width and refuses
 * vectors that disagree with it, so a wrong width is caught immediately; a
 * GUESSED width, by contrast, is right for the models we happen to know and
 * silently wrong for a new tag, a self-hosted model, or a provider that
 * truncates. The failure is invisible — writes succeed, and retrieval quality
 * quietly collapses — so the number is the operator's to state.
 *
 * `credentialId` is optional: absent means the organization's default
 * credential for `providerSlug`. The credential itself is never stored here;
 * only which one to resolve.
 */
export const knowledgeEmbeddingSchema = z.object({
  /** The provider whose credential authorizes the embedding calls. */
  providerSlug: z.string().min(1),
  /** A specific stored credential; omitted means the org's default for the
   * provider. */
  credentialId: z.string().min(1).optional(),
  /** The model tag as the provider spells it. */
  model: z.string().min(1),
  /** Vector width. Required, never inferred. */
  dimensions: z.number().int().min(1).max(16_000),
  /** OpenAI-compatible base URL, when the provider is not the default one. */
  baseUrl: z.string().url().optional(),
});
export type KnowledgeEmbeddingConfig = z.infer<typeof knowledgeEmbeddingSchema>;
