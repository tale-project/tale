'use node';

/**
 * APPEND a sent message copy to the mailbox Sent folder over IMAP.
 *
 * Used when SMTP send goes through a relay while IMAP receive lives on a
 * mailbox server — any provider pair, not a specific vendor.
 */

import { ImapFlow } from 'imapflow';

import type {
  AppendSentMessageParams,
  AppendSentMessageResult,
} from '../types';
import { buildOutboundRawMessage } from './build_outbound_mail';
import { discoverSentMailboxPath } from './discover_sent_mailbox';

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

export async function appendSentMessage(
  params: AppendSentMessageParams,
): Promise<AppendSentMessageResult> {
  try {
    const raw = await buildOutboundRawMessage(params);

    const client = new ImapFlow({
      host: params.imap.host,
      port: params.imap.port,
      secure: params.imap.secure,
      auth: { user: params.imap.user, pass: params.imap.password },
      logger: false,
      socketTimeout: params.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    });

    try {
      await client.connect();
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? `IMAP connection failed: ${error.message}`
            : 'IMAP connection failed',
      };
    }

    try {
      const listed = await client.list();
      const sentPath = discoverSentMailboxPath(listed, params.sentMailbox);
      if (!sentPath) {
        return {
          success: false,
          error: 'Sent folder not found on IMAP server',
        };
      }

      await client.append(sentPath, raw, ['\\Seen'], new Date());
      return { success: true, mailboxPath: sentPath };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'IMAP append to Sent folder failed',
      };
    } finally {
      try {
        await client.logout();
      } catch (error) {
        console.warn(
          '[imap_smtp] IMAP logout failed after Sent append:',
          error instanceof Error ? error.message : error,
        );
      }
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to save sent copy',
    };
  }
}
