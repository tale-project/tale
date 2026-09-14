import type { Sql, TransactionSql } from 'postgres';

import { isEmailChannel } from '../../core/conversations/channel.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { runConnectorAction } from '../connectors/service.ts';

/**
 * Telling a product that its conversation was closed or reopened.
 *
 * Closing in the Inbox raises `conversation.closed`, and that event fans out to
 * the org's automation triggers — which is useful, and is not the same thing as
 * telling the product that owns the customer's view of the thread. Without this
 * lane a customer's copy said "we're on it" forever while the case had been
 * finished for a week.
 *
 * Mail conversations enqueue nothing: there is no product behind them, and the
 * customer's copy of an email thread is their own mailbox.
 */

interface ConversationStatusTarget {
  id: string;
  organizationId: string;
  channel: string | null;
  connectorName: string | null;
  credentialId: string | null;
  contactExternalId?: string | null;
}

/**
 * Queue the notice, inside the transaction that changed the status — so a
 * rolled-back close never tells anyone it happened, and a committed one always
 * does.
 */
export async function notifyChannelStatusInTx(
  tx: TransactionSql,
  conversation: ConversationStatusTarget,
  status: string,
): Promise<void> {
  if (isEmailChannel(conversation.channel)) return;
  if (!conversation.connectorName) return;

  await addJobInTx(tx, 'conversation.notify_status', {
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    connectorName: conversation.connectorName,
    ...(conversation.credentialId !== null
      ? { credentialRef: conversation.credentialId }
      : {}),
    status,
    to: conversation.contactExternalId ? [conversation.contactExternalId] : [],
  });
}

/**
 * Deliver one status notice. Retryable: the receiver keys on the conversation
 * and the delivery id, so the same fact arriving twice is not a duplicate the
 * way a repeated MESSAGE would be.
 */
export async function runNotifyStatusJob(
  sql: Sql,
  payload: TaskPayloads['conversation.notify_status'],
): Promise<void> {
  const result = await runConnectorAction(sql, {
    organizationId: payload.organizationId,
    connector: payload.connectorName,
    action: 'send_status',
    input: {
      conversationId: payload.conversationId,
      status: payload.status,
      to: payload.to,
    },
    ...(payload.credentialRef !== undefined
      ? { credentialRef: payload.credentialRef }
      : {}),
    mode: 'live',
    caller: { kind: 'system', reason: 'conversation status notice' },
  });
  if (result.status !== 'ok') {
    // Thrown so pg-boss retries: unlike a send, there is no customer-visible
    // row to mark failed, and a lost notice leaves the product's copy wrong.
    throw new Error(result.message);
  }
}
