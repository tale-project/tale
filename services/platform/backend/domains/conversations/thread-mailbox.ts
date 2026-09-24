/**
 * Which mailbox a thread belongs to — the ONE answer the reply route and the
 * Inbox's mailbox name share, so the name a thread shows is the mailbox its
 * reply leaves from.
 *
 * `connector_name` names the connector (`imap-smtp`), never the account, and
 * an organization may hold several credentials on one connector. Two answers
 * are read, in order:
 *
 * 1. The credential recorded on the thread's newest INBOUND message (0113).
 *    The newest wins: a thread moved to another mailbox answers from where it
 *    now arrives. Where they wrote beats where we sent, so an inbound stamp
 *    wins over any outbound one. A thread with no inbound stamp — one composed
 *    in Tale and not yet answered — takes the credential its newest outbound
 *    message was sent through.
 * 2. For a thread with no recorded credential (its messages predate 0113):
 *    the active credential whose mailbox address is the address on our side
 *    of the envelope. Only an exact, unique match counts — two mailboxes
 *    claiming one address is no answer at all.
 *
 * A thread neither answers is left out. Its reply falls through to the
 * connector's default credential, and the Inbox names no mailbox for it.
 */

import type { Sql } from 'postgres';

import { mailboxSideAddress } from '../../../lib/shared/conversations/reply-from.ts';
import { storedImapFromAddress } from '../../core/connector_credentials/imap_from_address.ts';

export interface MailboxThread {
  id: string;
  channel: string | null;
  connectorName: string | null;
  direction: 'inbound' | 'outbound' | null;
  metadata: Record<string, unknown> | null;
}

function normalizedAddress(address: string | undefined): string | undefined {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/** A mailbox's own address as answer 2 compares it: its configured
 *  `fromAddress`, trimmed and lowercased. */
export function mailboxAddressOf(row: {
  config: Record<string, string | number | boolean> | null;
}): string | undefined {
  return normalizedAddress(
    storedImapFromAddress({ config: row.config ?? undefined }),
  );
}

/**
 * Answer 1 as SQL, for one row of `app.conversations` (referenced unaliased
 * as `conversations`). ONE fragment, shared by every statement that asks it,
 * so the resolver and the Inbox filter cannot disagree about a thread.
 */
export function recordedCredentialSql(sql: Sql) {
  return sql`(
    SELECT m.credential_id FROM app.conversation_messages m
    WHERE m.conversation_id = conversations.id
      AND m.org_id = conversations.org_id
      AND m.credential_id IS NOT NULL
    ORDER BY (m.direction = 'inbound') DESC,
      coalesce(m.sent_at_ms, m.delivered_at_ms, m.created_at_ms) DESC,
      m.seq DESC
    LIMIT 1
  )`;
}

/**
 * The address on our side of one `app.conversations` row, as SQL: the twin of
 * `mailboxSideAddress` (the sender of outbound mail, else the first
 * recipient), trimmed and lowercased like `normalizedAddress`. A malformed
 * envelope (not an array, an entry without a string address) yields NULL.
 */
export function mailboxSideAddressSql(sql: Sql) {
  return sql`lower(btrim(CASE
    WHEN conversations.direction = 'outbound'
      AND jsonb_typeof(conversations.metadata->'from'->0->'address') = 'string'
      THEN conversations.metadata->'from'->0->>'address'
    WHEN jsonb_typeof(conversations.metadata->'to'->0->'address') = 'string'
      THEN conversations.metadata->'to'->0->>'address'
  END, E' \\t\\n\\r'))`;
}

/** One mailbox as the Inbox filters by it. `address` is set only when answer
 *  2 could place a thread on it: the mailbox is active and no other active
 *  mailbox on its connector claims the same address. */
export interface MailboxFilter {
  id: string;
  connectorSlug: string;
  address: string | null;
}

/**
 * Read the mailbox a filter names, with its connector's other mailboxes (for
 * answer 2's uniqueness). `null` when the organization has no such mailbox —
 * the filter then matches nothing.
 */
export async function resolveMailboxFilter(
  sql: Sql,
  organizationId: string,
  credentialId: string,
): Promise<MailboxFilter | null> {
  const rows = await sql<
    {
      id: string;
      connectorSlug: string;
      status: string;
      config: Record<string, string | number | boolean> | null;
    }[]
  >`
    SELECT id, connector_slug AS "connectorSlug", status, config
    FROM app.connector_credentials
    WHERE org_id = ${organizationId}
      AND connector_slug = (
        SELECT connector_slug FROM app.connector_credentials
        WHERE id = ${credentialId} AND org_id = ${organizationId}
      )
  `;
  const mailbox = rows.find((row) => row.id === credentialId);
  if (mailbox === undefined) return null;
  const address =
    mailbox.status === 'active' ? mailboxAddressOf(mailbox) : undefined;
  const shared =
    address !== undefined &&
    rows.some(
      (row) =>
        row.id !== mailbox.id &&
        row.status === 'active' &&
        mailboxAddressOf(row) === address,
    );
  return {
    id: mailbox.id,
    connectorSlug: mailbox.connectorSlug,
    address: address !== undefined && !shared ? address : null,
  };
}

/**
 * The threads the resolver places on one mailbox, as a WHERE clause over
 * `app.conversations`: answer 1 names it, or answer 1 names nothing and answer
 * 2's address matches. Restricted to the mailbox's own connector, because the
 * Inbox names a thread only by a mailbox on the thread's connector.
 */
export function mailboxFilterSql(sql: Sql, mailbox: MailboxFilter) {
  return sql`
    AND conversations.connector_name = ${mailbox.connectorSlug}
    AND conversations.channel IS DISTINCT FROM 'api'
    AND ${mailbox.id}::text = coalesce(
      ${recordedCredentialSql(sql)},
      CASE WHEN ${mailbox.address}::text IS NOT NULL
        AND ${mailboxSideAddressSql(sql)} = ${mailbox.address}::text
        THEN ${mailbox.id}::text END
    )
  `;
}

/**
 * Answer 1 for a thread the caller already holds, oldest message first
 * (`listConversationMessages` order).
 */
export function newestRecordedCredential(
  messages: readonly {
    direction: 'inbound' | 'outbound';
    credentialId: string | null;
  }[],
): string | undefined {
  const newest =
    messages.findLast(
      (message) =>
        message.direction === 'inbound' && message.credentialId !== null,
    ) ?? messages.findLast((message) => message.credentialId !== null);
  return newest?.credentialId ?? undefined;
}

function isEmailThread(thread: MailboxThread): boolean {
  return (
    thread.channel !== 'api' &&
    thread.connectorName !== null &&
    thread.connectorName !== ''
  );
}

/**
 * Answer 2 for the threads answer 1 left open. Reads the credentials only when
 * one of them carries an address to match.
 */
async function matchByAddress(
  sql: Sql,
  organizationId: string,
  threads: readonly MailboxThread[],
  resolved: Map<string, string>,
): Promise<void> {
  const open = threads.flatMap((thread) => {
    const address = normalizedAddress(
      mailboxSideAddress(
        thread.metadata ?? undefined,
        thread.direction ?? undefined,
      ),
    );
    return thread.connectorName !== null && address !== undefined
      ? [{ id: thread.id, connectorSlug: thread.connectorName, address }]
      : [];
  });
  if (open.length === 0) return;

  const mailboxes = await sql<
    {
      id: string;
      connectorSlug: string;
      config: Record<string, string | number | boolean> | null;
    }[]
  >`
    SELECT id, connector_slug AS "connectorSlug", config
    FROM app.connector_credentials
    WHERE org_id = ${organizationId}
      AND connector_slug = ANY(${[...new Set(open.map((t) => t.connectorSlug))]})
      AND status = 'active'
  `;
  for (const thread of open) {
    const matches = mailboxes.filter(
      (mailbox) =>
        mailbox.connectorSlug === thread.connectorSlug &&
        mailboxAddressOf(mailbox) === thread.address,
    );
    const [only] = matches;
    if (only !== undefined && matches.length === 1) {
      resolved.set(thread.id, only.id);
    }
  }
}

/**
 * The credential each thread belongs to, keyed by conversation id. Batched:
 * two statements at most, whatever the number of threads.
 */
export async function resolveThreadCredentials(
  sql: Sql,
  organizationId: string,
  threads: readonly MailboxThread[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const email = threads.filter(isEmailThread);
  if (email.length === 0) return resolved;

  const recorded = await sql<
    { conversationId: string; credentialId: string | null }[]
  >`
    SELECT id AS "conversationId",
      ${recordedCredentialSql(sql)} AS "credentialId"
    FROM app.conversations
    WHERE org_id = ${organizationId}
      AND id = ANY(${email.map((thread) => thread.id)})
  `;
  for (const row of recorded) {
    if (row.credentialId !== null) {
      resolved.set(row.conversationId, row.credentialId);
    }
  }

  await matchByAddress(
    sql,
    organizationId,
    email.filter((thread) => !resolved.has(thread.id)),
    resolved,
  );
  return resolved;
}

/**
 * The same answer for a thread whose messages the caller already holds, in
 * `listConversationMessages` order (oldest first), so answer 1 needs no read.
 */
export async function resolveHeldThreadCredential(
  sql: Sql,
  organizationId: string,
  thread: MailboxThread,
  messages: readonly {
    direction: 'inbound' | 'outbound';
    credentialId: string | null;
  }[],
): Promise<string | undefined> {
  if (!isEmailThread(thread)) return undefined;
  const recorded = newestRecordedCredential(messages);
  if (recorded !== undefined) return recorded;

  const resolved = new Map<string, string>();
  await matchByAddress(sql, organizationId, [thread], resolved);
  return resolved.get(thread.id);
}
