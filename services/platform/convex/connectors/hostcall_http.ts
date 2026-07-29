/**
 * `POST /api/connectors/hostcall` — the platform end of a live connector
 * body running out of process.
 *
 * The in-sandbox portable façade presents a one-run capability token (minted
 * at dispatch, HMAC-signed, bound to org + connector + action + credential)
 * and a `{kind: 'http', method, url, req}` body. This handler only
 * authenticates and shapes; the actual mediated request — allowlist,
 * https-only, caps, Authorization — runs in the node action through the same
 * `createLiveHost` as the in-process path.
 *
 * Every answered outcome is JSON. Refusals the BODY should see (vendor 4xx,
 * allowlist violations) ride inside a 200 as `{error}` — the façade rethrows
 * them for the body's own error handling. Only an unauthenticated or
 * malformed call gets a non-2xx.
 */

import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { verifyHostcallToken } from './hostcall_token';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export const connectorsHostcallHandler = httpAction(async (ctx, request) => {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const verdict = await verifyHostcallToken(token);
  if (!verdict.ok) {
    return json(401, {
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized.' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, {
      error: { code: 'BAD_REQUEST', message: 'The body must be JSON.' },
    });
  }
  if (
    !isRecord(body) ||
    body.kind !== 'http' ||
    typeof body.method !== 'string' ||
    typeof body.url !== 'string'
  ) {
    return json(400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'Expected {kind: "http", method, url, req?}.',
      },
    });
  }
  const req = isRecord(body.req) ? body.req : {};
  const headers = stringRecord(req.headers);
  const reqBody = typeof req.body === 'string' ? req.body : undefined;
  const responseType = req.responseType === 'base64' ? 'base64' : undefined;

  const result: unknown = await ctx.runAction(
    internal.connectors.hostcall_action.performConnectorHostCall,
    {
      organizationId: verdict.payload.org,
      connectorSlug: verdict.payload.connector,
      actionName: verdict.payload.action,
      ...(verdict.payload.credentialRef !== undefined && {
        credentialRef: verdict.payload.credentialRef,
      }),
      method: body.method,
      url: body.url,
      req: {
        ...(headers !== undefined && { headers }),
        ...(reqBody !== undefined && { body: reqBody }),
        ...(responseType !== undefined && { responseType }),
      },
    },
  );
  return json(200, result);
});
