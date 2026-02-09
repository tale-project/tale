'use node';

import { v } from 'convex/values';
import { ImapFlow } from 'imapflow';

import type { EmailMessage } from '../../workflow_engine/action_defs/imap/helpers/types';

import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';
import computeUidToFetch from './lib/compute_uids_to_fetch';
import fetchEmailByUid from './lib/fetch_email_by_uid';
import listAllFolders from './lib/list_all_folders';
import searchThreadMessages from './lib/search_thread_messages';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

export const retrieveImapEmails = internalAction({
  args: {
    credentials: v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
      username: v.string(),
      password: v.optional(v.string()),
      accessToken: v.optional(v.string()),
    }),
    mailbox: v.string(),
    afterUid: v.optional(v.number()),
    includeAttachments: v.optional(v.boolean()),
    parseHtml: v.optional(v.boolean()),
    threadSearchFolders: v.optional(v.array(v.string())),
  },
  returns: v.array(
    v.object({
      uid: v.number(),
      messageId: v.string(),
      from: v.array(
        v.object({
          name: v.optional(v.string()),
          address: v.string(),
        }),
      ),
      to: v.array(
        v.object({
          name: v.optional(v.string()),
          address: v.string(),
        }),
      ),
      cc: v.optional(
        v.array(
          v.object({
            name: v.optional(v.string()),
            address: v.string(),
          }),
        ),
      ),
      bcc: v.optional(
        v.array(
          v.object({
            name: v.optional(v.string()),
            address: v.string(),
          }),
        ),
      ),
      subject: v.string(),
      date: v.string(),
      text: v.optional(v.string()),
      html: v.optional(v.string()),
      attachments: v.optional(
        v.array(
          v.object({
            filename: v.string(),
            contentType: v.string(),
            size: v.number(),
          }),
        ),
      ),
      flags: v.array(v.string()),
      headers: v.optional(v.record(v.string(), v.string())),
    }),
  ),
  handler: async (_ctx, args) => {
    const {
      credentials,
      mailbox,
      afterUid,
      includeAttachments = false,
      parseHtml = true,
      threadSearchFolders,
    } = args;

    if (!credentials.password && !credentials.accessToken) {
      throw new Error(
        'Either password or accessToken must be provided in credentials',
      );
    }

    debugLog('Connecting', {
      host: credentials.host,
      port: credentials.port,
      mailbox,
      afterUid: afterUid ?? null,
      authMethod: credentials.accessToken ? 'oauth2' : 'password',
    });

    const auth = credentials.accessToken
      ? {
          user: credentials.username,
          accessToken: credentials.accessToken,
        }
      : {
          user: credentials.username,
          pass: credentials.password ?? '',
        };

    const client = new ImapFlow({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth,
      logger: false,
    });

    await client.connect();
    await client.mailboxOpen(mailbox);

    const totalMessages =
      client.mailbox && typeof client.mailbox !== 'boolean'
        ? client.mailbox.exists
        : 0;

    if (totalMessages === 0) {
      await client.logout();
      return [];
    }

    const uid = await computeUidToFetch(client, totalMessages, afterUid);
    if (uid === null) {
      await client.logout();
      return [];
    }

    const email = await fetchEmailByUid(client, uid, {
      includeAttachments,
      parseHtml,
    });

    const messages: EmailMessage[] = [];
    if (email) {
      messages.push(email);
    }

    const resolvedThreadFolders: string[] =
      Array.isArray(threadSearchFolders) && threadSearchFolders.length > 0
        ? Array.from(new Set(threadSearchFolders))
        : await listAllFolders(client);
    debugLog('Thread search folders:', resolvedThreadFolders);

    const threadMessages = await searchThreadMessages(client, messages, {
      threadSearchFolders: resolvedThreadFolders,
      mailbox,
      includeAttachments,
      parseHtml,
    });

    try {
      await client.logout();
    } catch (logoutError) {
      debugLog('Logout failed (connection may have been closed):', logoutError);
    }

    const filteredInitialMessages =
      afterUid && afterUid > 0
        ? messages.filter((m) => m.uid > afterUid)
        : messages;

    return [...filteredInitialMessages, ...threadMessages];
  },
});
