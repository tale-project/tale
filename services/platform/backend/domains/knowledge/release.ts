import type { Sql } from 'postgres';

import {
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
} from '../../core/legacy/knowledge_delete.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { resolveObjectStore, s3DeleteObject } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';

/**
 * Ref release — THE shared seam for taking content out of circulation.
 *
 * The knowledge corpus is keyed by BLOB REF (`file_id` =
 * `app.file_metadata.storage_ref` / `app.documents.file_ref`), so every
 * lane that rotates a document's ref (controlled-record replacement,
 * knowledge-entry re-materialize, WebDAV PUT-overwrite, cloud-sync update)
 * or destroys a document (retention purge, user delete, folder cascade,
 * erasure, sync prune) must answer the same two questions per ref:
 *
 *   1. corpus-liveness — may the corpus still hold rows for this ref?
 *      Yes while ANY document row's CURRENT `file_ref` is the ref (any
 *      lifecycle: a trashed document is restorable and the retrievability
 *      filter hides it meanwhile), or a live UNBOUND file row holds it
 *      (thread files, video-link transcripts). A ref that is only history
 *      (`history_files`, a superseded replacement row) is corpus-dead: old
 *      versions must not answer RAG queries.
 *   2. blob-liveness — may the BYTES be deleted? Only when no document
 *      (`file_ref` or `history_files` — retained controlled-record
 *      snapshots need their bytes) and no live file row references the ref.
 *      WebDAV COPY shares one blob ref across several document rows, so a
 *      purge of one copy must never destroy the twin's bytes.
 *
 * `releaseRefs` applies both: de-index corpus rows for corpus-dead refs,
 * delete bytes for blob-dead refs, and REPORT failures instead of
 * swallowing them — a caller that deletes its rows anyway would turn a
 * failed purge into a false "done".
 *
 * Rotation points enqueue the durable `knowledge.release_refs` job (network
 * I/O never runs inside their transaction; pg-boss retries); purge lanes
 * call `releaseRefs` synchronously and keep their rows on failure. The
 * daily `knowledge.reconcile_corpus` sweep walks each org's corpus and
 * releases every ref both predicates declare dead — the backstop that also
 * heals historically stranded rows on existing deployments.
 */

export interface RefLiveness {
  ref: string;
  corpusLive: boolean;
  blobLive: boolean;
}

export interface AssessArgs {
  organizationId: string;
  refs: string[];
  /** A document being purged in the same operation — its own rows must not
   * keep its refs alive. */
  excludeDocumentId?: string;
  /** A file row being swept in the same operation (temp-file sweep). */
  excludeFileMetadataId?: string;
}

/** Both liveness verdicts for a set of refs, in one round trip. */
export async function assessRefLiveness(
  sql: Sql,
  args: AssessArgs,
): Promise<RefLiveness[]> {
  if (args.refs.length === 0) return [];
  const excludeDoc = args.excludeDocumentId ?? null;
  const excludeFile = args.excludeFileMetadataId ?? null;
  return sql<RefLiveness[]>`
    SELECT r.ref AS ref,
      (
        EXISTS(
          SELECT 1 FROM app.documents d
          WHERE d.org_id = ${args.organizationId} AND d.file_ref = r.ref
            AND (${excludeDoc}::text IS NULL OR d.id <> ${excludeDoc})
        )
        OR EXISTS(
          SELECT 1 FROM app.file_metadata fm
          WHERE fm.org_id = ${args.organizationId}
            AND fm.storage_ref = r.ref
            AND fm.document_id IS NULL
            AND (fm.lifecycle_status IS NULL
                 OR fm.lifecycle_status = 'active')
            AND (${excludeFile}::text IS NULL OR fm.id <> ${excludeFile})
        )
      ) AS "corpusLive",
      (
        EXISTS(
          SELECT 1 FROM app.documents d
          WHERE d.org_id = ${args.organizationId}
            AND (${excludeDoc}::text IS NULL OR d.id <> ${excludeDoc})
            AND (d.file_ref = r.ref
                 OR d.history_files @> ARRAY[r.ref])
        )
        OR EXISTS(
          SELECT 1 FROM app.file_metadata fm
          WHERE fm.org_id = ${args.organizationId}
            AND fm.storage_ref = r.ref
            AND (fm.lifecycle_status IS NULL
                 OR fm.lifecycle_status = 'active')
            AND (${excludeFile}::text IS NULL OR fm.id <> ${excludeFile})
            AND (${excludeDoc}::text IS NULL OR fm.document_id IS NULL
                 OR fm.document_id <> ${excludeDoc})
        )
      ) AS "blobLive"
    FROM unnest(${args.refs}::text[]) AS r(ref)
  `;
}

export interface ReleaseFailure {
  ref: string;
  stage: 'corpus' | 'blob';
  message: string;
}

export interface ReleaseOutcome {
  /** Refs whose dead surfaces were removed (idempotent: already-absent
   * counts as removed). */
  released: string[];
  /** Refs something still references — corpus row and bytes stay. */
  kept: string[];
  failures: ReleaseFailure[];
}

export interface ReleaseRefsArgs {
  organizationId: string;
  orgSlug: string;
  refs: readonly (string | null | undefined)[];
  excludeDocumentId?: string;
  excludeFileMetadataId?: string;
}

/**
 * Release every surface of the given refs that nothing references any more:
 * corpus rows for corpus-dead refs, bytes for blob-dead refs. Failures are
 * returned, never swallowed; a ref whose corpus delete failed keeps its
 * blob too, so a retry releases both together. Fully idempotent.
 */
export async function releaseRefs(
  sql: Sql,
  args: ReleaseRefsArgs,
): Promise<ReleaseOutcome> {
  const outcome: ReleaseOutcome = { released: [], kept: [], failures: [] };
  const refs = [
    ...new Set(
      args.refs.filter(
        (ref): ref is string => typeof ref === 'string' && ref.length > 0,
      ),
    ),
    // Conversation-message refs (`msg:`) belong to another vocabulary — the
    // file lifecycle never owns them.
  ].filter((ref) => !ref.startsWith('msg:'));
  if (refs.length === 0) return outcome;

  const liveness = await assessRefLiveness(sql, {
    organizationId: args.organizationId,
    refs,
    ...(args.excludeDocumentId !== undefined
      ? { excludeDocumentId: args.excludeDocumentId }
      : {}),
    ...(args.excludeFileMetadataId !== undefined
      ? { excludeFileMetadataId: args.excludeFileMetadataId }
      : {}),
  });

  const corpusDead = liveness.filter((entry) => !entry.corpusLive);
  const corpusFailed = new Set<string>();
  if (corpusDead.length > 0) {
    try {
      await deleteKnowledgeDocumentsBatch({
        orgSlug: args.orgSlug,
        fileIds: corpusDead.map((entry) => entry.ref),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of corpusDead) {
        corpusFailed.add(entry.ref);
        outcome.failures.push({ ref: entry.ref, stage: 'corpus', message });
      }
    }
  }

  for (const entry of liveness) {
    if (corpusFailed.has(entry.ref)) continue; // retry releases both surfaces
    if (entry.blobLive) {
      if (entry.corpusLive) outcome.kept.push(entry.ref);
      else outcome.released.push(entry.ref); // corpus gone, bytes retained
      continue;
    }
    try {
      const parsed = parseBlobRef(entry.ref);
      if (parsed.backend === 's3') {
        const store = await resolveObjectStore(args.orgSlug);
        await s3DeleteObject(store, parsed.key);
      }
      // The bytes are gone — reap trashed, unbound file rows that only
      // existed to remember this ref (the WebDAV overwrite strands).
      await sql`
        DELETE FROM app.file_metadata
        WHERE org_id = ${args.organizationId}
          AND storage_ref = ${entry.ref}
          AND lifecycle_status = 'trashed' AND document_id IS NULL
      `;
      outcome.released.push(entry.ref);
    } catch (error) {
      outcome.failures.push({
        ref: entry.ref,
        stage: 'blob',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
}

/** The `knowledge.release_refs` job body: resolve the org, release, and
 * THROW on any failure so pg-boss retries (the enqueue is transactional
 * with the rotation that orphaned the refs). */
export async function runReleaseRefsJob(
  sql: Sql,
  payload: { organizationId: string; refs: string[] },
): Promise<void> {
  const orgSlug = await resolveOrgSlug(sql, payload.organizationId);
  if (orgSlug === null) {
    // The organization is gone — its corpus and bucket went with it.
    console.warn(
      `[knowledge] release skipped for org ${payload.organizationId}: organization no longer exists`,
    );
    return;
  }
  const outcome = await releaseRefs(sql, {
    organizationId: payload.organizationId,
    orgSlug,
    refs: payload.refs,
  });
  if (outcome.failures.length > 0) {
    const detail = outcome.failures
      .map((failure) => `${failure.ref} (${failure.stage}): ${failure.message}`)
      .join('; ');
    throw new Error(`ref release incomplete — ${detail}`);
  }
}

const RECONCILE_REFS_PER_ORG = 500;
const RECONCILE_PAGE = 100;

/**
 * Walk one org's corpus and release every ref that is dead by both
 * predicates — the lazy backfill for historically stranded rows (replaced
 * versions, rotated knowledge entries, swept temp files) and the backstop
 * for a release job that exhausted its retries. Bounded per run; the daily
 * schedule drains large backlogs incrementally.
 */
export async function reconcileCorpusForOrg(
  sql: Sql,
  args: { organizationId: string; orgSlug: string },
): Promise<{ scanned: number; released: number; failures: number }> {
  let scanned = 0;
  let released = 0;
  let failures = 0;
  let cursor: string | null = null;
  while (scanned < RECONCILE_REFS_PER_ORG) {
    const page: string[] = await listKnowledgeDocumentRefs({
      orgSlug: args.orgSlug,
      afterFileId: cursor,
      limit: Math.min(RECONCILE_PAGE, RECONCILE_REFS_PER_ORG - scanned),
    });
    if (page.length === 0) break;
    scanned += page.length;
    cursor = page.at(-1) ?? null;
    const outcome = await releaseRefs(sql, {
      organizationId: args.organizationId,
      orgSlug: args.orgSlug,
      refs: page,
    });
    released += outcome.released.length;
    failures += outcome.failures.length;
    for (const failure of outcome.failures) {
      console.warn(
        `[knowledge] reconcile release failed for ${failure.ref} (${failure.stage}): ${failure.message}`,
      );
    }
    if (page.length < RECONCILE_PAGE) break;
  }
  return { scanned, released, failures };
}

/** The `knowledge.reconcile_corpus` cron body: every org, isolated. */
export async function runCorpusReconcile(sql: Sql): Promise<void> {
  const orgs = await sql<{ id: string; slug: string | null }[]>`
    SELECT "id", "slug" FROM "organization"
  `;
  for (const org of orgs) {
    if (org.slug === null) continue;
    try {
      const stats = await reconcileCorpusForOrg(sql, {
        organizationId: org.id,
        orgSlug: org.slug,
      });
      if (stats.released > 0 || stats.failures > 0) {
        console.info(
          `[knowledge] corpus reconcile for ${org.slug}: scanned=${stats.scanned} released=${stats.released} failures=${stats.failures}`,
        );
      }
    } catch (error) {
      // One org's corpus being unreachable must not starve the fleet.
      console.warn(
        `[knowledge] corpus reconcile failed for org ${org.slug}:`,
        error,
      );
    }
  }
}
