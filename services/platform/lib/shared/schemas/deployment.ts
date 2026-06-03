import { z } from 'zod/v4';

/**
 * Deployment-level (instance-wide) configuration.
 *
 * Unlike the per-org config files (`<orgSlug>/providers.json`,
 * `<orgSlug>/retention.json`, …), this is a SINGLE deployment-scoped file at
 * the config root (`<configRoot>/deployment.json` + a SOPS-encrypted
 * `deployment.secrets.json` sidecar). It is written by instance-admin Convex
 * actions and CONSUMED BY THE rag/convex/platform ENTRYPOINTS AT BOOT — none
 * of it is hot-reloaded (changing where data physically lives requires a
 * service restart). A top-level (one-path-segment) file is intentionally
 * ignored by the per-org config-watcher.
 *
 * The shape is a SECTIONED REGISTRY: `version` + a set of optional sections.
 * Adding a future deployment section (SMTP, telemetry, …) is purely additive
 * — add an optional field here and its secret keys to
 * `DEPLOYMENT_SECRET_KEYS`; the Convex read/save/test actions stay
 * section-agnostic (they read/write the whole file).
 */

export const DEPLOYMENT_CONFIG_VERSION = 1 as const;

/**
 * Reusable external-Postgres connection shape (no `table`/`schema` — the RAG
 * service owns the whole `private_knowledge` schema on the target DB). Models
 * the same fields the per-org external-pgvector connection used. Secrets
 * (password) are NEVER stored here — they live in the SOPS secrets sidecar
 * keyed by `DEPLOYMENT_SECRET_KEYS`.
 */
export const pgConnectionSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1),
    user: z.string().min(1),
    sslmode: z
      .enum(['disable', 'prefer', 'require', 'verify-ca', 'verify-full'])
      .default('require'),
  })
  .strict();

export type PgConnection = z.infer<typeof pgConnectionSchema>;

/**
 * The five Convex storage use-cases. When storage mode is `s3`, the
 * self-hosted `convex-local-backend` puts ALL of them in S3 (it is
 * all-or-nothing — there is no per-use-case local/S3 split), each in its own
 * bucket via `S3_STORAGE_{FILES,EXPORTS,SNAPSHOT_IMPORTS,MODULES,SEARCH}_BUCKET`.
 * `files` holds the user-uploaded `_storage` blobs — the one that matters for
 * document residency.
 */
const s3BucketsSchema = z
  .object({
    files: z.string().min(1),
    exports: z.string().min(1),
    snapshotImports: z.string().min(1),
    modules: z.string().min(1),
    search: z.string().min(1),
  })
  .strict();

/**
 * Convex file-storage backend. `local` (default) keeps `_storage` blobs on the
 * local volume — today's behavior. `s3` points them at an external /
 * S3-compatible object store (AWS S3, MinIO, Cloudflare R2); `endpoint` +
 * `forcePathStyle` cover the S3-compatible cases. Credentials
 * (accessKeyId/secretAccessKey) live in the secrets sidecar.
 *
 * NOTE: switching local→S3 on an existing deployment does NOT migrate the
 * already-stored local blobs — S3 mode is greenfield (set at initial deploy)
 * or requires a separate offline copy. The UI/docs must warn.
 */
export const convexStorageSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('local') }).strict(),
  z
    .object({
      mode: z.literal('s3'),
      region: z.string().min(1),
      endpoint: z.string().url().optional(),
      forcePathStyle: z.boolean().default(false),
      buckets: s3BucketsSchema,
    })
    .strict(),
]);

export type ConvexStorage = z.infer<typeof convexStorageSchema>;

/**
 * `dataStores` section — where the deployment's data physically lives.
 * - `knowledgePostgres`: the RAG knowledge DB (documents + chunk text +
 *   embeddings + BM25 + semantic cache). Must be ParadeDB (pgvector +
 *   pg_search) or hybrid search degrades to vector-only.
 * - `convexStorage`: where Convex `_storage` blobs (original uploaded files)
 *   live.
 * - `appPostgres`: optional override for the Convex/app metadata DB.
 * All optional — an absent section means "use the `.env` default" (today's
 * built-in stores).
 */
export const dataStoresSchema = z
  .object({
    knowledgePostgres: pgConnectionSchema.optional(),
    convexStorage: convexStorageSchema.optional(),
    appPostgres: pgConnectionSchema.optional(),
  })
  .strict();

export type DataStores = z.infer<typeof dataStoresSchema>;

/**
 * Root deployment config. `version` pins the file format (future migrations
 * bump it). Every section is optional so adding a new one never breaks an
 * older file, and an empty `{ version: 1 }` is valid (no overrides → `.env`
 * defaults everywhere).
 */
export const deploymentConfigSchema = z
  .object({
    version: z.literal(DEPLOYMENT_CONFIG_VERSION),
    dataStores: dataStoresSchema.optional(),
  })
  .strict();

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

/**
 * Allowlist of secret keys for the SOPS-encrypted `deployment.secrets.json`.
 * Keys are FLAT, DOTTED, and namespaced by section so a new section's secrets
 * never collide and merge independently. The secrets file validates against
 * this enum — an unknown key is rejected. Adding a section = add its keys
 * here.
 */
export const DEPLOYMENT_SECRET_KEYS = [
  'dataStores.knowledgePostgres.password',
  'dataStores.convexStorage.accessKeyId',
  'dataStores.convexStorage.secretAccessKey',
  'dataStores.appPostgres.password',
] as const;

export type DeploymentSecretKey = (typeof DEPLOYMENT_SECRET_KEYS)[number];

/**
 * Secrets sidecar shape: a partial map from an allowlisted secret key to its
 * (non-empty) string value. Stored SOPS-encrypted; never returned to the
 * browser in full (masked on read).
 */
export const deploymentSecretsSchema = z.partialRecord(
  z.enum(DEPLOYMENT_SECRET_KEYS),
  z.string().min(1),
);

export type DeploymentSecrets = z.infer<typeof deploymentSecretsSchema>;
