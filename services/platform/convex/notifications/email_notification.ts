'use node';

/**
 * Per-recipient email delivery for actionable return-loop notifications.
 *
 * Best-effort: scheduled fire-and-forget from the mutation write path. Skips
 * silently when the recipient has no email, email delivery is disabled in
 * prefs, the org has no connected mailbox connector, or send fails — the
 * in-app bell row is already written.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { notificationTypeValidator } from '../collab/schema';
import { jsonRecordValidator } from '../lib/validators/json';
import { renderActionableEmailContent } from './notification_messages';
import {
  findSendableMailbox,
  sendActionableEmail,
} from './send_actionable_email';

const SITE_URL = process.env.SITE_URL ?? 'http://127.0.0.1:3000';

/** Mirrors the in-app personal notification deep-link builder. */
export function buildPersonalNotificationUrl(args: {
  organizationId: string;
  taskId?: string;
  params?: Record<string, unknown>;
  siteUrl?: string;
}): string | null {
  const projectId = args.params?.projectId;
  const threadId = args.params?.threadId;
  const base = (args.siteUrl ?? SITE_URL).replace(/\/$/, '');

  if (args.params?.chat === true && typeof threadId === 'string') {
    return `${base}/dashboard/${args.organizationId}/chat/${encodeURIComponent(threadId)}`;
  }
  const conversationId = args.params?.conversationId;
  if (typeof conversationId === 'string') {
    const status =
      typeof args.params?.conversationStatus === 'string'
        ? args.params.conversationStatus
        : 'open';
    return `${base}/dashboard/${args.organizationId}/conversations/${encodeURIComponent(status)}?conversation=${encodeURIComponent(conversationId)}`;
  }
  // Document-review emails mirror `personalNotificationTarget`: project
  // files open inside their Files tab, library documents in the org list,
  // both with the preview (`doc`) opened on the frozen artifact.
  const documentId = args.params?.documentId;
  if (typeof documentId === 'string') {
    const docSearch = `doc=${encodeURIComponent(documentId)}`;
    if (typeof projectId === 'string') {
      const folderId = args.params?.folderId;
      const folderSearch =
        typeof folderId === 'string'
          ? `&folderId=${encodeURIComponent(folderId)}`
          : '';
      return `${base}/dashboard/${args.organizationId}/projects/${projectId}/files?${docSearch}${folderSearch}`;
    }
    return `${base}/dashboard/${args.organizationId}/documents?${docSearch}`;
  }
  if (args.taskId && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}/tasks?task=${args.taskId}`;
  }
  // Legacy discussion-mention rows (threadId + projectId): their route is
  // gone, so the email lands on the project overview — parity with
  // `personalNotificationTarget`.
  if (typeof threadId === 'string' && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}`;
  }
  return null;
}

export { findSendableMailbox } from './send_actionable_email';

export const deliverActionableEmailAction = internalAction({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    type: notificationTypeValidator,
    titleKey: v.string(),
    bodyKey: v.string(),
    params: v.optional(jsonRecordValidator),
    resourceType: v.string(),
    resourceId: v.string(),
    taskId: v.optional(v.id('tasks')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const recipientEmail = await ctx.runQuery(
        internal.notifications.email_notification_queries
          .getRecipientEmailInternal,
        { userId: args.userId },
      );
      if (!recipientEmail) return null;

      const emailEnabled = await ctx.runQuery(
        internal.notifications.email_notification_queries
          .isActionableEmailEnabledInternal,
        { userId: args.userId, organizationId: args.organizationId },
      );
      if (!emailEnabled) return null;

      const mailbox = await findSendableMailbox(ctx, args.organizationId);
      if (!mailbox) return null;

      const locale = await ctx.runQuery(
        internal.organizations.internal_queries.getOrganizationDefaultLocale,
        { organizationId: args.organizationId },
      );

      const params = args.params ?? {};
      const deepLink = buildPersonalNotificationUrl({
        organizationId: args.organizationId,
        taskId: args.taskId ? String(args.taskId) : undefined,
        params,
        siteUrl: SITE_URL,
      });

      const { subject, text, html } = renderActionableEmailContent(locale, {
        titleKey: args.titleKey,
        bodyKey: args.bodyKey,
        params,
        deepLink,
      });

      const sendResult = await sendActionableEmail(ctx, {
        organizationId: args.organizationId,
        mailbox,
        to: recipientEmail,
        subject,
        text,
        html,
      });

      if (!sendResult.success) {
        console.warn(
          `[deliverActionableEmail] send failed for ${args.type} → ${recipientEmail}: ${sendResult.error}`,
        );
      }
    } catch (err) {
      console.warn(
        `[deliverActionableEmail] delivery failed for ${args.type}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return null;
  },
});
