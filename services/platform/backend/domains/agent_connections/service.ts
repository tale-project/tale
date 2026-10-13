import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { AGENT_CONNECTION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { mayConnectAgentIn } from '../../auth/api-key-create-gate.ts';
import { isAdminRole } from '../../auth/membership.ts';
import {
  splitEmailForAudit,
  splitIpForAudit,
} from '../../core/lib/helpers/pii_hash.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { endAgentConnectionsAndTellInTx } from './end-and-tell.ts';
import type {
  AgentConnectionAuditActor,
  AgentConnectionEndReason,
} from './end.ts';

/**
 * The coding agents people connected to an organization by signing in on
 * the MCP endpoint: one record for each person, organization and app
 * (`app.agent_connections`), made when the person allows the app at the
 * sign-in server, listed to the person who made it and to the organization's
 * owners and admins, and ended by either of them — or by what the person
 * loses (`end.ts`).
 *
 * Better Auth owns the app, the consent and the tokens; the record here is
 * what the organization keeps of the grant and what the MCP door checks on
 * every call.
 */

type Db = Sql | TransactionSql;

/** How the app made itself known. */
export type AgentClientProvenance = 'metadata_document' | 'registered';

/** One connection as the app lists it. */
export interface AgentConnection {
  id: string;
  organizationId: string;
  userId: string;
  clientId: string;
  clientName: string;
  provenance: AgentClientProvenance;
  /** The verified host of an app that identifies itself by a metadata
   * document; null for one that registered itself. */
  clientHost: string | null;
  /** Where Tale sends the person back to, as the consent page showed it. */
  redirectHost: string;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
  revokeReason: AgentConnectionEndReason | null;
}

/** A connection as the list shows it, with when its agent last called and
 * who connected it. */
export interface ListedAgentConnection extends AgentConnection {
  /** The last call the MCP endpoint answered with this connection, from the
   * endpoint's own counters (`app.mcp_client_activity`) and never from what
   * the agent claims; null before its first. */
  lastUsedAt: number | null;
  /** The person's name and address, so an owner or admin reading everyone's
   * connections can tell whose each is. Null where the account no longer
   * holds one. */
  personName: string | null;
  personEmail: string | null;
}

export class AgentConnectionError extends Error {
  readonly code: string;
  readonly status: 404;

  constructor(code: string, message: string, status: 404) {
    super(message);
    this.name = 'AgentConnectionError';
    this.code = code;
    this.status = status;
  }
}

/** The most connections one listing answers: the newest. */
const LIST_LIMIT = 500;

/** The columns of a connection, as {@link AgentConnection} names them. */
function columns(db: Db) {
  return db`
    id, org_id AS "organizationId", user_id AS "userId",
    client_id AS "clientId", client_name AS "clientName",
    client_provenance AS "provenance", client_host AS "clientHost",
    redirect_host AS "redirectHost", scopes,
    created_at_ms::float8 AS "createdAt",
    updated_at_ms::float8 AS "updatedAt",
    revoked_at_ms::float8 AS "revokedAt", revoked_by AS "revokedBy",
    revoke_reason AS "revokeReason"
  `;
}

/** What a person allowed an app, as the sign-in server's consent gate
 * hands it over. */
export interface ConnectAgentInput {
  organizationId: string;
  userId: string;
  clientId: string;
  /** Already cleaned for display (`displayClientName`). */
  clientName: string;
  provenance: AgentClientProvenance;
  clientHost: string | null;
  redirectHost: string;
  scopes: readonly string[];
  /** The person, as the audit rows name them. */
  actor: AgentConnectionAuditActor;
}

function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((scope) => b.includes(scope));
}

/**
 * Record that a person allowed an app to work in an organization: a new
 * connection, or — when the same app is already connected there — the same
 * connection with the access they allow now. Answers the connection and
 * whether it is new; one audit row says which, and a change of access
 * names the access before and after. Serialized by person, organization and
 * app, so two consents at once leave one live connection.
 */
export async function connectAgent(
  sql: Sql,
  input: ConnectAgentInput,
): Promise<{
  connection: AgentConnection;
  created: boolean;
  scopesChanged: boolean;
}> {
  const scopes = [...new Set(input.scopes)];
  return sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtextextended(
        ${`agent-connection:${input.organizationId}/${input.userId}/${input.clientId}`}, 0
      ))
    `;
    const existing = (
      await tx<AgentConnection[]>`
        SELECT ${columns(tx)} FROM app.agent_connections
        WHERE org_id = ${input.organizationId} AND user_id = ${input.userId}
          AND client_id = ${input.clientId} AND revoked_at_ms IS NULL
        FOR UPDATE
      `
    )[0];
    const now = Date.now();
    if (existing === undefined) {
      const inserted = await tx<AgentConnection[]>`
        INSERT INTO app.agent_connections (
          id, org_id, user_id, client_id, client_name, client_provenance,
          client_host, redirect_host, scopes, created_at_ms, updated_at_ms
        ) VALUES (
          ${randomUUID()}, ${input.organizationId}, ${input.userId},
          ${input.clientId}, ${input.clientName}, ${input.provenance},
          ${input.clientHost}, ${input.redirectHost}, ${scopes}::text[],
          ${now}, ${now}
        )
        RETURNING ${columns(tx)}
      `;
      const connection = inserted[0];
      if (connection === undefined) {
        throw new Error('The agent connection was not written');
      }
      await createAuditLog(tx, {
        organizationId: input.organizationId,
        ...input.actor,
        action: 'agent_connection.created',
        category: 'security',
        resourceType: 'agent_connection',
        resourceId: connection.id,
        resourceName: connection.clientName,
        newState: {
          clientId: connection.clientId,
          provenance: connection.provenance,
          clientHost: connection.clientHost,
          redirectHost: connection.redirectHost,
          scopes: connection.scopes,
        },
        status: 'success',
      });
      await emitHintInTx(tx, {
        orgId: input.organizationId,
        entity: AGENT_CONNECTION_HINT_ENTITY,
        entityId: connection.id,
      });
      return { connection, created: true, scopesChanged: false };
    }
    const scopesChanged = !sameScopes(existing.scopes, scopes);
    const updated = await tx<AgentConnection[]>`
      UPDATE app.agent_connections SET
        client_name = ${input.clientName},
        client_provenance = ${input.provenance},
        client_host = ${input.clientHost},
        redirect_host = ${input.redirectHost},
        scopes = ${scopes}::text[],
        updated_at_ms = ${now}
      WHERE id = ${existing.id}
      RETURNING ${columns(tx)}
    `;
    const connection = updated[0];
    if (connection === undefined) {
      throw new Error('The agent connection was not written');
    }
    if (scopesChanged) {
      await createAuditLog(tx, {
        organizationId: input.organizationId,
        ...input.actor,
        action: 'agent_connection.updated',
        category: 'security',
        resourceType: 'agent_connection',
        resourceId: connection.id,
        resourceName: connection.clientName,
        previousState: { scopes: existing.scopes },
        newState: { scopes: connection.scopes },
        status: 'success',
      });
    }
    await emitHintInTx(tx, {
      orgId: input.organizationId,
      entity: AGENT_CONNECTION_HINT_ENTITY,
      entityId: connection.id,
    });
    return { connection, created: false, scopesChanged };
  });
}

/**
 * The connections a person sees in one organization: their own, or — for an
 * owner or admin who asks for everyone's — every one. Newest first, at most
 * {@link LIST_LIMIT}, each with when its agent last called. Ended ones are
 * listed only to an owner or admin who asks for them. `since` keeps the
 * connections made, changed or ended after that moment (epoch milliseconds),
 * which is how a setup step waits for the first one.
 */
export async function listAgentConnections(
  db: Db,
  args: {
    organizationId: string;
    viewerId: string;
    viewerRole: string;
    everyone?: boolean;
    includeEnded?: boolean;
    since?: number;
  },
): Promise<{
  connections: ListedAgentConnection[];
  canSeeEveryone: boolean;
}> {
  const canSeeEveryone = isAdminRole(args.viewerRole);
  const all = canSeeEveryone && args.everyone === true;
  const ended = canSeeEveryone && args.includeEnded === true;
  const connections = await db<ListedAgentConnection[]>`
    SELECT ${columns(db)}, (
      SELECT MAX(last_at_ms)::float8 FROM app.mcp_client_activity
      WHERE org_id = c.org_id AND user_id = c.user_id
        AND credential_kind = 'oauth' AND credential_id = c.id
    ) AS "lastUsedAt",
    person."name" AS "personName", person."email" AS "personEmail"
    FROM app.agent_connections c
    LEFT JOIN LATERAL (
      SELECT "name", "email" FROM "user" WHERE "id" = c.user_id
    ) person ON true
    WHERE org_id = ${args.organizationId}
      ${all ? db`` : db`AND user_id = ${args.viewerId}`}
      ${ended ? db`` : db`AND revoked_at_ms IS NULL`}
      ${
        args.since === undefined
          ? db``
          : db`AND GREATEST(created_at_ms, updated_at_ms, COALESCE(revoked_at_ms, 0)) > ${args.since}`
      }
    ORDER BY created_at_ms DESC, id
    LIMIT ${LIST_LIMIT}
  `;
  return { connections, canSeeEveryone };
}

/**
 * What a person has to do with coding agents in one organization: whether
 * they may connect one here (the rule the consent gate holds them to), and
 * whether they hold a live connection — which they keep seeing, and ending,
 * after the right to connect lapsed. Settings shows the Connected agents
 * page to a member who has either.
 */
export async function readAgentConnectionAccess(
  db: Sql,
  args: { organizationId: string; userId: string; role: string },
): Promise<{ mayConnect: boolean; holdsConnection: boolean }> {
  const [mayConnect, held] = await Promise.all([
    mayConnectAgentIn(db, { ...args, role: args.role.toLowerCase() }),
    db<{ id: string }[]>`
      SELECT id FROM app.agent_connections
      WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
        AND revoked_at_ms IS NULL
      LIMIT 1
    `,
  ]);
  return { mayConnect, holdsConnection: held.length > 0 };
}

/** The signed-in person acting on a connection here, as the audit rows name
 * them. */
export interface AgentConnectionViewer {
  userId: string;
  role: string;
  email?: string;
  ip?: string;
  userAgent?: string;
}

/** The person as an audit row names its actor: their address and the
 * network they came from, in the form the organization's audit policy
 * keeps. */
export async function agentConnectionActor(
  viewer: AgentConnectionViewer,
): Promise<AgentConnectionAuditActor> {
  const emailParts =
    viewer.email === undefined ? {} : await splitEmailForAudit(viewer.email);
  const ipParts =
    viewer.ip === undefined ? {} : await splitIpForAudit(viewer.ip);
  return {
    actorId: viewer.userId,
    actorType: 'user',
    actorRole: viewer.role,
    ...(emailParts.plaintext === undefined
      ? {}
      : { actorEmail: emailParts.plaintext }),
    ...(emailParts.hash === undefined
      ? {}
      : { actorEmailHash: emailParts.hash }),
    ...(ipParts.plaintext === undefined
      ? {}
      : { ipAddress: ipParts.plaintext }),
    ...(ipParts.hash === undefined ? {} : { actorIpHash: ipParts.hash }),
    ...(viewer.userAgent === undefined ? {} : { userAgent: viewer.userAgent }),
  };
}

/**
 * End a connection the person may end: their own, or — for an owner or
 * admin — anyone's in this organization. A connection that is another
 * person's to a member, one of another organization and one that already
 * ended are all not found, never forbidden: the answer reveals nothing of
 * what the person may not see.
 */
export async function disconnectAgent(
  sql: Sql,
  args: {
    organizationId: string;
    connectionId: string;
    viewer: AgentConnectionViewer;
  },
): Promise<{ id: string }> {
  const actor = await agentConnectionActor(args.viewer);
  return sql.begin(async (tx) => {
    const row = (
      await tx<{ id: string; userId: string }[]>`
        SELECT id, user_id AS "userId" FROM app.agent_connections
        WHERE id = ${args.connectionId} AND org_id = ${args.organizationId}
          AND revoked_at_ms IS NULL
        FOR UPDATE
      `
    )[0];
    const own = row?.userId === args.viewer.userId;
    if (row === undefined || !(own || isAdminRole(args.viewer.role))) {
      throw new AgentConnectionError(
        'AGENT_CONNECTION_NOT_FOUND',
        'Agent connection not found.',
        404,
      );
    }
    await endAgentConnectionsAndTellInTx(tx, {
      organizationId: args.organizationId,
      connectionIds: [row.id],
      reason: own ? 'user' : 'admin',
      revokedBy: args.viewer.userId,
      actor,
    });
    return { id: row.id };
  });
}
