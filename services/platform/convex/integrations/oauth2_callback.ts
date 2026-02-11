/**
 * OAuth2 Callback HTTP Handler for Integrations
 *
 * Handles the OAuth2 callback after user authorization with an external provider.
 * Parses the callback parameters and delegates to an internal action for token exchange.
 */

import type { Id } from '../_generated/dataModel';

import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';

type ErrorType =
  | 'missing_code'
  | 'missing_state'
  | 'invalid_state'
  | 'token_exchange_failed'
  | 'callback_failed';

interface ParsedState {
  integrationId: Id<'integrations'>;
  organizationId: string;
}

function buildRedirectUrl(
  organizationId: string | undefined,
  params: {
    integration_oauth2?: string;
    integration_oauth2_error?: ErrorType;
    description?: string;
  },
): string {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const basePath = organizationId
    ? `/dashboard/${organizationId}/settings/integrations`
    : '/settings/integrations';

  const searchParams = new URLSearchParams();
  if (params.integration_oauth2)
    searchParams.set('integration_oauth2', params.integration_oauth2);
  if (params.integration_oauth2_error)
    searchParams.set(
      'integration_oauth2_error',
      params.integration_oauth2_error,
    );
  if (params.description) searchParams.set('description', params.description);

  const queryString = searchParams.toString();
  return `${siteUrl}${basePath}${queryString ? `?${queryString}` : ''}`;
}

function parseState(state: string): ParsedState | null {
  const parts = state.split(':');
  if (parts.length !== 3) return null;

  const [prefix, integrationId, organizationId] = parts;

  if (prefix !== 'integration') return null;
  if (!integrationId || !organizationId) return null;

  return {
    integrationId: toId<'integrations'>(integrationId),
    organizationId,
  };
}

export const integrationOAuth2CallbackHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    console.error('[Integration OAuth2 Callback] Provider returned error:', {
      error,
      errorDescription,
    });
    const redirectUrl = buildRedirectUrl(undefined, {
      integration_oauth2_error: 'callback_failed',
      description: errorDescription || error,
    });
    return Response.redirect(redirectUrl, 302);
  }

  if (!code) {
    console.error('[Integration OAuth2 Callback] Missing authorization code');
    const redirectUrl = buildRedirectUrl(undefined, {
      integration_oauth2_error: 'missing_code',
    });
    return Response.redirect(redirectUrl, 302);
  }

  if (!state) {
    console.error('[Integration OAuth2 Callback] Missing state parameter');
    const redirectUrl = buildRedirectUrl(undefined, {
      integration_oauth2_error: 'missing_state',
    });
    return Response.redirect(redirectUrl, 302);
  }

  const parsedState = parseState(state);
  if (!parsedState) {
    console.error('[Integration OAuth2 Callback] Invalid state format:', state);
    const redirectUrl = buildRedirectUrl(undefined, {
      integration_oauth2_error: 'invalid_state',
    });
    return Response.redirect(redirectUrl, 302);
  }

  const { integrationId, organizationId } = parsedState;

  try {
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const redirectUri = `${siteUrl}/api/integrations/oauth2/callback`;

    await ctx.runAction(
      internal.integrations.oauth2_token_exchange.handleOAuth2Callback,
      {
        integrationId,
        code,
        redirectUri,
      },
    );

    console.log(
      '[Integration OAuth2 Callback] Successfully processed callback for:',
      { integrationId },
    );

    const redirectUrl = buildRedirectUrl(organizationId, {
      integration_oauth2: 'success',
    });
    return Response.redirect(redirectUrl, 302);
  } catch (err) {
    console.error(
      '[Integration OAuth2 Callback] Error processing callback:',
      err,
    );
    const redirectUrl = buildRedirectUrl(organizationId, {
      integration_oauth2_error: 'token_exchange_failed',
      description: err instanceof Error ? err.message : 'Unknown error',
    });
    return Response.redirect(redirectUrl, 302);
  }
});
