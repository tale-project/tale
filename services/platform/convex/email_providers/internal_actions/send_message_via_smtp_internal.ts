'use node';

/**
 * Internal action to send message via SMTP
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { sendMessageViaSMTP } from '../send_message_via_smtp';

export const sendMessageViaSMTPInternal = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    providerId: v.optional(v.id('emailProviders')),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await sendMessageViaSMTP(ctx, args);
  },
});
