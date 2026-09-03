import type { Sql, TransactionSql } from 'postgres';

import { authorizeRls } from '../../auth/access.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { writeCoalescedNotification } from '../collab/service.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  assertDocumentsWriteRole,
  assertDocumentVisible,
  DocumentError,
  hasKnowledgeHubDocumentAccess,
  loadDocumentOrThrow,
  type DocumentRow,
} from './service.ts';

/**
 * Controlled-record lifecycle (the 0.4 `documents/records.ts` state
 * machine): mark-controlled → draft, submit → in_review (approval mint,
 * newest submission supersedes), respond → approved (snapshot retained) or
 * back to draft, open-revision → next monotonic version. Reviews live on
 * `app.approvals` as `document_record_review` rows; decisions carry their
 * response in the row's metadata. Bells ride `writeCoalescedNotification`
 * in the same transaction as the transition.
 */

export const DOCUMENT_RECORD_MAX_APPROVED_VERSIONS = 200;
export const DOCUMENT_RECORD_FEEDBACK_MAX = 4000;

/** Only user- and agent-authored documents can become controlled records —
 * a connector/sync-owned row is rewritten by its external loop. */
const CONTROLLABLE_SOURCE_PROVIDERS: ReadonlySet<string> = new Set([
  'upload',
  'agent',
]);

const RECORD_AUDIT_ACTIONS = {
  controlled: 'document.record_controlled',
  submitted: 'document.record_submitted',
  reviewResponded: 'document.record_review_responded',
  revisionOpened: 'document.record_revision_opened',
} as const;

/** Reviewer-directory scan cap (the 0.4 `REVIEWER_SCAN_CAP`). */
const REVIEWER_SCAN_CAP = 500;

/** Bell-body excerpt cap for request-changes feedback. */
const FEEDBACK_EXCERPT_MAX = 160;

export interface ApprovedVersionSnapshot {
  version: number;
  fileId: string;
  contentHash?: string;
  sha256?: string;
  size?: number;
  approvedAt: number;
  approvedBy: string;
}

export interface ControlledRecord {
  state: 'draft' | 'in_review' | 'approved';
  version: number;
  controlledAt: number;
  controlledBy: string;
  approvedVersions: ApprovedVersionSnapshot[];
  submittedAt?: number;
  submittedBy?: string;
  reviewerUserId?: string;
  approvedAt?: number;
  approvedBy?: string;
}

/** Parse the jsonb record column; malformed content reads as uncontrolled
 * (the projection stance the item view takes). */
export function parseControlledRecord(
  raw: Record<string, unknown> | null,
): ControlledRecord | null {
  if (raw === null) return null;
  const state = raw.state;
  const version = raw.version;
  if (
    (state !== 'draft' && state !== 'in_review' && state !== 'approved') ||
    typeof version !== 'number'
  ) {
    return null;
  }
  const approvedVersions: ApprovedVersionSnapshot[] = [];
  if (Array.isArray(raw.approvedVersions)) {
    for (const entry of raw.approvedVersions as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const candidate: Record<string, unknown> = { ...entry };
      if (
        typeof candidate.version !== 'number' ||
        typeof candidate.fileId !== 'string'
      ) {
        continue;
      }
      approvedVersions.push({
        version: candidate.version,
        fileId: candidate.fileId,
        ...(typeof candidate.contentHash === 'string'
          ? { contentHash: candidate.contentHash }
          : {}),
        ...(typeof candidate.sha256 === 'string'
          ? { sha256: candidate.sha256 }
          : {}),
        ...(typeof candidate.size === 'number' ? { size: candidate.size } : {}),
        approvedAt:
          typeof candidate.approvedAt === 'number' ? candidate.approvedAt : 0,
        approvedBy:
          typeof candidate.approvedBy === 'string' ? candidate.approvedBy : '',
      });
    }
  }
  const record: ControlledRecord = {
    state,
    version,
    controlledAt: typeof raw.controlledAt === 'number' ? raw.controlledAt : 0,
    controlledBy: typeof raw.controlledBy === 'string' ? raw.controlledBy : '',
    approvedVersions,
  };
  if (typeof raw.submittedAt === 'number') record.submittedAt = raw.submittedAt;
  if (typeof raw.submittedBy === 'string') record.submittedBy = raw.submittedBy;
  if (typeof raw.reviewerUserId === 'string') {
    record.reviewerUserId = raw.reviewerUserId;
  }
  if (typeof raw.approvedAt === 'number') record.approvedAt = raw.approvedAt;
  if (typeof raw.approvedBy === 'string') record.approvedBy = raw.approvedBy;
  return record;
}

function requireControlledRecord(doc: DocumentRow): ControlledRecord {
  const record = parseControlledRecord(doc.record);
  if (record === null) {
    throw new DocumentError(
      'DOCUMENT_NOT_CONTROLLED',
      'This document is not a controlled record.',
    );
  }
  return record;
}

/** The document-write standard (public updateDocument): org-role write
 * matrix, visible, + project canEdit for project files. */
async function requireDocumentWriteAccess(
  db: Sql | TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<DocumentRow> {
  assertDocumentsWriteRole(auth);
  const doc = await loadDocumentOrThrow(db, documentId);
  await assertDocumentVisible(db, auth, doc);
  if (doc.projectId !== null) {
    const project = await loadProjectOrThrow(db, doc.projectId);
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      auth.teamIds,
      auth.role,
    );
    if (!access.canEdit) {
      throw new DocumentError('PROJECT_FORBIDDEN', 'No project access', 403);
    }
  }
  return doc;
}

async function writeRecord(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  doc: DocumentRow,
  record: ControlledRecord,
): Promise<void> {
  await tx`
    UPDATE app.documents SET record = ${tx.json(toJson(record))},
      updated_at_ms = ${Date.now()}
    WHERE id = ${doc.id}
  `;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'document',
    entityId: doc.id,
  });
}

async function auditRecordTransition(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  doc: DocumentRow,
  args: {
    action: string;
    previousState: Record<string, unknown>;
    newState: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    actorEmail: auth.email ?? '',
    actorType: 'user',
    action: args.action,
    category: 'data',
    resourceType: 'document',
    resourceId: doc.id,
    ...(doc.title !== null ? { resourceName: doc.title } : {}),
    previousState: args.previousState,
    newState: args.newState,
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    status: 'success',
  });
}

// ---------------------------------------------------------------------------
// Eligibility (the shared reviewer predicate)
// ---------------------------------------------------------------------------

interface MemberAccessRow {
  userId: string;
  role: string;
}

async function memberRole(
  db: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db<MemberAccessRow[]>`
    SELECT "userId", role FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  return rows[0]?.role ?? null;
}

async function userTeamIds(
  db: Sql | TransactionSql,
  userId: string,
): Promise<string[]> {
  const rows = await db<{ teamId: string }[]>`
    SELECT "teamId" FROM "teamMember" WHERE "userId" = ${userId}
  `;
  return rows.map((row) => row.teamId);
}

/**
 * Whether `userId` could RESPOND to a review on this document — the single
 * rule behind the submit designee gate AND the reviewer picker: a
 * write-capable role (responding transitions the record, and
 * `respondToDocumentRecordReview` enforces the same matrix — a designee who
 * could never respond would strand the review) who can see the document
 * (team scope), with edit access to the owning project for project files.
 */
export async function isEligibleDocumentReviewer(
  db: Sql | TransactionSql,
  doc: DocumentRow,
  userId: string,
): Promise<boolean> {
  const role = await memberRole(db, doc.organizationId, userId);
  if (role === null || !authorizeRls(role, 'documents', 'write')) return false;
  const teamIds = await userTeamIds(db, userId);
  if (doc.projectId !== null) {
    const project = await loadProjectOrThrow(db, doc.projectId);
    const access = checkProjectAccess(
      { teamId: project.teamId, sharedWithTeamIds: project.sharedWithTeamIds },
      teamIds,
      role,
    );
    return access.canEdit;
  }
  return hasKnowledgeHubDocumentAccess(doc, teamIds);
}

/** The picker's server-derived option set (caller needs read access; the
 * document routes' auth context already carries membership). */
export async function listEligibleDocumentReviewerIds(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<string[]> {
  let doc: DocumentRow;
  try {
    doc = await loadDocumentOrThrow(sql, documentId);
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[records] eligible-reviewers access refused', error);
    return [];
  }
  const members = await sql<MemberAccessRow[]>`
    SELECT "userId", role FROM "member"
    WHERE "organizationId" = ${auth.organizationId}
    LIMIT ${REVIEWER_SCAN_CAP}
  `;
  const eligible: string[] = [];
  for (const member of members) {
    if (member.role.toLowerCase() === 'disabled') continue;
    if (await isEligibleDocumentReviewer(sql, doc, member.userId)) {
      eligible.push(member.userId);
    }
  }
  return eligible;
}

// ---------------------------------------------------------------------------
// Bells (transactional with the transitions; preference gate skipped by
// design — a review designation is a human-in-the-loop safety signal)
// ---------------------------------------------------------------------------

function feedbackExcerpt(feedback: string): string {
  return feedback.length > FEEDBACK_EXCERPT_MAX
    ? `${feedback.slice(0, FEEDBACK_EXCERPT_MAX)}…`
    : feedback;
}

function documentReviewParams(
  doc: DocumentRow,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    documentId: doc.id,
    documentTitle: doc.title ?? 'Untitled',
    ...(doc.projectId !== null ? { projectId: doc.projectId } : {}),
    ...(doc.folderId !== null ? { folderId: doc.folderId } : {}),
    ...extra,
  };
}

async function notifyDocumentReviewRequested(
  tx: TransactionSql,
  doc: DocumentRow,
  args: {
    version: number;
    reviewerUserId: string;
    approvalId: string;
    requestedByUserId: string;
    requestedByName?: string;
  },
): Promise<void> {
  if (args.reviewerUserId === args.requestedByUserId) return;
  await writeCoalescedNotification(tx, {
    userId: args.reviewerUserId,
    organizationId: doc.organizationId,
    type: 'document_review_requested',
    titleKey: 'documentReviewRequested',
    bodyKey: args.requestedByName
      ? 'documentReviewRequestedBody'
      : 'documentReviewRequestedBodyNoActor',
    params: documentReviewParams(doc, {
      approvalId: args.approvalId,
      version: args.version,
      ...(args.requestedByName
        ? { requestedByName: args.requestedByName }
        : {}),
    }),
    resourceType: 'document_review',
    resourceId: args.approvalId,
    actorType: 'user',
    actorId: args.requestedByUserId,
  });
}

async function notifyDocumentReviewResolved(
  tx: TransactionSql,
  doc: DocumentRow,
  args: {
    version: number;
    decision: 'approve' | 'request_changes';
    decidedByUserId: string;
    decidedByName?: string;
    recipientUserId: string;
    feedback?: string;
  },
): Promise<void> {
  if (args.recipientUserId === args.decidedByUserId) return;
  const approved = args.decision === 'approve';
  await writeCoalescedNotification(tx, {
    userId: args.recipientUserId,
    organizationId: doc.organizationId,
    type: 'document_review_resolved',
    titleKey: approved
      ? 'documentReviewApproved'
      : 'documentReviewChangesRequested',
    bodyKey: approved
      ? 'documentReviewApprovedBody'
      : 'documentReviewChangesRequestedBody',
    params: documentReviewParams(doc, {
      version: args.version,
      ...(args.decidedByName ? { decidedByName: args.decidedByName } : {}),
      ...(args.feedback !== undefined && !approved
        ? { feedback: feedbackExcerpt(args.feedback) }
        : {}),
    }),
    resourceType: 'document',
    resourceId: doc.id,
    actorType: 'user',
    actorId: args.decidedByUserId,
  });
}

/** Mark a reviewer's pending request bell read once its approval resolves
 * or is superseded (the recipient is known — one user's unread rows). */
async function dismissDocumentReviewRequestNotifications(
  tx: TransactionSql,
  args: {
    organizationId: string;
    approvalId: string;
    reviewerUserId: string;
  },
): Promise<void> {
  const updated = await tx<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE user_id = ${args.reviewerUserId}
      AND org_id = ${args.organizationId}
      AND read = false
      AND type = 'document_review_requested'
      AND resource_id = ${args.approvalId}
    RETURNING id
  `;
  if (updated.length > 0) {
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      userId: args.reviewerUserId,
      entity: 'user_notification',
      entityId: null,
    });
  }
}

async function userName(
  db: Sql | TransactionSql,
  userId: string,
): Promise<string | undefined> {
  const rows = await db<{ name: string | null }[]>`
    SELECT name FROM "user" WHERE id = ${userId} LIMIT 1
  `;
  const name = rows[0]?.name;
  return name === null || name === undefined || name === '' ? undefined : name;
}

// ---------------------------------------------------------------------------
// Approval-row plumbing
// ---------------------------------------------------------------------------

interface RecordApprovalRow {
  id: string;
  organizationId: string;
  status: string;
  reviewedAt: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

const RECORD_APPROVAL_COLUMNS = `
  id, org_id AS "organizationId", status,
  reviewed_at_ms::float8 AS "reviewedAt", metadata,
  created_at_ms::float8 AS "createdAt"
`;

/** The record version a review approval was minted for; malformed metadata
 * reads as -1 (never matches a real version). */
function approvalRecordVersion(approval: RecordApprovalRow): number {
  const version = approval.metadata?.version;
  return typeof version === 'number' ? version : -1;
}

async function listRecordApprovals(
  db: Sql | TransactionSql,
  documentId: string,
  status?: string,
): Promise<RecordApprovalRow[]> {
  return db<RecordApprovalRow[]>`
    SELECT ${db.unsafe(RECORD_APPROVAL_COLUMNS)} FROM app.approvals
    WHERE resource_type = 'document_record_review'
      AND resource_id = ${documentId}
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
    ORDER BY seq DESC
  `;
}

// ---------------------------------------------------------------------------
// The lifecycle mutations
// ---------------------------------------------------------------------------

/** Opt a document into the controlled-record lifecycle (one-way in v1). */
export async function markControlled(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<void> {
  const doc = await requireDocumentWriteAccess(tx, auth, documentId);
  if ((doc.lifecycleStatus ?? 'active') !== 'active') {
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
  }
  if (parseControlledRecord(doc.record) !== null) {
    throw new DocumentError(
      'DOCUMENT_ALREADY_CONTROLLED',
      'This document is already a controlled record.',
    );
  }
  const sourceProvider = doc.sourceProvider ?? 'upload';
  if (!CONTROLLABLE_SOURCE_PROVIDERS.has(sourceProvider)) {
    throw new DocumentError(
      'DOCUMENT_RECORD_SOURCE_UNSUPPORTED',
      `A "${sourceProvider}" document is owned by its external sync and cannot become a controlled record.`,
      400,
      { sourceProvider },
    );
  }
  if (doc.fileRef === null) {
    throw new DocumentError(
      'DOCUMENT_RECORD_NEEDS_FILE',
      'Only file-backed documents can become controlled records (approval snapshots the file).',
    );
  }
  const now = Date.now();
  await writeRecord(tx, auth, doc, {
    state: 'draft',
    version: 1,
    controlledAt: now,
    controlledBy: auth.userId,
    approvedVersions: [],
  });
  await auditRecordTransition(tx, auth, doc, {
    action: RECORD_AUDIT_ACTIONS.controlled,
    previousState: { record: null },
    newState: { state: 'draft', version: 1 },
  });
}

/**
 * draft → in_review: freeze and mint the review approval for a NAMED human
 * reviewer. Idempotent per (document, version): a live pending row returns
 * as-is; a fresh mint supersedes every older pending row.
 */
export async function submitRecordForReview(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { documentId: string; reviewerUserId: string },
): Promise<{ approvalId: string }> {
  const doc = await requireDocumentWriteAccess(tx, auth, args.documentId);
  const record = requireControlledRecord(doc);
  if (record.state === 'approved') {
    throw new DocumentError(
      'DOCUMENT_RECORD_INVALID_STATE',
      'This record is approved. Open a new revision before submitting for review.',
      400,
      { state: record.state },
    );
  }
  // The designee must be able to RESPOND — the picker filters, the server
  // is the authority (fails closed).
  if (!(await isEligibleDocumentReviewer(tx, doc, args.reviewerUserId))) {
    throw new DocumentError('REVIEWER_NOT_ELIGIBLE', 'Reviewer not eligible');
  }

  const prior = await listRecordApprovals(tx, doc.id);
  if (record.state === 'in_review') {
    const pending = prior.find(
      (approval) =>
        approval.status === 'pending' &&
        approvalRecordVersion(approval) === record.version,
    );
    if (pending) {
      return { approvalId: pending.id };
    }
  }

  const now = Date.now();
  const metadata = {
    documentId: doc.id,
    version: record.version,
    requestedFor: args.reviewerUserId,
    requestedBy: auth.userId,
  };
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.approvals (
      org_id, resource_type, resource_id, priority, status, metadata,
      created_at_ms
    ) VALUES (
      ${doc.organizationId}, 'document_record_review', ${doc.id}, 'high',
      'pending', ${tx.json(toJson(metadata))}, ${now}
    ) RETURNING id
  `;
  const approvalId = inserted[0]?.id;
  if (approvalId === undefined) {
    throw new DocumentError('REVIEW_MINT_FAILED', 'Approval insert failed');
  }

  // One actionable review per document — newest submission wins; the
  // superseded reviewer's request bell goes with it.
  for (const stale of prior) {
    if (stale.status !== 'pending') continue;
    await tx`
      UPDATE app.approvals SET
        status = 'rejected', reviewed_at_ms = ${now},
        metadata = ${tx.json(toJson({ ...stale.metadata, supersededBy: approvalId }))}
      WHERE id = ${stale.id}
    `;
    const staleReviewer = stale.metadata?.requestedFor;
    if (typeof staleReviewer === 'string') {
      await dismissDocumentReviewRequestNotifications(tx, {
        organizationId: doc.organizationId,
        approvalId: stale.id,
        reviewerUserId: staleReviewer,
      });
    }
  }

  await writeRecord(tx, auth, doc, {
    ...record,
    state: 'in_review',
    submittedAt: now,
    submittedBy: auth.userId,
    reviewerUserId: args.reviewerUserId,
  });
  await auditRecordTransition(tx, auth, doc, {
    action: RECORD_AUDIT_ACTIONS.submitted,
    previousState: { state: record.state, version: record.version },
    newState: { state: 'in_review', version: record.version },
    metadata: { approvalId, reviewerUserId: args.reviewerUserId },
  });
  await notifyDocumentReviewRequested(tx, doc, {
    version: record.version,
    reviewerUserId: args.reviewerUserId,
    approvalId,
    requestedByUserId: auth.userId,
    requestedByName: await userName(tx, auth.userId),
  });
  return { approvalId };
}

/**
 * The review decision. Approve snapshots the CURRENT blob into
 * `approvedVersions` (size from `file_metadata`; contentHash from the row)
 * and retains it on `history_files`; request-changes REQUIRES feedback and
 * returns the record to draft.
 */
export async function respondToDocumentRecordReview(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    approvalId: string;
    decision: 'approve' | 'request_changes';
    feedback?: string;
  },
): Promise<{ state: 'approved' | 'draft'; version: number }> {
  const approvals = await tx<(RecordApprovalRow & { resourceId: string })[]>`
    SELECT ${tx.unsafe(RECORD_APPROVAL_COLUMNS)}, resource_id AS "resourceId"
    FROM app.approvals
    WHERE id = ${args.approvalId}
      AND resource_type = 'document_record_review'
    LIMIT 1
  `;
  const approval = approvals[0];
  if (!approval) {
    throw new DocumentError('REVIEW_NOT_FOUND', 'Review not found', 404);
  }
  if (approval.status !== 'pending') {
    throw new DocumentError('REVIEW_ALREADY_RESOLVED', 'Already resolved');
  }
  const feedback = args.feedback?.trim() || undefined;
  if (args.decision === 'request_changes' && feedback === undefined) {
    throw new DocumentError('REVIEW_FEEDBACK_REQUIRED', 'Feedback required');
  }
  if (
    feedback !== undefined &&
    feedback.length > DOCUMENT_RECORD_FEEDBACK_MAX
  ) {
    throw new DocumentError('REVIEW_FEEDBACK_TOO_LONG', 'Feedback too long');
  }

  const doc = await requireDocumentWriteAccess(tx, auth, approval.resourceId);
  if (doc.organizationId !== approval.organizationId) {
    throw new DocumentError('REVIEW_NOT_FOUND', 'Review not found', 404);
  }
  const record = requireControlledRecord(doc);
  if (
    record.state !== 'in_review' ||
    approvalRecordVersion(approval) !== record.version
  ) {
    throw new DocumentError(
      'DOCUMENT_RECORD_INVALID_STATE',
      'This review no longer matches the record state.',
      400,
      { state: record.state },
    );
  }

  const now = Date.now();
  const response = {
    decision: args.decision,
    respondedBy: auth.userId,
    timestamp: now,
    ...(feedback !== undefined ? { feedback } : {}),
  };
  const metadata = approval.metadata ?? {};
  await tx`
    UPDATE app.approvals SET
      status = 'completed', approved_by = ${auth.userId},
      reviewed_at_ms = ${now},
      metadata = ${tx.json(toJson({ ...metadata, response }))}
    WHERE id = ${args.approvalId}
  `;

  let nextState: 'approved' | 'draft';
  let snapshot: ApprovedVersionSnapshot | undefined;
  if (args.decision === 'approve') {
    if (
      record.approvedVersions.length >= DOCUMENT_RECORD_MAX_APPROVED_VERSIONS
    ) {
      throw new DocumentError(
        'DOCUMENT_RECORD_VERSION_LIMIT',
        `This record already holds ${DOCUMENT_RECORD_MAX_APPROVED_VERSIONS} approved versions — the platform cap. Export and re-create the document to continue.`,
        400,
        { limit: DOCUMENT_RECORD_MAX_APPROVED_VERSIONS },
      );
    }
    if (doc.fileRef === null) {
      throw new DocumentError(
        'DOCUMENT_RECORD_NEEDS_FILE',
        'This record has no backing file to approve.',
      );
    }
    const metas = await tx<{ size: number }[]>`
      SELECT size FROM app.file_metadata
      WHERE org_id = ${doc.organizationId} AND storage_ref = ${doc.fileRef}
      LIMIT 1
    `;
    snapshot = {
      version: record.version,
      fileId: doc.fileRef,
      ...(doc.contentHash !== null ? { contentHash: doc.contentHash } : {}),
      ...(metas[0] !== undefined ? { size: metas[0].size } : {}),
      approvedAt: now,
      approvedBy: auth.userId,
    };
    // Retain the approved blob on the row's own history so the version list
    // keeps serving it and delete-time erasure keeps covering it.
    if (!doc.historyFiles.includes(doc.fileRef)) {
      await tx`
        UPDATE app.documents
        SET history_files = history_files || ${[doc.fileRef]}
        WHERE id = ${doc.id}
      `;
    }
    await writeRecord(tx, auth, doc, {
      ...record,
      state: 'approved',
      approvedAt: now,
      approvedBy: auth.userId,
      approvedVersions: [...record.approvedVersions, snapshot],
    });
    nextState = 'approved';
  } else {
    await writeRecord(tx, auth, doc, { ...record, state: 'draft' });
    nextState = 'draft';
  }

  await auditRecordTransition(tx, auth, doc, {
    action: RECORD_AUDIT_ACTIONS.reviewResponded,
    previousState: { state: 'in_review', version: record.version },
    newState: { state: nextState, version: record.version },
    metadata: {
      approvalId: args.approvalId,
      decision: args.decision,
      feedbackProvided: feedback !== undefined,
      ...(snapshot !== undefined
        ? {
            snapshot: {
              fileId: snapshot.fileId,
              ...(snapshot.contentHash !== undefined
                ? { contentHash: snapshot.contentHash }
                : {}),
            },
          }
        : {}),
    },
  });

  const requestedFor =
    typeof metadata.requestedFor === 'string'
      ? metadata.requestedFor
      : record.reviewerUserId;
  if (requestedFor !== undefined) {
    await dismissDocumentReviewRequestNotifications(tx, {
      organizationId: doc.organizationId,
      approvalId: args.approvalId,
      reviewerUserId: requestedFor,
    });
  }
  const submitter =
    typeof metadata.requestedBy === 'string'
      ? metadata.requestedBy
      : record.submittedBy;
  if (submitter !== undefined) {
    await notifyDocumentReviewResolved(tx, doc, {
      version: record.version,
      decision: args.decision,
      decidedByUserId: auth.userId,
      decidedByName: await userName(tx, auth.userId),
      recipientUserId: submitter,
      ...(feedback !== undefined ? { feedback } : {}),
    });
  }
  return { state: nextState, version: record.version };
}

/** approved → draft with the next monotonic version; the approved snapshot
 * stays addressable in `approvedVersions` (and its blob in history). */
export async function openRecordRevision(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<{ version: number }> {
  const doc = await requireDocumentWriteAccess(tx, auth, documentId);
  const record = requireControlledRecord(doc);
  if (record.state !== 'approved') {
    throw new DocumentError(
      'DOCUMENT_RECORD_INVALID_STATE',
      'Only an approved record can open a new revision.',
      400,
      { state: record.state },
    );
  }
  const nextVersion = record.version + 1;
  await writeRecord(tx, auth, doc, {
    ...record,
    state: 'draft',
    version: nextVersion,
  });
  await auditRecordTransition(tx, auth, doc, {
    action: RECORD_AUDIT_ACTIONS.revisionOpened,
    previousState: { state: 'approved', version: record.version },
    newState: { state: 'draft', version: nextVersion },
  });
  return { version: nextVersion };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface PendingDocumentRecordReview {
  approvalId: string;
  version: number;
  requestedFor: string | null;
  requestedBy: string | null;
  requestedAt: number;
}

/** The live pending review for a document record (badge → respond join). */
export async function getPendingDocumentRecordReview(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<PendingDocumentRecordReview | null> {
  let doc: DocumentRow;
  try {
    doc = await loadDocumentOrThrow(sql, documentId);
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[records] pending-review access refused', error);
    return null;
  }
  const record = parseControlledRecord(doc.record);
  if (record === null || record.state !== 'in_review') return null;
  const pending = await listRecordApprovals(sql, doc.id, 'pending');
  for (const approval of pending) {
    if (approvalRecordVersion(approval) !== record.version) continue;
    const meta = approval.metadata ?? {};
    return {
      approvalId: approval.id,
      version: record.version,
      requestedFor:
        typeof meta.requestedFor === 'string' ? meta.requestedFor : null,
      requestedBy:
        typeof meta.requestedBy === 'string' ? meta.requestedBy : null,
      requestedAt: approval.createdAt,
    };
  }
  return null;
}

export interface LastDocumentRecordReview {
  decision: 'approve' | 'request_changes';
  feedback?: string;
  respondedBy: string;
  respondedByName?: string;
  respondedAt: number;
  version: number;
}

/** The latest completed review decision (the re-submit callout). */
export async function getLastDocumentRecordReview(
  sql: Sql,
  auth: ProjectAuthContext,
  documentId: string,
): Promise<LastDocumentRecordReview | null> {
  let doc: DocumentRow;
  try {
    doc = await loadDocumentOrThrow(sql, documentId);
    await assertDocumentVisible(sql, auth, doc);
  } catch (error) {
    console.warn('[records] last-review access refused', error);
    return null;
  }
  const completed = await listRecordApprovals(sql, doc.id, 'completed');
  let latest: Omit<LastDocumentRecordReview, 'respondedByName'> | null = null;
  for (const approval of completed) {
    const meta = approval.metadata ?? {};
    const response = meta.response;
    if (response === null || typeof response !== 'object') continue;
    const decision = (response as { decision?: unknown }).decision;
    if (decision !== 'approve' && decision !== 'request_changes') continue;
    const timestamp = (response as { timestamp?: unknown }).timestamp;
    const respondedAt =
      typeof timestamp === 'number'
        ? timestamp
        : (approval.reviewedAt ?? approval.createdAt);
    if (latest !== null && respondedAt <= latest.respondedAt) continue;
    const feedbackValue = (response as { feedback?: unknown }).feedback;
    const respondedByValue = (response as { respondedBy?: unknown })
      .respondedBy;
    latest = {
      decision,
      ...(typeof feedbackValue === 'string' ? { feedback: feedbackValue } : {}),
      respondedBy: typeof respondedByValue === 'string' ? respondedByValue : '',
      respondedAt,
      version: approvalRecordVersion(approval),
    };
  }
  if (latest === null) return null;
  const respondedByName =
    latest.respondedBy === ''
      ? undefined
      : await userName(sql, latest.respondedBy);
  return {
    ...latest,
    ...(respondedByName !== undefined ? { respondedByName } : {}),
  };
}
