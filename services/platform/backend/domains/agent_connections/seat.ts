import type { Sql, TransactionSql } from 'postgres';

/**
 * What the MCP door reads of a coding agent's connection on every call it
 * makes. Its own module so the REST door, which only reads, imports none of
 * the app's list-and-disconnect service (and the errors that answer the app
 * alone).
 */

type Db = Sql | TransactionSql;

/** What the MCP door needs of a connection to admit a call made with an
 * agent's access token. */
export interface AgentConnectionSeat {
  connectionId: string;
  clientName: string;
  /** The access the person allowed. */
  scopes: string[];
  /** When the connection was made — a token minted before it belongs to an
   * earlier connection of the same app. */
  createdAt: number;
  organizationSlug: string;
  /** The person's role in the organization now, lower-cased. */
  role: string;
  email: string;
}

/**
 * The live connection of one person and app in one organization, with the
 * person's seat in it — or null when there is none: the connection never
 * was, ended, or the person has no seat any more (or one that was switched
 * off). One read on every call an agent makes, by the live-connection index.
 */
export async function findLiveConnectionSeat(
  db: Db,
  args: { organizationId: string; userId: string; clientId: string },
): Promise<AgentConnectionSeat | null> {
  const rows = await db<AgentConnectionSeat[]>`
    SELECT c.id AS "connectionId", c.client_name AS "clientName", c.scopes,
           c.created_at_ms::float8 AS "createdAt",
           o."slug" AS "organizationSlug", lower(m."role") AS role,
           u."email" AS email
    FROM app.agent_connections c
    JOIN "member" m
      ON m."organizationId" = c.org_id AND m."userId" = c.user_id
    JOIN "organization" o ON o."id" = c.org_id
    JOIN "user" u ON u."id" = c.user_id
    WHERE c.org_id = ${args.organizationId} AND c.user_id = ${args.userId}
      AND c.client_id = ${args.clientId} AND c.revoked_at_ms IS NULL
      AND lower(m."role") <> 'disabled'
    LIMIT 1
  `;
  return rows[0] ?? null;
}
