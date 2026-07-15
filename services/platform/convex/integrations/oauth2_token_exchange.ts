'use node';

/**
 * OAuth2 token exchange for integrations.
 *
 * Generic authorization_code → token exchange that works with any OAuth2 provider.
 * Uses the integration's oauth2Config.tokenUrl rather than provider-specific logic.
 */

import { v } from 'convex/values';

import { fetchJson } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { encryptString } from '../lib/crypto/encrypt_string';
import { createDebugLog } from '../lib/debug_log';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations OAuth2]');

interface TokenResponse {
  // Slack's Web API (incl. oauth.v2.access) returns HTTP 200 even on failure,
  // signalling the error only via `ok:false` + `error` in the body. Standard
  // RFC-6749 providers omit these (they 4xx instead), so the check is a no-op
  // for them.
  ok?: boolean;
  error?: string;
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  // Slack `oauth.v2.access` non-standard extras (optional; ignored by other
  // providers). Used to route inbound Slack events back to the installing org
  // and to drop the bot's own messages. Slack omits `expires_in` for
  // non-rotating bot tokens, so the generic refresh path treats them as
  // non-expiring — no special handling needed.
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name?: string };
  enterprise?: { id: string; name?: string } | null;
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
}

/**
 * Best-effort fetch of the connected account's send address, so compose + the
 * conversation header can show the exact From for OAuth mailboxes. Gmail's
 * `users.getProfile` needs only the already-granted `gmail.readonly` scope;
 * Outlook's `/me` needs `User.Read`. Returns null on any failure — the caller
 * treats the address as optional and never fails the connection over it.
 */
async function fetchOAuthAccountEmail(
  slug: string,
  accessToken: string,
): Promise<string | null> {
  const init = {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  };
  try {
    if (slug === 'gmail') {
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        init,
      );
      if (!res.ok) {
        console.warn(`[OAuth2] gmail profile fetch failed: ${res.status}`);
        return null;
      }
      const body = await fetchJson<{ emailAddress?: string }>(res);
      return typeof body.emailAddress === 'string' ? body.emailAddress : null;
    }
    if (slug === 'outlook') {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', init);
      if (!res.ok) {
        console.warn(`[OAuth2] outlook /me fetch failed: ${res.status}`);
        return null;
      }
      const body = await fetchJson<{
        mail?: string | null;
        userPrincipalName?: string;
      }>(res);
      return body.mail ?? body.userPrincipalName ?? null;
    }
    return null;
  } catch (error) {
    console.warn(
      `[OAuth2] account-email capture failed for ${slug} (non-fatal):`,
      error,
    );
    return null;
  }
}

export const handleOAuth2Callback = internalAction({
  args: {
    credentialId: v.id('integrationCredentials'),
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.runQuery(
      internal.integrations.credential_queries.getByIdInternal,
      { credentialId: args.credentialId },
    );

    if (!credential) {
      throw new Error('Integration credential not found');
    }

    const orgSlug = await resolveOrgSlug(ctx, credential.organizationId);
    const fileResult = await ctx.runAction(
      internal.integrations.file_actions.readIntegrationForExecution,
      { orgSlug, slug: credential.slug },
    );

    const fileOAuth2Config = fileResult?.ok
      ? fileResult.config?.oauth2Config
      : undefined;
    const dbOAuth2Config = credential.oauth2Config;

    const tokenUrl = fileOAuth2Config?.tokenUrl ?? dbOAuth2Config?.tokenUrl;
    const clientId = dbOAuth2Config?.clientId;
    const clientSecretEncrypted = dbOAuth2Config?.clientSecretEncrypted;

    if (!clientId || !clientSecretEncrypted || !tokenUrl) {
      throw new Error('Integration OAuth2 client credentials not configured');
    }

    const clientSecret = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: clientSecretEncrypted },
    );

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OAuth2 Token Exchange] Failed:', errorText);
      throw new Error(
        `Token exchange failed: ${response.status} - ${errorText}`,
      );
    }

    const tokens = await fetchJson<TokenResponse>(response);

    // Slack-style HTTP-200 failure (and a guard for any provider that adopts the
    // same shape). Surface the real reason instead of a generic message.
    if (tokens.ok === false) {
      console.error(
        `[OAuth2 Token Exchange] provider returned ok:false (${tokens.error ?? 'unknown'}) for credential ${args.credentialId}`,
      );
      throw new Error(
        `Authorization failed: ${tokens.error ?? 'unknown error'}. Please try authorizing again.`,
      );
    }

    if (!tokens.access_token) {
      console.error(
        `[OAuth2 Token Exchange] Response missing access_token for credential ${args.credentialId}`,
      );
      throw new Error(
        'OAuth2 token exchange returned an invalid response. Please try authorizing again.',
      );
    }

    const accessTokenEncrypted = await encryptString(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encryptString(tokens.refresh_token)
      : undefined;

    const tokenExpiry = tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : undefined;

    // Slack returns a comma-separated scope string; RFC-6749 uses spaces. Split
    // on either so granted scopes are stored as distinct elements.
    const scopes = tokens.scope
      ? tokens.scope.split(/[\s,]+/).filter(Boolean)
      : undefined;

    // Slack-specific: secure workspace routing/ownership BEFORE activating the
    // credential, so a cross-org conflict (or an unroutable enterprise-grid
    // install) fails closed — leaving the credential inactive with no usable bot
    // token rather than an active credential a losing org could post through.
    if (credential.slug === 'slack') {
      if (!tokens.team?.id) {
        // Enterprise Grid org-wide install: `team` is null, only `enterprise` is
        // set. Inbound routing keys on team_id, so this credential could never
        // answer — reject loudly instead of reporting a healthy connection.
        console.warn(
          `[OAuth2 Token Exchange] Slack enterprise-grid/org-wide install for credential ${args.credentialId} (enterprise ${tokens.enterprise?.id ?? 'unknown'}) — no team_id; rejecting.`,
        );
        throw new Error(
          'Slack Enterprise Grid org-wide installs are not yet supported. Please install the app to a specific workspace.',
        );
      }
      // Throws if this workspace is already mapped to a different org — before
      // any token is activated.
      await ctx.runMutation(
        internal.integrations.slack_installations.upsertInstallation,
        {
          teamId: tokens.team.id,
          teamName: tokens.team.name,
          enterpriseId: tokens.enterprise?.id,
          organizationId: credential.organizationId,
          slug: credential.slug,
          botUserId: tokens.bot_user_id,
          appId: tokens.app_id,
          credentialId: args.credentialId,
        },
      );
      debugLog(
        `Recorded Slack installation for team ${tokens.team.id} (org ${credential.organizationId})`,
      );
    }

    await ctx.runMutation(
      internal.integrations.credential_mutations.updateCredentialsInternal,
      {
        credentialId: args.credentialId,
        oauth2Auth: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiry,
          scopes,
        },
        status: 'active',
        isActive: true,
        errorMessage: undefined,
      },
    );

    // Best-effort: capture the connected account's send address for OAuth
    // mailboxes (gmail/outlook) so compose + the conversation header can show
    // the exact From. Runs AFTER activation, so a failure here leaves a healthy
    // connection — the address is optional and fills in on the next reconnect.
    if (credential.slug === 'gmail' || credential.slug === 'outlook') {
      const accountEmail = await fetchOAuthAccountEmail(
        credential.slug,
        tokens.access_token,
      );
      if (accountEmail) {
        await ctx.runMutation(
          internal.integrations.credential_mutations.updateCredentialsInternal,
          {
            credentialId: args.credentialId,
            connectionConfig: {
              ...credential.connectionConfig,
              fromAddress: accountEmail,
            },
          },
        );
        debugLog(
          `Captured ${credential.slug} account email for credential ${args.credentialId}`,
        );
      }
    }

    debugLog(
      `OAuth2 token exchange successful for credential ${args.credentialId}`,
    );

    return {};
  },
});
