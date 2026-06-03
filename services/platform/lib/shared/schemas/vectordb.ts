import { z } from 'zod';

/**
 * Per-organization vector-database configuration.
 *
 * Each org has its own config selecting which vector-store backend the RAG
 * service uses for that org's documents. The RAG service reads the org's
 * `<orgSlug>/vectordb.json` (+ SOPS-encrypted `vectordb.secrets.json`) from
 * the shared config volume and picks that org's driver accordingly. Orgs
 * without a config file fall back to built-in pgvector.
 *
 * Keep the backend literals in lockstep with the RAG-side
 * `services/rag/app/services/vector_store/config_reader.py` (`VALID_BACKENDS`).
 */

// Qdrant collection name: letters/digits, then letters/digits/_/-. Mirrors
// the conservative shape Qdrant accepts and keeps it path/log-safe.
const COLLECTION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Postgres identifier for the external pgvector table: starts with a letter or
// underscore, then letters/digits/underscore. Kept to a single unquoted
// identifier (no schema-qualified or quoted names) so it interpolates safely
// into the RAG driver's DDL/DML without quoting surprises.
const PG_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const qdrantConfigSchema = z.object({
  url: z.string().url(),
  collection: z
    .string()
    .regex(
      COLLECTION_RE,
      'Collection must start alphanumeric and use only letters, digits, - or _',
    )
    .default('tale_chunks'),
  preferGrpc: z.boolean().optional(),
});

// External pgvector: a user-supplied Postgres reachable from the RAG service.
// Non-secret connection params live here (editable + displayable); the password
// is the write-only secret in `vectordb.secrets.json`, mirroring the Qdrant
// url-in-config + apiKey-as-secret split.
const pgvectorExternalConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  sslmode: z
    .enum(['disable', 'prefer', 'require', 'verify-ca', 'verify-full'])
    .default('require'),
  table: z
    .string()
    .regex(
      PG_IDENT_RE,
      'Table must be a single unquoted identifier: start with a letter or underscore, then letters, digits or underscore',
    )
    .default('tale_vectors'),
});

export const vectorDbConfigSchema = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('pgvector') }),
  z.object({
    backend: z.literal('pgvector_external'),
    pgvectorExternal: pgvectorExternalConfigSchema,
  }),
  z.object({ backend: z.literal('qdrant'), qdrant: qdrantConfigSchema }),
]);

export type VectorDbConfig = z.infer<typeof vectorDbConfigSchema>;

/**
 * Write-only secrets for the active external backend. A single deployment-wide
 * file shared across backends: Qdrant uses `apiKey`, external pgvector uses
 * `password`. Both optional — the built-in backend writes no secret, and Qdrant
 * may be unauthenticated. At least one is required when a secret is written
 * (enforced where the file is merged, not here, so a partial merge stays valid).
 */
export const vectorDbSecretsSchema = z.object({
  apiKey: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});

export type VectorDbSecrets = z.infer<typeof vectorDbSecretsSchema>;
