/**
 * Start a brand-new outbound email conversation to a contact.
 *
 * The counterpart to `reply_to_conversation`: rather than deriving the recipient
 * and connector from an existing conversation, compose takes an explicit
 * `contactId` (recipient) and `connectorName` (the inbox to send through),
 * creates a fresh outbound conversation, then delegates the send itself to the
 * shared `sendMessageViaConnector` path — threading, from-resolution, audit
 * and delivery all live there, so replies and compose share one send spine.
 *
 * Two deliberate choices:
 * - The conversation is created through the INTERNAL `createConversation`
 *   mutation, not the helper directly. `createConversation` writes its audit row
 *   via `AuditLogHelpers.logSuccess`, and under `mutationWithRLS` that write is
 *   denied for every role by the `auditLogChainGenesis` sentinel (#1972).
 *   Running it via `ctx.runMutation` executes it on a raw (non-RLS) ctx, in the
 *   same transaction — the same escape hatch `emitAuditSuccess` uses. The send
 *   itself stays on the user ctx so its audit records the real actor.
 * - The sender is carried on the conversation's `metadata.to` — the address on
 *   OUR side of the thread, which `sendMessageViaConnector` reads via
 *   `inboundRecipientAddress` to derive the send From (and which every later
 *   reply reuses). When the caller passes `from` — the dynamic-sender case
 *   (imap_smtp over a domain-verified SMTP provider, where any address on the
 *   verified domain is a valid sender) — we stamp it there, so the first send
 *   AND replies go out as that address, still domain-guarded by `resolveReplyFrom`
 *   in the send action. When `from` is omitted, `metadata.to` stays unset and the
 *   send falls back to the connector's configured From (see `reply_from.ts`).
 */

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { splitHtmlText } from './reply_to_conversation';
import { sendMessageViaConnector } from './send_message_via_connector';

/** Placeholder email a contact record carries when it has no real address. */
const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

export interface ComposeEmailConversationArgs {
  organizationId: string;
  contactId: Id<'contacts'>;
  /**
   * Default owner for the new thread (the non-admin composer). Resolved by the
   * RLS mutation and passed as data — this raw-ctx helper can't see auth.
   */
  assigneeUserId?: string;
  connectorName: string;
  subject: string;
  content: string;
  /** Composer markdown at send time — stored for undo-send draft restore. */
  sourceMarkdown?: string;
  /**
   * Sender address for the thread (dynamic-sender / imap_smtp only). Any address
   * on the connector's verified domain; the send action's `resolveReplyFrom`
   * guard silently falls back to the configured From if the domain doesn't match.
   * Omit to send from the connector's configured From.
   */
  from?: string;
  attachments?: Array<{
    storageId: Id<'_storage'>;
    fileName: string;
    contentType: string;
    size: number;
  }>;
}

export interface ComposeEmailConversationResult {
  conversationId: Id<'conversations'>;
  messageId: Id<'conversationMessages'>;
}

export async function composeEmailConversation(
  ctx: MutationCtx,
  args: ComposeEmailConversationArgs,
): Promise<ComposeEmailConversationResult> {
  const subject = args.subject.trim();
  if (!subject) {
    throw new ConvexError({
      code: 'compose_subject_required',
      message: 'A subject is required to start an email',
    });
  }

  // Recipient is always an existing contact (contacts-only compose). Resolve it
  // before creating anything so a bad recipient never leaves an empty thread.
  const contact = await ctx.db.get(args.contactId);
  if (!contact) {
    throw new ConvexError({
      code: 'contact_not_found',
      message: 'Contact not found',
    });
  }

  if (contact.organizationId !== args.organizationId) {
    throw new ConvexError({
      code: 'contact_org_mismatch',
      message: 'Contact does not belong to organization',
    });
  }

  const recipientEmail = contact.email;
  if (!recipientEmail || recipientEmail === UNKNOWN_CONTACT_EMAIL) {
    throw new ConvexError({
      code: 'contact_email_not_found',
      message: 'Contact has no email address to send to',
    });
  }

  // Create the outbound conversation on a raw ctx (see file header re: #1972).
  // A chosen sender is stamped into `metadata.to` (our side of the thread) so
  // both this send and later replies resolve to it via `inboundRecipientAddress`.
  const chosenFrom = args.from?.trim();
  const { conversationId } = await ctx.runMutation(
    internal.conversations.internal_mutations.createConversation,
    {
      organizationId: args.organizationId,
      contactId: args.contactId,
      assigneeUserId: args.assigneeUserId,
      subject,
      status: 'open',
      channel: 'email',
      direction: 'outbound',
      connectorName: args.connectorName,
      ...(chosenFrom ? { metadata: { to: [{ address: chosenFrom }] } } : {}),
    },
  );

  const { html, text } = splitHtmlText(args.content);

  return {
    conversationId,
    messageId: await sendMessageViaConnector(ctx, {
      conversationId,
      organizationId: args.organizationId,
      connectorName: args.connectorName,
      content: args.content,
      to: [recipientEmail],
      subject,
      html,
      text,
      ...(args.sourceMarkdown ? { sourceMarkdown: args.sourceMarkdown } : {}),
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    }),
  };
}
