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
  // gone, so the email lands on the project's Tasks board — parity with
  // `personalNotificationTarget`.
  if (typeof threadId === 'string' && typeof projectId === 'string') {
    return `${base}/dashboard/${args.organizationId}/projects/${projectId}/tasks`;
  }
  return null;
}

export { findSendableMailbox } from './send_actionable_email';

/**
 * Send ONE actionable notification's email, rendered from the bell row as it
 * stands right now.
 *
 * Scheduled with a debounce by `collab/coalesce.ts`, which cancels and
 * re-schedules this job whenever the row is rewritten — so a burst of changes
 * on one dimension produces at most one email, carrying the final state rather
 * than the state at the moment the first event fired. Reading the row here (not
 * a payload snapshot) is what makes that true even if a cancel loses a race.
 *
 * Skips silently when the row is gone (an event that undid itself), already
 * read (they've seen it in the app — no need to mail it), the recipient has no
 * email, email delivery is off in prefs, the org has no connected mailbox, or
 * the send fails. The in-app row is the durable record either way.
 */
export const deliverActionableEmailAction = internalAction({
  args: { notificationId: v.id('userNotifications') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const notification = await ctx.runQuery(
        internal.notifications.email_notification_queries
          .getDeliverableNotificationInternal,
        { notificationId: args.notificationId },
      );
      if (!notification) return null;

      const recipientEmail = await ctx.runQuery(
        internal.notifications.email_notification_queries
          .getRecipientEmailInternal,
        { userId: notification.userId },
      );
      if (!recipientEmail) return null;

      const emailEnabled = await ctx.runQuery(
        internal.notifications.email_notification_queries
          .isActionableEmailEnabledInternal,
        {
          userId: notification.userId,
          organizationId: notification.organizationId,
        },
      );
      if (!emailEnabled) return null;

      const mailbox = await findSendableMailbox(
        ctx,
        notification.organizationId,
      );
      if (!mailbox) return null;

      const locale = await ctx.runQuery(
        internal.organizations.internal_queries.getOrganizationDefaultLocale,
        { organizationId: notification.organizationId },
      );

      const params = notification.params ?? {};
      const deepLink = buildPersonalNotificationUrl({
        organizationId: notification.organizationId,
        taskId: notification.taskId ? String(notification.taskId) : undefined,
        params,
        siteUrl: SITE_URL,
      });

      const { subject, text, html } = renderActionableEmailContent(locale, {
        titleKey: notification.titleKey,
        bodyKey: notification.bodyKey,
        params,
        deepLink,
      });

      const sendResult = await sendActionableEmail(ctx, {
        organizationId: notification.organizationId,
        mailbox,
        to: recipientEmail,
        subject,
        text,
        html,
      });

      if (!sendResult.success) {
        console.warn(
          `[deliverActionableEmail] send failed for ${notification.type} → ${recipientEmail}: ${sendResult.error}`,
        );
      }
    } catch (err) {
      console.warn(
        `[deliverActionableEmail] delivery failed for ${String(
          args.notificationId,
        )}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return null;
  },
});
