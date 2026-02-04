import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';
import { getAdapter } from './registry';
import { ONEDRIVE_SCOPES } from './entra_id/adapter';

function normalizeOrigin(origin: string): string {
	return origin.replace('127.0.0.1', 'localhost');
}

export async function ssoAuthorizeHandler(ctx: ActionCtx, req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const email = url.searchParams.get('email');
		const normalizedOrigin = normalizeOrigin(url.origin);
		const redirectUri = url.searchParams.get('redirect_uri') || `${normalizedOrigin}/api/sso/callback`;

		const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

		if (!provider) {
			return new Response('No SSO configuration found', { status: 404 });
		}

		const adapter = getAdapter(provider.providerId);
		if (!adapter) {
			return new Response(`Unsupported SSO provider: ${provider.providerId}`, { status: 400 });
		}

		const loginHint = email || undefined;

		const clientId = await decryptString(provider.clientIdEncrypted);

		const stateData = JSON.stringify({
			redirectUri,
			timestamp: Date.now(),
		});
		const state = btoa(stateData).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

		const scopes = [...provider.scopes];
		const entraFeatures = provider.providerFeatures?.entraId;
		const additionalScopes: string[] = [];

		if (entraFeatures?.enableOneDriveAccess) {
			for (const scope of ONEDRIVE_SCOPES) {
				if (!scopes.includes(scope)) {
					additionalScopes.push(scope);
				}
			}
		}

		const authUrl = adapter.buildAuthorizeUrl(
			{
				providerId: provider.providerId,
				issuer: provider.issuer,
				clientId,
				clientSecret: '',
				scopes,
			},
			{
				redirectUri,
				state,
				loginHint,
				additionalScopes,
			},
		);

		return new Response(null, {
			status: 302,
			headers: { Location: authUrl.toString() },
		});
	} catch (error) {
		console.error('[SSO] Authorize error:', error);
		return new Response('Internal server error', { status: 500 });
	}
}
