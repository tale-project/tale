import type { Sql } from 'postgres';

import { findConnector } from '../../../lib/connectors/catalog.ts';
import { generatePkcePair } from '../../core/enterprise_sso/pkce.ts';
import { buildAuthorizeUrl } from '../../core/http_connectors/authorize_url.ts';
import {
  oauthAppEnvPrefix,
  resolveConnectorSettingsUrl,
  resolveOauthRedirectUri,
} from '../../core/http_connectors/deployment_config.ts';
import {
  hashStateToken,
  isPlausibleStateToken,
  mintStateToken,
  OAUTH_STATE_TTL_MS,
} from '../../core/http_connectors/oauth_state.ts';
import {
  exchangeAuthorizationCode,
  type Oauth2Tokens,
} from '../../core/http_connectors/token_exchange.ts';
import {
  CREDENTIAL_NAME_MAX,
  createCredentialInTransaction,
  listCredentials,
  updateCredential,
} from '../connector_credentials/service.ts';
import {
  applyMicrosoftTenant,
  resolveConnectorOauthApp,
} from './oauth-apps.ts';

/**
 * The OAuth2 authorization-code flow for connectors on Postgres — the 0.4
 * `http_connectors/oauth_handlers.ts` re-hosted.
 *
 * Everything the flow's security rests on is REUSED verbatim from the 0.4
 * modules, because they are already host-neutral and each owns one rule:
 * the opaque single-use `state` (`oauth_state.ts`), PKCE S256
 * (`enterprise_sso/pkce.ts`), the deployment-fixed `redirect_uri` and the
 * env app-credential fallback (`deployment_config.ts` — org rows in
 * `oauth-apps.ts` resolve first), the authorize URL
 * builder with its vendor quirks (`authorize_url.ts`), and the scrubbed
 * server-to-server exchange (`token_exchange.ts`). The catalog stays the one
 * truth for a vendor's endpoints and scopes.
 *
 * What changes is the substrate: the pending authorization is a row in
 * `app.connector_oauth_states`, and single-use is a `DELETE … RETURNING` —
 * one statement, so two replayed callbacks cannot both observe it (the 0.4
 * property, kept by a different mechanism). The Slack workspace route is a
 * primary key on `team_id`, so "one workspace, one organization" is an
 * invariant the database holds rather than a read-two-and-refuse check.
 */

/** Connector slugs are catalog directory names — checked before any lookup. */
const CONNECTOR_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Oauth2Endpoints {
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
}

/**
 * The connector's declared OAuth2 endpoints, or null when the slug is not a
 * shipped connector or it offers no `oauth2` method. Reads the same catalog
 * the settings UI and the engine read — nothing here hardcodes a vendor URL.
 */
export function readOauth2Endpoints(
  connectorSlug: string,
): Oauth2Endpoints | null {
  if (!CONNECTOR_SLUG_RE.test(connectorSlug)) return null;
  const connector = findConnector(connectorSlug);
  if (!connector) return null;
  const oauth2 = connector.auth.find((entry) => entry.method === 'oauth2');
  if (!oauth2) return null;
  return {
    displayName: connector.displayName,
    authorizeUrl: oauth2.authorizeUrl,
    tokenUrl: oauth2.tokenUrl,
    scopes: oauth2.scopes,
  };
}

/** How many stale rows one mint clears — keeps the table bounded, no cron. */
const EXPIRED_SWEEP_LIMIT = 25;

export interface PendingAuthorization {
  organizationId: string;
  userId: string;
  connectorSlug: string;
  codeVerifier: string;
  redirectUri: string;
}

/** Record the authorization the browser is about to be redirected into. */
export async function createPendingAuthorization(
  sql: Sql,
  args: PendingAuthorization & { stateHash: string },
): Promise<void> {
  const now = Date.now();
  await sql`
    DELETE FROM app.connector_oauth_states
    WHERE state_hash IN (
      SELECT state_hash FROM app.connector_oauth_states
      WHERE expires_at_ms < ${now}
      LIMIT ${EXPIRED_SWEEP_LIMIT}
    )
  `;
  await sql`
    INSERT INTO app.connector_oauth_states (
      state_hash, org_id, user_id, connector_slug, code_verifier,
      redirect_uri, created_at_ms, expires_at_ms
    ) VALUES (
      ${args.stateHash}, ${args.organizationId}, ${args.userId},
      ${args.connectorSlug}, ${args.codeVerifier}, ${args.redirectUri},
      ${now}, ${now + OAUTH_STATE_TTL_MS}
    )
  `;
}

export type ConsumedAuthorization =
  | ({ ok: true } & PendingAuthorization)
  | { ok: false; reason: 'unknown' | 'expired' };

/**
 * Claim a pending authorization by its state hash and remove it, whatever the
 * outcome. `DELETE … RETURNING` makes the read and the delete one statement,
 * so a replay can never observe the row twice; an expired row is deleted too
 * (it can never become valid, and leaving it invites probing).
 */
export async function consumePendingAuthorization(
  sql: Sql,
  stateHash: string,
): Promise<ConsumedAuthorization> {
  const rows = await sql<
    {
      organizationId: string;
      userId: string;
      connectorSlug: string;
      codeVerifier: string;
      redirectUri: string;
      expiresAt: number;
    }[]
  >`
    DELETE FROM app.connector_oauth_states
    WHERE state_hash = ${stateHash}
    RETURNING org_id AS "organizationId", user_id AS "userId",
              connector_slug AS "connectorSlug",
              code_verifier AS "codeVerifier",
              redirect_uri AS "redirectUri",
              expires_at_ms::float8 AS "expiresAt"
  `;
  const row = rows[0];
  // "unknown" covers a forged state, another deployment's state and a replay
  // of one already consumed — deliberately indistinguishable to the caller.
  if (row === undefined) return { ok: false, reason: 'unknown' };
  if (row.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    organizationId: row.organizationId,
    userId: row.userId,
    connectorSlug: row.connectorSlug,
    codeVerifier: row.codeVerifier,
    redirectUri: row.redirectUri,
  };
}

/** The organization a Slack workspace is connected to, or null. */
export async function resolveTeamRoute(
  sql: Sql,
  teamId: string,
): Promise<{ organizationId: string; credentialId: string } | null> {
  const rows = await sql<{ organizationId: string; credentialId: string }[]>`
    SELECT org_id AS "organizationId", credential_id AS "credentialId"
    FROM app.connector_team_routes WHERE team_id = ${teamId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Point a workspace at this organization's credential. Refuses when another
 * organization already holds it — the upsert only matches its own org row, so
 * a foreign claim leaves the table untouched.
 */
export async function claimTeamRoute(
  sql: Sql,
  args: { teamId: string; organizationId: string; credentialId: string },
): Promise<{ ok: true } | { ok: false; reason: 'claimed_by_other_org' }> {
  const now = Date.now();
  const rows = await sql<{ teamId: string }[]>`
    INSERT INTO app.connector_team_routes (
      team_id, org_id, credential_id, created_at_ms, updated_at_ms
    ) VALUES (
      ${args.teamId}, ${args.organizationId}, ${args.credentialId},
      ${now}, ${now}
    )
    ON CONFLICT (team_id) DO UPDATE
      SET credential_id = EXCLUDED.credential_id, updated_at_ms = ${now}
      WHERE app.connector_team_routes.org_id = ${args.organizationId}
    RETURNING team_id AS "teamId"
  `;
  if (rows.length === 0) {
    console.warn(
      `[connectors:slack] refusing to re-point workspace ${args.teamId}: already connected to another organization`,
    );
    return { ok: false, reason: 'claimed_by_other_org' };
  }
  return { ok: true };
}

/**
 * The label a NEW credential gets among the names its (organization,
 * connector) siblings already hold: `base` itself when free, else
 * `base (2)`, `base (3)`, … — compared case-insensitively, the way the
 * table's unique index compares. Pure, so the rule is testable on its own.
 */
export function uniqueCredentialName(
  taken: readonly string[],
  base: string,
): string {
  const held = new Set(taken.map((name) => name.trim().toLowerCase()));
  let candidate = base;
  let counter = 1;
  while (held.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${base} (${counter})`;
  }
  return candidate;
}

/** Room a workspace-named label leaves for the ` (N)` a collision appends. */
const NAME_COUNTER_ROOM = 6;

export interface Oauth2GrantArgs {
  organizationId: string;
  connectorSlug: string;
  userId: string;
  /** The connector's catalog display name — the first credential's label. */
  displayName: string;
  tokens: Oauth2Tokens;
}

/**
 * Where a completed consent lands.
 *
 * A workspace this organization already connected — the team route names its
 * credential — is a RECONNECT: that credential takes the fresh grant and is
 * active again, so the settings card's Reconnect action (and a second consent
 * for the same workspace) renews what is there instead of failing on the
 * label it already holds. A connector with no workspace notion reconnects
 * the same way — the pair's one oauth2 credential (its default, when several
 * exist) is the grant being renewed. Everything else is a NEW connection: a
 * first one, or a second Slack workspace — stored under a label no sibling
 * holds (the connector's display name for the first, the workspace name or a
 * counter after that).
 */
export async function storeOauth2Grant(
  sql: Sql,
  args: Oauth2GrantArgs,
): Promise<{ credentialId: string; renewed: boolean }> {
  const { tokens } = args;
  const secret = {
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined
      ? { refreshToken: tokens.refreshToken }
      : {}),
    ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
    scopes: tokens.scopes,
  };
  const siblings = await listCredentials(
    sql,
    args.organizationId,
    args.connectorSlug,
  );
  const grants = siblings.filter((row) => row.authMethod === 'oauth2');

  let renewId: string | null = null;
  if (tokens.teamId !== undefined) {
    const route = await resolveTeamRoute(sql, tokens.teamId);
    if (
      route !== null &&
      route.organizationId === args.organizationId &&
      grants.some((row) => row.id === route.credentialId)
    ) {
      renewId = route.credentialId;
    }
  } else if (grants.length > 0) {
    const oldest = [...grants].sort((a, b) => a.createdAt - b.createdAt)[0];
    renewId = grants.find((row) => row.isDefault)?.id ?? oldest?.id ?? null;
  }

  if (renewId !== null) {
    await updateCredential(sql, {
      organizationId: args.organizationId,
      credentialId: renewId,
      secret,
      status: 'active',
      statusDetail: null,
    });
    console.info(
      `[connectors:oauth2] "${args.connectorSlug}" grant renewed for organization ${args.organizationId}`,
    );
    return { credentialId: renewId, renewed: true };
  }

  const workspace = tokens.teamName?.trim() ?? '';
  const base =
    grants.length === 0 || workspace.length === 0
      ? args.displayName
      : `${args.displayName} (${workspace})`.slice(
          0,
          CREDENTIAL_NAME_MAX - NAME_COUNTER_ROOM,
        );
  // Store the credential and claim the workspace in ONE transaction. Two
  // organizations can pass the pre-check for the same workspace at once;
  // the route's key decides the winner, and the loser must keep nothing —
  // a committed credential for a workspace routed elsewhere would be a
  // live foreign token stored (and default) for this organization.
  const name = uniqueCredentialName(
    siblings.map((row) => row.name),
    base,
  );
  let created!: { credentialId: string };
  await sql.begin(async (tx) => {
    created = await createCredentialInTransaction(tx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      authMethod: 'oauth2',
      name,
      createdBy: args.userId,
      secret,
    });
    if (tokens.teamId !== undefined) {
      const claim = await claimTeamRoute(tx, {
        teamId: tokens.teamId,
        organizationId: args.organizationId,
        credentialId: created.credentialId,
      });
      if (!claim.ok) throw new WorkspaceClaimedError();
    }
  });
  return { credentialId: created.credentialId, renewed: false };
}

export type StartOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'error'; error: ConnectorFlowError };

export type ConnectorFlowError =
  | 'unsupported_connector'
  | 'not_configured'
  | 'vendor_declined'
  | 'vendor_unreachable'
  | 'invalid_state'
  | 'workspace_claimed'
  | 'storage_failed';

/**
 * Mint the pending authorization and build the vendor consent URL. The caller
 * has already established WHO is asking and that they may add credentials to
 * this organization — this half owns only the OAuth mechanics.
 */
export async function startOauth2(
  sql: Sql,
  args: { connectorSlug: string; organizationId: string; userId: string },
): Promise<StartOutcome> {
  if (!CONNECTOR_SLUG_RE.test(args.connectorSlug)) {
    return { kind: 'error', error: 'unsupported_connector' };
  }
  // Fixed by the deployment, read first: a misconfigured SITE_URL must fail
  // as configuration, not half-way through a consent flow.
  const redirectUri = resolveOauthRedirectUri();
  if (!redirectUri) {
    console.error(
      '[connectors:oauth2] SITE_URL is unset — refusing to derive an OAuth redirect URI from the request',
    );
    return { kind: 'error', error: 'not_configured' };
  }
  const endpoints = readOauth2Endpoints(args.connectorSlug);
  if (!endpoints) return { kind: 'error', error: 'unsupported_connector' };

  const app = await resolveConnectorOauthApp(
    sql,
    args.organizationId,
    args.connectorSlug,
  );
  if (!app) {
    const prefix = oauthAppEnvPrefix(args.connectorSlug);
    console.error(
      `[connectors:oauth2] no OAuth app configured for "${args.connectorSlug}": configure one under Settings > Connectors, or set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the deployment`,
    );
    return { kind: 'error', error: 'not_configured' };
  }

  const pkce = await generatePkcePair();
  const state = mintStateToken();
  await createPendingAuthorization(sql, {
    stateHash: await hashStateToken(state),
    organizationId: args.organizationId,
    userId: args.userId,
    connectorSlug: args.connectorSlug,
    codeVerifier: pkce.verifier,
    redirectUri,
  });

  try {
    return {
      kind: 'redirect',
      url: buildAuthorizeUrl({
        authorizeUrl: applyMicrosoftTenant(
          endpoints.authorizeUrl,
          app.tenantId,
        ),
        scopes: endpoints.scopes,
        clientId: app.clientId,
        redirectUri,
        state,
        codeChallenge: pkce.challenge,
      }),
    };
  } catch (error) {
    console.error(
      `[connectors:oauth2] connector "${args.connectorSlug}" has an unusable authorize URL:`,
      error instanceof Error ? error.message : String(error),
    );
    return { kind: 'error', error: 'unsupported_connector' };
  }
}

/** Thrown inside the store-and-claim transaction so the credential rolls
 * back with the lost claim — never surfaces past `completeOauth2`. */
class WorkspaceClaimedError extends Error {
  constructor() {
    super('workspace already connected to another organization');
    this.name = 'WorkspaceClaimedError';
  }
}

export type CallbackOutcome =
  | { kind: 'connected'; settingsUrl: string; connectorSlug: string }
  | {
      kind: 'error';
      error: ConnectorFlowError;
      organizationId?: string;
    };

/**
 * The vendor's front-channel return. Everything trusted comes from the
 * consumed state row; the request supplies only the authorization code, which
 * is worthless without the PKCE verifier held server-side.
 *
 * The state binds the INITIATOR; `requesterUserId` is who is completing —
 * the session on the browser the vendor redirected back to. The two must be
 * the same person: a consent link forwarded to someone else would otherwise
 * store THEIR vendor grant under the initiator's organization. The state is
 * consumed before the comparison, so a mismatched completion still burns it.
 */
export async function completeOauth2(
  sql: Sql,
  args: {
    state: string | null;
    code: string | null;
    vendorError: string | null;
    /** The signed-in user completing the flow, or null when the browser
     * carries no session. */
    requesterUserId: string | null;
  },
  /** The reused exchange's own documented seam — injected only by tests, so
   * the whole flow is exercisable without a network. */
  options: {
    fetchImpl?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
  } = {},
): Promise<CallbackOutcome> {
  if (!isPlausibleStateToken(args.state)) {
    return { kind: 'error', error: 'invalid_state' };
  }
  // Consume FIRST, whatever else the request says: a replayed callback must
  // burn its token even when it carries an error, so a captured URL can never
  // be retried into a second exchange.
  const pending = await consumePendingAuthorization(
    sql,
    await hashStateToken(args.state),
  );
  if (!pending.ok) {
    console.warn(
      `[connectors:oauth2] refused a callback with a ${pending.reason} state`,
    );
    return { kind: 'error', error: 'invalid_state' };
  }
  const { organizationId, userId, connectorSlug, codeVerifier, redirectUri } =
    pending;

  if (args.requesterUserId === null || args.requesterUserId !== userId) {
    // Same page as a forged state: the completer learns nothing about whose
    // flow this was, and the state is already gone.
    console.warn(
      `[connectors:oauth2] refused a "${connectorSlug}" callback completed by ${
        args.requesterUserId === null ? 'no session' : 'a different user'
      } than the one who started it (organization ${organizationId})`,
    );
    return { kind: 'error', error: 'invalid_state' };
  }

  // A user who declines consent comes back with `error`, not `code`.
  if (args.vendorError !== null || args.code === null || args.code === '') {
    console.info(
      `[connectors:oauth2] "${connectorSlug}" consent did not complete for organization ${organizationId}`,
    );
    return { kind: 'error', error: 'vendor_declined', organizationId };
  }

  const endpoints = readOauth2Endpoints(connectorSlug);
  if (!endpoints) {
    return { kind: 'error', error: 'unsupported_connector', organizationId };
  }
  const app = await resolveConnectorOauthApp(
    sql,
    organizationId,
    connectorSlug,
  );
  if (!app) {
    const prefix = oauthAppEnvPrefix(connectorSlug);
    console.error(
      `[connectors:oauth2] no OAuth app configured for "${connectorSlug}": configure one under Settings > Connectors, or set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the deployment`,
    );
    return { kind: 'error', error: 'not_configured', organizationId };
  }

  const exchange = await exchangeAuthorizationCode(
    {
      tokenUrl: applyMicrosoftTenant(endpoints.tokenUrl, app.tenantId),
      code: args.code,
      // Byte-identical to the authorize request's — what vendors compare.
      redirectUri,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      codeVerifier,
    },
    options.fetchImpl,
  );
  if (!exchange.ok) {
    console.warn(
      `[connectors:oauth2] "${connectorSlug}" token exchange failed for organization ${organizationId}: ${exchange.reason}${
        exchange.code ? ` (${exchange.code})` : ''
      }`,
    );
    return {
      kind: 'error',
      error:
        exchange.reason === 'vendor_rejected'
          ? 'vendor_declined'
          : 'vendor_unreachable',
      organizationId,
    };
  }
  const tokens = exchange.tokens;

  // A workspace belongs to one organization. Check BEFORE storing so a
  // workspace already connected elsewhere refuses cleanly instead of leaving
  // an orphan credential behind.
  if (tokens.teamId !== undefined) {
    const existing = await resolveTeamRoute(sql, tokens.teamId);
    if (existing && existing.organizationId !== organizationId) {
      return { kind: 'error', error: 'workspace_claimed', organizationId };
    }
  }

  try {
    // A renewal for a workspace (or connector) already connected here, or a
    // new credential under a label no sibling holds — never a collision on
    // the connector's display name. A NEW credential and its workspace claim
    // commit together inside storeOauth2Grant, or not at all.
    await storeOauth2Grant(sql, {
      organizationId,
      connectorSlug,
      userId,
      displayName: endpoints.displayName,
      tokens,
    });
  } catch (error) {
    if (error instanceof WorkspaceClaimedError) {
      return { kind: 'error', error: 'workspace_claimed', organizationId };
    }
    // The message may embed the arguments, which include the access token —
    // log the SHAPE of the failure, never the error itself.
    console.error(
      `[connectors:oauth2] storing the "${connectorSlug}" credential for organization ${organizationId} failed (${
        error instanceof Error ? error.name : 'unknown error'
      })`,
    );
    return { kind: 'error', error: 'storage_failed', organizationId };
  }

  const settingsUrl = resolveConnectorSettingsUrl(organizationId);
  if (settingsUrl === null) {
    // Unreachable in practice: the pending row exists only because `start`
    // resolved a site URL. Refuse rather than invent a redirect target.
    return { kind: 'error', error: 'not_configured' };
  }
  return { kind: 'connected', settingsUrl, connectorSlug };
}
