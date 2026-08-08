/**
 * Controlled records — the opt-in document lifecycle (phase 5).
 *
 * A document promoted via `markControlled` gains a `record` field and walks
 * draft → in_review (frozen) → approved (immutable), reviewed by a NAMED
 * human through a `document_record_review` approval row (the task-review
 * mint conventions: idempotent per (document, version), a fresh mint
 * supersedes any older pending row). Approving snapshots the exact blob
 * into `record.approvedVersions` — the immutably-addressable supersede
 * chain — and `openRecordRevision` starts the next monotonic version.
 *
 * Documents that never opt in carry no `record` and behave exactly as
 * before; the content freeze itself lives in `access.ts`
 * (`assertRecordContentWritable` / `assertRecordTrashable`) and is wired
 * into every content write path.
 */

import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type { AuthenticatedUser } from '../lib/rls/types';
import { convexStorageId } from '../lib/storage/blob_ref';
import {
  resolveProjectAccessForUser,
  resolveUserAccessContext,
} from '../projects/resolve_project_access';
import {
  canReadDocument,
  checkProjectDocumentAccess,
  isProjectScopedDocument,
} from './access';

/** Supersede-chain cap: refusing the 201st approval beats an unbounded
 * array in a 1 MB Convex row. */
export const DOCUMENT_RECORD_MAX_APPROVED_VERSIONS = 200;

/** Only user- and agent-authored documents can become controlled records —
 * a connector/sync-owned row is rewritten by its external loop, which a
 * frozen record would fight. `undefined` reads as `upload` (legacy rows),
 * matching `transformToDocumentItem`. */
export const CONTROLLABLE_SOURCE_PROVIDERS: ReadonlySet<string> = new Set([
  'upload',
  'agent',
]);

export const DOCUMENT_RECORD_FEEDBACK_MAX = 4000;

export const DOCUMENT_RECORD_AUDIT_ACTIONS = {
  controlled: 'document.record_controlled',
  submitted: 'document.record_submitted',
  reviewResponded: 'document.record_review_responded',
  revisionOpened: 'document.record_revision_opened',
  deleted: 'document.record_deleted',
} as const;

const DOCUMENT_RESOURCE_TYPE = 'document';

type ControlledRecord = NonNullable<Doc<'documents'>['record']>;

/** The record version a review approval was minted for; malformed metadata
 * reads as -1 (never matches a real version). Exported for tests. */
export function approvalRecordVersion(
  approval: Pick<Doc<'approvals'>, 'metadata'>,
): number {
  const metadata: unknown = approval.metadata;
  if (!isRecord(metadata)) return -1;
  return typeof metadata.version === 'number' ? metadata.version : -1;
}

/**
 * The caller's document-write permission — the exact standard of the public
 * `updateDocument` mutation: authenticated org member, plus edit access to
 * the owning project for project-scoped documents.
 */
async function requireDocumentWriteAccess(
  ctx: MutationCtx,
  documentId: Id<'documents'>,
): Promise<{
  document: Doc<'documents'>;
  authUser: AuthenticatedUser;
  userId: string;
}> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({ code: 'UNAUTHENTICATED' });
  }

  const document = await ctx.db.get(documentId);
  if (!document) {
    throw new ConvexError({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
    });
  }

  const member = await getOrganizationMember(
    ctx,
    document.organizationId,
    authUser,
  );

  if (isProjectScopedDocument(document)) {
    const access = await checkProjectDocumentAccess(ctx, document, {
      userId: member.userId,
      organizationId: document.organizationId,
    });
    if (!access?.canEdit) {
      throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
    }
  }

  return { document, authUser, userId: member.userId };
}

function requireControlledRecord(doc: Doc<'documents'>): ControlledRecord {
  if (doc.record === undefined) {
    throw new ConvexError({
      code: 'DOCUMENT_NOT_CONTROLLED',
      message: 'This document is not a controlled record.',
    });
  }
  return doc.record;
}

/**
 * Audit the deletion of a controlled record that the trash guard allows —
 * a never-approved draft. The guard keeps every record with approved
 * history undeletable, so this entry closes the remaining silence: opting a
 * document into the lifecycle and then dropping it leaves a trail, the same
 * way every other transition does. Deleting an UNCONTROLLED document stays
 * unaudited, exactly as before.
 */
export async function auditControlledRecordDeletion(
  ctx: MutationCtx,
  args: {
    document: Doc<'documents'>;
    authUser: AuthenticatedUser;
    userId: string;
  },
): Promise<void> {
  const record = args.document.record;
  if (record === undefined) return;
  await auditRecordTransition(ctx, {
    document: args.document,
    authUser: args.authUser,
    userId: args.userId,
    action: DOCUMENT_RECORD_AUDIT_ACTIONS.deleted,
    previousState: { state: record.state, version: record.version },
    newState: { state: 'deleted' },
    metadata: {
      version: record.version,
      approvedVersionCount: record.approvedVersions.length,
    },
  });
}

async function auditRecordTransition(
  ctx: MutationCtx,
  args: {
    document: Doc<'documents'>;
    authUser: AuthenticatedUser;
    userId: string;
    action: string;
    previousState: Record<string, unknown>;
    newState: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(ctx, {
    organizationId: args.document.organizationId,
    actorId: args.userId,
    actorEmail: args.authUser.email,
    actorType: 'user',
    action: args.action,
    category: 'data',
    resourceType: DOCUMENT_RESOURCE_TYPE,
    resourceId: String(args.document._id),
    resourceName: args.document.title,
    previousState: args.previousState,
    newState: args.newState,
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    status: 'success',
  });
}

/**
 * Opt a document into the controlled-record lifecycle. Explicit, one-way in
 * v1 (no "uncontrol" — the record trail must not be discardable in place);
 * refuses connector/sync-owned sources and documents without a backing blob
 * (an approved version must be a snapshot-addressable file).
 */
export const markControlled = mutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { document, authUser, userId } = await requireDocumentWriteAccess(
      ctx,
      args.documentId,
    );

    if ((document.lifecycleStatus ?? 'active') !== 'active') {
      throw new ConvexError({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found',
      });
    }
    if (document.record !== undefined) {
      throw new ConvexError({
        code: 'DOCUMENT_ALREADY_CONTROLLED',
        message: 'This document is already a controlled record.',
      });
    }
    const sourceProvider = document.sourceProvider ?? 'upload';
    if (!CONTROLLABLE_SOURCE_PROVIDERS.has(sourceProvider)) {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_SOURCE_UNSUPPORTED',
        message: `A "${sourceProvider}" document is owned by its external sync and cannot become a controlled record.`,
        sourceProvider,
      });
    }
    if (document.fileId === undefined) {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_NEEDS_FILE',
        message:
          'Only file-backed documents can become controlled records (approval snapshots the file).',
      });
    }

    const now = Date.now();
    await ctx.db.patch(document._id, {
      record: {
        state: 'draft',
        version: 1,
        controlledAt: now,
        controlledBy: userId,
        approvedVersions: [],
      },
    });

    await auditRecordTransition(ctx, {
      document,
      authUser,
      userId,
      action: DOCUMENT_RECORD_AUDIT_ACTIONS.controlled,
      previousState: { record: null },
      newState: { state: 'draft', version: 1 },
    });

    return null;
  },
});

/**
 * draft → in_review: freeze the content and mint the review approval for a
 * NAMED human reviewer (task_review mint conventions — idempotent per
 * (documentId, version): a pending row for this version is returned as-is;
 * a fresh mint supersedes any older pending row via `rejected` +
 * `metadata.supersededBy`).
 */
export const submitRecordForReview = mutation({
  args: {
    documentId: v.id('documents'),
    reviewerUserId: v.string(),
  },
  returns: v.object({ approvalId: v.id('approvals') }),
  handler: async (ctx, args): Promise<{ approvalId: Id<'approvals'> }> => {
    const { document, authUser, userId } = await requireDocumentWriteAccess(
      ctx,
      args.documentId,
    );
    const record = requireControlledRecord(document);

    if (record.state === 'approved') {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_INVALID_STATE',
        message:
          'This record is approved. Open a new revision before submitting for review.',
        state: record.state,
      });
    }

    // The designee must be able to RESPOND: a non-disabled org member, with
    // edit access to the owning project for project files. The picker
    // filters, but the server is the authority (fails closed).
    if (isProjectScopedDocument(document) && document.projectId) {
      const designeeAccess = await resolveProjectAccessForUser(
        ctx,
        document.projectId,
        {
          userId: args.reviewerUserId,
          organizationId: document.organizationId,
        },
      );
      if (!designeeAccess.canEdit) {
        throw new ConvexError({ code: 'REVIEWER_NOT_ELIGIBLE' });
      }
    } else {
      const designee = await resolveUserAccessContext(
        ctx,
        document.organizationId,
        args.reviewerUserId,
      );
      if (designee === null || designee.role === 'disabled') {
        throw new ConvexError({ code: 'REVIEWER_NOT_ELIGIBLE' });
      }
    }

    const prior: Doc<'approvals'>[] = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'document_record_review')
          .eq('resourceId', String(document._id)),
      )) {
      prior.push(approval);
    }

    // Idempotent replay: an in_review record with a live pending row for
    // this version returns that row instead of minting a duplicate.
    if (record.state === 'in_review') {
      const pending = prior.find(
        (approval) =>
          approval.status === 'pending' &&
          approvalRecordVersion(approval) === record.version,
      );
      if (pending) {
        return { approvalId: pending._id };
      }
      // No live pending row (e.g. superseded out-of-band): fall through and
      // mint a fresh one for the SAME version — self-healing re-submit.
    }

    const now = Date.now();
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: document.organizationId,
      resourceType: 'document_record_review',
      resourceId: String(document._id),
      priority: 'high',
      status: 'pending',
      metadata: {
        documentId: String(document._id),
        version: record.version,
        requestedFor: args.reviewerUserId,
        requestedBy: userId,
      },
    });

    // One actionable review per document — newest submission wins.
    for (const stale of prior) {
      if (stale.status !== 'pending') continue;
      await ctx.db.patch(stale._id, {
        status: 'rejected',
        reviewedAt: now,
        metadata: {
          ...(isRecord(stale.metadata) ? stale.metadata : {}),
          supersededBy: approvalId,
        },
      });
    }

    await ctx.db.patch(document._id, {
      record: {
        ...record,
        state: 'in_review',
        submittedAt: now,
        submittedBy: userId,
        reviewerUserId: args.reviewerUserId,
      },
    });

    await auditRecordTransition(ctx, {
      document,
      authUser,
      userId,
      action: DOCUMENT_RECORD_AUDIT_ACTIONS.submitted,
      previousState: { state: record.state, version: record.version },
      newState: { state: 'in_review', version: record.version },
      metadata: {
        approvalId: String(approvalId),
        reviewerUserId: args.reviewerUserId,
      },
    });

    return { approvalId };
  },
});

/**
 * The review decision — Approve / Request changes, mirroring
 * `respondToTaskReview`'s permission standard (org member + document-write
 * access; the named reviewer is a soft designation, not an exclusive ACL).
 *
 * Approve snapshots the CURRENT blob into `approvedVersions` (sha256/size
 * from `_storage` system metadata for Convex blobs, `contentHash` from the
 * row otherwise) and flips the record to `approved`. Request-changes
 * REQUIRES feedback and returns the record to `draft` for rework.
 *
 * NOTE (follow-up, deliberate): the org's `review_policy` governance file
 * (independent reviewer / required competences) is enforced for TASK reviews
 * only in v1 — wiring it here is a named follow-up, not an oversight.
 */
export const respondToDocumentRecordReview = mutation({
  args: {
    approvalId: v.id('approvals'),
    decision: v.union(v.literal('approve'), v.literal('request_changes')),
    feedback: v.optional(v.string()),
  },
  returns: v.object({
    state: v.union(v.literal('approved'), v.literal('draft')),
    version: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ state: 'approved' | 'draft'; version: number }> => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.resourceType !== 'document_record_review') {
      throw new ConvexError({ code: 'REVIEW_NOT_FOUND' });
    }
    if (approval.status !== 'pending') {
      throw new ConvexError({ code: 'REVIEW_ALREADY_RESOLVED' });
    }
    const feedback = args.feedback?.trim() || undefined;
    if (args.decision === 'request_changes' && !feedback) {
      throw new ConvexError({ code: 'REVIEW_FEEDBACK_REQUIRED' });
    }
    if (
      feedback !== undefined &&
      feedback.length > DOCUMENT_RECORD_FEEDBACK_MAX
    ) {
      throw new ConvexError({ code: 'REVIEW_FEEDBACK_TOO_LONG' });
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- document_record_review approvals store String(documentId) as resourceId
    const documentId = approval.resourceId as Id<'documents'>;
    const { document, authUser, userId } = await requireDocumentWriteAccess(
      ctx,
      documentId,
    );
    if (document.organizationId !== approval.organizationId) {
      throw new ConvexError({ code: 'REVIEW_NOT_FOUND' });
    }
    const record = requireControlledRecord(document);
    if (
      record.state !== 'in_review' ||
      approvalRecordVersion(approval) !== record.version
    ) {
      // The record moved on (superseded submission); the row is stale.
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_INVALID_STATE',
        message: 'This review no longer matches the record state.',
        state: record.state,
      });
    }

    const now = Date.now();
    const response = {
      decision: args.decision,
      respondedBy: userId,
      timestamp: now,
      ...(feedback ? { feedback } : {}),
    };
    const existingMetadata: unknown = approval.metadata;
    const metadata = isRecord(existingMetadata) ? existingMetadata : {};
    await ctx.db.patch(args.approvalId, {
      status: 'completed',
      approvedBy: userId,
      reviewedAt: now,
      metadata: { ...metadata, response },
    });

    let nextState: 'approved' | 'draft';
    let snapshot: ControlledRecord['approvedVersions'][number] | undefined;
    if (args.decision === 'approve') {
      if (
        record.approvedVersions.length >= DOCUMENT_RECORD_MAX_APPROVED_VERSIONS
      ) {
        throw new ConvexError({
          code: 'DOCUMENT_RECORD_VERSION_LIMIT',
          message: `This record already holds ${DOCUMENT_RECORD_MAX_APPROVED_VERSIONS} approved versions — the platform cap. Export and re-create the document to continue.`,
          limit: DOCUMENT_RECORD_MAX_APPROVED_VERSIONS,
        });
      }
      const fileId = document.fileId;
      if (fileId === undefined) {
        // markControlled requires a blob and no write path unsets fileId;
        // defensive — an approve MUST snapshot an addressable file.
        throw new ConvexError({
          code: 'DOCUMENT_RECORD_NEEDS_FILE',
          message: 'This record has no backing file to approve.',
        });
      }
      // Tolerance twin of the run ledger's output hashing: `convexStorageId`
      // blind-casts any non-`s3:` string and `db.system.get` THROWS on an
      // undecodable id. A malformed ref must stay a visible user-level
      // outcome — the same hash-omitted snapshot the `s3:` arm produces
      // (fileId + the row's contentHash remain the version's identity) —
      // never a crash from inside the cast.
      const rawConvexId = convexStorageId(fileId);
      const convexId =
        rawConvexId === null
          ? null
          : ctx.db.system.normalizeId('_storage', rawConvexId);
      const blobMeta =
        convexId === null ? null : await ctx.db.system.get(convexId);
      snapshot = {
        version: record.version,
        fileId,
        ...(document.contentHash !== undefined
          ? { contentHash: document.contentHash }
          : {}),
        ...(blobMeta?.sha256 !== undefined ? { sha256: blobMeta.sha256 } : {}),
        ...(blobMeta?.size !== undefined ? { size: blobMeta.size } : {}),
        approvedAt: now,
        approvedBy: userId,
      };
      // Retain the approved blob on the row's own history so the version
      // list keeps serving it and the delete-time blob erase keeps covering
      // it, even after later drafts replace `fileId`.
      const historyFiles = document.historyFiles ?? [];
      const patch: Record<string, unknown> = {
        record: {
          ...record,
          state: 'approved',
          approvedAt: now,
          approvedBy: userId,
          approvedVersions: [...record.approvedVersions, snapshot],
        },
      };
      if (!historyFiles.includes(fileId)) {
        patch.historyFiles = [...historyFiles, fileId];
      }
      await ctx.db.patch(document._id, patch);
      nextState = 'approved';
    } else {
      await ctx.db.patch(document._id, {
        record: { ...record, state: 'draft' },
      });
      nextState = 'draft';
    }

    await auditRecordTransition(ctx, {
      document,
      authUser,
      userId,
      action: DOCUMENT_RECORD_AUDIT_ACTIONS.reviewResponded,
      previousState: { state: 'in_review', version: record.version },
      newState: { state: nextState, version: record.version },
      metadata: {
        approvalId: String(args.approvalId),
        decision: args.decision,
        feedbackProvided: feedback !== undefined,
        ...(snapshot !== undefined
          ? {
              snapshot: {
                fileId: String(snapshot.fileId),
                ...(snapshot.sha256 !== undefined
                  ? { sha256: snapshot.sha256 }
                  : {}),
                ...(snapshot.contentHash !== undefined
                  ? { contentHash: snapshot.contentHash }
                  : {}),
              },
            }
          : {}),
      },
    });

    return { state: nextState, version: record.version };
  },
});

/**
 * approved → draft with the next monotonic version. The approved snapshot
 * stays addressable in `approvedVersions` (and its blob in `historyFiles`).
 */
export const openRecordRevision = mutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({ version: v.number() }),
  handler: async (ctx, args): Promise<{ version: number }> => {
    const { document, authUser, userId } = await requireDocumentWriteAccess(
      ctx,
      args.documentId,
    );
    const record = requireControlledRecord(document);
    if (record.state !== 'approved') {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_INVALID_STATE',
        message: 'Only an approved record can open a new revision.',
        state: record.state,
      });
    }

    const nextVersion = record.version + 1;
    await ctx.db.patch(document._id, {
      record: {
        ...record,
        state: 'draft',
        version: nextVersion,
      },
    });

    await auditRecordTransition(ctx, {
      document,
      authUser,
      userId,
      action: DOCUMENT_RECORD_AUDIT_ACTIONS.revisionOpened,
      previousState: { state: 'approved', version: record.version },
      newState: { state: 'draft', version: nextVersion },
    });

    return { version: nextVersion };
  },
});

/**
 * The live pending review for a document record, if any — the UI's join
 * from the row badge to the respond actions (who it waits on + the
 * approval id `respondToDocumentRecordReview` needs).
 */
export const getPendingDocumentRecordReview = query({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.union(
    v.null(),
    v.object({
      approvalId: v.id('approvals'),
      version: v.number(),
      requestedFor: v.union(v.string(), v.null()),
      requestedBy: v.union(v.string(), v.null()),
      requestedAt: v.number(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    approvalId: Id<'approvals'>;
    version: number;
    requestedFor: string | null;
    requestedBy: string | null;
    requestedAt: number;
  } | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
    const document = await ctx.db.get(args.documentId);
    if (!document) return null;
    await getOrganizationMember(ctx, document.organizationId, authUser);
    const readable = await canReadDocument(ctx, document, {
      userId: authUser.userId,
      organizationId: document.organizationId,
    });
    if (!readable) return null;
    if (
      document.record === undefined ||
      document.record.state !== 'in_review'
    ) {
      return null;
    }
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resourceType_and_resourceId_and_status', (q) =>
        q
          .eq('resourceType', 'document_record_review')
          .eq('resourceId', String(document._id))
          .eq('status', 'pending'),
      )) {
      if (approvalRecordVersion(approval) !== document.record.version) continue;
      const metadata: unknown = approval.metadata;
      const meta = isRecord(metadata) ? metadata : {};
      return {
        approvalId: approval._id,
        version: document.record.version,
        requestedFor:
          typeof meta.requestedFor === 'string' ? meta.requestedFor : null,
        requestedBy:
          typeof meta.requestedBy === 'string' ? meta.requestedBy : null,
        requestedAt: approval._creationTime,
      };
    }
    return null;
  },
});
