import type { TransactionSql } from 'postgres';

import { notifyUser } from '../collab/service.ts';
import {
  type AgentConnectionEndReason,
  endAgentConnectionsInTx,
  type EndAgentConnectionsArgs,
  type EndedAgentConnection,
} from './end.ts';

/**
 * Ending the connections of coding agents when something other than the
 * person's own hand does it, and telling them: a notice in their bell, in
 * the organization the connection was to — never an e-mail, never to anyone
 * else. What `end.ts` does for every ending (the stamp, the sign-in, the
 * audit row, the hint) this does too; the notice is what it adds.
 *
 * An ending that tells nobody calls `end.ts` itself: a seat that ended (the
 * person can no longer read that organization's bell) and an erasure (which
 * removes every trace of the person and writes none anew). Every other
 * ending comes through here, so a new way to end an agent tells the person
 * unless it says it must not.
 */

/** The bell row a person gets when an agent they connected is disconnected
 * by something other than themselves. */
const AGENT_CONNECTION_ENDED_NOTIFICATION_TYPE = 'agent_connection_ended';

/** What each ending tells the person. The ones that are their own — they
 * disconnected it — or that need no telling are left out. */
const NOTICE_BODY_KEYS: Partial<Record<AgentConnectionEndReason, string>> = {
  refresh_reuse: 'agentConnectionEndedReuseBody',
  account_security: 'agentConnectionEndedAccountBody',
  admin: 'agentConnectionEndedAdminBody',
};

/** The admin who ended a connection, as the person reads them. */
interface NamedAdmin {
  id: string;
  name: string;
}

/**
 * End the live connections the filters name, as `end.ts` does, and write the
 * person's notice for each one that something other than themselves ended.
 * Answers what it ended.
 */
export async function endAgentConnectionsAndTellInTx(
  tx: TransactionSql,
  args: EndAgentConnectionsArgs,
): Promise<EndedAgentConnection[]> {
  const ended = await endAgentConnectionsInTx(tx, args);
  const bodyKey = NOTICE_BODY_KEYS[args.reason];
  if (bodyKey === undefined || ended.length === 0) return ended;
  const admin =
    args.reason === 'admin' ? await nameAdmin(tx, args.revokedBy) : null;
  for (const connection of ended) {
    await tellPerson(tx, connection, bodyKey, admin);
  }
  return ended;
}

/** An admin as a person reads them: their name, else their address. */
async function nameAdmin(
  tx: TransactionSql,
  userId: string,
): Promise<NamedAdmin> {
  const rows = await tx<{ name: string | null; email: string }[]>`
    SELECT "name", "email" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  const row = rows[0];
  return { id: userId, name: row?.name?.trim() || row?.email || userId };
}

/**
 * One notice. A notice that cannot be written is logged and never undoes
 * the ending — the ending is the security act — so the write is one the
 * transaction can give up alone.
 */
async function tellPerson(
  tx: TransactionSql,
  connection: EndedAgentConnection,
  bodyKey: string,
  admin: NamedAdmin | null,
): Promise<void> {
  try {
    await tx.savepoint((sp) =>
      notifyUser(sp, {
        organizationId: connection.organizationId,
        userId: connection.userId,
        type: AGENT_CONNECTION_ENDED_NOTIFICATION_TYPE,
        titleKey: 'agentConnectionEnded',
        bodyKey,
        params: {
          client: connection.clientName,
          ...(admin === null ? {} : { name: admin.name }),
          agentConnections: true,
        },
        resourceType: 'agent_connection',
        resourceId: connection.id,
        actorType: admin === null ? 'system' : 'user',
        ...(admin === null ? {} : { actorId: admin.id }),
      }),
    );
  } catch (error) {
    console.error(
      '[agent-connections] the notice of a disconnected agent was not written',
      error instanceof Error ? error.message : error,
    );
  }
}
