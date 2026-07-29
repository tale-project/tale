/**
 * The PORTABLE calling convention for a live yaml-js connector body running
 * out of process (sandbox-exec runner).
 *
 * A live body's contract is `(input, ctx)` where `ctx` carries functions —
 * `secrets.get`, the mediated `http` verbs, `base64*` — and functions cannot
 * cross the sandbox's data-only JSON boundary. So the scope ships `ctx` as
 * PLAIN DATA ({@link PortableLiveCtxData}) and the code ships with a PRELUDE
 * that rebuilds the body-facing façade inside the sandbox:
 *
 *  - `secrets.get` / `config` / `endpoint` / `idempotencyKey` come straight
 *    from the data (the dispatcher resolved them server-side; a body places
 *    secret values itself, so they were always going to be present in the
 *    run's memory);
 *  - `http.*` stays PLATFORM-MEDIATED: each verb round-trips to the
 *    `/api/integrations/hostcall` endpoint (bearer: a one-run capability
 *    token), where the real live host enforces the connector allowlist,
 *    https-only, response caps, and injects the org's Authorization header —
 *    the mediation layer is never re-implemented in the sandbox, and a
 *    bearer/oauth credential never enters it;
 *  - `files` is absent in this convention (V1) — a body that needs it gets a
 *    clear refusal from the façade instead of a TypeError.
 *
 * Pure string/data assembly — no `node:*`, no Convex — so the dispatcher (lib)
 * can build the invocation and unit tests can execute the composed program.
 */

/** Where the in-sandbox façade reaches the platform, and as whom. */
export interface PortableHostCall {
  /** Sandbox-reachable URL of the host-call endpoint. */
  url: string;
  /** One-run capability token (see integrations/hostcall_token.ts). */
  token: string;
}

/** `ctx` as it crosses the boundary — data only, no functions. */
export interface PortableLiveCtxData {
  secrets: Record<string, string>;
  config: Record<string, string | number | boolean>;
  endpoint?: string;
  idempotencyKey?: string;
  hostCall: PortableHostCall;
}

/**
 * The façade-rebuilding prelude. Runs FIRST inside the sandbox program with
 * `ctx` bound to the {@link PortableLiveCtxData}; reassigns `ctx` to the
 * body-facing shape, then the original body follows verbatim. Kept as one
 * template so the wire shape lives in exactly one place; the host-call
 * endpoint implements the matching side.
 */
const PORTABLE_CTX_PRELUDE = `ctx = (function (d) {
  async function hostHttp(method, url, req) {
    var res;
    try {
      res = await fetch(d.hostCall.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + d.hostCall.token,
        },
        body: JSON.stringify({ kind: 'http', method: method, url: url, req: req || {} }),
      });
    } catch (err) {
      throw new Error('integration host-call unreachable: ' + (err && err.message ? err.message : String(err)));
    }
    var out = null;
    try { out = await res.json(); } catch (err) {
      throw new Error('integration host-call returned a non-JSON response (status ' + res.status + ')');
    }
    if (out && out.error) {
      throw new Error(String(out.error.message || out.error.code || 'integration host-call failed'));
    }
    if (!res.ok) {
      throw new Error('integration host-call failed (status ' + res.status + ')');
    }
    var parsed = null;
    return {
      status: out.status,
      headers: out.headers || {},
      text: function () { return out.bodyText; },
      json: function () {
        if (parsed) return parsed.value;
        parsed = { value: JSON.parse(out.bodyText) };
        return parsed.value;
      },
    };
  }
  return {
    secrets: {
      get: function (name) {
        return Object.prototype.hasOwnProperty.call(d.secrets || {}, name) ? d.secrets[name] : '';
      },
    },
    config: d.config || {},
    endpoint: d.endpoint,
    idempotencyKey: d.idempotencyKey,
    http: {
      get: function (u, r) { return hostHttp('GET', u, r); },
      post: function (u, r) { return hostHttp('POST', u, r); },
      put: function (u, r) { return hostHttp('PUT', u, r); },
      patch: function (u, r) { return hostHttp('PATCH', u, r); },
      delete: function (u, r) { return hostHttp('DELETE', u, r); },
    },
    files: {
      download: function () { throw new Error('ctx.files is not available when this connector runs in the sandbox yet'); },
      store: function () { throw new Error('ctx.files is not available when this connector runs in the sandbox yet'); },
    },
    base64Encode: function (s) { return Buffer.from(s, 'utf8').toString('base64'); },
    base64Decode: function (s) { return Buffer.from(s, 'base64').toString('utf8'); },
  };
})(ctx);
`;

/** The runnable body: the façade prelude, then the connector's live body
 * verbatim. Bound as `(input, ctx)` by the runner's calling convention. */
export function buildPortableLiveCode(liveBody: string): string {
  return `${PORTABLE_CTX_PRELUDE}${liveBody}`;
}
