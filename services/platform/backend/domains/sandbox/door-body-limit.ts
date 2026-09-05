import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/**
 * Request-body cap for the CONTAINER-FACING doors (`/api/tools/*`,
 * `/api/connectors/*`). Those routes bypass the proxy — backend-api is
 * dual-homed onto the sandbox network and SANDBOX_HTTP_API_BASE_URL points
 * straight at it — so the proxy's `request_body` cap never applies, and
 * `c.req.json()` would buffer whatever a prompt-injected or looping agent
 * POSTs into the one API process every org shares. The doors treat the
 * container as hostile in every other respect (org, user and grants come
 * from the token row, never the body); the size is a boundary too.
 *
 * 8 MiB sits well above the largest legitimate body: document_create's
 * inline content cap is 600k characters (≤ 2.4 MiB as UTF-8), and a
 * connector hostcall relays JSON API requests (the live host caps
 * RESPONSES at 5 MiB; attachment bytes ride ctx.files, not this door).
 * Hono checks Content-Length first and otherwise stops reading the stream
 * at the first byte over the cap, so an oversized body is never buffered
 * whole.
 */
export const SANDBOX_DOOR_MAX_BODY_BYTES = 8 * 1024 * 1024;

const TOO_LARGE_MESSAGE = `Request body too large: the sandbox doors accept at most ${SANDBOX_DOOR_MAX_BODY_BYTES / (1024 * 1024)} MB.`;

/**
 * The cap as middleware. `refusal` shapes the 413 body in the door's own
 * dialect — `{status: 'invalid_args', message}` for the tool-result doors
 * (relayed verbatim to the model), `{error: {code, message}}` for the
 * hostcall door (the in-sandbox `ctx.http` façade rethrows `error`).
 */
export function sandboxDoorBodyLimit(
  refusal: (message: string) => unknown,
): MiddlewareHandler {
  return bodyLimit({
    maxSize: SANDBOX_DOOR_MAX_BODY_BYTES,
    onError: (c) => c.json(refusal(TOO_LARGE_MESSAGE), 413),
  });
}

/** The tool-result doors' refusal (`/api/tools/*`, `/api/connectors/{execute,status}`). */
export function toolResultTooLarge(message: string): unknown {
  return { status: 'invalid_args', message };
}

/** The hostcall door's refusal (`/api/connectors/hostcall`). */
export function hostcallTooLarge(message: string): unknown {
  return { error: { code: 'PAYLOAD_TOO_LARGE', message } };
}
