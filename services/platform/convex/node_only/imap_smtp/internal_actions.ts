'use node';

/**
 * Node-runtime actions for the IMAP/SMTP mailbox integration.
 *
 * IMAP and SMTP are raw-TCP protocols that the HTTP-only connector sandbox
 * cannot speak, so — exactly like the SQL integration — these run as
 * `'use node'` internalActions with credentials passed in decrypted by the
 * dispatching action.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { fetchMessages as fetchMessagesHelper } from './helpers/fetch_messages';
import { sendMessage as sendMessageHelper } from './helpers/send_message';
import { testConnection as testConnectionHelper } from './helpers/test_connection';
import type {
  FetchMessagesResult,
  SendMessageResult,
  TestConnectionResult,
} from './types';

const imapCredentialsValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
  user: v.string(),
  password: v.string(),
});

const smtpCredentialsValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
  user: v.string(),
  password: v.string(),
});

export const fetchMessages = internalAction({
  args: {
    imap: imapCredentialsValidator,
    mailbox: v.optional(v.string()),
    since: v.optional(v.number()),
    maxResults: v.optional(v.number()),
    connectTimeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    // EmailType[] — plain JSON; validated structurally by the conversation flow.
    data: v.optional(v.array(v.any())),
    error: v.optional(v.string()),
    duration: v.optional(v.number()),
  }),
  handler: async (_ctx, args): Promise<FetchMessagesResult> => {
    return await fetchMessagesHelper({
      imap: args.imap,
      mailbox: args.mailbox,
      since: args.since,
      maxResults: args.maxResults,
      connectTimeoutMs: args.connectTimeoutMs,
    });
  },
});

export const sendMessage = internalAction({
  args: {
    smtp: smtpCredentialsValidator,
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    text: v.optional(v.string()),
    html: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          url: v.string(),
        }),
      ),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<SendMessageResult> => {
    return await sendMessageHelper(args);
  },
});

export const testConnection = internalAction({
  args: {
    imap: imapCredentialsValidator,
    smtp: v.optional(smtpCredentialsValidator),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<TestConnectionResult> => {
    return await testConnectionHelper({ imap: args.imap, smtp: args.smtp });
  },
});
