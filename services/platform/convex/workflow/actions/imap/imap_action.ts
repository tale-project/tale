import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { ImapActionParams, ImapActionResult } from './types';
import { getImapCredentials } from './get_imap_credentials';
import { internal } from '../../../_generated/api';

export const imapAction: ActionDefinition<ImapActionParams> = {
  type: 'imap',
  title: 'IMAP Email Retriever',
  description: 'Retrieve emails from an IMAP server (Gmail, Outlook, etc.)',
  parametersValidator: v.object({
    // Credentials (optional if provided in variables)
    host: v.optional(v.string()),
    port: v.optional(v.number()),
    secure: v.optional(v.boolean()),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    accessToken: v.optional(v.string()),

    // Operation details
    operation: v.union(v.literal('list'), v.literal('search')),
    mailbox: v.optional(v.string()),

    // Fetch parameters
    afterUid: v.optional(v.number()),

    // Options
    includeAttachments: v.optional(v.boolean()),
    parseHtml: v.optional(v.boolean()),
    threadSearchFolders: v.optional(v.union(v.array(v.string()), v.string())), // Folders to search - array or JSON string
  }),

  async execute(_ctx, params, variables): Promise<ImapActionResult> {
    const processedParams = params as ImapActionParams;

    // Get IMAP credentials
    const credentials = getImapCredentials(processedParams, variables);

    // Set defaults
    const mailbox = processedParams.mailbox || 'INBOX';
    const includeAttachments = processedParams.includeAttachments || false;
    const parseHtml = processedParams.parseHtml || false;

    // Parse threadSearchFolders - can be array or JSON string; if omitted, let server auto-detect
    let threadSearchFolders: string[] | undefined;
    if (Array.isArray(processedParams.threadSearchFolders)) {
      threadSearchFolders = processedParams.threadSearchFolders;
    } else if (
      typeof processedParams.threadSearchFolders === 'string' &&
      processedParams.threadSearchFolders.trim()
    ) {
      // Parse JSON string - will throw if malformed
      threadSearchFolders = JSON.parse(processedParams.threadSearchFolders);
    }

    // Execute based on operation
    const startTime = Date.now();

    // Both 'search' and 'list' operations now do the same thing:
    // - If afterUid is provided: fetch 1 email after that UID
    // - If afterUid is not provided: fetch latest email
    // - Always fetch all related thread messages
    const afterUid =
      typeof processedParams.afterUid === 'number'
        ? processedParams.afterUid
        : undefined;

    const messages = await _ctx.runAction!(
      internal.node_only.imap.retrieve_imap_emails.retrieveImapEmails,
      {
        credentials,
        mailbox,
        ...(afterUid !== undefined ? { afterUid } : {}),
        includeAttachments,
        parseHtml,
        ...(Array.isArray(threadSearchFolders) && threadSearchFolders.length
          ? { threadSearchFolders }
          : {}),
      },
    );

    const duration = Date.now() - startTime;

    return {
      success: true,
      operation: processedParams.operation,
      mailbox,
      messages,
      count: messages.length,
      duration,
      timestamp: Date.now(),
    };
  },
};
