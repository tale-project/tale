import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { decryptString } from '../lib/crypto/decrypt_string';
import { signCookieValue, verifySignedValue } from './sign_cookie_value';
import { createAuth } from '../auth';
import { getAdapter } from './registry';

const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function redirectWithError(origin: string, message: string): Response {
	const errorUrl = new URL('/log-in', origin);
	errorUrl.searchParams.set('error', message);
	return new Response(null, {
		status: 302,
		headers: { Location: errorUrl.toString() },
	});
}

export async function ssoCallbackHandler(ctx: ActionCtx, req: Request): Promise<Response> {
	try {
		const url = new URL(req.url);
		const code = url.searchParams.get('code');
		const stateParam = url.searchParams.get('state');
		const error = url.searchParams.get('error');
		const errorDescription = url.searchParams.get('error_description');

		if (error) {
			console.error('[SSO] OAuth error:', error, errorDescription);
			return redirectWithError(url.origin, `SSO login failed: ${errorDescription || error}`);
		}

		if (!code || !stateParam) {
			return redirectWithError(url.origin, 'Missing authorization code or state');
		}

		const secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			console.error('[SSO] BETTER_AUTH_SECRET not configured');
			return redirectWithError(url.origin, 'Server configuration error');
		}

		const verifiedPayload = await verifySignedValue(stateParam, secret);
		if (!verifiedPayload) {
			return redirectWithError(url.origin, 'Invalid state signature');
		}

		let state: { redirectUri: string; timestamp: number };
		try {
			const base64 = verifiedPayload.replace(/-/g, '+').replace(/_/g, '/');
			const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
			state = JSON.parse(atob(padded));
		} catch {
			return redirectWithError(url.origin, 'Invalid state parameter');
		}

		if (Date.now() - state.timestamp > 10 * 60 * 1000) {
			return redirectWithError(url.origin, 'SSO session expired');
		}

		const frontendOrigin = new URL(state.redirectUri).origin;

		const provider = await ctx.runQuery(internal.sso_providers.internal_queries.getSsoConfig, {});

		if (!provider) {
			return redirectWithError(frontendOrigin, 'SSO configuration not found');
		}

		const adapter = getAdapter(provider.providerId);
		if (!adapter) {
			return redirectWithError(frontendOrigin, `Unsupported SSO provider: ${provider.providerId}`);
		}

		const clientId = await decryptString(provider.clientIdEncrypted);
		const clientSecret = await decryptString(provider.clientSecretEncrypted);

		const tokens = await adapter.exchangeCodeForTokens(
			{
				providerId: provider.providerId,
				issuer: provider.issuer,
				clientId,
				clientSecret,
				scopes: provider.scopes,
			},
			{
				code,
				redirectUri: state.redirectUri,
			},
		);

		const userInfo = await adapter.getUserInfo(tokens.accessToken);

		let appRoles: string[] = [];
		if (provider.autoProvisionRole && adapter.getAppRoles) {
			try {
				appRoles = await adapter.getAppRoles(tokens.accessToken);
			} catch (e) {
				console.warn('[SSO] Failed to fetch app roles:', e);
			}
		}

		const result = await ctx.runAction(internal.sso_providers.internal_actions.handleSsoLogin, {
			email: userInfo.email,
			name: userInfo.name,
			externalId: userInfo.externalId,
			providerId: provider.providerId,
			jobTitle: userInfo.jobTitle,
			appRoles,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			accessTokenExpiresAt: tokens.expiresAt,
			organizationId: provider.organizationId,
		});

		if (!result.success) {
			return redirectWithError(frontendOrigin, result.error || 'SSO login failed');
		}

		if (!result.sessionToken) {
			return redirectWithError(frontendOrigin, 'Failed to create session');
		}

		const secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			console.error('[SSO] BETTER_AUTH_SECRET not configured');
			return redirectWithError(frontendOrigin, 'Server configuration error');
		}

		const signedToken = await signCookieValue(result.sessionToken, secret);

		const isHttps = frontendOrigin.startsWith('https://');
		const cookieName = isHttps ? `__Secure-${SESSION_COOKIE_NAME}` : SESSION_COOKIE_NAME;

		const cookieParts = [
			`${cookieName}=${signedToken}`,
			`Max-Age=${SESSION_MAX_AGE}`,
			'Path=/',
			'HttpOnly',
			'SameSite=Lax',
		];
		if (isHttps) {
			cookieParts.push('Secure');
		}
		const sessionCookie = cookieParts.join('; ');

		const auth = createAuth(ctx);
		const getSessionUrl = new URL('/api/auth/get-session', frontendOrigin);
		const getSessionRequest = new Request(getSessionUrl.toString(), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${result.sessionToken}`,
				'Content-Type': 'application/json',
			},
		});

		const authResponse = await auth.handler(getSessionRequest);

		const cookies: string[] = [sessionCookie];
		authResponse.headers.forEach((value, key) => {
			if (key.toLowerCase() === 'set-cookie') {
				cookies.push(value);
			}
		});

		const headers = new Headers();
		headers.set('Location', `${frontendOrigin}/dashboard`);
		for (const cookie of cookies) {
			headers.append('Set-Cookie', cookie);
		}

		return new Response(null, {
			status: 302,
			headers,
		});
	} catch (error) {
		console.error('[SSO] Callback error:', error);
		return redirectWithError(new URL(req.url).origin, 'Internal server error');
	}
}
