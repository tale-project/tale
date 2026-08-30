/**
 * Pure helpers for actionable notification email — mailbox pick order and
 * per-connector send input. Shared by the 0.4 Node send helpers and the 0.5
 * backend's email sink.
 */

import { sendConnectorAction } from '../conversations/connector_slug';
import {
  ACTIONABLE_EMAIL_CONNECTORS,
  type ActionableEmailConnectorSlug,
} from './actionable_email_connectors';

export interface SendableMailbox {
  connectorSlug: ActionableEmailConnectorSlug;
  credentialId: string;
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
