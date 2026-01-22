/**
 * OAuth2 Callback HTTP Handler for Email Providers
 *
 * Handles the OAuth2 callback from Microsoft/Google after user authorization.
 * This HTTP action parses the callback parameters and delegates to an internal
 * action that handles the token exchange and storage.
 */

import { httpAction } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

type OAuthProvider = 'gmail' | 'microsoft';

interface ParsedState {
  provider: OAuthProvider;
  emailProviderId: Id<'emailProviders'>;
  organizationId: string;
}

type ErrorType =
  | 'missing_code'
  | 'missing_state'
  | 'invalid_state'
  | 'missing_provider'
  | 'missing_oauth2_config'
  | 'token_exchange_failed'
  | 'callback_failed';

function buildRedirectUrl(
  organizationId: string | undefined,
  params: { oauth2?: string; email_error?: ErrorType; description?: string },
): string {
  const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
  const basePath = organizationId
    ? `/dashboard/${organizationId}/settings/integrations`
    : '/settings/integrations';

  const searchParams = new URLSearchParams();
  if (params.oauth2) searchParams.set('oauth2', params.oauth2);
  if (params.email_error) searchParams.set('email_error', params.email_error);
  if (params.description) searchParams.set('description', params.description);

  const queryString = searchParams.toString();
  return `${siteUrl}${basePath}${queryString ? `?${queryString}` : ''}`;
}

function parseState(state: string): ParsedState | null {
  const parts = state.split(':');
  if (parts.length !== 3) return null;

  const [provider, emailProviderId, organizationId] = parts;

  if (provider !== 'gmail' && provider !== 'microsoft') return null;
  if (!emailProviderId || !organizationId) return null;

  return {
    provider: provider as OAuthProvider,
    emailProviderId: emailProviderId as Id<'emailProviders'>,
    organizationId,
  };
}

export const oauth2CallbackHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle OAuth error response from provider
  if (error) {
    console.error('[OAuth2 Callback] Provider returned error:', {
      error,
      errorDescription,
    });
    const redirectUrl = buildRedirectUrl(undefined, {
      email_error: 'callback_failed',
      description: errorDescription || error,
    });
    return Response.redirect(redirectUrl, 302);
  }

  // Validate required parameters
  if (!code) {
    console.error('[OAuth2 Callback] Missing authorization code');
    const redirectUrl = buildRedirectUrl(undefined, {
      email_error: 'missing_code',
    });
    return Response.redirect(redirectUrl, 302);
  }

  if (!state) {
    console.error('[OAuth2 Callback] Missing state parameter');
    const redirectUrl = buildRedirectUrl(undefined, {
      email_error: 'missing_state',
    });
    return Response.redirect(redirectUrl, 302);
  }

  // Parse state parameter
  const parsedState = parseState(state);
  if (!parsedState) {
    console.error('[OAuth2 Callback] Invalid state format:', state);
    const redirectUrl = buildRedirectUrl(undefined, {
      email_error: 'invalid_state',
    });
    return Response.redirect(redirectUrl, 302);
  }

  const { emailProviderId, organizationId } = parsedState;

  try {
    // Build redirect URI (must match what was used in authorization request)
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const redirectUri = `${siteUrl}/api/auth/oauth2/callback`;

    // Call internal action to handle the OAuth callback
    // This action runs in Node.js and handles token exchange, encryption, and storage
    await ctx.runAction(
      internal.email_providers.internal_actions.handleOAuth2Callback,
      {
        emailProviderId,
        code,
        redirectUri,
      },
    );

    console.log('[OAuth2 Callback] Successfully processed callback for provider:', {
      emailProviderId,
    });

    // Redirect to success page
    const redirectUrl = buildRedirectUrl(organizationId, {
      oauth2: 'success',
    });
    return Response.redirect(redirectUrl, 302);
  } catch (err) {
    console.error('[OAuth2 Callback] Error processing callback:', err);
    const redirectUrl = buildRedirectUrl(organizationId, {
      email_error: 'token_exchange_failed',
      description: err instanceof Error ? err.message : 'Unknown error',
    });
    return Response.redirect(redirectUrl, 302);
  }
});
