import { NextRequest, NextResponse } from 'next/server';
import { Logger } from '@/lib/logger';
import { encryptString } from '@/convex/lib/crypto/encrypt_string';
import { fetchAction } from '@/lib/convex-next-server';
import { api } from '../../../../../../convex/_generated/api';

const logger = new Logger('oauth2-existing-microsoft-callback');

/**
 * OAuth2 Callback for Existing Microsoft Account
 * Handles the callback from Microsoft OAuth and creates email provider
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Extract OAuth2 callback parameters
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Parse state parameter early to get organizationId
    // State format: "secureState:organizationId:userId:providerName"
    const stateParts = state?.split(':') || [];
    const organizationId = stateParts[1]; // Extract organizationId early for redirects

    // Handle OAuth2 errors
    if (error) {
      logger.error('OAuth2 authorization error', {
        error,
        errorDescription,
      });

      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=${error}&description=${errorDescription}`
        : `/auth/oauth2/error?email_error=${error}&description=${errorDescription}`;

      // Preserve the original hostname but avoid 0.0.0.0
      const requestUrl = new URL(request.url);
      const baseUrl =
        requestUrl.hostname === '0.0.0.0'
          ? process.env.SITE_URL || 'http://localhost:3000'
          : `${requestUrl.protocol}//${requestUrl.host}`;

      return NextResponse.redirect(new URL(redirectUrl, baseUrl));
    }

    // Validate required parameters
    if (!code || !state) {
      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=missing_parameters`
        : `/settings/integrations?email_error=missing_parameters`;

      const requestUrl = new URL(request.url);
      const baseUrl =
        requestUrl.hostname === '0.0.0.0'
          ? process.env.SITE_URL || 'http://localhost:3000'
          : `${requestUrl.protocol}//${requestUrl.host}`;

      return NextResponse.redirect(new URL(redirectUrl, baseUrl));
    }

    if (stateParts.length < 4) {
      const redirectUrl = organizationId
        ? `/dashboard/${organizationId}/settings/integrations?email_error=invalid_state`
        : `/settings/integrations?email_error=invalid_state`;

      const requestUrl = new URL(request.url);
      const baseUrl =
        requestUrl.hostname === '0.0.0.0'
          ? process.env.SITE_URL || 'http://localhost:3000'
          : `${requestUrl.protocol}//${requestUrl.host}`;

      return NextResponse.redirect(new URL(redirectUrl, baseUrl));
    }

    const [, , userId, encodedProviderName] = stateParts;
    const providerName = decodeURIComponent(encodedProviderName);

    logger.info('Processing OAuth2 callback for existing Microsoft account', {
      organizationId,
      userId,
      providerName,
      hasCode: !!code,
    });

    // User email lookup not available in this context; proceed without it
    const userEmail = '';

    // Extract tenant ID from issuer URL
    const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
    if (!issuer) {
      throw new Error(
        'AUTH_MICROSOFT_ENTRA_ID_ISSUER environment variable is not set',
      );
    }

    // Extract tenant ID from issuer URL (format: https://login.microsoftonline.com/{tenant-id}/v2.0)
    const tenantIdMatch = issuer.match(/\/([^\/]+)\/v2\.0$/);
    if (!tenantIdMatch) {
      throw new Error('Invalid issuer URL format');
    }
    const tenantId = tenantIdMatch[1];

    // Exchange authorization code for tokens using tenant-specific endpoint
    // Important: Only request Outlook scopes during token exchange to avoid
    // "multiple resources" error. We'll use the refresh token to mint Graph-scoped
    // tokens just-in-time when needed for sending via Graph API.
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
          client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${process.env.SITE_URL}/api/auth/oauth2/existing-microsoft/callback`,
          scope: [
            'https://outlook.office.com/SMTP.Send',
            'https://outlook.office.com/IMAP.AccessAsUser.All',
            'offline_access',
          ].join(' '),
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      logger.error('Failed to exchange code for tokens', {
        status: tokenResponse.status,
        error: errorData,
      });

      const requestUrl = new URL(request.url);
      const baseUrl =
        requestUrl.hostname === '0.0.0.0'
          ? process.env.SITE_URL || 'http://localhost:3000'
          : `${requestUrl.protocol}//${requestUrl.host}`;

      return NextResponse.redirect(
        new URL(
          `/dashboard/${organizationId}/settings/integrations?email_error=token_exchange_failed`,
          baseUrl,
        ),
      );
    }

    const tokens = await tokenResponse.json();

    // Create email provider with the tokens
    const oauth2Config = {
      provider: 'microsoft' as const,
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: await encryptString(
        process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      ),
      scope: [
        'https://outlook.office.com/SMTP.Send',
        'https://outlook.office.com/IMAP.AccessAsUser.All',
        'https://graph.microsoft.com/User.Read',
        'https://graph.microsoft.com/Mail.Read',
        'https://graph.microsoft.com/Mail.Send',
        'offline_access',
      ],
      authUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      redirectUri: `${process.env.SITE_URL}/api/auth/oauth2/existing-microsoft/callback`,
    };

    // Create email provider in Convex with new structured config
    const providerId = await fetchAction(api.email_providers.create, {
      organizationId: organizationId as string,
      name: providerName,
      vendor: 'outlook',
      authMethod: 'oauth2',
      oauth2Auth: {
        provider: 'microsoft',
        clientId: oauth2Config.clientId,
        clientSecret: oauth2Config.clientSecret,
        tokenUrl: oauth2Config.tokenUrl,
      },
      smtpConfig: {
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
      },
      imapConfig: {
        host: 'outlook.office365.com',
        port: 993,
        secure: true,
      },
      isDefault: false,
      metadata: {
        setup_completed_at: new Date().toISOString(),
        oauth2_setup: true,
        existing_microsoft_account: true,
        oauth2_user: userEmail,
        oauth2_access_encrypted: await encryptString(tokens.access_token),
        oauth2_refresh_encrypted: tokens.refresh_token
          ? await encryptString(tokens.refresh_token)
          : '',
        oauth2_expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
        oauth2_tokenType: tokens.token_type || 'Bearer',
        oauth2_scope:
          tokens.scope ||
          oauth2Config.scope.join(' ') ||
          'https://outlook.office365.com/.default',
      },
    });

    logger.info(
      'Successfully created email provider with existing Microsoft account',
      {
        providerId,
        organizationId,
        userId,
        providerName,
      },
    );

    // Redirect to success page, preserving the original hostname
    const requestUrl = new URL(request.url);
    const baseUrl =
      requestUrl.hostname === '0.0.0.0'
        ? process.env.SITE_URL || 'http://localhost:3000'
        : `${requestUrl.protocol}//${requestUrl.host}`;

    return NextResponse.redirect(
      new URL(
        `/dashboard/${organizationId}/settings/integrations?oauth2=success&provider=${providerId}`,
        baseUrl,
      ),
    );
  } catch (error) {
    logger.error('OAuth2 callback processing failed', {
      error: (error as Error).message,
    });

    // Try to extract organizationId from state for error redirect
    const searchParams = new URL(request.url).searchParams;
    const state = searchParams.get('state');
    const orgId = state?.split(':')[1];
    const errorUrl = orgId
      ? `/dashboard/${orgId}/settings/integrations?email_error=callback_failed`
      : `/settings/integrations?email_error=callback_failed`;

    const requestUrl = new URL(request.url);
    const baseUrl =
      requestUrl.hostname === '0.0.0.0'
        ? process.env.SITE_URL || 'http://localhost:3000'
        : `${requestUrl.protocol}//${requestUrl.host}`;

    return NextResponse.redirect(new URL(errorUrl, baseUrl));
  }
}
