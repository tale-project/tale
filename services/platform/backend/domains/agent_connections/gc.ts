import type { Sql } from 'postgres';

/**
 * The daily clean-up of what coding agents leave behind.
 *
 * - A connection that ended is history an admin can read; 90 days later it
 *   goes (the audit log keeps the trace).
 * - An app that registered itself or identified itself by a document, and
 *   that nobody has connected for a day, is removed with what hangs off it:
 *   a stranger's registration costs a row, never a place in the list for
 *   ever. An app with a live connection, or a refresh token that still
 *   works, is never removed.
 * - The refresh and access tokens of those apps that expired or were retired
 *   a month ago go.
 *
 * Only the apps coding agents sign in with are touched: a client an
 * organization registered for single sign-on belongs to an organization or
 * a person and is never selected.
 */

const DAY_MS = 86_400_000;

/** How long an ended connection stays as history. */
export const ENDED_CONNECTION_RETENTION_DAYS = 90;

/** How long an app nobody connected stays registered. */
export const UNUSED_APP_GRACE_HOURS = 24;

/** How long a retired or expired token stays on file. */
export const RETIRED_TOKEN_RETENTION_DAYS = 30;

export interface AgentConnectionsGcResult {
  /** Ended connections removed. */
  readonly connections: number;
  /** Apps nobody connected, removed. */
  readonly apps: number;
  /** Retired or expired refresh tokens removed. */
  readonly refreshTokens: number;
  /** Expired access tokens removed. */
  readonly accessTokens: number;
}

/** Clean up, in one transaction. `now` is epoch milliseconds. */
export async function gcAgentConnections(
  sql: Sql,
  now: number = Date.now(),
): Promise<AgentConnectionsGcResult> {
  const endedBefore = now - ENDED_CONNECTION_RETENTION_DAYS * DAY_MS;
  const unusedSince = new Date(now - UNUSED_APP_GRACE_HOURS * 3_600_000);
  const tokensBefore = new Date(now - RETIRED_TOKEN_RETENTION_DAYS * DAY_MS);
  const asOf = new Date(now);
  return sql.begin(async (tx) => {
    const connections = await tx<{ id: string }[]>`
      DELETE FROM app.agent_connections
      WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms < ${endedBefore}
      RETURNING id
    `;
    // The provider's tables cascade from the client: its consent, its
    // tokens and its links to the endpoint go with it.
    // The apps coding agents sign in with — not an organization's, not a
    // person's, allowed to ask for the MCP endpoint — in each statement.
    const apps = await tx<{ clientId: string }[]>`
      DELETE FROM "oauthClient" AS agent_app
      WHERE agent_app."referenceId" IS NULL AND agent_app."userId" IS NULL
        AND agent_app."scopes" @> '["tale:mcp"]'::jsonb
        AND agent_app."createdAt" < ${unusedSince}
        AND NOT EXISTS (
          SELECT 1 FROM app.agent_connections AS live
          WHERE live.client_id = agent_app."clientId"
            AND live.revoked_at_ms IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM "oauthRefreshToken" AS working
          WHERE working."clientId" = agent_app."clientId"
            AND working."revoked" IS NULL AND working."expiresAt" > ${asOf}
        )
      RETURNING agent_app."clientId" AS "clientId"
    `;
    const refreshTokens = await tx<{ id: string }[]>`
      DELETE FROM "oauthRefreshToken"
      WHERE ("revoked" < ${tokensBefore} OR "expiresAt" < ${tokensBefore})
        AND "clientId" IN (
          SELECT "clientId" FROM "oauthClient"
          WHERE "referenceId" IS NULL AND "userId" IS NULL
            AND "scopes" @> '["tale:mcp"]'::jsonb
        )
      RETURNING "id"
    `;
    const accessTokens = await tx<{ id: string }[]>`
      DELETE FROM "oauthAccessToken"
      WHERE "expiresAt" < ${tokensBefore}
        AND "clientId" IN (
          SELECT "clientId" FROM "oauthClient"
          WHERE "referenceId" IS NULL AND "userId" IS NULL
            AND "scopes" @> '["tale:mcp"]'::jsonb
        )
      RETURNING "id"
    `;
    return {
      connections: connections.length,
      apps: apps.length,
      refreshTokens: refreshTokens.length,
      accessTokens: accessTokens.length,
    };
  });
}
