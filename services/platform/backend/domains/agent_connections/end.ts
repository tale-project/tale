import type { TransactionSql } from 'postgres';

import { AGENT_CONNECTION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * Ending the connections of coding agents — the stamp, the sign-in the
 * agent can no longer use and the trail every ending shares, and the
 * retirements the platform runs when what a connection belonged to goes: a
 * seat in the organization, an account's credentials, an app's refresh
 * token that was used twice. Its own module so the membership cascade
 * (`auth/membership.ts`) can call it without a cycle through the
 * connections' door, which reads memberships.
 *
 * A connection is the organization's record (`app.agent_connections`); the
 * OAuth server keeps the consent and the refresh tokens (Better Auth's
 * `oauthConsent` and `oauthRefreshToken`). Ending a connection ends the
 * record, which the MCP door reads on every call — so the agent is refused
 * at once — and deletes the consent and every refresh token of the app for
 * this person in this organization, so it cannot sign itself in again. They
 * are deleted, never stamped revoked: the provider reads a refused refresh
 * token that is still on file as one used twice and ends every refresh
 * token of the app for the person, in their other organizations too.
 */

/** Why a connection ended. */
export type AgentConnectionEndReason =
  | 'user'
  | 'admin'
  | 'membership_ended'
  | 'account_security'
  | 'refresh_reuse'
  | 'client_removed';

/** A connection that {@link endAgentConnectionsInTx} ended. */
export interface EndedAgentConnection {
  id: string;
  organizationId: string;
  userId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
}

/** Who an ending is the act of, as its audit row names them. */
export interface AgentConnectionAuditActor {
  actorId: string;
  actorType: AuditLogActorType;
  actorRole?: string;
  actorEmail?: string;
  actorEmailHash?: string;
  ipAddress?: string;
  actorIpHash?: string;
  userAgent?: string;
}

/** The platform ending a connection nobody ended by hand. */
const SYSTEM_ACTOR: AgentConnectionAuditActor = {
  actorId: 'system',
  actorType: 'system',
};

/**
 * End the live connections that match every filter given — at least one is
 * required, so a call can never end them all by leaving its filters out —
 * inside the caller's own transaction. Each ending leaves one
 * `agent_connection.revoked` audit row naming who ended it and why, and
 * one hint to the organization. Answers what it ended.
 */
export async function endAgentConnectionsInTx(
  tx: TransactionSql,
  args: {
    organizationId?: string;
    userId?: string;
    clientId?: string;
    connectionIds?: readonly string[];
    reason: AgentConnectionEndReason;
    /** A user id, or `system`. */
    revokedBy: string;
    /** Who the audit rows name; the platform when left out. */
    actor?: AgentConnectionAuditActor;
  },
): Promise<EndedAgentConnection[]> {
  if (
    args.organizationId === undefined &&
    args.userId === undefined &&
    args.clientId === undefined &&
    args.connectionIds === undefined
  ) {
    throw new Error('Ending agent connections needs a filter');
  }
  if (args.connectionIds?.length === 0) return [];
  const now = Date.now();
  const ended = await tx<EndedAgentConnection[]>`
    UPDATE app.agent_connections SET
      revoked_at_ms = ${now},
      revoked_by = ${args.revokedBy},
      revoke_reason = ${args.reason}
    WHERE revoked_at_ms IS NULL
      ${args.organizationId === undefined ? tx`` : tx`AND org_id = ${args.organizationId}`}
      ${args.userId === undefined ? tx`` : tx`AND user_id = ${args.userId}`}
      ${args.clientId === undefined ? tx`` : tx`AND client_id = ${args.clientId}`}
      ${args.connectionIds === undefined ? tx`` : tx`AND id = ANY(${[...args.connectionIds]})`}
    RETURNING id, org_id AS "organizationId", user_id AS "userId",
              client_id AS "clientId", client_name AS "clientName", scopes
  `;
  for (const connection of ended) {
    // What the provider holds for this person's grant to this app in this
    // organization: consent and tokens are keyed by the organization the
    // grant was made for (`referenceId`).
    await tx`
      DELETE FROM "oauthAccessToken"
      WHERE "clientId" = ${connection.clientId}
        AND "userId" = ${connection.userId}
        AND "referenceId" = ${connection.organizationId}
    `;
    await tx`
      DELETE FROM "oauthAccessToken"
      WHERE "refreshId" IN (
        SELECT "id" FROM "oauthRefreshToken"
        WHERE "clientId" = ${connection.clientId}
          AND "userId" = ${connection.userId}
          AND "referenceId" = ${connection.organizationId}
      )
    `;
    await tx`
      DELETE FROM "oauthRefreshToken"
      WHERE "clientId" = ${connection.clientId}
        AND "userId" = ${connection.userId}
        AND "referenceId" = ${connection.organizationId}
    `;
    await tx`
      DELETE FROM "oauthConsent"
      WHERE "clientId" = ${connection.clientId}
        AND "userId" = ${connection.userId}
        AND "referenceId" = ${connection.organizationId}
    `;
    const actor = args.actor ?? SYSTEM_ACTOR;
    await createAuditLog(tx, {
      organizationId: connection.organizationId,
      ...actor,
      action: 'agent_connection.revoked',
      category: 'security',
      resourceType: 'agent_connection',
      resourceId: connection.id,
      resourceName: connection.clientName,
      previousState: {
        clientId: connection.clientId,
        userId: connection.userId,
        scopes: connection.scopes,
      },
      metadata: { reason: args.reason },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: connection.organizationId,
      entity: AGENT_CONNECTION_HINT_ENTITY,
      entityId: connection.id,
    });
  }
  return ended;
}
