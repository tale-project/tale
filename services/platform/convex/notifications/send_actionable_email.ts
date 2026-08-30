'use node';

/**
 * Send helpers for actionable notification email — IMAP/SMTP mailboxes and
 * OAuth connectors (Gmail, Outlook).
 *
 * Delivery goes through `runConnectorAction` the same way conversation
 * replies do: pick an active mail credential for the org, then invoke the
 * connector's send action as a system caller. Skips silently when the org
 * has no usable mailbox — the in-app bell row is already written.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { sendConnectorAction } from '../conversations/connector_slug';
import {
  buildActionableEmailInput,
  pickSendableMailbox,
  type SendableMailbox,
} from './actionable_email_input';

export {
  ACTIONABLE_EMAIL_CONNECTORS,
  type ActionableEmailConnectorSlug,
} from './actionable_email_connectors';
export {
  buildActionableEmailInput,
  pickSendableMailbox,
  type SendableMailbox,
} from './actionable_email_input';

function errorMessage(error: unknown): string {
  if (error instanceof AppError) {
    const data = error.data;
    if (
      isRecord(data) &&
      typeof data.message === 'string' &&
      data.message.trim() !== ''
    ) {
      return data.message;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Build the connector input for an actionable notification. Mirrors
 * conversation `buildSendInput` for the no-attachment HTML case, and asks
 * IMAP/SMTP to rewrite From to `notification@` on the mailbox domain.
 */

/** Prefer IMAP/SMTP, then Gmail, then Outlook; within a slug prefer the default. */

/**
 * Resolve an active mail credential the org can send actionable email from.
 * Returns null when none is configured — callers treat that as a silent skip.
 */
export async function findSendableMailbox(
  ctx: ActionCtx,
  organizationId: string,
): Promise<SendableMailbox | null> {
  const credentials = await ctx.runQuery(
    internal.notifications.email_notification_queries
      .listActiveMailCredentialsInternal,
    { organizationId },
  );
  return pickSendableMailbox(credentials);
}

/**
 * Deliver one actionable notification email through the org's mail connector.
 */
export async function sendActionableEmail(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    mailbox: SendableMailbox;
    to: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const { connector, action } = sendConnectorAction(args.mailbox.connectorSlug);
  const input = buildActionableEmailInput(args.mailbox.connectorSlug, {
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });

  try {
    const result = await ctx.runAction(
      internal.connectors.execute_action.runConnectorAction,
      {
        organizationId: args.organizationId,
        connector,
        action,
        input,
        credentialRef: args.mailbox.credentialId,
        mode: 'live',
        caller: {
          kind: 'system',
          reason: 'actionable notification email',
        },
      },
    );

    if (result.status !== 'ok') {
      return {
        success: false,
        error:
          result.message ||
          `connector_send_failed:${args.mailbox.connectorSlug}`,
      };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
