/**
 * The in-sandbox integrations dispatch surface —
 * `POST /api/integrations/{execute,status}` — the platform end of the baked
 * `tale-integrations-mcp` bridge.
 *
 * Contract (fixed by the bridge shipped in the sandbox image, so this surface
 * keeps its exact shape):
 *   execute: body `{slug, operation, args}` → JSON status body
 *   status:  body `{}`                      → JSON listing body
 * Auth: `Authorization: Bearer <session VK>` — resolved by `authSessionToken`
 * to the token row's org + grant set; NOTHING is trusted from the body. The
 * response body is relayed verbatim to the coding agent as tool-result text,
 * so every branch answers structured JSON with guidance, and only transport
 * failures (auth) use a non-2xx status.
 */

import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { authSessionToken } from './dispatch_auth';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const integrationsExecuteHandler = httpAction(async (ctx, request) => {
  const auth = await authSessionToken(ctx, request);
  if (auth === null) {
    return json(401, { status: 'error', message: 'Unauthorized.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(200, {
      status: 'invalid_args',
      message: 'The request body must be JSON: {slug, operation, args}.',
    });
  }
  const slug = isRecord(body) && typeof body.slug === 'string' ? body.slug : '';
  const operation =
    isRecord(body) && typeof body.operation === 'string' ? body.operation : '';
  const callArgs = isRecord(body) && isRecord(body.args) ? body.args : {};
  if (slug === '' || operation === '') {
    return json(200, {
      status: 'invalid_args',
      message: 'Both "slug" and "operation" are required.',
    });
  }

  // The grant set comes from the session token row — what this agent was
  // equipped with when the turn was provisioned, never the request.
  if (!auth.integrationGrants.includes(slug)) {
    return json(200, {
      status: 'unavailable',
      blockers: [
        {
          code: 'not_granted',
          guidance:
            `The "${slug}" integration is not equipped for this agent. ` +
            'The user can equip it in the chat composer or on the project Agents tab, then start a new message.',
        },
      ],
    });
  }
  // Coding-turn tokens always carry the turn's user; a token without one
  // cannot attribute the call, so it cannot dispatch.
  if (auth.userId === undefined) {
    return json(200, {
      status: 'unavailable',
      blockers: [
        {
          code: 'no_user_context',
          guidance:
            'This session token carries no user context, so integration calls cannot run from it.',
        },
      ],
    });
  }

  const result: unknown = await ctx.runAction(
    internal.node_only.sandbox.integrations_bridge.dispatchBridgeIntegration,
    {
      organizationId: auth.organizationId,
      userId: auth.userId,
      slug,
      operation,
      callArgs,
    },
  );
  return json(200, result);
});

export const integrationsStatusHandler = httpAction(async (ctx, request) => {
  const auth = await authSessionToken(ctx, request);
  if (auth === null) {
    return json(401, { status: 'error', message: 'Unauthorized.' });
  }
  const result: unknown = await ctx.runAction(
    internal.node_only.sandbox.integrations_bridge.bridgeIntegrationStatus,
    {
      organizationId: auth.organizationId,
      grants: auth.integrationGrants,
    },
  );
  return json(200, result);
});
