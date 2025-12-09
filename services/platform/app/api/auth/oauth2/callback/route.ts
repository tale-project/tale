import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { fetchAction } from '@/lib/convex-next-server';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';

const logger = new Logger('oauth2-callback-api');

/**
 * OAuth2 Callback Endpoint
 * Handles OAuth2 authorization code exchange for access tokens
 *
 * Architecture: All decryption and sensitive operations happen in Convex
 * to ensure encryption/decryption use the same runtime and keys.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Extract OAuth2 callback parameters
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Parse state parameter first to get organizationId for redirects
    const stateParts = state?.split(':') || [];
    const organizationId = stateParts[2]; // Extract organizationId early

    // Handle OAuth2 errors
    if (error) {
      logger.error('OAuth2 authorization error', {
        error,
        errorDescription,
      });

      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=${error}&description=${errorDescription}`
        : `/settings/integrations?email_error=${error}&description=${errorDescription}`;

      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    // Validate required parameters
    if (!code) {
      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=missing_code`
        : `/settings/integrations?email_error=missing_code`;
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    if (!state) {
      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=missing_state`
        : `/settings/integrations?email_error=missing_state`;
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    // Parse state parameter to get provider and other info
    // State format: "provider:emailProviderId:organizationId"
    if (stateParts.length < 3) {
      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=invalid_state`
        : `/settings/integrations?email_error=invalid_state`;
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    const [provider, emailProviderId] = stateParts;

    logger.info('Processing OAuth2 callback', {
      provider,
      emailProviderId,
      organizationId,
      hasCode: !!code,
    });

    // Construct redirect URI (must match what was used in authorization URL)
    // Try to get the origin from the Referer header first (more reliable than Host header)
    const requestUrl = new URL(request.url);
    const referer = request.headers.get('referer');

    let origin: string;
    if (referer) {
      // Extract origin from referer (e.g., "http://localhost:3000/some/path" -> "http://localhost:3000")
      const refererUrl = new URL(referer);
      origin = `${refererUrl.protocol}//${refererUrl.host}`;
    } else if (requestUrl.hostname === '0.0.0.0') {
      // Fallback to SITE_URL if no referer and hostname is 0.0.0.0
      origin = process.env.SITE_URL || 'http://localhost:3000';
    } else {
      // Use request hostname
      origin = `${requestUrl.protocol}//${requestUrl.host}`;
    }

    const redirectUri = `${origin}/api/auth/oauth2/callback`;

    logger.info('OAuth2 callback redirect URI', {
      requestHostname: requestUrl.hostname,
      referer,
      origin,
      redirectUri,
    });

    // Call Convex action to handle the complete OAuth2 flow
    // This includes: fetching provider, decrypting credentials, exchanging code,
    // storing tokens, and fetching user email - all in Convex where encryption happened
    const result = await fetchAction(api.email_providers.handleOAuth2Callback, {
      emailProviderId: emailProviderId as Id<'emailProviders'>,
      code,
      redirectUri,
    });

    logger.info('OAuth2 authorization successful', {
      provider,
      emailProviderId,
      userEmail: result.userEmail,
    });

    // Prefer the origin/redirectUri returned by Convex (persisted at auth start)
    const finalRedirectOrigin = result.redirectOrigin || origin;

    return NextResponse.redirect(
      new URL(
        `/dashboard/${organizationId}/settings/integrations?oauth2=success`,
        finalRedirectOrigin,
      ),
    );
  } catch (error) {
    logger.error('OAuth2 callback processing failed', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Try to extract organizationId from state for error redirect
    const searchParams = new URL(request.url).searchParams;
    const state = searchParams.get('state');
    const orgId = state?.split(':')[2];
    const errorUrl = orgId
      ? `/dashboard/${orgId}/settings/integrations?email_error=callback_failed`
      : `/settings/integrations?email_error=callback_failed`;

    // Preserve the original hostname but avoid 0.0.0.0
    const requestUrl = new URL(request.url);
    const baseUrl =
      requestUrl.hostname === '0.0.0.0'
        ? process.env.SITE_URL || 'http://localhost:3000'
        : `${requestUrl.protocol}//${requestUrl.host}`;

    return NextResponse.redirect(new URL(errorUrl, baseUrl));
  }
}

/**
 * OAuth2 Token Refresh Endpoint
 * Manually refresh OAuth2 tokens for an email provider
 *
 * NOTE: Token refresh with decryption will be implemented in a future update.
 * The refreshOAuth2TokenWithDecryption action needs to be available in the API.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailProviderId } = body;

    if (!emailProviderId) {
      return NextResponse.json(
        { error: 'Email provider ID is required' },
        { status: 400 },
      );
    }

    logger.info('OAuth2 token refresh endpoint called', {
      emailProviderId,
      note: 'Manual refresh not yet implemented - use re-authorization instead',
    });

    return NextResponse.json(
      {
        error:
          'Manual token refresh not yet implemented. Please re-authorize the provider instead.',
        action: 'reauthorize',
      },
      { status: 501 },
    );
  } catch (error) {
    logger.error('OAuth2 token refresh failed', {
      error: (error as Error).message,
    });

    return NextResponse.json(
      { error: 'Failed to refresh OAuth2 tokens' },
      { status: 500 },
    );
  }
}

/**
 * OAuth2 Token Revocation Endpoint
 * Revoke OAuth2 tokens for an email provider
 *
 * NOTE: Token revocation with decryption will be implemented in a future update.
 * The revokeOAuth2Tokens action needs to be available in the API.
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const emailProviderId = searchParams.get('emailProviderId');

    if (!emailProviderId) {
      return NextResponse.json(
        { error: 'Email provider ID is required' },
        { status: 400 },
      );
    }

    logger.info('OAuth2 token revocation endpoint called', {
      emailProviderId,
      note: 'Revocation not yet implemented - tokens will expire naturally',
    });

    // Clear OAuth2 metadata to mark as revoked
    await fetchAction(api.email_providers.updateMetadata, {
      id: emailProviderId as Id<'emailProviders'>,
      config: {
        oauth2_revoked: true,
        oauth2_revoked_at: new Date().toISOString(),
      } as Record<string, string | number | boolean>,
    });

    logger.info('OAuth2 tokens marked as revoked', {
      emailProviderId,
    });

    return NextResponse.json({
      success: true,
      message: 'OAuth2 tokens marked as revoked',
    });
  } catch (error) {
    logger.error('OAuth2 token revocation failed', {
      error: (error as Error).message,
    });

    return NextResponse.json(
      { error: 'Failed to revoke OAuth2 tokens' },
      { status: 500 },
    );
  }
}
