'use node';

/**
 * Fetch inbound messages from an IMAP mailbox and map them to EmailType[].
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import type { EmailType } from '../../../workflow_engine/action_defs/conversation/helpers/types';
import type { FetchMessagesParams, FetchMessagesResult } from '../types';
import { mapToEmailType } from './map_to_email_type';

const DEFAULT_MAILBOX = 'INBOX';
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

export async function fetchMessages(
  params: FetchMessagesParams,
): Promise<FetchMessagesResult> {
  const startedAt = Date.now();
  const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;

  const client = new ImapFlow({
    host: params.imap.host,
    port: params.imap.port,
    secure: params.imap.secure,
    auth: { user: params.imap.user, pass: params.imap.password },
    // Silence imapflow's pino logger; we surface errors via the result.
    logger: false,
    socketTimeout: params.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  });

  try {
    await client.connect();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'IMAP connection failed',
      duration: Date.now() - startedAt,
    };
  }

  try {
    const lock = await client.getMailboxLock(params.mailbox ?? DEFAULT_MAILBOX);
    try {
      // Search by received date when a cursor is provided, else scan the whole
      // mailbox. IMAP date search has day granularity, so we re-filter by the
      // exact epoch-ms cursor below to avoid re-importing same-day messages.
      const sinceDate = params.since ? new Date(params.since) : undefined;
      const uids = await client.search(
        sinceDate ? { since: sinceDate } : { all: true },
        { uid: true },
      );

      if (!uids || uids.length === 0) {
        return { success: true, data: [], duration: Date.now() - startedAt };
      }

      // Newest messages last in UID order; take the most recent `maxResults`.
      const selected = uids.slice(-maxResults);
      const emails: EmailType[] = [];

      for await (const message of client.fetch(
        selected,
        { uid: true, flags: true, source: true },
        { uid: true },
      )) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const flags = message.flags ? Array.from(message.flags) : [];
        const email = mapToEmailType(message.uid, flags, parsed);

        // Re-filter against the precise cursor: IMAP `since` is day-granular,
        // so messages from earlier on the cursor day can slip through.
        if (params.since && parsed.date) {
          if (parsed.date.getTime() <= params.since) continue;
        }
        emails.push(email);
      }

      // Oldest-first so conversation creation processes in chronological order.
      emails.sort((a, b) => {
        const at = a.date ? Date.parse(a.date) : 0;
        const bt = b.date ? Date.parse(b.date) : 0;
        return at - bt;
      });

      return { success: true, data: emails, duration: Date.now() - startedAt };
    } finally {
      lock.release();
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'IMAP fetch failed',
      duration: Date.now() - startedAt,
    };
  } finally {
    try {
      await client.logout();
    } catch (error) {
      // Logout failures are non-fatal: the fetch already succeeded or failed
      // above, and the socket is torn down regardless.
      console.warn(
        '[imap_smtp] IMAP logout failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
