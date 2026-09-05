/**
 * Controlled-record guards shared by every content and delete door.
 *
 * Documents live in exactly one of two scopes (`projectId` and `teamId` are
 * mutually exclusive): the Knowledge Hub (`projectId` unset, team rules
 * apply) and project files (`projectId` set, readable only through the
 * owning project). The 0.5 scope filters live with their readers —
 * `domains/documents/service.ts` (`hasKnowledgeHubDocumentAccess`,
 * `assertDocumentVisible`) and the chat shim's knowledge-access resolver;
 * this module keeps the pure record predicates the WebDAV lane guards with.
 */

import { AppError } from '../../../lib/shared/errors/app-error';
import type { Doc } from '../lib/rows';

type DocumentRecordFields = Pick<Doc<'documents'>, 'record'>;

/**
 * Controlled-record content freeze (documents/records.ts owns the lifecycle).
 *
 * Content-mutating writes are allowed ONLY while a document is uncontrolled
 * or its record sits in `draft`: `in_review` is frozen so the named reviewer
 * reviews a FIXED artifact, and `approved` is immutable until
 * `openRecordRevision` opens the next draft. "Content" means the bytes and
 * their identity fields (`content`, `fileId`, `extension`, `mimeType`,
 * `contentHash`) — renames, folder moves, team/metadata edits stay allowed
 * in every state (title is identity, not content).
 */
export function isRecordContentFrozen(doc: DocumentRecordFields): boolean {
  return doc.record !== undefined && doc.record.state !== 'draft';
}

/**
 * Refuse a content-mutating write on a frozen controlled record. One guard,
 * wired into EVERY content write path (public update, internal/REST update,
 * WebDAV PUT, connector/sync upsert) — a new content writer MUST call this.
 */
export function assertRecordContentWritable(doc: DocumentRecordFields): void {
  if (!isRecordContentFrozen(doc)) return;
  throw new AppError({
    code: 'DOCUMENT_RECORD_FROZEN',
    message:
      doc.record?.state === 'in_review'
        ? 'This controlled record is in review and frozen. Wait for the review decision (or request changes) before editing its content.'
        : 'This controlled record is approved and immutable. Open a new revision to edit its content.',
    state: doc.record?.state,
  });
}

/**
 * Generic writers may update an uncontrolled document, but controlled-record
 * bytes and identity fields have exactly one door: the attested replacement
 * flow in `documents/records.ts`. Check the frozen state first to preserve the
 * established in-review/approved errors; a draft then gets the dedicated-flow
 * error rather than being silently replaceable through another writer.
 */
export function assertGenericDocumentContentWritable(
  doc: DocumentRecordFields,
): void {
  assertRecordContentWritable(doc);
  if (doc.record === undefined) return;
  throw new AppError({
    code: 'DOCUMENT_RECORD_REPLACEMENT_REQUIRED',
    message:
      'Replace controlled-record content through the dedicated replacement flow.',
    state: doc.record.state,
  });
}

/**
 * Why a controlled record refuses trash/delete — `null` when it may be
 * trashed.
 *
 * Protection follows the record's EVIDENCE, not merely its current state: a
 * record is protected while `in_review` or `approved`, AND for the rest of
 * its life once any version has been approved (`retained_history`) — an
 * approved snapshot is the signed artifact a reviewer stands behind, and it
 * does not stop being that because a later revision is being drafted.
 * Without the second rule, "open a new revision, then delete" quietly
 * destroys the approved history the whole lifecycle exists to preserve.
 *
 * The single source of truth for every delete path — direct delete, WebDAV,
 * knowledge entries, the folder-delete cascade pre-walk — and for the
 * `hasApprovedVersions` row projection the UI delete gate reads. A path
 * re-deriving this from `state` alone is the bug this predicate exists to
 * prevent.
 */
export type RecordTrashRefusal = 'in_review' | 'approved' | 'retained_history';

export function recordTrashRefusal(
  record: Doc<'documents'>['record'],
): RecordTrashRefusal | null {
  if (record === undefined) return null;
  if (record.state === 'in_review') return 'in_review';
  if (record.state === 'approved') return 'approved';
  return record.approvedVersions.length > 0 ? 'retained_history' : null;
}

/**
 * Refuse trashing/deleting a protected controlled record
 * (`recordTrashRefusal`). Uncontrolled documents, and controlled ones still
 * drafting their FIRST (never-approved) version, trash/delete exactly as
 * they did before.
 */
export function assertRecordTrashable(doc: DocumentRecordFields): void {
  if (doc.record === undefined) return;
  const refusal = recordTrashRefusal(doc.record);
  if (refusal === null) return;
  throw new AppError({
    code: 'DOCUMENT_RECORD_PROTECTED',
    message:
      refusal === 'in_review'
        ? 'This controlled record is in review and cannot be deleted. Resolve the review first.'
        : refusal === 'approved'
          ? 'This controlled record is approved and cannot be deleted. Its approved version is a retained record.'
          : 'This controlled record has an approved version in its history, which is a retained record, so it cannot be deleted.',
    state: doc.record.state,
  });
}
