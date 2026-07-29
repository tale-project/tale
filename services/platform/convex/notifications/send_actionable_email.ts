'use node';

/**
 * Send helpers for actionable notification email — IMAP/SMTP mailboxes and
 * OAuth connectors (Gmail, Outlook).
 *
 * `../connectors/{build_test_secrets,
 * guards/is_imap_smtp_connector,imap_smtp_config,load_connector}` moved
 * with the connectors rewrite. `email_notification.ts`'s
 * `deliverActionableEmailAction` is already designed to skip silently when
 * "the org has no connected mailbox connector" (its own doc comment) — the
 * in-app bell row is written regardless — so `findSendableMailbox` always
 * returning `null` is a true, in-contract answer, not a lie: it degrades
 * exactly like the "no mailbox configured" case always did, no caller
 * changes needed. `sendActionableEmail` is kept exported (nothing calls it
 * once `findSendableMailbox` always returns `null`, but the stub policy
 * never deletes an export) and returns its established `{ success, error? }`
 * failure shape instead of attempting a send.
 */

import type { ActionCtx } from '../_generated/server';

export interface SendableMailbox {
  kind: 'smtp' | 'connector';
}

/**
 * No-op — always reports "no sendable mailbox found",
 * which callers already treat as a normal, silent skip. See file header.
 */
export async function findSendableMailbox(
  _ctx: ActionCtx,
  _organizationId: string,
): Promise<SendableMailbox | null> {
  console.debug(
    '[findSendableMailbox] Actionable email delivery is offline while the platform AI backend is rewritten; reporting no sendable mailbox',
  );
  return null;
}

/**
 * Offline — always fails. See file header. Unreachable in
 * practice since `findSendableMailbox` never returns a mailbox, but kept
 * exported and functional-shaped per the stub policy.
 */
export async function sendActionableEmail(
  _ctx: ActionCtx,
  _args: {
    organizationId: string;
    mailbox: SendableMailbox;
    to: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<{ success: boolean; error?: string }> {
  return {
    success: false,
    error:
      'Sending actionable email is offline while the platform AI backend is rewritten.',
  };
}
