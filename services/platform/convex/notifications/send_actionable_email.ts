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

import { ConvexError } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { sendConnectorAction } from '../conversations/connector_slug';
import {
  ACTIONABLE_EMAIL_CONNECTORS,
  type ActionableEmailConnectorSlug,
} from './actionable_email_connectors';

export {
  ACTIONABLE_EMAIL_CONNECTORS,
  type ActionableEmailConnectorSlug,
} from './actionable_email_connectors';

export interface SendableMailbox {
  connectorSlug: ActionableEmailConnectorSlug;
  credentialId: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
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
export function buildActionableEmailInput(
  connectorSlug: ActionableEmailConnectorSlug,
  args: { to: string; subject: string; text: string; html: string },
): Record<string, unknown> {
  const { connector } = sendConnectorAction(connectorSlug);
  if (connector === 'imap-smtp') {
    return {
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      notificationSender: true,
    };
  }
  return {
    to: connector === 'outlook' ? [args.to] : args.to,
    subject: args.subject,
    body: args.html,
    contentType: 'HTML',
  };
}

/** Prefer IMAP/SMTP, then Gmail, then Outlook; within a slug prefer the default. */
export function pickSendableMailbox(
  credentials: ReadonlyArray<{
    credentialId: string;
    connectorSlug: string;
    isDefault: boolean;
  }>,
): SendableMailbox | null {
  for (const slug of ACTIONABLE_EMAIL_CONNECTORS) {
    const forSlug = credentials.filter((row) => row.connectorSlug === slug);
    const pick = forSlug.find((row) => row.isDefault) ?? forSlug[0];
    if (pick) {
      return { connectorSlug: slug, credentialId: pick.credentialId };
    }
  }
  return null;
}

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
