import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { checkProviderHostPolicy } from '../../../lib/net/host-policy.ts';
import { AppError } from '../../../lib/shared/errors/app-error.ts';
import { pickEmbeddingRecommendations } from '../../../lib/shared/providers/embedding_recommendations.ts';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error.ts';
import {
  KNOWLEDGE_CONNECTION_KEY,
  KNOWLEDGE_EMBEDDING_KEY,
  knowledgeConnectionSchema,
  knowledgeConnectionSecretsSchema,
  knowledgeEmbeddingSchema,
  type KnowledgeConnection,
  type KnowledgeConnectionSecrets,
  type KnowledgeEmbeddingConfig,
} from '../../../lib/shared/schemas/knowledge.ts';
import {
  testDatastoreConnection,
  type DatastoreTestResult,
} from '../../core/deployment/test_datastore_connection.ts';
import {
  connectionFilePath,
  connectionSecretsFilePath,
  embeddingFilePath,
  knowledgeConfigDir,
  readPassword,
} from '../../core/knowledge/connection.ts';
import { invalidateOrgUrl } from '../../core/knowledge/pool.ts';
import {
  atomicWrite,
  atomicWriteSecret,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
  safeJoinWithinDir,
} from '../../core/lib/file_io.ts';
import { getProviderCatalog } from '../../core/lib/providers/catalog_fetch.ts';
import { resolveProvidersForOrg } from '../../core/lib/providers/org_providers.ts';
import {
  encryptJsonWithSops,
  hasSopsKey,
  invalidateSecretsCache,
} from '../../core/lib/sops.ts';

/**
 * The knowledge-DB + embedding ADMIN config (the 0.4 `knowledge/actions` +
 * `file_actions` pair re-orchestrated for the data-residency page). File
 * layout, history snapshots, and sidecar semantics are byte-identical to
 * 0.4 (paths + schemas reused; the four-line serializers are twinned).
 */
export class KnowledgeAdminError extends Error {
  readonly code: string;
  readonly status: 400 | 404;
  constructor(code: string, message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = 'KnowledgeAdminError';
    this.code = code;
    this.status = status;
  }
}

const MAX_HISTORY_ENTRIES = 20;

/**
 * The outbound-host policy, spoken in this domain's error vocabulary.
 *
 * The shared check refuses with a coded `AppError` — cloud metadata endpoints
 * always, private/loopback hosts unless `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`
 * — and its message names the opt-in. That is a legitimate, actionable denial
 * the admin has to SEE. Left as an `AppError` it fell through the knowledge
 * routes (which map only `KnowledgeAdminError`) to the generic handler: a bare
 * 500 "Internal Server Error", an error report filed, and the one sentence
 * that would have fixed the setup never reached anyone.
 */
function assertHostAllowed(url: string): void {
  try {
    checkProviderHostPolicy(url);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const data: unknown = error.data;
    const field = (name: string): string | null => {
      if (data === null || typeof data !== 'object') return null;
      const value: unknown = Reflect.get(data, name);
      return typeof value === 'string' && value.length > 0 ? value : null;
    };
    throw new KnowledgeAdminError(
      field('code') ?? 'HOST_BLOCKED',
      field('message') ?? `Host policy refused ${url}`,
      400,
    );
  }
}

function historyDir(orgSlug: string, key: string): string {
  return safeJoinWithinDir(
    safeJoinWithinDir(knowledgeConfigDir(orgSlug), '.history'),
    key,
  );
}

function serializeConnectionJson(connection: KnowledgeConnection): string {
  return (
    JSON.stringify(knowledgeConnectionSchema.parse(connection), null, 2) + '\n'
  );
}

function parseConnectionJson(content: string): KnowledgeConnection {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeConnectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge connection config', result.error),
    );
  }
  return result.data;
}

function serializeSecretsJson(secrets: KnowledgeConnectionSecrets): string {
  return (
    JSON.stringify(knowledgeConnectionSecretsSchema.parse(secrets), null, 2) +
    '\n'
  );
}

function serializeEmbeddingJson(config: KnowledgeEmbeddingConfig): string {
  return JSON.stringify(knowledgeEmbeddingSchema.parse(config), null, 2) + '\n';
}

function parseEmbeddingJson(content: string): KnowledgeEmbeddingConfig {
  const parsed: unknown = JSON.parse(content);
  const result = knowledgeEmbeddingSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage('Invalid knowledge embedding config', result.error),
    );
  }
  return result.data;
}

async function snapshotHistory(
  orgSlug: string,
  key: string,
  currentContent: string,
): Promise<void> {
  const dir = historyDir(orgSlug, key);
  await mkdir(dir, { recursive: true });
  await atomicWrite(
    path.join(dir, `${generateHistoryTimestamp()}.json`),
    currentContent,
  );
  await pruneHistory(dir, MAX_HISTORY_ENTRIES);
}

export interface KnowledgeConnectionView {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: KnowledgeConnection['sslmode'];
  hasPassword?: boolean;
}

export async function readKnowledgeConnectionView(
  orgSlug: string,
): Promise<KnowledgeConnectionView> {
  const configRaw = await readFileSafe(connectionFilePath(orgSlug));
  if (configRaw === null) {
    return { configured: false };
  }
  const connection = parseConnectionJson(configRaw);
  const sidecar = await readFileSafe(connectionSecretsFilePath(orgSlug));
  return {
    configured: true,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    sslmode: connection.sslmode,
    hasPassword: sidecar !== null && sidecar.trim().length > 0,
  };
}

export async function writeKnowledgeConnection(
  orgSlug: string,
  args: { connection: unknown; password?: string | null },
): Promise<void> {
  const parsed = knowledgeConnectionSchema.safeParse(args.connection);
  if (!parsed.success) {
    throw new KnowledgeAdminError(
      'INVALID_CONNECTION',
      zodErrorMessage('Invalid knowledge connection', parsed.error),
    );
  }
  const connection = parsed.data;
  assertHostAllowed(`http://${connection.host}:${connection.port}`);

  const filePath = connectionFilePath(orgSlug);
  const serialized = serializeConnectionJson(connection);
  const currentContent = await readFileSafe(filePath);
  if (currentContent) {
    await snapshotHistory(orgSlug, KNOWLEDGE_CONNECTION_KEY, currentContent);
  }
  await atomicWrite(filePath, serialized);

  if (args.password !== undefined && args.password !== null) {
    const secretsPath = connectionSecretsFilePath(orgSlug);
    if (args.password === '') {
      await removeFileSafe(secretsPath);
    } else {
      const plaintext = serializeSecretsJson({ password: args.password });
      const content = hasSopsKey()
        ? await encryptJsonWithSops(plaintext)
        : plaintext;
      await atomicWriteSecret(secretsPath, content);
    }
    invalidateSecretsCache(secretsPath);
  }

  invalidateOrgUrl(orgSlug);
}

export async function deleteKnowledgeConnection(
  orgSlug: string,
): Promise<void> {
  const secretsPath = connectionSecretsFilePath(orgSlug);
  await removeFileSafe(connectionFilePath(orgSlug));
  await removeFileSafe(secretsPath);
  await removeDirSafe(historyDir(orgSlug, KNOWLEDGE_CONNECTION_KEY));
  invalidateSecretsCache(secretsPath);
  invalidateOrgUrl(orgSlug);
}

export interface KnowledgeProbeResult {
  ok: boolean;
  latencyMs?: number;
  version?: string;
  vectorAvailable?: boolean;
  paradedbAvailable?: boolean;
  error?: string;
  hint?: string;
}

export async function probeKnowledgeConnection(args: {
  connection: unknown;
  password?: string | null;
  orgSlug?: string;
}): Promise<KnowledgeProbeResult> {
  const parsed = knowledgeConnectionSchema.safeParse(args.connection);
  if (!parsed.success) {
    return {
      ok: false,
      error: zodErrorMessage('Invalid knowledge connection', parsed.error),
    };
  }
  const connection = parsed.data;
  // A probe REPORTS — a refused host is a test result, not an exception,
  // the same way an unparseable body or an unreadable password is.
  try {
    assertHostAllowed(`http://${connection.host}:${connection.port}`);
  } catch (error) {
    if (error instanceof KnowledgeAdminError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  let password: string;
  try {
    password =
      args.password != null && args.password !== ''
        ? args.password
        : args.orgSlug
          ? await readPassword(args.orgSlug)
          : '';
  } catch (err) {
    return {
      ok: false,
      error: `Could not read the stored password: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let data: DatastoreTestResult;
  try {
    data = await testDatastoreConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.user,
      password,
      sslmode: connection.sslmode,
    });
  } catch (err) {
    return {
      ok: false,
      error: `Could not run the datastore connection test: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let hint: string | undefined;
  if (data.ok && data.vector_available === false) {
    hint =
      'The `vector` (pgvector) extension is not available on this database — vector search will not work. Install it before switching.';
  } else if (data.ok && data.paradedb_available === false) {
    hint =
      'ParadeDB (`pg_search`) is not available — full-text/BM25 hybrid search will degrade to vector-only. Install ParadeDB for full search quality.';
  }

  return {
    ok: data.ok,
    latencyMs: data.latency_ms ?? undefined,
    version: data.version ?? undefined,
    vectorAvailable: data.vector_available ?? undefined,
    paradedbAvailable: data.paradedb_available ?? undefined,
    error: data.error ?? undefined,
    ...(hint !== undefined ? { hint } : {}),
  };
}

export interface KnowledgeEmbeddingView {
  configured: boolean;
  providerSlug?: string;
  credentialId?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

export async function readKnowledgeEmbeddingView(
  orgSlug: string,
): Promise<KnowledgeEmbeddingView> {
  const raw = await readFileSafe(embeddingFilePath(orgSlug));
  if (raw === null) {
    return { configured: false };
  }
  const config = parseEmbeddingJson(raw);
  return {
    configured: true,
    providerSlug: config.providerSlug,
    ...(config.credentialId !== undefined
      ? { credentialId: config.credentialId }
      : {}),
    model: config.model,
    dimensions: config.dimensions,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  };
}

export async function writeKnowledgeEmbedding(
  orgSlug: string,
  config: unknown,
): Promise<void> {
  const parsed = knowledgeEmbeddingSchema.safeParse(config);
  if (!parsed.success) {
    throw new KnowledgeAdminError(
      'INVALID_EMBEDDING',
      zodErrorMessage('Invalid knowledge embedding config', parsed.error),
    );
  }
  if (parsed.data.baseUrl) {
    assertHostAllowed(parsed.data.baseUrl);
  }
  const filePath = embeddingFilePath(orgSlug);
  const serialized = serializeEmbeddingJson(parsed.data);
  const currentContent = await readFileSafe(filePath);
  if (currentContent) {
    await snapshotHistory(orgSlug, KNOWLEDGE_EMBEDDING_KEY, currentContent);
  }
  await atomicWrite(filePath, serialized);
}

export async function deleteKnowledgeEmbedding(orgSlug: string): Promise<void> {
  await removeFileSafe(embeddingFilePath(orgSlug));
  await removeDirSafe(historyDir(orgSlug, KNOWLEDGE_EMBEDDING_KEY));
}

export interface EmbeddingRecommendation {
  providerSlug: string;
  model: string;
  dimensions: number;
  recommended: boolean;
}

/** Curated embedding picks from providers the org holds a DIRECT key for. */
export async function listEmbeddingRecommendationsForOrg(
  orgSlug: string,
  credentials: Array<{
    status: string;
    authMethod: string;
    providerSlug: string;
  }>,
): Promise<EmbeddingRecommendation[]> {
  const directProviders = new Set(
    credentials
      .filter(
        (credential) =>
          credential.status === 'active' &&
          (credential.authMethod === 'api-key' ||
            credential.authMethod === 'env'),
      )
      .map((credential) => credential.providerSlug),
  );
  if (directProviders.size === 0) return [];

  const catalogs: Array<{
    providerSlug: string;
    entries: Awaited<ReturnType<typeof getProviderCatalog>>;
  }> = [];
  for (const connector of resolveProvidersForOrg(orgSlug)) {
    if (!directProviders.has(connector.name)) continue;
    try {
      catalogs.push({
        providerSlug: connector.name,
        entries: await getProviderCatalog(connector),
      });
    } catch (error) {
      // One unreachable catalog must not blank the recommendations.
      console.warn(
        `[knowledge] could not resolve catalog for "${connector.name}" while listing embedding recommendations:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return pickEmbeddingRecommendations(
    catalogs.map((catalog) => ({
      providerSlug: catalog.providerSlug,
      entries: [...catalog.entries],
    })),
  );
}
