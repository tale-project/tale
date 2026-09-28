import type { Sql, TransactionSql } from 'postgres';

import { findConnector } from '../../../lib/connectors/catalog.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { ConsentIntent } from '../../../lib/shared/connector-consent.ts';
import {
  MembershipError,
  requireOrganizationMember,
} from '../../auth/membership.ts';
import { generatePkcePair } from '../../core/enterprise_sso/pkce.ts';
import { buildAuthorizeUrl } from '../../core/http_connectors/authorize_url.ts';
import {
  oauthAppEnvPrefix,
  publicBaseFromRedirectUri,
  resolveConnectorSettingsUrl,
  resolveOauthRedirectUri,
  resolvePublicBaseUrl,
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
  findOauth2Grant,
  listCredentials,
  lockCredentialPair,
  updateCredentialInTransaction,
} from '../connector_credentials/service.ts';
import {
  applyMicrosoftTenant,
  resolveConnectorOauthApp,
} from './oauth-apps.ts';
import { planOauth2Grant } from './oauth-grant-plan.ts';

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
 * property, kept by a different mechanism). The row also carries what the
 * consent is FOR — an Add, or the one credential a Reconnect renews — so the
 * callback stores it there and nowhere else. The Slack workspace route is a
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
  /** The credential a Reconnect renews; null for an Add, which stores a NEW
   * credential. Checked at the start door, re-checked at the callback. */
  reconnectCredentialId: string | null;
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
      redirect_uri, reconnect_credential_id, created_at_ms, expires_at_ms
    ) VALUES (
      ${args.stateHash}, ${args.organizationId}, ${args.userId},
      ${args.connectorSlug}, ${args.codeVerifier}, ${args.redirectUri},
      ${args.reconnectCredentialId}, ${now}, ${now + OAUTH_STATE_TTL_MS}
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
async function consumePendingAuthorization(
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
      reconnectCredentialId: string | null;
      expiresAt: number;
    }[]
  >`
    DELETE FROM app.connector_oauth_states
    WHERE state_hash = ${stateHash}
    RETURNING org_id AS "organizationId", user_id AS "userId",
              connector_slug AS "connectorSlug",
              code_verifier AS "codeVerifier",
              redirect_uri AS "redirectUri",
              reconnect_credential_id AS "reconnectCredentialId",
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
    reconnectCredentialId: row.reconnectCredentialId,
  };
}

/** A pending row's intent, as the grant store reads it. */
function intentOf(reconnectCredentialId: string | null): ConsentIntent {
  return reconnectCredentialId === null
    ? { kind: 'add' }
    : { kind: 'reconnect', credentialId: reconnectCredentialId };
}

/**
 * Whether `userId` may add or renew connector credentials in the
 * organization: an active member whose role carries the developer
 * capability — the gate the credential routes write behind. Asked at BOTH
 * ends of a consent, because a membership can end or a role change while the
 * vendor is asking for consent, and the callback writes as that person.
 */
export async function connectorWriteAccess(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<'allowed' | 'not_member' | 'role_forbidden'> {
  let role: string;
  try {
    role = (await requireOrganizationMember(sql, organizationId, userId)).role;
  } catch (error) {
    if (error instanceof MembershipError) return 'not_member';
    throw error;
  }
  return defineAbilityFor(role).cannot('read', 'developerSettings')
    ? 'role_forbidden'
    : 'allowed';
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

/** The workspaces routed to one of this organization's credentials. */
async function teamsRoutedTo(
  sql: Sql,
  organizationId: string,
  credentialId: string,
): Promise<string[]> {
  const rows = await sql<{ teamId: string }[]>`
    SELECT team_id AS "teamId" FROM app.connector_team_routes
    WHERE org_id = ${organizationId} AND credential_id = ${credentialId}
  `;
  return rows.map((row) => row.teamId);
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

export interface Oauth2GrantArgs {
  organizationId: string;
  connectorSlug: string;
  userId: string;
  /** The connector's catalog display name — the first credential's label. */
  displayName: string;
  /** What the consent was started FOR — from the consumed state row. */
  intent: ConsentIntent;
  tokens: Oauth2Tokens;
}

export type StoreGrantOutcome =
  | { ok: true; credentialId: string; renewed: boolean }
  | {
      ok: false;
      reason:
        | 'credential_missing'
        | 'account_mismatch'
        | 'workspace_claimed'
        | 'forbidden';
    };

/**
 * Store a completed consent where its intent says (`planOauth2Grant`): an Add
 * becomes a NEW credential under a label no sibling holds, a Reconnect renews
 * exactly the credential it named, and a Slack workspace already connected
 * here renews its own credential — never the connector's default in place of
 * any of them.
 *
 * ONE transaction, serialized per (organization, connector): the sibling
 * list, the Reconnect target (row-locked), the team route and the write are
 * one consistent decision, so two consents completing at once number past
 * each other instead of colliding on a label or the default, and a target
 * deleted meanwhile is refused rather than written. A new or re-routed
 * workspace claims its route in the same transaction: the route's key decides
 * a claim race and the loser keeps nothing.
 */
export async function storeOauth2Grant(
  sql: Sql,
  args: Oauth2GrantArgs,
): Promise<StoreGrantOutcome> {
  const { tokens } = args;
  const secret = {
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined
      ? { refreshToken: tokens.refreshToken }
      : {}),
    ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
    scopes: tokens.scopes,
  };
  const team =
    tokens.teamId === undefined
      ? undefined
      : {
          id: tokens.teamId,
          ...(tokens.teamName !== undefined ? { name: tokens.teamName } : {}),
        };

  try {
    return await sql.begin(async (tx): Promise<StoreGrantOutcome> => {
      await lockCredentialPair(tx, args.organizationId, args.connectorSlug);
      // The token exchange can outlive the callback's access check. Lock the
      // current membership before checking it again, so a demotion/removal
      // either wins first and refuses this write, or waits for its commit.
      // A fresh read after the lock also sees a revocation that was uncommitted
      // when this statement began and made it wait.
      await tx`
        SELECT "id" FROM "member"
        WHERE "organizationId" = ${args.organizationId} AND "userId" = ${args.userId}
        FOR SHARE
      `;
      if (
        (await connectorWriteAccess(tx, args.organizationId, args.userId)) !==
        'allowed'
      ) {
        return { ok: false, reason: 'forbidden' };
      }
      const lockGrant = (credentialId: string) =>
        findOauth2Grant(tx, {
          organizationId: args.organizationId,
          connectorSlug: args.connectorSlug,
          credentialId,
          forUpdate: true,
        });
      // Row-lock what a renewal may write BEFORE reading the siblings: a
      // delete that committed first is missing from every read below, and
      // one that comes later waits for this transaction.
      const target =
        args.intent.kind === 'reconnect'
          ? await lockGrant(args.intent.credentialId)
          : null;
      let route =
        team === undefined ? null : await resolveTeamRoute(tx, team.id);
      if (
        args.intent.kind === 'add' &&
        route !== null &&
        route.organizationId === args.organizationId &&
        (await lockGrant(route.credentialId)) === null
      ) {
        // Its credential went with it (the route cascades) — a new one
        // takes the workspace over.
        route = null;
      }
      const targetTeams =
        target === null || team === undefined
          ? []
          : await teamsRoutedTo(tx, args.organizationId, target.id);
      const siblings = await listCredentials(
        tx,
        args.organizationId,
        args.connectorSlug,
      );

      const plan = planOauth2Grant({
        organizationId: args.organizationId,
        intent: args.intent,
        displayName: args.displayName,
        nameMax: CREDENTIAL_NAME_MAX,
        siblings,
        target,
        ...(team !== undefined ? { team } : {}),
        route,
        targetTeams,
      });
      if (plan.kind === 'refuse') {
        console.warn(
          `[connectors:oauth2] "${args.connectorSlug}" consent refused for organization ${args.organizationId}: ${plan.reason} (${args.intent.kind})`,
        );
        return { ok: false, reason: plan.reason };
      }

      let credentialId: string;
      if (plan.kind === 'renew') {
        credentialId = plan.credentialId;
        await updateCredentialInTransaction(tx, {
          organizationId: args.organizationId,
          credentialId,
          secret,
          ...(plan.reactivate
            ? { status: 'active' as const, statusDetail: null }
            : {}),
          actor: { userId: args.userId },
        });
      } else {
        credentialId = (
          await createCredentialInTransaction(tx, {
            organizationId: args.organizationId,
            connectorSlug: args.connectorSlug,
            authMethod: 'oauth2',
            name: plan.name,
            createdBy: args.userId,
            actor: { userId: args.userId },
            secret,
          })
        ).credentialId;
      }
      if (plan.claimTeamId !== undefined) {
        const claim = await claimTeamRoute(tx, {
          teamId: plan.claimTeamId,
          organizationId: args.organizationId,
          credentialId,
        });
        if (!claim.ok) throw new WorkspaceClaimedError();
      }
      console.info(
        `[connectors:oauth2] "${args.connectorSlug}" grant ${plan.kind === 'renew' ? 'renewed' : 'stored as a new credential'} for organization ${args.organizationId} (${args.intent.kind})`,
      );
      return { ok: true, credentialId, renewed: plan.kind === 'renew' };
    });
  } catch (error) {
    // A lost claim rolls the whole write back: a committed credential for a
    // workspace routed elsewhere would be a live foreign token stored here.
    if (error instanceof WorkspaceClaimedError) {
      return { ok: false, reason: 'workspace_claimed' };
    }
    throw error;
  }
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
  | 'storage_failed'
  | 'credential_missing'
  | 'account_mismatch'
  | 'forbidden';

/**
 * Mint the pending authorization and build the vendor consent URL. The caller
 * has already established WHO is asking and that they may add credentials to
 * this organization — this half owns the OAuth mechanics and the intent.
 *
 * No `reconnectCredentialId` is an Add: the consent stores a new credential.
 * With one, it must name an OAuth grant of THIS organization and connector —
 * checked here, before anything is minted or the browser leaves, and again
 * when the consent comes back. The id then rides the server-side row only.
 */
export async function startOauth2(
  sql: Sql,
  args: {
    connectorSlug: string;
    organizationId: string;
    userId: string;
    /** The credential a Reconnect renews; absent for an Add. */
    reconnectCredentialId?: string;
    /** The configured site origin the browser is on — the callback must land
     * on the domain holding the session that started the flow. */
    publicOrigin?: string | null;
  },
): Promise<StartOutcome> {
  if (!CONNECTOR_SLUG_RE.test(args.connectorSlug)) {
    return { kind: 'error', error: 'unsupported_connector' };
  }
  // Fixed by the deployment, read first: a misconfigured SITE_URL must fail
  // as configuration, not half-way through a consent flow.
  const redirectUri = resolveOauthRedirectUri(args.publicOrigin);
  if (!redirectUri) {
    console.error(
      '[connectors:oauth2] SITE_URL is unset — refusing to derive an OAuth redirect URI from the request',
    );
    return { kind: 'error', error: 'not_configured' };
  }
  const endpoints = readOauth2Endpoints(args.connectorSlug);
  if (!endpoints) return { kind: 'error', error: 'unsupported_connector' };

  const reconnectCredentialId = args.reconnectCredentialId ?? null;
  if (
    reconnectCredentialId !== null &&
    (await findOauth2Grant(sql, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      credentialId: reconnectCredentialId,
    })) === null
  ) {
    console.warn(
      `[connectors:oauth2] refused to reconnect a credential that is not an OAuth grant of "${args.connectorSlug}" in organization ${args.organizationId}`,
    );
    return { kind: 'error', error: 'credential_missing' };
  }

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
    reconnectCredentialId,
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
 * consumed state row — the organization, the connector and the INTENT (Add,
 * or Reconnect of one named credential); the request supplies only the
 * authorization code, which is worthless without the PKCE verifier held
 * server-side, so no query parameter can re-target the write.
 *
 * The state binds the INITIATOR; `requesterUserId` is who is completing —
 * the session on the browser the vendor redirected back to. The two must be
 * the same person: a consent link forwarded to someone else would otherwise
 * store THEIR vendor grant under the initiator's organization. The state is
 * consumed before the comparison, so a mismatched completion still burns it.
 * That person must STILL be allowed to write credentials there, and a
 * Reconnect's credential must still exist, before the code is redeemed.
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
  const intent = intentOf(pending.reconnectCredentialId);

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

  // The start door's gate, asked again: the member may have left, or lost
  // the role that writes credentials, while the vendor asked for consent.
  const access = await connectorWriteAccess(sql, organizationId, userId);
  if (access !== 'allowed') {
    console.warn(
      `[connectors:oauth2] refused a "${connectorSlug}" callback: the initiator may no longer write credentials in organization ${organizationId} (${access})`,
    );
    return { kind: 'error', error: 'forbidden' };
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
  // Checked before the exchange too, so a Reconnect whose credential was
  // deleted meanwhile never redeems its code. The store re-reads it locked.
  if (
    intent.kind === 'reconnect' &&
    (await findOauth2Grant(sql, {
      organizationId,
      connectorSlug,
      credentialId: intent.credentialId,
    })) === null
  ) {
    console.warn(
      `[connectors:oauth2] "${connectorSlug}" reconnect target is gone in organization ${organizationId}; nothing exchanged`,
    );
    return { kind: 'error', error: 'credential_missing', organizationId };
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

  let stored: StoreGrantOutcome;
  try {
    // An Add is a new credential under a label no sibling holds; a Reconnect
    // renews exactly the credential it named; a Slack workspace already
    // connected here renews its own. The write and any workspace claim
    // commit together inside storeOauth2Grant, or not at all.
    stored = await storeOauth2Grant(sql, {
      organizationId,
      connectorSlug,
      userId,
      displayName: endpoints.displayName,
      intent,
      tokens,
    });
  } catch (error) {
    // The message may embed the arguments, which include the access token —
    // log the SHAPE of the failure, never the error itself.
    console.error(
      `[connectors:oauth2] storing the "${connectorSlug}" credential for organization ${organizationId} failed (${
        error instanceof Error ? error.name : 'unknown error'
      })`,
    );
    return { kind: 'error', error: 'storage_failed', organizationId };
  }
  if (!stored.ok) {
    return { kind: 'error', error: stored.reason, organizationId };
  }

  // Back to the domain the flow STARTED on — recovered from the redirect URI
  // the state row carries, so a multi-domain deployment returns the browser
  // where its session cookie lives rather than to the canonical origin.
  const settingsUrl = resolveConnectorSettingsUrl(
    organizationId,
    publicBaseFromRedirectUri(redirectUri) ?? resolvePublicBaseUrl(),
  );
  if (settingsUrl === null) {
    // Unreachable in practice: the pending row exists only because `start`
    // resolved a site URL. Refuse rather than invent a redirect target.
    return { kind: 'error', error: 'not_configured' };
  }
  return { kind: 'connected', settingsUrl, connectorSlug };
}
