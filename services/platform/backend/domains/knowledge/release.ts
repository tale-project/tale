import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  isMessageRef,
  messageRef,
} from '../../../lib/knowledge/message-ref.ts';
import {
  deleteKnowledgeDocumentsBatch,
  listKnowledgeDocumentRefs,
} from '../../core/legacy/knowledge_delete.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { deleteOrgObject } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { assessMessageRefLiveness, assessRefLiveness } from './liveness.ts';
import {
  reconcileDocumentScopeStamps,
  reconcileMailAttachmentStamps,
} from './service.ts';

/**
 * Ref release — THE shared seam for taking content out of circulation.
 *
 * The knowledge corpus is keyed by BLOB REF (`file_id` =
 * `app.file_metadata.storage_ref` / `app.documents.file_ref`), so every
 * lane that rotates a document's ref (controlled-record replacement,
 * knowledge-entry re-materialize, WebDAV PUT-overwrite, cloud-sync update)
 * or destroys a document (retention purge, user delete, folder cascade,
 * erasure, sync prune) must answer the same two questions per ref —
 * corpus-liveness and blob-liveness, defined once in `liveness.ts`
 * (`assessRefLiveness`), where the indexer reads the corpus half too.
 *
 * `releaseRefs` applies both: de-index corpus rows for corpus-dead refs,
 * delete bytes for blob-dead refs, and REPORT failures instead of
 * swallowing them — a caller that deletes its rows anyway would turn a
 * failed purge into a false "done".
 *
 * An indexed email body rides the same seam under its MESSAGE ref (`msg:`):
 * corpus-dead once its inbound email row is gone or its conversation is
 * marked spam (`assessMessageRefLiveness`), and corpus rows are its only
 * surface — it never reaches the blob stage. Every lane that kills one —
 * the conversation delete, the retention purge, a spam verdict — enqueues
 * the release job in its own transaction (`conversations/message-corpus.ts`).
 *
 * Rotation points enqueue the durable `knowledge.release_refs` job (network
 * I/O never runs inside their transaction; pg-boss retries); purge lanes
 * call `releaseRefs` synchronously and keep their rows on failure. The
 * daily `knowledge.reconcile_corpus` sweep walks each org's corpus and
 * releases every ref both predicates declare dead — the backstop that also
 * heals historically stranded rows on existing deployments.
 */

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

/** The distinct, non-empty refs of a release, split by vocabulary: blob refs
 * name bytes the file lifecycle owns; message refs (`msg:`) name an email
 * body whose only surface is its corpus rows. */
function splitReleaseRefs(refs: ReleaseRefsArgs['refs']): {
  blobRefs: string[];
  messageRefs: string[];
} {
  const unique = [
    ...new Set(
      refs.filter(
        (ref): ref is string => typeof ref === 'string' && ref.length > 0,
      ),
    ),
  ];
  return {
    blobRefs: unique.filter((ref) => !isMessageRef(ref)),
    messageRefs: unique.filter(isMessageRef),
  };
}

/**
 * Release the corpus rows of every email message ref nothing holds any more
 * (`assessMessageRefLiveness`: the inbound email row is gone, or its
 * conversation is marked spam). A message has
 * no bytes, so this is the whole of its release — the same step in a full
 * release and in a corpus-only one. Failures land on the outcome, never
 * thrown.
 */
async function releaseMessageRefs(
  sql: Sql,
  args: ReleaseRefsArgs,
  refs: readonly string[],
  outcome: ReleaseOutcome,
): Promise<void> {
  if (refs.length === 0) return;
  const liveness = await assessMessageRefLiveness(sql, {
    organizationId: args.organizationId,
    refs,
  });
  const dead = liveness
    .filter((entry) => !entry.corpusLive)
    .map((entry) => entry.ref);
  outcome.kept.push(
    ...liveness.filter((entry) => entry.corpusLive).map((entry) => entry.ref),
  );
  if (dead.length === 0) return;
  try {
    await deleteKnowledgeDocumentsBatch({
      orgSlug: args.orgSlug,
      fileIds: dead,
    });
    outcome.released.push(...dead);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const ref of dead) {
      outcome.failures.push({ ref, stage: 'corpus', message });
    }
  }
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
  const { blobRefs: refs, messageRefs } = splitReleaseRefs(args.refs);
  // An email body's ref never reaches the blob stage below: `parseBlobRef`
  // would coerce it into a storage id rather than refuse it.
  await releaseMessageRefs(sql, args, messageRefs, outcome);
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
        await deleteOrgObject(args.orgSlug, parsed.key);
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

/**
 * De-index without touching bytes: delete the CORPUS rows of every ref
 * nothing else keeps in the corpus — a document being retired in the same
 * operation excluded through `excludeDocumentId` — and leave the blob for
 * whoever restores or purges the document later. A trashed knowledge
 * document's chunks used to stay in the corpus until the retention purge:
 * dark to the admission re-check, but still winning candidate slots, so a
 * small page could come back empty while a live passage sat just below
 * the cut. Failures are returned, never thrown — the caller's own write
 * already happened; the purge is the backstop.
 */
export async function releaseCorpusRefs(
  sql: Sql,
  args: ReleaseRefsArgs,
): Promise<ReleaseOutcome> {
  const outcome: ReleaseOutcome = { released: [], kept: [], failures: [] };
  const { blobRefs: refs, messageRefs } = splitReleaseRefs(args.refs);
  await releaseMessageRefs(sql, args, messageRefs, outcome);
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
  outcome.kept.push(
    ...liveness.filter((entry) => entry.corpusLive).map((entry) => entry.ref),
  );
  if (corpusDead.length === 0) return outcome;
  try {
    await deleteKnowledgeDocumentsBatch({
      orgSlug: args.orgSlug,
      fileIds: corpusDead.map((entry) => entry.ref),
    });
    outcome.released.push(...corpusDead.map((entry) => entry.ref));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const entry of corpusDead) {
      outcome.failures.push({ ref: entry.ref, stage: 'corpus', message });
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

interface ReconcileStats {
  scanned: number;
  released: number;
  failures: number;
}

/** Walk one vocabulary of an org's corpus refs over one keyset range (after
 * `after`, before `before`), releasing every dead ref, until the range ends
 * or `budget` refs have been read. */
async function reconcileRange(
  sql: Sql,
  args: { organizationId: string; orgSlug: string },
  range: {
    refs: 'blobs' | 'messages';
    after: string | null;
    before: string | null;
  },
  budget: number,
): Promise<ReconcileStats> {
  let scanned = 0;
  let released = 0;
  let failures = 0;
  let cursor = range.after;
  while (scanned < budget) {
    const page: string[] = await listKnowledgeDocumentRefs({
      orgSlug: args.orgSlug,
      refs: range.refs,
      afterFileId: cursor,
      beforeFileId: range.before,
      limit: Math.min(RECONCILE_PAGE, budget - scanned),
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

/**
 * Walk one org's corpus and release every ref that is dead by both
 * predicates — the lazy backfill for historically stranded rows (replaced
 * versions, rotated knowledge entries, swept temp files) and the backstop
 * for a release job that exhausted its retries. Bounded per run; the daily
 * schedule drains large backlogs incrementally.
 *
 * Email bodies (`msg:` refs) get a walk of their own with its own budget, so
 * an inbox can never crowd the blob refs out (`listKnowledgeDocumentRefs`).
 * That walk starts at a random point of the key space and wraps round to
 * it: message ids are uuids, so over a few runs it visits every ref, where a
 * walk that always started at the first key would never get past a head of
 * live messages longer than its budget. `messagePivot` pins the start for a
 * test.
 */
export async function reconcileCorpusForOrg(
  sql: Sql,
  args: { organizationId: string; orgSlug: string; messagePivot?: string },
): Promise<ReconcileStats> {
  const blobs = await reconcileRange(
    sql,
    args,
    { refs: 'blobs', after: null, before: null },
    RECONCILE_REFS_PER_ORG,
  );
  const pivot = args.messagePivot ?? messageRef(randomUUID());
  const tail = await reconcileRange(
    sql,
    args,
    { refs: 'messages', after: pivot, before: null },
    RECONCILE_REFS_PER_ORG,
  );
  const head =
    tail.scanned < RECONCILE_REFS_PER_ORG
      ? await reconcileRange(
          sql,
          args,
          { refs: 'messages', after: null, before: pivot },
          RECONCILE_REFS_PER_ORG - tail.scanned,
        )
      : { scanned: 0, released: 0, failures: 0 };
  return {
    scanned: blobs.scanned + tail.scanned + head.scanned,
    released: blobs.released + tail.released + head.released,
    failures: blobs.failures + tail.failures + head.failures,
  };
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
      // The scope pass is independent of the release pass: a ref that is
      // alive can still be mis-stamped, and correcting that is the only
      // backstop a scope-only edit has (see `reconcileDocumentScopeStamps`).
      const scope = await reconcileDocumentScopeStamps(sql, {
        organizationId: org.id,
        orgSlug: org.slug,
      });
      if (scope.corrected > 0) {
        // Loud on purpose: every corrected row is an edit whose corpus write
        // failed silently, and until now nothing said so.
        console.warn(
          `[knowledge] corpus scope drift for ${org.slug}: corrected=${scope.corrected} of scanned=${scope.scanned} — the per-edit sync had failed for these`,
        );
      }
      // The emailed attachments' conversation stamp: the backfill of every
      // attachment indexed before the indexer stamped one, then the backstop.
      // The same walk releases the corpus copy of every attachment whose
      // conversation is gone or marked spam — those a delete or a verdict
      // left behind before its lane queued the release, which the bounded
      // blob walk above may never reach — and takes the stamp off every row
      // no attachment backs any more, or releases it when nothing keeps it.
      const orgRef = { organizationId: org.id, orgSlug: org.slug };
      const mail = await reconcileMailAttachmentStamps(sql, {
        ...orgRef,
        releaseCorpus: async (refs) => {
          const outcome = await releaseCorpusRefs(sql, { ...orgRef, refs });
          for (const failure of outcome.failures) {
            console.warn(
              `[knowledge] reconcile release failed for ${failure.ref} (${failure.stage}): ${failure.message}`,
            );
          }
          return outcome;
        },
      });
      if (mail.corrected > 0 || mail.released > 0 || mail.failures > 0) {
        console.info(
          `[knowledge] emailed attachments for ${org.slug}: stamped=${mail.corrected} released=${mail.released} failures=${mail.failures} (of scanned=${mail.scanned})`,
        );
      }
      if (mail.cleared > 0) {
        // Not drift: no sync failed. These rows stopped being emailed
        // attachments (a file filed into a document, whose stamp raced the
        // filing) and kept a stamp that hid them from every document door,
        // so they are reported apart from the scope drift above.
        console.info(
          `[knowledge] stale conversation stamps for ${org.slug}: cleared=${mail.cleared} — rows no longer an emailed attachment (filed into a document), not a failed sync`,
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
