'use node';

/**
 * Fetch inbound messages from an IMAP mailbox and map them to EmailType[].
 */

import type { ImapFlow } from 'imapflow';
import { ImapFlow as ImapFlowClient } from 'imapflow';
import { simpleParser } from 'mailparser';

import type { EmailType } from '../../../workflow_engine/action_defs/conversation/helpers/types';
import type { FetchMessagesParams, FetchMessagesResult } from '../types';
import { discoverSentMailboxPath } from './discover_sent_mailbox';
import { mapToEmailType } from './map_to_email_type';
import {
  shouldUseRecentSentFetch,
  uidsFromSearch,
} from './select_message_uids';

const DEFAULT_MAILBOX = 'INBOX';
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

/** Message count of the open mailbox. `client.mailbox` is `false` until one is opened. */
function mailboxMessageCount(client: ImapFlow): number {
  return client.mailbox ? client.mailbox.exists : 0;
}

function isSentFolderSync(params: FetchMessagesParams): boolean {
  if (params.sentFolder) return true;
  return (
    typeof params.mailbox === 'string' &&
    params.mailbox.trim().toLowerCase() === 'sent'
  );
}

function sentFolderPreferredName(
  mailbox: string | undefined,
): string | undefined {
  if (!mailbox?.trim()) return undefined;
  return mailbox.trim().toLowerCase() === 'sent' ? undefined : mailbox.trim();
}

function sentFolderSkipResult(
  startedAt: number,
  warning: string,
): FetchMessagesResult {
  return {
    success: true,
    data: [],
    warning,
    duration: Date.now() - startedAt,
  };
}

async function searchMessageUids(
  client: ImapFlow,
  since: number | undefined,
  maxResults: number,
  sentFolder: boolean,
): Promise<number[]> {
  const sinceDate = since ? new Date(since) : undefined;
  let searchUids: number[] | false | null | undefined;
  let searchThrew = false;

  // Sent folders often reject or empty-return SEARCH; skip it on first sync.
  if (!sentFolder || sinceDate) {
    try {
      searchUids = await client.search(
        sinceDate ? { since: sinceDate } : { all: true },
        { uid: true },
      );
      const fromSearch = uidsFromSearch(searchUids, maxResults);
      if (fromSearch.length > 0) {
        return fromSearch;
      }
    } catch (error) {
      searchThrew = true;
      if (!sentFolder) {
        throw error;
      }
      console.warn(
        '[imap_smtp] Sent folder SEARCH failed, falling back to recent fetch:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const mailboxExists = mailboxMessageCount(client);
  if (
    shouldUseRecentSentFetch({
      searchUids,
      searchThrew,
      mailboxExists,
      sentFolder,
      maxResults,
    })
  ) {
    return await recentMessageUids(client, maxResults);
  }

  return uidsFromSearch(searchUids, maxResults);
}

async function recentMessageUids(
  client: ImapFlow,
  maxResults: number,
): Promise<number[]> {
  // Fetch the most recent `maxResults` messages by sequence number. IMAP has no
  // negative offset syntax, so derive the range from the mailbox message count:
  // `${start}:*` selects the last N. Fetch by sequence (no `{ uid: true }` range
  // flag) but still request the UID in the response.
  const exists = mailboxMessageCount(client);
  if (exists === 0) return [];
  const start = Math.max(1, exists - maxResults + 1);

  const uids: number[] = [];
  for await (const message of client.fetch(`${start}:*`, { uid: true })) {
    if (typeof message.uid === 'number') {
      uids.push(message.uid);
    }
  }

  uids.sort((a, b) => a - b);
  return uids.slice(-maxResults);
}

async function fetchEmailsFromUids(
  client: ImapFlow,
  uids: number[],
  since: number | undefined,
): Promise<EmailType[]> {
  const emails: EmailType[] = [];

  for await (const message of client.fetch(
    uids,
    { uid: true, flags: true, source: true },
    { uid: true },
  )) {
    if (!message.source) continue;
    const parsed = await simpleParser(message.source);
    const flags = message.flags ? Array.from(message.flags) : [];
    const email = mapToEmailType(message.uid, flags, parsed);

    if (since && parsed.date) {
      if (parsed.date.getTime() <= since) continue;
    }
    emails.push(email);
  }

  emails.sort((a, b) => {
    const at = a.date ? Date.parse(a.date) : 0;
    const bt = b.date ? Date.parse(b.date) : 0;
    return at - bt;
  });

  return emails;
}

async function fetchRecentSentDirectly(
  client: ImapFlow,
  maxResults: number,
  since: number | undefined,
): Promise<EmailType[]> {
  // Last N by sequence number — see recentMessageUids for why `*:-N` is invalid.
  const exists = mailboxMessageCount(client);
  if (exists === 0) return [];
  const start = Math.max(1, exists - maxResults + 1);

  const emails: EmailType[] = [];

  for await (const message of client.fetch(`${start}:*`, {
    uid: true,
    flags: true,
    source: true,
  })) {
    if (!message.source) continue;
    const parsed = await simpleParser(message.source);
    const flags = message.flags ? Array.from(message.flags) : [];
    const email = mapToEmailType(message.uid, flags, parsed);

    if (since && parsed.date) {
      if (parsed.date.getTime() <= since) continue;
    }
    emails.push(email);
  }

  emails.sort((a, b) => {
    const at = a.date ? Date.parse(a.date) : 0;
    const bt = b.date ? Date.parse(b.date) : 0;
    return at - bt;
  });

  return emails;
}

export async function fetchMessages(
  params: FetchMessagesParams,
): Promise<FetchMessagesResult> {
  const startedAt = Date.now();
  const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
  const sentFolder = isSentFolderSync(params);

  const client = new ImapFlowClient({
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
    if (sentFolder) {
      return sentFolderSkipResult(
        startedAt,
        error instanceof Error
          ? `Sent folder sync skipped (IMAP connection failed: ${error.message}).`
          : 'Sent folder sync skipped (IMAP connection failed).',
      );
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'IMAP connection failed',
      duration: Date.now() - startedAt,
    };
  }

  try {
    let mailboxToOpen = params.mailbox ?? DEFAULT_MAILBOX;

    if (sentFolder) {
      try {
        const listed = await client.list();
        const discovered = discoverSentMailboxPath(
          listed,
          sentFolderPreferredName(params.mailbox),
        );
        if (!discovered) {
          return sentFolderSkipResult(
            startedAt,
            'Sent folder not found on this IMAP server; skipped sent-mail sync. Set Sent mailbox in the integration settings if your provider uses a non-standard folder name.',
          );
        }
        mailboxToOpen = discovered;
      } catch (error) {
        return sentFolderSkipResult(
          startedAt,
          error instanceof Error
            ? `Sent folder sync skipped (could not list mailboxes: ${error.message}).`
            : 'Sent folder sync skipped (could not list mailboxes).',
        );
      }
    }

    const lock = await client.getMailboxLock(mailboxToOpen);
    try {
      const mailboxExists = mailboxMessageCount(client);

      let emails: EmailType[];
      if (sentFolder && !params.since) {
        emails = await fetchRecentSentDirectly(
          client,
          maxResults,
          params.since,
        );
      } else {
        const selected = await searchMessageUids(
          client,
          params.since,
          maxResults,
          sentFolder,
        );

        if (selected.length === 0) {
          if (sentFolder && mailboxExists > 0) {
            return {
              success: true,
              data: [],
              warning: `Opened Sent folder "${mailboxToOpen}" (${mailboxExists} messages on server) but none were fetched. Check the Sent mailbox setting matches your provider's folder name.`,
              duration: Date.now() - startedAt,
            };
          }
          return { success: true, data: [], duration: Date.now() - startedAt };
        }

        emails = await fetchEmailsFromUids(client, selected, params.since);
      }

      if (sentFolder && emails.length === 0 && mailboxExists > 0) {
        return {
          success: true,
          data: [],
          warning: `Opened Sent folder "${mailboxToOpen}" (${mailboxExists} messages on server) but none were fetched. Check the Sent mailbox setting matches your provider's folder name.`,
          duration: Date.now() - startedAt,
        };
      }

      return { success: true, data: emails, duration: Date.now() - startedAt };
    } finally {
      lock.release();
    }
  } catch (error) {
    if (sentFolder) {
      return sentFolderSkipResult(
        startedAt,
        error instanceof Error
          ? `Sent folder could not be read (${error.message}); skipped sent-mail sync.`
          : 'Sent folder could not be read; skipped sent-mail sync.',
      );
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'IMAP fetch failed',
      duration: Date.now() - startedAt,
    };
  } finally {
    try {
      await client.logout();
    } catch (error) {
      console.warn(
        '[imap_smtp] IMAP logout failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
