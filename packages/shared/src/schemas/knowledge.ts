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
 * `pgConnectionSchema` is THE external-Postgres connection shape: every
 * config lane that points at a Postgres an operator brings (today: this one)
 * reuses it verbatim rather than declaring a second shape that would drift.
 */

import { z } from 'zod/v4';

/**
 * The characters a Postgres host may carry: hostname / IPv4 / IPv6 only.
 * Rejecting URL metacharacters (`/ ? & @ , space % #`) keeps a crafted host
 * from smuggling libpq params / downgrading TLS once it is interpolated into
 * a connection URL or DSN downstream (the SSRF-gate URL parser and the pg
 * driver's DSN parser must not be able to disagree on the host). Exported so
 * the settings form checks the very rule the door applies.
 */
export const PG_HOST_PATTERN = /^[A-Za-z0-9._:[\]-]+$/;

/** The longest database password a knowledge-connection write takes (the
 * app door's cap, which the settings form checks before it sends). */
export const KNOWLEDGE_CONNECTION_PASSWORD_MAX = 2_000;

/**
 * External-Postgres connection shape (no `table`/`schema` — the corpus owns
 * whole schemas on the target DB). Secrets (password) are NEVER stored here —
 * they live in the SOPS-encrypted secrets sidecar next to the file.
 */
export const pgConnectionSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .regex(
        PG_HOST_PATTERN,
        'Host may only contain letters, digits, and . _ - : [ ] (no URL metacharacters).',
      ),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1),
    user: z.string().min(1),
    sslmode: z
      .enum(['disable', 'prefer', 'require', 'verify-ca', 'verify-full'])
      .default('require'),
  })
  .strict();

export const KNOWLEDGE_CONFIG_DOMAIN = 'knowledge';
export const KNOWLEDGE_CONNECTION_KEY = 'connection';
export const KNOWLEDGE_EMBEDDING_KEY = 'embedding';

/**
 * The dense-leg similarity floor the built-in assistant's search applies
 * when `embedding.json` states none: a cosine under it reads as noise and is
 * dropped before fusion. One value cannot fit every embedding model — some
 * put unrelated text at 0.44–0.48 — which is why the file can override it
 * per organization (`minSimilarity`). REST callers get no floor unless they
 * send one.
 */
export const KNOWLEDGE_DEFAULT_MIN_SIMILARITY = 0.45;

/**
 * How many embedding requests Tale keeps in flight to an organization's
 * model at once, in each Tale process, when `embedding.json` states no
 * `maxConcurrentRequests` — the bound embedding had before it was
 * configurable.
 */
export const KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS = 3;

/**
 * The vector widths a knowledge database stores. Each has a table of its
 * own beside the chunks (`chunk_vectors_<width>`, created by the knowledge
 * migrations), and an organization's vectors go to the table of the width
 * its embedding model states — so organizations with models of different
 * widths share one database, and a change of width needs no change to the
 * database. A width outside this list has no table: saving it is refused.
 * Adding one means a migration that creates its table in both corpus
 * schemas; `chunk-vector-tables.guard.test.ts` holds the two lists equal.
 */
export const KNOWLEDGE_VECTOR_WIDTHS = [
  256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096,
] as const;
export type KnowledgeVectorWidth = (typeof KNOWLEDGE_VECTOR_WIDTHS)[number];

/** Whether a knowledge database has a table for vectors of this width. */
export function isKnowledgeVectorWidth(
  width: number,
): width is KnowledgeVectorWidth {
  return (KNOWLEDGE_VECTOR_WIDTHS as readonly number[]).includes(width);
}

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
 * name. Vectors are stored in the table of their width and a vector that
 * disagrees with the stated width is refused, so a wrong width is caught
 * immediately; a GUESSED width, by contrast, is right for the models we
 * happen to know and silently wrong for a new tag, a self-hosted model, or a
 * provider that truncates. The failure is invisible — writes succeed, and
 * retrieval quality quietly collapses — so the number is the operator's to
 * state.
 *
 * Reading accepts any width, so a file stored before the widths were a list
 * (or edited by hand) still opens in Settings; only a WRITE is held to
 * {@link KNOWLEDGE_VECTOR_WIDTHS} ({@link knowledgeEmbeddingWriteSchema}).
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
  /**
   * The cosine floor the built-in assistant's search applies to this
   * model's dense leg (0..1); absent means
   * {@link KNOWLEDGE_DEFAULT_MIN_SIMILARITY}. Set it where the model places
   * unrelated text above the default — the floor belongs to the model, so
   * it lives next to the model.
   */
  minSimilarity: z.number().min(0).max(1).optional(),
  /**
   * How many embedding requests to this model Tale keeps in flight at once
   * (1–64) — for this organization, in each Tale process (the API and every
   * worker count separately), shared by every indexing job, website scan and
   * search; further requests wait in arrival order, a search query ahead of
   * waiting batches. A lower value applies at once, a higher one once the
   * requests made under the old value are done. Absent means
   * {@link KNOWLEDGE_DEFAULT_MAX_CONCURRENT_REQUESTS}. On a server that
   * computes one request at a time and queues the rest, a higher bound adds
   * no load; it only lengthens the queue each request waits in.
   */
  maxConcurrentRequests: z.number().int().min(1).max(64).optional(),
  /**
   * The slowest rate, in tokens per second, at which the server computes
   * embeddings for this model under its usual load — including slowdowns
   * from other work on the same hardware, but NOT time a request spends
   * waiting behind other requests: Tale allows for that wait itself.
   *
   * Every request has a ceiling: 15 minutes (the indexing-job budget) for a
   * batch, 5 minutes for a search query — a chat turn waits on the query,
   * and the chat watchdog takes a turn for dead after 10 minutes without a
   * heartbeat; a search also ends after 5 minutes in all, slot wait
   * included.
   *
   * Set, this rate sizes each request's timeout as queue wait plus compute:
   * the request's own tokens (estimated from its characters), plus the other
   * `maxConcurrentRequests − 1` requests this process may have in flight and
   * `maxConcurrentRequests` more from other clients, each counted as at least
   * a full batch of 64 texts of 1,024 tokens; divided by this rate and
   * multiplied by 1.5, never under 60 seconds and never over the ceiling.
   * Absent, nothing says how long the server's queue may take, so a request
   * may wait its whole ceiling.
   */
  minTokensPerSecond: z.number().positive().optional(),
  /**
   * The most tokens Tale sends this model in any one minute — the
   * organization's requests in each Tale process together, estimated from
   * their characters (a conservative count, 1.2–1.5 times the real one for
   * prose). A batch that would cross it waits until the oldest minute's
   * worth has aged out; a sixtieth of it is kept per second as well, and
   * no single request carries more than that, because a provider enforces
   * its per-minute figure per second too. Set it to the provider's
   * tokens-per-minute limit (DashScope's text-embedding-v4 allows
   * 1,000,000) so a crawl of hundreds of pages is paced instead of refused
   * with 429s. Absent means unpaced.
   */
  maxTokensPerMinute: z.number().int().positive().optional(),
  /**
   * The most requests Tale sends this model in any one minute, counted the
   * same way; set it to the provider's requests-per-minute limit. Absent
   * means unpaced.
   */
  maxRequestsPerMinute: z.number().int().positive().optional(),
});
export type KnowledgeEmbeddingConfig = z.infer<typeof knowledgeEmbeddingSchema>;

/**
 * The `embedding.json` settings the Settings form does not carry: an
 * operator states them in the file or through the CLI. A write that omits
 * one keeps the stored value; only an explicit `null` removes it — so a form
 * save never resets them.
 */
export const KNOWLEDGE_EMBEDDING_KEPT_KEYS = [
  'minSimilarity',
  'maxConcurrentRequests',
  'minTokensPerSecond',
  'maxTokensPerMinute',
  'maxRequestsPerMinute',
] as const;

const embeddingFields = knowledgeEmbeddingSchema.shape;

/**
 * What a write to `embedding.json` accepts: the file's own shape, where each
 * of {@link KNOWLEDGE_EMBEDDING_KEPT_KEYS} may also be `null` (clear it),
 * and where `dimensions` is one of {@link KNOWLEDGE_VECTOR_WIDTHS} — a width
 * the knowledge database has no table for would save and then fail every
 * document at index time. The other bounds are the file's.
 */
export const knowledgeEmbeddingWriteSchema = knowledgeEmbeddingSchema.extend({
  // `: boolean` keeps the written type `number`: a predicate here would
  // narrow every caller's `dimensions` to the list's literal union.
  dimensions: embeddingFields.dimensions.refine(
    (width): boolean => isKnowledgeVectorWidth(width),
    {
      message: `Vector width must be one of ${KNOWLEDGE_VECTOR_WIDTHS.join(', ')}.`,
    },
  ),
  minSimilarity: embeddingFields.minSimilarity.unwrap().nullable().optional(),
  maxConcurrentRequests: embeddingFields.maxConcurrentRequests
    .unwrap()
    .nullable()
    .optional(),
  minTokensPerSecond: embeddingFields.minTokensPerSecond
    .unwrap()
    .nullable()
    .optional(),
  maxTokensPerMinute: embeddingFields.maxTokensPerMinute
    .unwrap()
    .nullable()
    .optional(),
  maxRequestsPerMinute: embeddingFields.maxRequestsPerMinute
    .unwrap()
    .nullable()
    .optional(),
});
export type KnowledgeEmbeddingWrite = z.infer<
  typeof knowledgeEmbeddingWriteSchema
>;
