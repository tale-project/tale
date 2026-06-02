import { z } from 'zod';

/**
 * Deployment-wide vector-database configuration.
 *
 * A SINGLE config for the whole deployment (not per-org): it selects which
 * vector-store backend the RAG service uses. The RAG service reads the
 * resulting `vectordb.json` (+ SOPS-encrypted `vectordb.secrets.json`) from
 * the shared config volume and picks its driver accordingly.
 *
 * Keep the backend literals in lockstep with the RAG-side
 * `services/rag/app/services/vector_store/config_reader.py` (`VALID_BACKENDS`).
 */

// Qdrant collection name: letters/digits, then letters/digits/_/-. Mirrors
// the conservative shape Qdrant accepts and keeps it path/log-safe.
const COLLECTION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

export const vectorDbConfigSchema = z.discriminatedUnion('backend', [
  z.object({ backend: z.literal('pgvector') }),
  z.object({ backend: z.literal('qdrant'), qdrant: qdrantConfigSchema }),
]);

export type VectorDbConfig = z.infer<typeof vectorDbConfigSchema>;

/** Write-only secret for the external backend (e.g. the Qdrant API key). */
export const vectorDbSecretsSchema = z.object({
  apiKey: z.string().min(1),
});

export type VectorDbSecrets = z.infer<typeof vectorDbSecretsSchema>;
