/**
 * Controlled-document review inbox emitters — the document twin of
 * `notify_task_reviews.ts`, transactional with `documents/records.ts`.
 *
 * Both types skip the preference gate on purpose: a review designation is a
 * human-in-the-loop safety signal (same stance as `task_review_requested`,
 * whose `taskReview` preference is hardwired always-on, #2651), and the
 * outcome ping goes to exactly one person — the submitter — so there is no
 * fan-out to mute.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { queueActionableEmail } from './notify_email';

/** Bell-body excerpt cap for request-changes feedback — the full text stays
 * on the approval row and in the submit dialog's last-review callout. */
export const DOCUMENT_REVIEW_FEEDBACK_EXCERPT_MAX = 160;

export function feedbackExcerpt(feedback: string): string {
  return feedback.length > DOCUMENT_REVIEW_FEEDBACK_EXCERPT_MAX
    ? `${feedback.slice(0, DOCUMENT_REVIEW_FEEDBACK_EXCERPT_MAX)}…`
    : feedback;
}

/** Inbox params stay PII-lean: ids, titles, and the reviewer-authored
 * feedback excerpt (org content). Project scope rides along so the bell can
 * deep-link a project file into its Files tab. */
function documentReviewParams(
  document: Doc<'documents'>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentId: String(document._id),
    documentTitle: document.title ?? 'Untitled',
    ...(document.projectId ? { projectId: String(document.projectId) } : {}),
    ...(document.folderId ? { folderId: String(document.folderId) } : {}),
    ...extra,
  };
}

async function insertDocumentReviewNotification(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: 'document_review_requested' | 'document_review_resolved';
    titleKey: string;
    bodyKey: string;
    params: Record<string, unknown>;
    resourceType: 'document_review' | 'document';
    resourceId: string;
    actorId: string;
  },
): Promise<void> {
  await ctx.db.insert('userNotifications', {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    titleKey: args.titleKey,
    bodyKey: args.bodyKey,
    params: args.params,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    actorType: 'user',
    actorId: args.actorId,
    read: false,
    createdAt: Date.now(),
  });
  await queueActionableEmail(ctx, {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    titleKey: args.titleKey,
    bodyKey: args.bodyKey,
    params: args.params,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
  });
}

/**
 * Actionable review request to the designated reviewer. Self-designation is
 * silent — you were in the submit dialog a moment ago.
 */
export async function notifyDocumentReviewRequested(
  ctx: MutationCtx,
  args: {
    document: Doc<'documents'>;
    version: number;
    reviewerUserId: string;
    approvalId: Id<'approvals'>;
    requestedByUserId: string;
    requestedByName?: string;
  },
): Promise<void> {
  if (args.reviewerUserId === args.requestedByUserId) return;
  await insertDocumentReviewNotification(ctx, {
    userId: args.reviewerUserId,
    organizationId: args.document.organizationId,
    type: 'document_review_requested',
    titleKey: 'documentReviewRequested',
    bodyKey: args.requestedByName
      ? 'documentReviewRequestedBody'
      : 'documentReviewRequestedBodyNoActor',
    params: documentReviewParams(args.document, {
      approvalId: String(args.approvalId),
      version: args.version,
      ...(args.requestedByName
        ? { requestedByName: args.requestedByName }
        : {}),
    }),
    resourceType: 'document_review',
    resourceId: String(args.approvalId),
    actorId: args.requestedByUserId,
  });
}

/**
 * Review outcome to the submitter. A self-decided review (submitter is the
 * reviewer) is silent — they just clicked the button.
 */
export async function notifyDocumentReviewResolved(
  ctx: MutationCtx,
  args: {
    document: Doc<'documents'>;
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
  await insertDocumentReviewNotification(ctx, {
    userId: args.recipientUserId,
    organizationId: args.document.organizationId,
    type: 'document_review_resolved',
    titleKey: approved
      ? 'documentReviewApproved'
      : 'documentReviewChangesRequested',
    bodyKey: approved
      ? 'documentReviewApprovedBody'
      : 'documentReviewChangesRequestedBody',
    params: documentReviewParams(args.document, {
      version: args.version,
      ...(args.decidedByName ? { decidedByName: args.decidedByName } : {}),
      ...(args.feedback && !approved
        ? { feedback: feedbackExcerpt(args.feedback) }
        : {}),
    }),
    resourceType: 'document',
    resourceId: String(args.document._id),
    actorId: args.decidedByUserId,
  });
}

/**
 * Marks a reviewer's pending request bell read once its approval resolves or
 * is superseded. Unlike the task twin's whole-org fan-out, the recipient is
 * known (the approval's `requestedFor`), so the scan is one user's unread
 * rows.
 */
export async function dismissDocumentReviewRequestNotifications(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    approvalId: Id<'approvals'>;
    reviewerUserId: string;
  },
): Promise<void> {
  const approvalIdStr = String(args.approvalId);
  const now = Date.now();
  const unread = await ctx.db
    .query('userNotifications')
    .withIndex('by_user_org_read', (q) =>
      q
        .eq('userId', args.reviewerUserId)
        .eq('organizationId', args.organizationId)
        .eq('read', false),
    )
    .collect();
  for (const row of unread) {
    if (row.type !== 'document_review_requested') continue;
    if (row.resourceId !== approvalIdStr) continue;
    await ctx.db.patch(row._id, { read: true, readAt: now });
  }
}
