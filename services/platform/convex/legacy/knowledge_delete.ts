'use node';

/**
 * LEGACY-DATA knowledge deletion — home `convex/legacy/`.
 *
 * the knowledge rebuild replaces this with the knowledge rebuild engine; until then,
 * GDPR erasure (`governance/erasure.ts`) and retention cleanup
 * (`governance/retention_cleanup.ts`) depend on this action to keep purging
 * rows out of the legacy `private_knowledge` corpus for a deleted document.
 *
 * This is a MINIMAL, self-contained replacement for the retired RAG
 * document-deletion path — not a restore of the full knowledge_db.ts
 * machinery (no connection pooling/caching, no schema bootstrap, no BM25
 * probing, no retry wrapper). It opens one connection, deletes, and closes
 * it. Retired sources it mirrors:
 *
 *   - `knowledge/file_utils.ts`
 *     (`readOrgKnowledgeConnection` — BYO per-org connection resolution)
 *   - `lib/knowledge/db/knowledge_db.ts`
 *     (`getKnowledgeDatabaseUrl` — deployment-default fallback + the
 *     `KNOWLEDGE_DATABASE_URL` / `RAG_DATABASE_URL` env names)
 *   - `rag/documents.ts` (`deleteDocument`
 *     action — the return shape this action matches)
 *   - `rag/lib/rag_service.ts`
 *     (`RagService.deleteDocument` — the SQL + idempotent-on-missing-doc
 *     semantics this action ports verbatim)
 *   - the knowledge-db baseline SQL migration
 *     (`00000000000001_knowledge_private_baseline.sql` — exact
 *     `private_knowledge.documents` / `private_knowledge.chunks`
 *     table + column names)
 *
 * `lib/shared/schemas/knowledge.ts` (the old `connection.json` Zod schema)
 * was ripped along with the rest of the knowledge domain's schemas; its
 * shape was always just the deployment-wide `pgConnectionSchema`
 * (`{host,port,database,user,sslmode}`), which is NOT ripped — it lives on
 * in `lib/shared/schemas/deployment.ts` — so it's reused directly here
 * rather than re-declared, per house convention (no divergent second copy
 * of an existing shape).
 *
 * Cross-runtime note: this file needs `'use node'` for the `postgres`
 * package, but its callers (`governance/erasure.ts`) are NOT node actions.
 * The generated `internal` API object also doesn't know about
 * `convex/legacy/*` yet (codegen hasn't run since the ripout removed
 * `convex/workflow_engine/` out from under it), so
 * callers can't reference `internal.legacy.knowledge_delete.deleteDocument`
 * the normal way without a hard "Property does not exist" compile error.
 * Callers instead build their own `FunctionReference` with
 * `makeFunctionReference` (the documented convex/server escape hatch for
 * exactly this — see its JSDoc) against `DeleteDocumentArgs` /
 * `DeleteDocumentResult` (type-only, erased at compile time — safe to
 * import into a non-node file) and invoke it via `ctx.runAction`. This
 * mirrors the old `deleteDocumentById` wrapper's own calling convention,
 * which also always crossed via `ctx.runAction` rather than a direct
 * import, for the same node/non-node boundary reason.
 */

import path from 'node:path';

import { v } from 'convex/values';
import postgres from 'postgres';
import type { z } from 'zod/v4';

import { pgConnectionSchema } from '../../lib/shared/schemas/deployment';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import { internalAction } from '../_generated/server';
import {
  errnoCode,
  getConfigRoot,
  readFileSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';

// Origin: the retired `lib/shared/schemas/knowledge.ts` (ripped
// with the rest of the knowledge schemas — domain name + on-disk layout
// only; the shape itself is the live `pgConnectionSchema`, see above).
const KNOWLEDGE_CONFIG_DOMAIN = 'knowledge';
const KNOWLEDGE_CONNECTION_KEY = 'connection';

// Origin: the retired `lib/knowledge/db/knowledge_db.ts`
// (`PRIVATE_KNOWLEDGE_SCHEMA`).
const PRIVATE_KNOWLEDGE_SCHEMA = 'private_knowledge';

type KnowledgeConnectionFile = z.infer<typeof pgConnectionSchema>;

interface ResolvedKnowledgeConnection {
  connection: KnowledgeConnectionFile;
  password: string;
}

/** `<orgSlug>/knowledge/` — the org's knowledge-DB config directory. */
function resolveKnowledgeDir(orgSlug: string): string {
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
function resolveKnowledgeConnectionFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveKnowledgeDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.json`,
  );
}

/** `<orgSlug>/knowledge/connection.secrets.json` — SOPS password sidecar. */
function resolveKnowledgeConnectionSecretsFilePath(orgSlug: string): string {
  return safeJoinWithinDir(
    resolveKnowledgeDir(orgSlug),
    `${KNOWLEDGE_CONNECTION_KEY}.secrets.json`,
  );
}

/**
 * Read the org's knowledge-DB password from the SOPS sidecar. Absent
 * sidecar → `''` (passwordless auth is valid). Present-but-undecryptable →
 * throws (fail closed).
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
  const password = raw['password'];
  return typeof password === 'string' && password.length > 0 ? password : '';
}

/**
 * Read + resolve an org's knowledge-DB connection.
 *
 * Returns `null` when the org has NO `connection.json` — the caller then
 * uses the deployment default (today's behaviour). Returns the connection +
 * resolved password when present.
 *
 * FAIL-CLOSED: throws when `connection.json` is present but invalid JSON or
 * fails `pgConnectionSchema`, or when the password sidecar exists but can't
 * be decrypted (missing SOPS key). Never falls back to the shared default
 * DB for a misconfigured per-org store — mis-routing a tenant's corpus into
 * the shared database is worse than erroring.
 */
async function readOrgKnowledgeConnection(
  orgSlug: string,
): Promise<ResolvedKnowledgeConnection | null> {
  const configRaw = await readFileSafe(
    resolveKnowledgeConnectionFilePath(orgSlug),
  );
  if (configRaw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(configRaw);
  } catch (err) {
    // Object.assign bolts `cause` onto the Error: convex/tsconfig.json's
    // "lib" predates the ES2022 two-argument Error constructor overload,
    // even though the runtime itself supports it (mirrors `lib/sops.ts`).
    throw Object.assign(
      new Error(
        `Invalid knowledge connection config for org ${orgSlug}: not valid JSON (${
          err instanceof Error ? err.message : String(err)
        })`,
      ),
      { cause: err },
    );
  }
  const result = pgConnectionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      zodErrorMessage(
        `Invalid knowledge connection config for org ${orgSlug}`,
        result.error,
      ),
    );
  }
  const password = await readKnowledgePassword(orgSlug);
  return { connection: result.data, password };
}

/** Assemble a `postgresql://` URL for an org's knowledge DB. */
function buildKnowledgeUrl(resolved: ResolvedKnowledgeConnection): string {
  const c = resolved.connection;
  const auth = `${encodeURIComponent(c.user)}:${encodeURIComponent(resolved.password)}`;
  const database = encodeURIComponent(c.database);
  return `postgresql://${auth}@${c.host}:${c.port}/${database}?sslmode=${c.sslmode}`;
}

/**
 * Resolve the deployment-default knowledge-db connection string from the
 * env. Origin: the retired `lib/knowledge/db/knowledge_db.ts`
 * (`getKnowledgeDatabaseUrl`) — `KNOWLEDGE_DATABASE_URL` preferred,
 * `RAG_DATABASE_URL` kept as a legacy alias, else the compose default.
 */
function getDefaultKnowledgeDatabaseUrl(): string {
  const explicit =
    process.env.KNOWLEDGE_DATABASE_URL || process.env.RAG_DATABASE_URL;
  if (explicit) {
    return explicit;
  }
  const password = process.env.DB_PASSWORD ?? '';
  return `postgresql://tale:${password}@knowledge-db:5432/tale_knowledge`;
}

/**
 * Resolve an org's knowledge-DB connection string: its own BYO Postgres URL
 * when `<org>/knowledge/connection.json` is configured, else the deployment
 * default. No caching layer (unlike the full `knowledge_db.ts`) — this
 * action is a one-shot delete, not a hot read path.
 */
async function resolveKnowledgeUrlForOrg(orgSlug: string): Promise<string> {
  const resolved = await readOrgKnowledgeConnection(orgSlug);
  return resolved
    ? buildKnowledgeUrl(resolved)
    : getDefaultKnowledgeDatabaseUrl();
}

// A plain `type` (not `interface`) so it satisfies `makeFunctionReference`'s
// `Args extends DefaultFunctionArgs` (`Record<string, unknown>`) constraint
// at the two call sites that build a reference by hand (see
// `governance/erasure.ts` / `governance/retention_cleanup.ts`) — TypeScript
// only infers the implicit string index signature `Record<string, unknown>`
// needs for object-literal type aliases, never for `interface` declarations.
export type DeleteDocumentArgs = {
  orgSlug: string;
  fileId: string;
};

export interface DeleteDocumentResult {
  success: boolean;
  message: string;
  deleted_count: number;
  deleted_data_ids: string[];
  processing_time_ms: number;
}

/**
 * Delete a document from the knowledge corpus by id, scoped to `orgSlug`.
 * Ports `RagService.deleteDocument`'s SQL + idempotent semantics verbatim
 * (from the retired `rag/lib/rag_service.ts`): a document that
 * doesn't exist (already deleted, or never indexed) returns
 * `{success: true, deleted_count: 0}` rather than an error, so retention
 * re-runs and cascade purges stay safe to repeat.
 *
 * Opens one connection for the call and closes it in `finally` — no pool,
 * no cache (see file header).
 */
async function deleteOneDocument(
  sql: postgres.Sql,
  orgSlug: string,
  fileId: string,
  startTime: number,
): Promise<DeleteDocumentResult> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1 AND file_id = $2`,
    [orgSlug, fileId],
  );

  if (rows.length === 0) {
    return {
      success: true,
      message: `No documents found with ID '${fileId}'`,
      deleted_count: 0,
      deleted_data_ids: [],
      processing_time_ms: performance.now() - startTime,
    };
  }

  const idsToDelete = rows.map((row) => row.id);

  await sql.begin(async (tx) => {
    await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks WHERE org_slug = $1 AND document_id = ANY($2)`,
      [orgSlug, idsToDelete],
    );
    await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1 AND id = ANY($2)`,
      [orgSlug, idsToDelete],
    );
  });

  return {
    success: true,
    message: `Deleted ${idsToDelete.length} document(s) with ID '${fileId}'`,
    deleted_count: idsToDelete.length,
    deleted_data_ids: idsToDelete,
    processing_time_ms: performance.now() - startTime,
  };
}

async function deleteKnowledgeDocument(
  args: DeleteDocumentArgs,
): Promise<DeleteDocumentResult> {
  const url = await resolveKnowledgeUrlForOrg(args.orgSlug);
  const startTime = performance.now();
  const sql = postgres(url, { max: 1 });
  try {
    return await deleteOneDocument(sql, args.orgSlug, args.fileId, startTime);
  } finally {
    await sql.end();
  }
}

export const deleteDocument = internalAction({
  args: {
    orgSlug: v.string(),
    fileId: v.string(),
  },
  handler: async (_ctx, args): Promise<DeleteDocumentResult> => {
    return await deleteKnowledgeDocument(args);
  },
});

// The batch args cross the same V8→node boundary as DeleteDocumentArgs, so
// the same plain-`type` requirement applies (see that type's comment).
export type DeleteDocumentsBatchArgs = {
  orgSlug: string;
  fileIds: string[];
};

export interface DeleteDocumentsBatchResult {
  success: boolean;
  deleted_count: number;
  failed_file_ids: string[];
}

/**
 * Batch counterpart used by the legacy thread cascade
 * (`discussions/thread_cascade.ts`): purge every listed file's corpus rows over
 * ONE connection. Per-file failures are recorded and skipped (one bad row
 * must not strand the rest of a thread's purge) — the cascade re-runs are
 * idempotent, so a failed id is retried on the next sweep.
 */
export const deleteDocumentsBatch = internalAction({
  args: {
    orgSlug: v.string(),
    fileIds: v.array(v.string()),
  },
  handler: async (_ctx, args): Promise<DeleteDocumentsBatchResult> => {
    const url = await resolveKnowledgeUrlForOrg(args.orgSlug);
    const sql = postgres(url, { max: 1 });
    let deleted = 0;
    const failed: string[] = [];
    try {
      for (const fileId of args.fileIds) {
        try {
          const result = await deleteOneDocument(
            sql,
            args.orgSlug,
            fileId,
            performance.now(),
          );
          deleted += result.deleted_count;
        } catch (error) {
          failed.push(fileId);
          console.error(
            `[knowledge_delete] batch purge failed for file ${fileId} (org ${args.orgSlug}):`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    } finally {
      await sql.end();
    }
    return {
      success: failed.length === 0,
      deleted_count: deleted,
      failed_file_ids: failed,
    };
  },
});
