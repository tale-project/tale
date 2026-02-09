/**
 * Business logic for generating OAuth2 authorization URL
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { createDebugLog } from '../lib/debug_log';
import { buildOAuth2AuthUrl } from './generate_oauth2_auth_url';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

interface GenerateOAuth2AuthUrlArgs {
  emailProviderId: Doc<'emailProviders'>['_id'];
  organizationId: string;
  redirectUri?: string;
}

interface GenerateOAuth2AuthUrlDependencies {
  getProvider: (providerId: Doc<'emailProviders'>['_id']) => Promise<unknown>;
  setMetadata: (
    providerId: Doc<'emailProviders'>['_id'],
    config: Record<string, string | number | boolean>,
  ) => Promise<void>;
}

/**
 * Main logic for generating OAuth2 authorization URL
 * Fetches provider and builds authorization URL
 */
export async function generateOAuth2AuthUrlLogic(
  ctx: ActionCtx,
  args: GenerateOAuth2AuthUrlArgs,
  deps: GenerateOAuth2AuthUrlDependencies,
): Promise<string> {
  // Get the provider
  const provider = await deps.getProvider(args.emailProviderId);

  if (!provider) {
    throw new Error('Provider not found');
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const providerData = provider as {
    authMethod: string;
    oauth2Auth?: { provider: string; clientId: string };
    metadata?: Record<string, unknown>;
  };

  if (providerData.authMethod !== 'oauth2' || !providerData.oauth2Auth) {
    throw new Error('Provider is not configured for OAuth2');
  }

  // Get OAuth2 config
  const oauth2Auth = providerData.oauth2Auth;
  const metadata = providerData.metadata;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const accountType = metadata?.accountType as
    | 'personal'
    | 'organizational'
    | 'both'
    | undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const tenantId = metadata?.tenantId as string | undefined;

  // Build and return OAuth2 authorization URL
  // Use redirectUri from args (passed from client) if available,
  // otherwise fall back to metadata, then to default
  debugLog('Received redirectUri from client:', args.redirectUri);
  debugLog('Metadata redirectUri:', metadata?.redirectUri);

  const finalRedirectUri =
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    args.redirectUri || (metadata?.redirectUri as string | undefined);
  debugLog('Final redirectUri to use:', finalRedirectUri);

  // Persist the redirectUri/origin for use during the callback (when Host may be 0.0.0.0)
  if (finalRedirectUri) {
    try {
      const origin = new URL(finalRedirectUri).origin;
      await deps.setMetadata(args.emailProviderId, {
        redirectUri: finalRedirectUri,
        redirectOrigin: origin,
        redirectUpdatedAt: Date.now(),
      });
    } catch (e) {
      console.warn('[OAuth2 Server] Failed to persist redirectUri metadata', e);
    }
  }

  return buildOAuth2AuthUrl({
    provider: oauth2Auth.provider,
    clientId: oauth2Auth.clientId,
    emailProviderId: args.emailProviderId,
    organizationId: args.organizationId,
    accountType,
    tenantId,
    redirectUri: finalRedirectUri,
  });
}
