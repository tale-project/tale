'use node';

import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailMessage } from '../../../workflow/actions/imap/helpers/types';

import { createDebugLog } from '../../../lib/debug_log';
import buildEmailMessage from './build_email_message';
import normalizeMessageId from './normalize_message_id';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

interface Options {
  includeAttachments: boolean;
  parseHtml: boolean;
  skipMessageIdValidation?: boolean; // Skip Message-ID validation (for forward search)
}

export default async function fetchAndParseMessage(
  client: ImapFlow,
  uid: number,
  expectedMessageId: string,
  options: Options,
): Promise<EmailMessage | null> {
  const fetched = await client.fetchOne(
    String(uid),
    { source: true, flags: true, uid: true },
    { uid: true },
  );

  if (!fetched || typeof fetched === 'boolean' || !fetched.source) return null;

  const parsed = await simpleParser(fetched.source);
  const parsedMsgId = (parsed.messageId || '').trim();

  // Validate Message-ID unless explicitly skipped (e.g., for forward search)
  if (!options.skipMessageIdValidation) {
    if (
      !parsedMsgId ||
      normalizeMessageId(parsedMsgId) !== normalizeMessageId(expectedMessageId)
    ) {
      debugLog(
        `[Fetch] Message-ID mismatch: expected ${expectedMessageId}, got ${parsedMsgId}`,
      );
      return null;
    }
  }

  return buildEmailMessage(
    parsed,
    fetched.uid,
    fetched.flags || new Set(),
    options,
  );
}
