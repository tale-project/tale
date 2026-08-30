import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';

/**
 * @deprecated Login no longer routes by email domain; use the org picker instead.
 *
 * POST /api/sso/discover — given an email, report whether SSO is enabled and,
 * if so, the org + protocol so the login screen can start the right flow.
 */
export async function ssoDiscoverHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const body = await req.json();
    const email = body?.email;
    if (!email || typeof email !== 'string') {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const match = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.discoverByEmail,
      { email },
    );

    if (!match) {
      return new Response(JSON.stringify({ ssoEnabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        ssoEnabled: true,
        organizationId: match.organizationId,
        protocol: match.protocol,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[SSO] Discover error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
