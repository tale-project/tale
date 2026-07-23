'use node';

/**
 * Where an organization's knowledge corpus lives, and which embedding model
 * writes into it — read from the organization's own config files.
 *
 * Both answers are FAIL-CLOSED, and that is the whole point of this module.
 *
 * An organization that brings its own database does so because its documents
 * must not sit in the shared one — a data-residency requirement, a customer
 * contract, a regulator. If its `connection.json` is malformed, or its password
 * sidecar exists but cannot be decrypted because the SOPS key is missing on
 * this node, the ONLY safe outcome is an error. Falling back to the deployment
 * default would silently write that organization's documents into the shared
 * corpus, where they would be readable by an operator who was told they never
 * would be, and the mistake would be invisible until an audit found it. An
 * outage is recoverable; that is not.
 *
 * The one case that is NOT a failure is an absent `connection.json`: an
 * organization that never configured its own database is meant to use the
 * deployment default, and that is a configuration, not an error.
 */

import path from 'node:path';

import {
  KNOWLEDGE_CONFIG_DOMAIN,
  KNOWLEDGE_CONNECTION_KEY,
  KNOWLEDGE_EMBEDDING_KEY,
  knowledgeConnectionSchema,
  knowledgeConnectionSecretsSchema,
  knowledgeEmbeddingSchema,
  type KnowledgeConnection,
  type KnowledgeEmbeddingConfig,
} from '../../lib/knowledge/config';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  errnoCode,
  getConfigRoot,
  readFileSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';

/** `$TALE_CONFIG_DIR/<org>/knowledge/` */
export function knowledgeConfigDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid organization slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot(KNOWLEDGE_CONFIG_DOMAIN),
    orgSlug,
    KNOWLEDGE_CONFIG_DOMAIN,
  );
}

export function connectionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    knowledgeConfigDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.json`,
  );
}

export function connectionSecretsFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    knowledgeConfigDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.secrets.json`,
  );
}

export function embeddingFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    knowledgeConfigDir(orgSlug),
    `${KNOWLEDGE_EMBEDDING_KEY}.json`,
  );
}

export interface ResolvedKnowledgeConnection {
  readonly connection: KnowledgeConnection;
  /** Empty string when the database uses passwordless authentication. */
  readonly password: string;
}

/**
 * Read an organization's own database connection.
 *
 * `null` means the organization did not configure one and should use the
 * deployment default. Anything else that goes wrong THROWS — see the module
 * note.
 */
export async function readOrgConnection(
  orgSlug: string,
): Promise<ResolvedKnowledgeConnection | null> {
  const raw = await readFileSafe(connectionFilePath(orgSlug));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // `Object.assign` bolts the cause on: the Convex tsconfig's lib predates
    // the two-argument Error constructor even though the runtime supports it.
    throw Object.assign(
      new Error(
        `Organization "${orgSlug}" has a knowledge connection file that is not valid JSON. Fix or remove it; its corpus will not fall back to the shared database. (${describe(err)})`,
      ),
      { cause: err },
    );
  }
  const result = knowledgeConnectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage(
        `Organization "${orgSlug}" has an invalid knowledge connection config; its corpus will not fall back to the shared database`,
        result.error,
      ),
    );
  }
  return { connection: result.data, password: await readPassword(orgSlug) };
}

/**
 * Read the database password from the SOPS sidecar.
 *
 * An absent sidecar yields `''`, because passwordless authentication is valid.
 * A sidecar that exists but cannot be read or decrypted throws: the
 * organization DID configure a secret, and continuing without it would mean
 * either failing to connect in a confusing way or — worse, if a fallback
 * existed — using the wrong database.
 */
export async function readPassword(orgSlug: string): Promise<string> {
  let raw: Record<string, unknown>;
  try {
    raw = await decryptSecretsFile(connectionSecretsFilePath(orgSlug));
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return '';
    throw err;
  }
  const parsed = knowledgeConnectionSecretsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      zodErrorMessage(
        `Organization "${orgSlug}" has an unreadable knowledge password sidecar`,
        parsed.error,
      ),
    );
  }
  return parsed.data.password ?? '';
}

/**
 * Build the `postgresql://` URL for an organization's own database.
 *
 * User, password, and database name are percent-encoded. The host is not, and
 * does not need to be: `pgConnectionSchema` restricts it to hostname, IPv4, and
 * IPv6 characters precisely so it can be interpolated here without a crafted
 * value smuggling libpq parameters or downgrading TLS.
 */
export function buildConnectionUrl(
  resolved: ResolvedKnowledgeConnection,
): string {
  const c = resolved.connection;
  const auth = `${encodeURIComponent(c.user)}:${encodeURIComponent(resolved.password)}`;
  return `postgresql://${auth}@${c.host}:${c.port}/${encodeURIComponent(c.database)}?sslmode=${c.sslmode}`;
}

/**
 * Read an organization's embedding model.
 *
 * Returns `null` when the organization has not configured one — retrieval then
 * refuses rather than guessing, because there is no default model whose
 * dimensions would happen to match whatever is already in the corpus.
 *
 * A present-but-invalid file throws. In particular a file missing `dimensions`
 * fails here: the width is required, never inferred from the model name.
 */
export async function readOrgEmbeddingConfig(
  orgSlug: string,
): Promise<KnowledgeEmbeddingConfig | null> {
  const raw = await readFileSafe(embeddingFilePath(orgSlug));
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw Object.assign(
      new Error(
        `Organization "${orgSlug}" has a knowledge embedding config that is not valid JSON. (${describe(err)})`,
      ),
      { cause: err },
    );
  }
  const result = knowledgeEmbeddingSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage(
        `Organization "${orgSlug}" has an invalid knowledge embedding config (every field is required, including the exact vector width in "dimensions")`,
        result.error,
      ),
    );
  }
  return result.data;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
