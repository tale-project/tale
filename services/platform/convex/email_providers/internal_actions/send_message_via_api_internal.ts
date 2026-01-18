'use node';

/**
 * Internal action to send message via email API
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { sendMessageViaAPI } from '../send_message_via_api';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export const sendMessageViaAPIInternal = internalAction({
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
    return await sendMessageViaAPI(ctx, args);
  },
});
