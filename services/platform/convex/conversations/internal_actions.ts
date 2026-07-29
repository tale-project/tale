'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

// Conversation email send/receive via connectors.
// `../connectors/{build_test_secrets,guards/is_imap_smtp_connector,
// imap_smtp_config,should_save_sent_to_imap}` and
// `../workflow_engine/action_defs/conversation/helpers/normalize_external_message_id`
// moved with the automations/connectors rewrite.
//
// `sendMessageViaConnectorAction` is the send path — offline, marking the
// message `'failed'` with an explanatory error the same way the real
// implementation's own catch block already reported a send failure (this
// action never threw; it always resolved `null` and recorded the outcome via
// `updateConversationMessage`), so conversation UIs that poll/subscribe on
// `deliveryState` see an honest failure instead of hanging at `'queued'`.
//
// `checkMessageDeliveryAction` (a delivery-confirmation poll only ever
// scheduled by a successful send) and `downloadAttachmentsAction` (best-
// effort attachment materialization for a received message, scheduled
// fire-and-forget from the `downloadAttachments` mutation) are both no-ops:
// neither is "send", both are safe to skip silently per the stub policy for
// fire-and-forget paths that must not break their caller.

export const sendMessageViaConnectorAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    contentType: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    // The address the customer originally wrote to (multi-address support):
    // reply as that address when it's on the sender's domain (imap_smtp only).
    from: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          fileName: v.string(),
          contentType: v.string(),
          size: v.optional(v.number()),
        }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    console.debug(
      `[sendMessageViaConnectorAction] Sending via connector is offline while the platform AI backend is rewritten; marking message ${args.messageId} failed`,
    );
    await ctx.runMutation(
      internal.conversations.internal_mutations.updateConversationMessage,
      {
        messageId: args.messageId,
        deliveryState: 'failed',
        metadata: {
          error:
            'Sending via connector is offline while the platform AI backend is rewritten.',
        },
      },
    );
    return null;
  },
});

/**
 * No-op. Only ever scheduled by a successful send (see
 * above) — with sending offline there is never a delivery to confirm. See
 * file header.
 */
export const checkMessageDeliveryAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    internetMessageId: v.string(),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    console.debug(
      `[checkMessageDeliveryAction] Delivery confirmation is offline while the platform AI backend is rewritten; not checking message ${args.messageId}`,
    );
    return null;
  },
});

/**
 * No-op. Best-effort attachment materialization for a
 * received message — the message keeps working, its attachment metadata
 * just doesn't get backfilled with a real storageId/url. See file header.
 */
export const downloadAttachmentsAction = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    connectorName: v.string(),
    externalMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    console.debug(
      `[downloadAttachmentsAction] Attachment download via connector is offline while the platform AI backend is rewritten; skipping message ${args.messageId}`,
    );
    return null;
  },
});
