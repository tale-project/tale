import { internal } from '../_generated/api';
import { ActionCtx } from '../_generated/server';

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

    const provider = await ctx.runQuery(
      internal.sso_providers.internal_queries.getSsoConfig,
      {},
    );

    if (!provider) {
      return new Response(JSON.stringify({ ssoEnabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        ssoEnabled: true,
        organizationId: provider.organizationId,
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
