import type { Sql, TransactionSql } from 'postgres';

import {
  assertGenericDocumentContentWritable,
  assertRecordTrashable,
} from '../../../convex/documents/access.ts';
import { extractExtension } from '../../../convex/documents/extract_extension.ts';
import { canonicalResourcePath } from '../../../convex/webdav/helpers.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import { resolveFileType } from '../../../lib/shared/file-types.ts';
import { isTextBasedFile } from '../../../lib/utils/text-file-types.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3DeleteObject,
  s3HeadObject,
  s3PresignGetUrl,
  s3PresignPutUrl,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  checkIpRateLimit,
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { registerUploadedBytes } from '../files/service.ts';
import { MAX_FOLDER_DEPTH } from '../folders/service.ts';
import { markRagQueued } from '../knowledge/service.ts';
import {
  assertNotHeld,
  LegalHoldError,
  loadActiveHolds,
} from '../legal_holds/service.ts';

/**
 * The WebDAV backing handlers — the 0.5 twins of `convex/webdav/*` (tree,
 * locks, app passwords, org resolve) plus the blob-upload handoff, keyed by
 * the SAME function names the REUSED `lib/webdav` protocol layer addresses
 * through its ConvexHttpClient. `client-shim.ts` maps those names here, so
 * PROPFIND/GET/PUT/MKCOL/DELETE/MOVE/COPY/LOCK/UNLOCK run the 0.4 method
 * handlers verbatim.
 *
 * Semantics carried over whole: hub-only visibility (#2545 — a
 * project-scoped document or folder never lists, never resolves, never
 * collides), bounded subtree walks with the reused read-budget contract
 * (SUBTREE_TOO_LARGE → 507), the legal-hold gates on every destructive
 * branch, controlled-record guards, lock RFC rules (ancestor
 * depth-infinity, subtree pre-check, per-password cap), and the
 * PUT-overwrite blob refcount rule (a COPY shares bytes).
 *
 * 0.5-only simplifications (each the 0.4 S3 branch made total): every blob
 * ref is `s3:<key>` so `contentHash` stays undefined (change detection uses
 * size/mtime); blob deletes run inline (no scheduler hop); the RAG
 * folder-path denormalization sync is a no-op until the 0.5 corpus rows
 * carry `folder_path` (ledger).
 */

export const MAX_CHILDREN_PER_PROPFIND = 1000;
const MAX_LOCK_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_LOCKS_PER_APP_PASSWORD = 200;
const MAX_WEBDAV_BULK_NODES = 5_000;
const WEBDAV_SOURCE_PROVIDER = 'webdav';
const SYNC_SOURCE_PROVIDERS = new Set([
  'onedrive',
  'sharepoint',
  'google_drive',
  'gdrive',
  'google-drive',
]);

function nfc(s: string): string {
  return s.normalize('NFC');
}

interface ReadBudget {
  remaining: number;
}
function newReadBudget(): ReadBudget {
  return { remaining: MAX_WEBDAV_BULK_NODES };
}
function chargeReadBudget(budget: ReadBudget, rowsRead: number): void {
  budget.remaining -= rowsRead;
  if (budget.remaining < 0) {
    throw new AppError({ code: 'SUBTREE_TOO_LARGE' });
  }
}

// ------------------------------------------------------------------ rows

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  projectId: string | null;
  createdAt: number;
}

interface DocRow {
  id: string;
  title: string | null;
  fileRef: string | null;
  mimeType: string | null;
  extension: string | null;
  contentHash: string | null;
  sourceProvider: string | null;
  sourceModifiedAt: number | null;
  folderId: string | null;
  projectId: string | null;
  lifecycleStatus: string | null;
  record: unknown;
  createdBy: string | null;
  createdAt: number;
}

const DOC_COLUMNS = `
  id, title, file_ref AS "fileRef", mime_type AS "mimeType", extension,
  content_hash AS "contentHash", source_provider AS "sourceProvider",
  source_modified_at_ms::float8 AS "sourceModifiedAt",
  folder_id AS "folderId", project_id AS "projectId",
  lifecycle_status AS "lifecycleStatus", record, created_by AS "createdBy",
  created_at_ms::float8 AS "createdAt"
`;

function isVisibleDoc(doc: DocRow): boolean {
  return (
    (doc.lifecycleStatus ?? 'active') === 'active' && doc.projectId === null
  );
}

/** The 0.4 wire shape PROPFIND consumes: absent-not-null. */
function docMeta(doc: DocRow) {
  return {
    _id: doc.id,
    title: doc.title ?? '(untitled)',
    ...(doc.mimeType !== null ? { mimeType: doc.mimeType } : {}),
    ...(doc.extension !== null ? { extension: doc.extension } : {}),
    ...(doc.fileRef !== null ? { fileId: doc.fileRef } : {}),
    ...(doc.contentHash !== null ? { contentHash: doc.contentHash } : {}),
    creationTime: doc.createdAt,
    ...(doc.sourceModifiedAt !== null
      ? { sourceModifiedAt: doc.sourceModifiedAt }
      : {}),
    ...(doc.folderId !== null ? { folderId: doc.folderId } : {}),
    ...(doc.lifecycleStatus !== null
      ? { lifecycleStatus: doc.lifecycleStatus }
      : {}),
  };
}

async function joinDocumentMetadata(sql: Sql, doc: DocRow) {
  let size: number | null = null;
  let contentType: string | null = doc.mimeType;
  if (doc.fileRef !== null) {
    const rows = await sql<{ size: number; contentType: string }[]>`
      SELECT size::float8 AS size, content_type AS "contentType"
      FROM app.file_metadata
      WHERE storage_ref = ${doc.fileRef} LIMIT 1
    `;
    if (rows[0]) {
      size = rows[0].size;
      contentType = rows[0].contentType;
    }
  }
  return { ...docMeta(doc), size, contentType };
}

/** The record guards are pure over the record jsonb — shape it. */
function recordFields(doc: DocRow): never {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused guards read only `record` (validated jsonb written by the records flow)
  return { record: doc.record ?? undefined } as never;
}

// ------------------------------------------------------------ tree reads

/** Hub-exact folder-by-(parent, name) lookup: project folders never match. */
async function hubFolder(
  db: Sql | TransactionSql,
  organizationId: string,
  parentId: string | null,
  name: string,
): Promise<FolderRow | null> {
  const rows = await db<FolderRow[]>`
    SELECT id, name, parent_id AS "parentId", project_id AS "projectId",
           created_at_ms::float8 AS "createdAt"
    FROM app.folders
    WHERE org_id = ${organizationId} AND project_id IS NULL
      AND parent_id IS NOT DISTINCT FROM ${parentId} AND name = ${name}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Walk hub folder segments to a folder id (the 0.4 findFolderByPath). */
async function findFolderByPath(
  db: Sql | TransactionSql,
  organizationId: string,
  segments: string[],
): Promise<string | null> {
  let parentId: string | null = null;
  for (const segment of segments) {
    const folder: FolderRow | null = await hubFolder(
      db,
      organizationId,
      parentId,
      segment,
    );
    if (!folder) return null;
    parentId = folder.id;
  }
  return parentId;
}

/** Absolute hub path of a folder ('/A/B'), the 0.4 buildFolderPath. */
async function buildFolderPath(
  db: Sql | TransactionSql,
  folderId: string,
): Promise<string | undefined> {
  const names: string[] = [];
  let cursor: string | null = folderId;
  for (let i = 0; i <= MAX_FOLDER_DEPTH; i++) {
    if (cursor === null) break;
    const rows: { name: string; parentId: string | null }[] = await db<
      { name: string; parentId: string | null }[]
    >`
      SELECT name, parent_id AS "parentId" FROM app.folders
      WHERE id = ${cursor} LIMIT 1
    `;
    const row = rows[0];
    if (!row) break;
    names.unshift(row.name);
    cursor = row.parentId;
  }
  return names.length > 0 ? '/' + names.join('/') : undefined;
}

async function resolveLeafDocument(
  sql: Sql,
  organizationId: string,
  folderId: string | null,
  leafName: string,
): Promise<string | null> {
  const matches = await sql<DocRow[]>`
    SELECT ${sql.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId} AND title = ${leafName}
      AND folder_id IS NOT DISTINCT FROM ${folderId}
  `;
  const exact = matches.find((d) => isVisibleDoc(d));
  if (exact) return exact.id;

  // `<title>_<docId>` disambiguation for same-title siblings (see
  // methods/propfind.ts) — split on the LAST underscore, verify both halves.
  const underscore = leafName.lastIndexOf('_');
  if (underscore > 0) {
    const titlePrefix = leafName.slice(0, underscore);
    const idPart = leafName.slice(underscore + 1);
    const rows = await sql<DocRow[]>`
      SELECT ${sql.unsafe(DOC_COLUMNS)} FROM app.documents
      WHERE id = ${idPart} AND org_id = ${organizationId} LIMIT 1
    `;
    const doc = rows[0];
    if (
      doc &&
      (doc.folderId ?? null) === folderId &&
      isVisibleDoc(doc) &&
      (doc.title ?? '') === titlePrefix
    ) {
      return doc.id;
    }
  }
  return null;
}

async function findCollision(
  db: Sql | TransactionSql,
  organizationId: string,
  parentFolderId: string | null,
  name: string,
): Promise<
  { kind: 'document'; id: string } | { kind: 'folder'; id: string } | null
> {
  const folder = await hubFolder(db, organizationId, parentFolderId, name);
  if (folder) return { kind: 'folder', id: folder.id };
  const matches = await db<DocRow[]>`
    SELECT ${db.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId} AND title = ${name}
      AND folder_id IS NOT DISTINCT FROM ${parentFolderId}
  `;
  const doc = matches.find((d) => isVisibleDoc(d));
  if (doc) return { kind: 'document', id: doc.id };
  return null;
}

async function loadDoc(
  db: Sql | TransactionSql,
  organizationId: string,
  documentId: string,
): Promise<DocRow | null> {
  const rows = await db<DocRow[]>`
    SELECT ${db.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE id = ${documentId} AND org_id = ${organizationId} LIMIT 1
  `;
  return rows[0] ?? null;
}

// ------------------------------------------------------- destructive core

/** The 0.5 hold guard throws its own LegalHoldError class; the REUSED DAV
 * method handlers branch on AppError codes (403 for LEGAL_HOLD_ACTIVE) —
 * translate so a held delete never reads as a 500. */
async function translateHoldError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LegalHoldError) {
      throw new AppError({ code: 'LEGAL_HOLD_ACTIVE' });
    }
    throw error;
  }
}

async function assertWebdavDocNotHeld(
  db: Sql | TransactionSql,
  organizationId: string,
  doc: DocRow,
): Promise<void> {
  await translateHoldError(() =>
    assertNotHeld(
      db,
      organizationId,
      'document',
      doc.id,
      undefined,
      doc.createdBy ?? undefined,
    ),
  );
}

async function softDeleteDocumentInner(
  tx: TransactionSql,
  organizationId: string,
  documentId: string,
): Promise<void> {
  const doc = await loadDoc(tx, organizationId, documentId);
  // A project-scoped doc is not a WebDAV resource (#2545) — behave exactly
  // as if the path never resolved.
  if (!doc || doc.projectId !== null) {
    throw new AppError({ code: 'NOT_FOUND' });
  }
  if ((doc.lifecycleStatus ?? 'active') !== 'active') return;
  await assertWebdavDocNotHeld(tx, organizationId, doc);
  assertRecordTrashable(recordFields(doc));
  await tx`
    UPDATE app.documents SET
      lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()},
      updated_at_ms = ${Date.now()}
    WHERE id = ${documentId}
  `;
}

async function assertFolderTreeNotHeld(
  tx: TransactionSql,
  organizationId: string,
  folderId: string,
): Promise<void> {
  const holds = await loadActiveHolds(tx, organizationId);
  await translateHoldError(() =>
    assertNotHeld(tx, organizationId, 'folder', folderId, holds),
  );
  const budget = newReadBudget();
  const walk = async (id: string, depth: number): Promise<void> => {
    if (depth > MAX_FOLDER_DEPTH) throw new AppError({ code: 'CONFLICT' });
    const docs = await tx<DocRow[]>`
      SELECT ${tx.unsafe(DOC_COLUMNS)} FROM app.documents
      WHERE org_id = ${organizationId} AND folder_id = ${id}
      LIMIT ${budget.remaining + 1}
    `;
    chargeReadBudget(budget, docs.length);
    for (const d of docs) {
      if (!isVisibleDoc(d)) continue;
      await translateHoldError(() =>
        assertNotHeld(
          tx,
          organizationId,
          'document',
          d.id,
          holds,
          d.createdBy ?? undefined,
        ),
      );
    }
    const children = await tx<{ id: string }[]>`
      SELECT id FROM app.folders
      WHERE org_id = ${organizationId} AND parent_id = ${id}
      LIMIT ${budget.remaining + 1}
    `;
    chargeReadBudget(budget, children.length);
    for (const c of children) await walk(c.id, depth + 1);
  };
  await walk(folderId, 0);
}

async function cascadeDeleteFolderRecursive(
  tx: TransactionSql,
  organizationId: string,
  folderId: string,
  depth = 0,
  budget: ReadBudget = newReadBudget(),
): Promise<void> {
  // Legal-hold pre-walk once at the root: never half-delete a tree.
  if (depth === 0) {
    await assertFolderTreeNotHeld(tx, organizationId, folderId);
  }
  if (depth > MAX_FOLDER_DEPTH) throw new AppError({ code: 'CONFLICT' });
  const children = await tx<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${organizationId} AND parent_id = ${folderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, children.length);
  for (const c of children) {
    await cascadeDeleteFolderRecursive(
      tx,
      organizationId,
      c.id,
      depth + 1,
      budget,
    );
  }
  const docs = await tx<DocRow[]>`
    SELECT ${tx.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId} AND folder_id = ${folderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, docs.length);
  for (const d of docs) {
    // A WebDAV folder delete must never trash a project file (#2545).
    if (isVisibleDoc(d)) {
      // A frozen controlled record anywhere refuses the WHOLE cascade —
      // the throw rolls the transaction back.
      assertRecordTrashable(recordFields(d));
      await tx`
        UPDATE app.documents SET
          lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()},
          updated_at_ms = ${Date.now()}
        WHERE id = ${d.id}
      `;
    }
  }
  await tx`DELETE FROM app.folders WHERE id = ${folderId}`;
}

async function assertVisibleFolderSrc(
  db: Sql | TransactionSql,
  organizationId: string,
  folderId: string,
): Promise<void> {
  const rows = await db<{ projectId: string | null }[]>`
    SELECT project_id AS "projectId" FROM app.folders
    WHERE id = ${folderId} AND org_id = ${organizationId} LIMIT 1
  `;
  if (!rows[0] || rows[0].projectId !== null) {
    throw new AppError({ code: 'NOT_FOUND' });
  }
}

async function assertNotDescendantOf(
  db: Sql | TransactionSql,
  descendantId: string,
  ancestorId: string,
): Promise<void> {
  let cursor: string | null = descendantId;
  for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
    if (cursor === null) return;
    if (cursor === ancestorId) {
      throw new AppError({ code: 'DEST_IS_DESCENDANT' });
    }
    const rows: { parentId: string | null }[] = await db<
      { parentId: string | null }[]
    >`
      SELECT parent_id AS "parentId" FROM app.folders
      WHERE id = ${cursor} LIMIT 1
    `;
    if (!rows[0]) return;
    cursor = rows[0].parentId;
  }
  throw new AppError({ code: 'CONFLICT' });
}

function lockKeyForSegments(segments: string[]): string {
  if (segments.length === 0) return '/documents';
  return '/documents/' + segments.map((s) => encodeURIComponent(s)).join('/');
}

async function purgeLocksAtAndBelow(
  tx: TransactionSql,
  organizationId: string,
  resourcePath: string,
  alsoDescendants: boolean,
): Promise<void> {
  await tx`
    DELETE FROM app.webdav_locks
    WHERE org_id = ${organizationId} AND resource_path = ${resourcePath}
  `;
  if (!alsoDescendants) return;
  const prefix = resourcePath.endsWith('/') ? resourcePath : resourcePath + '/';
  await tx`
    DELETE FROM app.webdav_locks
    WHERE org_id = ${organizationId}
      AND resource_path LIKE ${prefix.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%'}
  `;
}

/** PUT-overwrite blob reclaim with the COPY refcount rule. */
async function purgeOldBlob(
  tx: TransactionSql,
  organizationId: string,
  oldFileRef: string,
): Promise<void> {
  const refs = await tx<{ lifecycleStatus: string | null }[]>`
    SELECT lifecycle_status AS "lifecycleStatus" FROM app.documents
    WHERE org_id = ${organizationId} AND file_ref = ${oldFileRef}
  `;
  if (refs.some((d) => (d.lifecycleStatus ?? 'active') === 'active')) {
    return;
  }
  await tx`
    UPDATE app.file_metadata SET
      lifecycle_status = 'trashed', status_changed_at_ms = ${Date.now()},
      document_id = NULL
    WHERE storage_ref = ${oldFileRef}
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
  `;
  await deleteOrgBlobRef(tx, organizationId, oldFileRef);
}

async function deleteOrgBlobRef(
  db: Sql | TransactionSql,
  organizationId: string,
  ref: string,
): Promise<void> {
  try {
    const orgSlug = await resolveOrgSlug(db, organizationId);
    if (!orgSlug) return;
    const store = await resolveObjectStore(orgSlug);
    const key = ref.startsWith('s3:') ? ref.slice(3) : ref;
    await s3DeleteObject(store, key);
  } catch (error) {
    console.warn('[webdav] blob delete failed', error);
  }
}

async function copyFolderRecursive(
  tx: TransactionSql,
  organizationId: string,
  srcFolderId: string,
  destParentId: string | null,
  destName: string,
  userId: string,
  depth: number,
  budget: ReadBudget = newReadBudget(),
): Promise<string> {
  if (depth > MAX_FOLDER_DEPTH) throw new AppError({ code: 'CONFLICT' });
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.folders (org_id, name, parent_id, created_by,
                             created_at_ms)
    VALUES (${organizationId}, ${nfc(destName)}, ${destParentId},
            ${userId}, ${Date.now()})
    RETURNING id
  `;
  const newFolderId = inserted[0]?.id;
  if (!newFolderId) throw new Error('folder insert failed');

  const childFolders = await tx<{ id: string; name: string }[]>`
    SELECT id, name FROM app.folders
    WHERE org_id = ${organizationId} AND parent_id = ${srcFolderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, childFolders.length);
  for (const cf of childFolders) {
    await copyFolderRecursive(
      tx,
      organizationId,
      cf.id,
      newFolderId,
      cf.name,
      userId,
      depth + 1,
      budget,
    );
  }
  const childDocs = await tx<DocRow[]>`
    SELECT ${tx.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId} AND folder_id = ${srcFolderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, childDocs.length);
  const now = Date.now();
  for (const d of childDocs) {
    if (!isVisibleDoc(d)) continue;
    // Same blob ref — the destination is another reference to the bytes.
    await tx`
      INSERT INTO app.documents (
        org_id, title, file_ref, mime_type, extension, content_hash,
        source_provider, source_created_at_ms, source_modified_at_ms,
        created_by, folder_id, created_at_ms, updated_at_ms
      ) VALUES (
        ${organizationId}, ${nfc(d.title ?? '(untitled)')}, ${d.fileRef},
        ${d.mimeType}, ${d.extension}, ${d.contentHash},
        ${WEBDAV_SOURCE_PROVIDER}, ${now}, ${now},
        ${userId}, ${newFolderId}, ${now}, ${now}
      )
    `;
  }
  return newFolderId;
}

async function fixupMovedFolderDescendants(
  tx: TransactionSql,
  organizationId: string,
  folderId: string,
  depth: number,
  budget: ReadBudget,
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) throw new AppError({ code: 'CONFLICT' });
  const folderPath = await buildFolderPath(tx, folderId);
  const docs = await tx<DocRow[]>`
    SELECT ${tx.unsafe(DOC_COLUMNS)} FROM app.documents
    WHERE org_id = ${organizationId} AND folder_id = ${folderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, docs.length);
  for (const d of docs) {
    if (!isVisibleDoc(d)) continue;
    const detachSync =
      d.sourceProvider !== null && SYNC_SOURCE_PROVIDERS.has(d.sourceProvider);
    await tx`
      UPDATE app.documents SET
        folder_path = ${folderPath ?? null},
        source_provider = ${detachSync ? null : tx.unsafe('source_provider')},
        external_item_id = ${detachSync ? null : tx.unsafe('external_item_id')},
        drive_id = ${detachSync ? null : tx.unsafe('drive_id')},
        updated_at_ms = ${Date.now()}
      WHERE id = ${d.id}
    `;
  }
  const childFolders = await tx<{ id: string }[]>`
    SELECT id FROM app.folders
    WHERE org_id = ${organizationId} AND parent_id = ${folderId}
    LIMIT ${budget.remaining + 1}
  `;
  chargeReadBudget(budget, childFolders.length);
  for (const cf of childFolders) {
    await fixupMovedFolderDescendants(
      tx,
      organizationId,
      cf.id,
      depth + 1,
      budget,
    );
  }
}

// -------------------------------------------------------------- handlers

export type WebdavHandler = (args: never) => Promise<unknown>;

export function webdavHandlers(
  sql: Sql,
): Record<string, (raw: unknown) => Promise<unknown>> {
  const asArgs = <T>(raw: unknown): T =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the reused protocol layer passes exactly the 0.4 validator shapes
    raw as T;

  return {
    // ------------------------------------------------------ org resolve
    'webdav/org_queries:resolveOrgAndCheckMembership': async (raw) => {
      const args = asArgs<{ orgSlug: string; userId: string }>(raw);
      const orgs = await sql<{ id: string }[]>`
        SELECT "id" FROM "organization" WHERE "slug" = ${args.orgSlug} LIMIT 1
      `;
      const organizationId = orgs[0]?.id;
      if (organizationId === undefined) return null;
      if (args.userId.length === 0) return { organizationId };
      const members = await sql<{ role: string }[]>`
        SELECT "role" FROM "member"
        WHERE "organizationId" = ${organizationId}
          AND "userId" = ${args.userId}
        LIMIT 1
      `;
      const role = members[0]?.role;
      if (role === undefined || role === 'disabled') return null;
      return { organizationId };
    },

    // ---------------------------------------------------- app passwords
    'webdav/app_password_queries:findCandidatesByPrefix': async (raw) => {
      const args = asArgs<{ organizationId: string; prefix: string }>(raw);
      if (args.prefix.length < 4) return [];
      const rows = await sql<
        { _id: string; userId: string; passwordHashed: string }[]
      >`
        SELECT id AS "_id", user_id AS "userId",
               password_hashed AS "passwordHashed"
        FROM app.webdav_app_passwords
        WHERE org_id = ${args.organizationId}
          AND password_prefix = ${args.prefix.slice(0, 4)}
          AND revoked_at_ms IS NULL
      `;
      return rows;
    },
    'webdav/app_password_queries:chargeWebdavAuthFailure': async (raw) => {
      const args = asArgs<{ organizationId: string; clientIp: string }>(raw);
      try {
        await checkIpRateLimit(sql, 'webdav:auth-fail-ip', args.clientIp, 1);
        if (args.organizationId.length > 0) {
          await checkOrganizationRateLimit(
            sql,
            'webdav:auth-fail-org',
            args.organizationId,
            1,
          );
        }
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          throw new AppError({ code: 'RATE_LIMITED' });
        }
        throw error;
      }
      return null;
    },
    'webdav/app_password_mutations:recordAppPasswordUse': async (raw) => {
      const args = asArgs<{ id: string; at: number }>(raw);
      await sql`
        UPDATE app.webdav_app_passwords
        SET last_used_at_ms = ${args.at}
        WHERE id = ${args.id} AND revoked_at_ms IS NULL
      `;
      return null;
    },

    // ------------------------------------------------------- tree reads
    'webdav/tree_queries:resolvePath': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        namespace: 'documents' | '.trash';
        segments: string[];
      }>(raw);
      if (args.segments.length === 0) {
        return { kind: 'root', exists: true, creationTime: null };
      }
      if (args.namespace === '.trash') {
        if (args.segments.length !== 1) {
          return { kind: 'not_found', exists: false };
        }
        const matches = await sql<DocRow[]>`
          SELECT ${sql.unsafe(DOC_COLUMNS)} FROM app.documents
          WHERE org_id = ${args.organizationId}
            AND lifecycle_status = 'trashed' AND title = ${args.segments[0]}
        `;
        const match = matches.find((d) => d.projectId === null);
        if (match) {
          return { kind: 'document', documentId: match.id, exists: true };
        }
        return { kind: 'not_found', exists: false };
      }
      const parentSegments = args.segments.slice(0, -1);
      const leafName = args.segments[args.segments.length - 1];
      let parentFolderId: string | null = null;
      if (parentSegments.length > 0) {
        parentFolderId = await findFolderByPath(
          sql,
          args.organizationId,
          parentSegments,
        );
        if (parentFolderId === null) {
          return { kind: 'not_found', exists: false };
        }
      }
      const childFolder = await hubFolder(
        sql,
        args.organizationId,
        parentFolderId,
        leafName,
      );
      if (childFolder) {
        return {
          kind: 'folder',
          folderId: childFolder.id,
          exists: true,
          creationTime: childFolder.createdAt,
        };
      }
      const docId = await resolveLeafDocument(
        sql,
        args.organizationId,
        parentFolderId,
        leafName,
      );
      if (docId) return { kind: 'document', documentId: docId, exists: true };
      return { kind: 'not_found', exists: false };
    },

    'webdav/tree_queries:listCollection': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        namespace: 'documents' | '.trash';
        folderId: string | null;
      }>(raw);
      if (args.namespace === '.trash') {
        const taken = await sql<DocRow[]>`
          SELECT ${sql.unsafe(DOC_COLUMNS)} FROM app.documents
          WHERE org_id = ${args.organizationId}
            AND lifecycle_status = 'trashed'
          ORDER BY created_at_ms ASC
          LIMIT ${MAX_CHILDREN_PER_PROPFIND + 1}
        `;
        const truncated = taken.length > MAX_CHILDREN_PER_PROPFIND;
        const slice = (
          truncated ? taken.slice(0, MAX_CHILDREN_PER_PROPFIND) : taken
        ).filter((d) => d.projectId === null);
        return {
          folders: [],
          documents: await Promise.all(
            slice.map((d) => joinDocumentMetadata(sql, d)),
          ),
          truncated,
        };
      }
      const rawFolders = await sql<FolderRow[]>`
        SELECT id, name, parent_id AS "parentId", project_id AS "projectId",
               created_at_ms::float8 AS "createdAt"
        FROM app.folders
        WHERE org_id = ${args.organizationId} AND project_id IS NULL
          AND parent_id IS NOT DISTINCT FROM ${args.folderId}
        ORDER BY name ASC
        LIMIT ${MAX_CHILDREN_PER_PROPFIND + 1}
      `;
      const foldersHitReadCap = rawFolders.length > MAX_CHILDREN_PER_PROPFIND;
      const rawDocs = await sql<DocRow[]>`
        SELECT ${sql.unsafe(DOC_COLUMNS)} FROM app.documents
        WHERE org_id = ${args.organizationId}
          AND folder_id IS NOT DISTINCT FROM ${args.folderId}
        ORDER BY created_at_ms ASC
        LIMIT ${MAX_CHILDREN_PER_PROPFIND + 1}
      `;
      const docsHitReadCap = rawDocs.length > MAX_CHILDREN_PER_PROPFIND;
      const docs = rawDocs.filter((d) => isVisibleDoc(d));
      const total = rawFolders.length + docs.length;
      const truncated =
        total > MAX_CHILDREN_PER_PROPFIND ||
        docsHitReadCap ||
        foldersHitReadCap;
      let folderSlice: FolderRow[] = [...rawFolders];
      let docSlice: DocRow[] = docs;
      if (truncated) {
        if (rawFolders.length >= MAX_CHILDREN_PER_PROPFIND) {
          folderSlice = folderSlice.slice(0, MAX_CHILDREN_PER_PROPFIND);
          docSlice = [];
        } else {
          docSlice = docs.slice(
            0,
            MAX_CHILDREN_PER_PROPFIND - rawFolders.length,
          );
        }
      }
      return {
        folders: folderSlice.map((f) => ({
          _id: f.id,
          name: f.name,
          creationTime: f.createdAt,
        })),
        documents: await Promise.all(
          docSlice.map((d) => joinDocumentMetadata(sql, d)),
        ),
        truncated,
      };
    },

    'webdav/tree_queries:getDocumentProps': async (raw) => {
      const args = asArgs<{ organizationId: string; documentId: string }>(raw);
      const doc = await loadDoc(sql, args.organizationId, args.documentId);
      if (!doc || doc.projectId !== null) return null;
      return joinDocumentMetadata(sql, doc);
    },

    'webdav/tree_queries:getWebdavBlobUrl': async (raw) => {
      const args = asArgs<{ storageId: string }>(raw);
      // Presigned S3 GET — streams and supports Range. Null when the object
      // is gone (the 0.4 contract).
      const rows = await sql<{ orgId: string }[]>`
        SELECT org_id AS "orgId" FROM app.file_metadata
        WHERE storage_ref = ${args.storageId} LIMIT 1
      `;
      const orgId = rows[0]?.orgId;
      if (orgId === undefined) return null;
      try {
        const orgSlug = await resolveOrgSlug(sql, orgId);
        if (!orgSlug) return null;
        const store = await resolveObjectStore(orgSlug);
        const key = args.storageId.startsWith('s3:')
          ? args.storageId.slice(3)
          : args.storageId;
        const head = await s3HeadObject(store, key);
        if (!head) return null;
        return s3PresignGetUrl(store, key);
      } catch (error) {
        console.warn('[webdav] getWebdavBlobUrl failed', error);
        return null;
      }
    },

    // --------------------------------------------------------- blob I/O
    'files/blob_actions:generateWebdavBlobUpload': async (raw) => {
      const args = asArgs<{ organizationId: string; contentType: string }>(raw);
      const orgSlug = await resolveOrgSlug(sql, args.organizationId);
      if (!orgSlug) throw new AppError({ code: 'NOT_FOUND' });
      const store = await resolveObjectStore(orgSlug);
      const key = buildObjectKey(store, orgSlug);
      const url = await s3PresignPutUrl(store, key, {
        contentType: args.contentType,
      });
      return { url, method: 'PUT', s3Ref: `s3:${key}` };
    },
    'webdav/tree_mutations:generateWebdavUploadUrl': async () => {
      // The 0.4 fallback targeted Convex `_storage`'s chunked POST ingest;
      // 0.5 is S3-only and a presigned PUT needs a Content-Length. A
      // chunked PUT (no declared length) is refused loudly — the handler
      // maps this to 502 with its own log line.
      throw new AppError({ code: 'CHUNKED_PUT_UNSUPPORTED' });
    },
    'webdav/tree_mutations:deleteWebdavBlob': async (raw) => {
      const args = asArgs<{ storageId: string; organizationId?: string }>(raw);
      if (args.organizationId === undefined) {
        console.warn(
          '[webdav] deleteWebdavBlob: ref without organizationId; cannot reclaim',
          args.storageId,
        );
        return null;
      }
      await deleteOrgBlobRef(sql, args.organizationId, args.storageId);
      return null;
    },

    // ------------------------------------------------------ tree writes
    'webdav/tree_mutations:ingestPutBlob': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        pathSegments: string[];
        storageId: string;
        contentType: string;
        size: number;
        userId: string;
        sourceModifiedAtMs?: number;
      }>(raw);
      if (args.pathSegments.length === 0) {
        throw new AppError({ code: 'INVALID_PATH' });
      }
      const parentSegments = args.pathSegments.slice(0, -1).map(nfc);
      const fileName = nfc(args.pathSegments[args.pathSegments.length - 1]);

      // Derive the real MIME from the filename exactly as the web upload
      // path does; classify generic text files as text/plain (WebDAV-only
      // widening — see the 0.4 comment).
      let resolvedContentType = resolveFileType(fileName, args.contentType);
      if (
        (resolvedContentType === 'application/octet-stream' ||
          resolvedContentType === '') &&
        isTextBasedFile(fileName)
      ) {
        resolvedContentType = 'text/plain';
      }

      return sql.begin(async (tx) => {
        // RFC 4918 §9.7.1: a PUT may not auto-vivify intermediate
        // collections.
        let folderId: string | null = null;
        if (parentSegments.length > 0) {
          folderId = await findFolderByPath(
            tx,
            args.organizationId,
            parentSegments,
          );
          if (folderId === null) throw new AppError({ code: 'CONFLICT' });
        }
        const matches = await tx<DocRow[]>`
          SELECT ${tx.unsafe(DOC_COLUMNS)} FROM app.documents
          WHERE org_id = ${args.organizationId} AND title = ${fileName}
            AND folder_id IS NOT DISTINCT FROM ${folderId}
        `;
        const existing = matches.find((d) => isVisibleDoc(d));
        if (existing) {
          await assertWebdavDocNotHeld(tx, args.organizationId, existing);
          assertGenericDocumentContentWritable(recordFields(existing));
        }

        // Register the blob + schedule RAG (the 0.4 saveFileMetadata twin).
        const { fileId } = await registerUploadedBytes(tx, {
          organizationId: args.organizationId,
          storageRef: args.storageId,
          fileName,
          contentType: resolvedContentType,
          size: args.size,
          source: WEBDAV_SOURCE_PROVIDER,
          uploadedBy: args.userId,
        });
        await markRagQueued(tx, fileId);
        await addJobInTx(tx, 'rag.index_file', { fileId });

        const sourceModifiedAt = args.sourceModifiedAtMs ?? Date.now();
        if (existing) {
          const oldFileRef = existing.fileRef;
          await tx`
            UPDATE app.documents SET
              file_ref = ${args.storageId},
              mime_type = ${resolvedContentType},
              extension = ${extractExtension(fileName) ?? null},
              source_modified_at_ms = ${sourceModifiedAt},
              updated_at_ms = ${Date.now()}
            WHERE id = ${existing.id}
          `;
          await tx`
            UPDATE app.file_metadata SET document_id = ${existing.id}
            WHERE id = ${fileId}
          `;
          if (oldFileRef && oldFileRef !== args.storageId) {
            await purgeOldBlob(tx, args.organizationId, oldFileRef);
          }
          return { created: false, documentId: existing.id };
        }
        const now = Date.now();
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.documents (
            org_id, title, file_ref, mime_type, extension, source_provider,
            source_created_at_ms, source_modified_at_ms, created_by,
            folder_id, created_at_ms, updated_at_ms
          ) VALUES (
            ${args.organizationId}, ${fileName}, ${args.storageId},
            ${resolvedContentType}, ${extractExtension(fileName) ?? null},
            ${WEBDAV_SOURCE_PROVIDER}, ${now}, ${sourceModifiedAt},
            ${args.userId}, ${folderId}, ${now}, ${now}
          )
          RETURNING id
        `;
        const documentId = inserted[0]?.id;
        if (!documentId) throw new Error('document insert failed');
        await tx`
          UPDATE app.file_metadata SET document_id = ${documentId}
          WHERE id = ${fileId}
        `;
        return { created: true, documentId };
      });
    },

    'webdav/tree_mutations:softDeleteDocument': async (raw) => {
      const args = asArgs<{ organizationId: string; documentId: string }>(raw);
      await sql.begin((tx) =>
        softDeleteDocumentInner(tx, args.organizationId, args.documentId),
      );
      return null;
    },

    'webdav/tree_mutations:deleteFolderCascade': async (raw) => {
      const args = asArgs<{ organizationId: string; folderId: string }>(raw);
      await sql.begin(async (tx) => {
        await assertVisibleFolderSrc(tx, args.organizationId, args.folderId);
        await cascadeDeleteFolderRecursive(
          tx,
          args.organizationId,
          args.folderId,
        );
      });
      return null;
    },

    'webdav/tree_mutations:mkcol': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        parentSegments: string[];
        name: string;
        userId: string;
      }>(raw);
      const name = nfc(args.name);
      const parentSegments = args.parentSegments.map(nfc);
      if (parentSegments.length + 1 > MAX_FOLDER_DEPTH) {
        throw new AppError({ code: 'CONFLICT' });
      }
      return sql.begin(async (tx) => {
        let parentId: string | null = null;
        if (parentSegments.length > 0) {
          parentId = await findFolderByPath(
            tx,
            args.organizationId,
            parentSegments,
          );
          if (parentId === null) throw new AppError({ code: 'CONFLICT' });
        }
        const existing = await findCollision(
          tx,
          args.organizationId,
          parentId,
          name,
        );
        if (existing) throw new AppError({ code: 'METHOD_NOT_ALLOWED' });
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.folders (org_id, name, parent_id, created_by,
                                   created_at_ms)
          VALUES (${args.organizationId}, ${name}, ${parentId},
                  ${args.userId}, ${Date.now()})
          RETURNING id
        `;
        return { folderId: inserted[0]?.id };
      });
    },

    'webdav/tree_mutations:moveResource': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        src: { kind: 'document'; id: string } | { kind: 'folder'; id: string };
        srcSegments: string[];
        destParentSegments: string[];
        destName: string;
        overwrite: boolean;
        userId: string;
      }>(raw);
      const destName = nfc(args.destName);
      const destParentSegments = args.destParentSegments.map(nfc);
      const srcSegments = args.srcSegments.map(nfc);
      return sql.begin(async (tx) => {
        if (args.src.kind === 'folder') {
          await assertVisibleFolderSrc(tx, args.organizationId, args.src.id);
        }
        let destFolderId: string | null = null;
        if (destParentSegments.length > 0) {
          destFolderId = await findFolderByPath(
            tx,
            args.organizationId,
            destParentSegments,
          );
          if (destFolderId === null) {
            throw new AppError({ code: 'DEST_PARENT_MISSING' });
          }
        }
        const collision = await findCollision(
          tx,
          args.organizationId,
          destFolderId,
          destName,
        );
        if (
          collision !== null &&
          collision.kind === args.src.kind &&
          collision.id === args.src.id
        ) {
          throw new AppError({ code: 'SELF_DESTINATION' });
        }
        if (args.src.kind === 'folder' && destFolderId !== null) {
          await assertNotDescendantOf(tx, destFolderId, args.src.id);
        }
        if (collision && !args.overwrite) {
          throw new AppError({ code: 'DEST_EXISTS' });
        }
        if (collision && args.overwrite) {
          if (collision.kind === 'document') {
            await softDeleteDocumentInner(
              tx,
              args.organizationId,
              collision.id,
            );
          } else {
            await cascadeDeleteFolderRecursive(
              tx,
              args.organizationId,
              collision.id,
            );
          }
        }
        if (args.src.kind === 'document') {
          const existing = await loadDoc(tx, args.organizationId, args.src.id);
          if (!existing || existing.projectId !== null) {
            throw new AppError({ code: 'NOT_FOUND' });
          }
          const newFolderPath =
            destFolderId !== null
              ? await buildFolderPath(tx, destFolderId)
              : undefined;
          const detachSync =
            existing.sourceProvider !== null &&
            SYNC_SOURCE_PROVIDERS.has(existing.sourceProvider);
          await tx`
            UPDATE app.documents SET
              title = ${destName}, folder_id = ${destFolderId},
              folder_path = ${newFolderPath ?? null},
              source_modified_at_ms = ${Date.now()},
              source_provider = ${detachSync ? null : tx.unsafe('source_provider')},
              external_item_id = ${detachSync ? null : tx.unsafe('external_item_id')},
              drive_id = ${detachSync ? null : tx.unsafe('drive_id')},
              updated_at_ms = ${Date.now()}
            WHERE id = ${args.src.id}
          `;
        } else {
          await tx`
            UPDATE app.folders SET
              name = ${destName}, parent_id = ${destFolderId}
            WHERE id = ${args.src.id}
          `;
          await fixupMovedFolderDescendants(
            tx,
            args.organizationId,
            args.src.id,
            0,
            newReadBudget(),
          );
        }
        await purgeLocksAtAndBelow(
          tx,
          args.organizationId,
          lockKeyForSegments(srcSegments),
          args.src.kind === 'folder',
        );
        return { created: collision === null };
      });
    },

    'webdav/tree_mutations:copyResource': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        src: { kind: 'document'; id: string } | { kind: 'folder'; id: string };
        destParentSegments: string[];
        destName: string;
        overwrite: boolean;
        userId: string;
      }>(raw);
      const destName = nfc(args.destName);
      const destParentSegments = args.destParentSegments.map(nfc);
      return sql.begin(async (tx) => {
        if (args.src.kind === 'folder') {
          await assertVisibleFolderSrc(tx, args.organizationId, args.src.id);
        }
        let destFolderId: string | null = null;
        if (destParentSegments.length > 0) {
          destFolderId = await findFolderByPath(
            tx,
            args.organizationId,
            destParentSegments,
          );
          if (destFolderId === null) {
            throw new AppError({ code: 'DEST_PARENT_MISSING' });
          }
        }
        const collision = await findCollision(
          tx,
          args.organizationId,
          destFolderId,
          destName,
        );
        if (
          collision !== null &&
          collision.kind === args.src.kind &&
          collision.id === args.src.id
        ) {
          throw new AppError({ code: 'SELF_DESTINATION' });
        }
        if (args.src.kind === 'folder' && destFolderId !== null) {
          await assertNotDescendantOf(tx, destFolderId, args.src.id);
        }
        if (collision && !args.overwrite) {
          throw new AppError({ code: 'DEST_EXISTS' });
        }
        if (collision && args.overwrite) {
          if (collision.kind === 'document') {
            await softDeleteDocumentInner(
              tx,
              args.organizationId,
              collision.id,
            );
          } else {
            await cascadeDeleteFolderRecursive(
              tx,
              args.organizationId,
              collision.id,
            );
          }
        }
        if (args.src.kind === 'document') {
          const src = await loadDoc(tx, args.organizationId, args.src.id);
          if (!src || src.projectId !== null) {
            throw new AppError({ code: 'NOT_FOUND' });
          }
          const now = Date.now();
          await tx`
            INSERT INTO app.documents (
              org_id, title, file_ref, mime_type, extension, content_hash,
              source_provider, source_created_at_ms, source_modified_at_ms,
              created_by, folder_id, created_at_ms, updated_at_ms
            ) VALUES (
              ${args.organizationId}, ${destName}, ${src.fileRef},
              ${src.mimeType}, ${src.extension}, ${src.contentHash},
              ${WEBDAV_SOURCE_PROVIDER}, ${now}, ${now},
              ${args.userId}, ${destFolderId}, ${now}, ${now}
            )
          `;
          return { created: collision === null };
        }
        await copyFolderRecursive(
          tx,
          args.organizationId,
          args.src.id,
          destFolderId,
          destName,
          args.userId,
          0,
        );
        return { created: collision === null };
      });
    },

    // ------------------------------------------------------------ locks
    'webdav/lock_queries:findLockForPath': async (raw) => {
      const args = asArgs<{ organizationId: string; resourcePath: string }>(
        raw,
      );
      const path = canonicalResourcePath(args.resourcePath);
      const rows = await sql<
        {
          _id: string;
          lockToken: string;
          ownerUserId: string;
          ownerXml: string;
          depth: '0' | 'infinity';
          scope: 'exclusive' | 'shared';
          expiresAt: number;
        }[]
      >`
        SELECT id AS "_id", lock_token AS "lockToken",
               owner_user_id AS "ownerUserId", owner_xml AS "ownerXml",
               depth, scope, expires_at_ms::float8 AS "expiresAt"
        FROM app.webdav_locks
        WHERE org_id = ${args.organizationId} AND resource_path = ${path}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return { lock: null, expiredId: null };
      if (row.expiresAt <= Date.now()) {
        return { lock: null, expiredId: row._id };
      }
      return { lock: row, expiredId: null };
    },
    'webdav/lock_queries:findLocksUnderPath': async (raw) => {
      const args = asArgs<{ organizationId: string; resourcePath: string }>(
        raw,
      );
      const path = canonicalResourcePath(args.resourcePath);
      const rows = await sql<
        { resourcePath: string; lockToken: string; expiresAt: number }[]
      >`
        SELECT resource_path AS "resourcePath", lock_token AS "lockToken",
               expires_at_ms::float8 AS "expiresAt"
        FROM app.webdav_locks
        WHERE org_id = ${args.organizationId}
          AND resource_path >= ${path + '/'}
          AND resource_path < ${path + '/￿'}
      `;
      const now = Date.now();
      return rows
        .filter((r) => r.expiresAt > now)
        .map((r) => ({ resourcePath: r.resourcePath, lockToken: r.lockToken }));
    },
    'webdav/lock_queries:findLockByToken': async (raw) => {
      const args = asArgs<{ token: string }>(raw);
      const rows = await sql<
        {
          _id: string;
          organizationId: string;
          resourcePath: string;
          lockToken: string;
          ownerUserId: string;
          ownerXml: string;
          depth: string;
          scope: string;
          expiresAt: number;
        }[]
      >`
        SELECT id AS "_id", org_id AS "organizationId",
               resource_path AS "resourcePath", lock_token AS "lockToken",
               owner_user_id AS "ownerUserId", owner_xml AS "ownerXml",
               depth, scope, expires_at_ms::float8 AS "expiresAt"
        FROM app.webdav_locks WHERE lock_token = ${args.token} LIMIT 1
      `;
      const row = rows[0];
      if (!row || row.expiresAt <= Date.now()) return null;
      return row;
    },
    'webdav/lock_mutations:createLock': async (raw) => {
      const args = asArgs<{
        organizationId: string;
        resourcePath: string;
        lockToken: string;
        ownerXml: string;
        depth: '0' | 'infinity';
        scope: 'exclusive' | 'shared';
        ownerUserId: string;
        appPasswordId: string;
        timeoutMs: number;
      }>(raw);
      const path = canonicalResourcePath(args.resourcePath);
      return sql.begin(async (tx) => {
        const now = Date.now();
        // Evict this password's expired rows, then cap live locks.
        await tx`
          DELETE FROM app.webdav_locks
          WHERE app_password_id = ${args.appPasswordId}
            AND expires_at_ms <= ${now}
        `;
        const live = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count FROM app.webdav_locks
          WHERE app_password_id = ${args.appPasswordId}
        `;
        if (Number(live[0]?.count ?? '0') >= MAX_LOCKS_PER_APP_PASSWORD) {
          throw new AppError({ code: 'RATE_LIMITED' });
        }
        const existing = await tx<{ id: string; expiresAt: number }[]>`
          SELECT id, expires_at_ms::float8 AS "expiresAt"
          FROM app.webdav_locks
          WHERE org_id = ${args.organizationId} AND resource_path = ${path}
          LIMIT 1
          FOR UPDATE
        `;
        if (existing[0] && existing[0].expiresAt > now) {
          throw new AppError({ code: 'LOCKED' });
        }
        if (existing[0]) {
          await tx`DELETE FROM app.webdav_locks WHERE id = ${existing[0].id}`;
        }
        // RFC §6.1: a depth-infinity ANCESTOR lock covers the subtree.
        const parts = path.split('/');
        for (let i = parts.length - 1; i > 1; i--) {
          const ancestor = parts.slice(0, i).join('/');
          const anc = await tx<{ depth: string; expiresAt: number }[]>`
            SELECT depth, expires_at_ms::float8 AS "expiresAt"
            FROM app.webdav_locks
            WHERE org_id = ${args.organizationId}
              AND resource_path = ${ancestor}
            LIMIT 1
          `;
          if (anc[0] && anc[0].depth === 'infinity' && anc[0].expiresAt > now) {
            throw new AppError({ code: 'LOCKED' });
          }
        }
        // RFC §7.4: no new depth-infinity lock over a locked subtree.
        if (args.depth === 'infinity') {
          const descendants = await tx<{ expiresAt: number }[]>`
            SELECT expires_at_ms::float8 AS "expiresAt"
            FROM app.webdav_locks
            WHERE org_id = ${args.organizationId}
              AND resource_path >= ${path + '/'}
              AND resource_path < ${path + '/￿'}
          `;
          if (descendants.some((d) => d.expiresAt > now)) {
            throw new AppError({ code: 'LOCKED' });
          }
        }
        const timeoutMs = Math.min(args.timeoutMs, MAX_LOCK_TIMEOUT_MS);
        const expiresAt = now + timeoutMs;
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.webdav_locks (
            org_id, resource_path, lock_token, owner_xml, depth, scope,
            owner_user_id, app_password_id, expires_at_ms
          ) VALUES (
            ${args.organizationId}, ${path}, ${args.lockToken},
            ${args.ownerXml}, ${args.depth}, ${args.scope},
            ${args.ownerUserId}, ${args.appPasswordId}, ${expiresAt}
          )
          RETURNING id
        `;
        return { _id: inserted[0]?.id, expiresAt };
      });
    },
    'webdav/lock_mutations:refreshLock': async (raw) => {
      const args = asArgs<{
        lockToken: string;
        ownerUserId: string;
        timeoutMs: number;
      }>(raw);
      return sql.begin(async (tx) => {
        const rows = await tx<
          {
            _id: string;
            organizationId: string;
            resourcePath: string;
            lockToken: string;
            ownerXml: string;
            depth: string;
            scope: string;
            ownerUserId: string;
            expiresAt: number;
          }[]
        >`
          SELECT id AS "_id", org_id AS "organizationId",
                 resource_path AS "resourcePath", lock_token AS "lockToken",
                 owner_xml AS "ownerXml", depth, scope,
                 owner_user_id AS "ownerUserId",
                 expires_at_ms::float8 AS "expiresAt"
          FROM app.webdav_locks WHERE lock_token = ${args.lockToken}
          LIMIT 1
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) throw new AppError({ code: 'NOT_FOUND' });
        if (row.expiresAt <= Date.now()) {
          await tx`DELETE FROM app.webdav_locks WHERE id = ${row._id}`;
          throw new AppError({ code: 'NOT_FOUND' });
        }
        if (row.ownerUserId !== args.ownerUserId) {
          throw new AppError({ code: 'FORBIDDEN' });
        }
        const timeoutMs = Math.min(args.timeoutMs, MAX_LOCK_TIMEOUT_MS);
        const newExpiresAt = Date.now() + timeoutMs;
        await tx`
          UPDATE app.webdav_locks SET expires_at_ms = ${newExpiresAt}
          WHERE id = ${row._id}
        `;
        return { ...row, expiresAt: newExpiresAt };
      });
    },
    'webdav/lock_mutations:releaseLock': async (raw) => {
      const args = asArgs<{
        lockToken: string;
        ownerUserId: string;
        organizationId: string;
        resourcePath?: string;
      }>(raw);
      return sql.begin(async (tx) => {
        const rows = await tx<
          {
            id: string;
            organizationId: string;
            resourcePath: string;
            ownerUserId: string;
          }[]
        >`
          SELECT id, org_id AS "organizationId",
                 resource_path AS "resourcePath",
                 owner_user_id AS "ownerUserId"
          FROM app.webdav_locks WHERE lock_token = ${args.lockToken}
          LIMIT 1
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) throw new AppError({ code: 'NOT_FOUND' });
        if (row.organizationId !== args.organizationId) {
          throw new AppError({ code: 'NOT_FOUND' });
        }
        if (args.resourcePath !== undefined) {
          const canonical = canonicalResourcePath(args.resourcePath);
          if (row.resourcePath !== canonical) {
            throw new AppError({ code: 'NOT_FOUND' });
          }
        }
        if (row.ownerUserId !== args.ownerUserId) {
          throw new AppError({ code: 'FORBIDDEN' });
        }
        await tx`DELETE FROM app.webdav_locks WHERE id = ${row.id}`;
        return null;
      });
    },
    'webdav/lock_mutations:deleteLocksUnderPath': async (raw) => {
      const args = asArgs<{ organizationId: string; resourcePath: string }>(
        raw,
      );
      const path = canonicalResourcePath(args.resourcePath);
      await sql.begin((tx) =>
        purgeLocksAtAndBelow(tx, args.organizationId, path, true),
      );
      return null;
    },
    'webdav/lock_mutations:deleteLockIfStale': async (raw) => {
      const args = asArgs<{ id: string }>(raw);
      await sql`
        DELETE FROM app.webdav_locks
        WHERE id = ${args.id} AND expires_at_ms <= ${Date.now()}
      `;
      return null;
    },
  };
}
