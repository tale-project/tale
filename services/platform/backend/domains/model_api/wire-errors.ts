import type { Env, MiddlewareHandler } from 'hono';

import { isRecord } from '../../../lib/utils/type-utils.ts';
import { requestIdOf } from '../../error-reporting.ts';
import {
  MODEL_API_WIRE_PATHS,
  modelApiWireOf,
  wireErrorBody,
  wireHeaders,
} from './wire.ts';

/**
 * Every refusal on a model endpoint in the wire's own error shape — the REST
 * door's own included: the missing or invalid key (401), the organization
 * header (400/403/404), the key holder's rate limit (429), an oversized body
 * (413), an unknown path under the wire (404), the database restarting
 * (503), the door's 500. Those are answered before the model route runs, in
 * the door's flat `{error, code}` envelope; a vendor SDK reading them as the
 * vendor's own would find no message where it looks. This middleware wraps
 * the whole door on the two wire prefixes — registered ahead of the pre-route
 * guards in `createApp`, so their refusals pass through it too — and
 * rewrites a flat envelope into the wire's shape, keeping the status, the
 * code and every header (the challenge, the wait). A body already in the
 * wire's shape, and every success, pass untouched.
 */
export function modelApiWireErrors<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const wire = modelApiWireOf(c.req.path);
    if (wire === null) return next();
    await next();
    const response = c.res;
    if (response.status < 400 || c.req.method === 'HEAD') return;
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) return;
    let envelope: unknown;
    try {
      envelope = await response.clone().json();
    } catch (error) {
      console.warn(
        '[model-api] a refusal on a model endpoint was not JSON; relayed as it is:',
        error instanceof Error ? error.message : error,
      );
      return;
    }
    if (!isRecord(envelope) || typeof envelope.error !== 'string') return;
    const requestId =
      typeof envelope.requestId === 'string'
        ? envelope.requestId
        : requestIdOf(c);
    const body = wireErrorBody(
      wire,
      {
        status: response.status,
        code: typeof envelope.code === 'string' ? envelope.code : 'HTTP_ERROR',
        message: envelope.error,
      },
      requestId,
    );
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(wireHeaders(wire, requestId))) {
      headers.set(name, value);
    }
    // Hono carries the replaced response's headers over; its length is the
    // flat envelope's, not this body's.
    response.headers.delete('content-length');
    headers.delete('content-length');
    c.res = new Response(JSON.stringify(body), {
      status: response.status,
      headers,
    });
  };
}

/** The sentence the `x-api-key` refusal adds on the Anthropic endpoint,
 * whose SDKs and Claude Code send a key in that header unless it is given
 * as an auth token. */
export function modelApiKeyHeaderHint(path: string): string | undefined {
  if (modelApiWireOf(path) !== 'anthropic') return undefined;
  return `on ${MODEL_API_WIRE_PATHS.anthropic}, set the key as ANTHROPIC_AUTH_TOKEN (Claude Code) or authToken / auth_token (Anthropic SDKs) and leave ANTHROPIC_API_KEY unset`;
}
