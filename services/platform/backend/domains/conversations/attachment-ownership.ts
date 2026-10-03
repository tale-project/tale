import type { Sql, TransactionSql } from 'postgres';

import { firstForeignUpload } from '../files/upload-intents.ts';
import { ConversationError } from './service.ts';

/**
 * Outbound attachments are client-named blob refs the connector will READ
 * and mail out of the organization. Each must be the sender's own upload
 * (their upload intent, or a row they registered) — a document's ref, which
 * every reader of that document holds, is not theirs to send.
 *
 * The proof that counts runs inside the transaction that writes the queued
 * message (`send.ts`' `sendMessageViaConnectorInTx`, `api-sync.ts`'
 * `queueApiReply`), because it STAMPS the intents it proves through
 * (`ownsUploadedBlob`): a refusal anywhere in that transaction rolls the
 * stamps back with the message, and a rejected-upload reclaim racing the
 * send waits on the intent row. The route asks first with `stamp: false`,
 * so a foreign attachment is still refused before any other check; a stamp
 * the route committed on its own used to outlive every later refusal and
 * leave an upload no reclaim could take (#4111).
 */
export async function assertOwnedAttachments(
  sql: Sql | TransactionSql,
  scope: { organizationId: string; userId: string },
  attachments: readonly { storageId: string }[] | undefined,
  options: { stamp?: boolean } = {},
): Promise<void> {
  if (attachments === undefined || attachments.length === 0) return;
  const foreign = await firstForeignUpload(
    sql,
    scope,
    attachments.map((attachment) => attachment.storageId),
    options,
  );
  if (foreign !== null) {
    throw new ConversationError(
      'ATTACHMENT_NOT_OWNED',
      'An attachment is not one of your uploads. Remove it and attach the file again.',
      403,
    );
  }
}
