// Request authentication for the spawner's HTTP surface — ONE verifier for
// every route that changes or reveals state (sessions, exec, files, the deploy
// control routes, the screencast upgrade). HMAC over
// METHOD\npath\ntimestamp\nnonce\nsha256(body) with the shared SANDBOX_TOKEN
// (auth.ts). The secret is REQUIRED (loadConfig fails closed without it), so
// there is no "unsigned mode" branch here: a request without a valid signature
// is a 401, full stop. The spawner holds the host docker socket and sits on the
// sandbox network every session container shares — anything short of that lets
// a tenant's sandboxed code drive the control plane.

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verify,
} from './auth.ts';
import { jsonResponse, readBodyCapped } from './http-util.ts';

export interface RequestAuth {
  /** Verify `req` against an already-read body. `null` = authorized;
   * otherwise the 401 Response to return as-is. */
  authorize(body: string, req: Request): Response | null;
  /** Body-cap + verify for a route that needs the raw body; returns the
   * verified body string or an error Response (400 / 401 / 413). */
  readAndAuth(req: Request): Promise<{ body: string } | { error: Response }>;
}

export function createRequestAuth(
  token: string,
  maxRequestBodyBytes: number,
): RequestAuth {
  if (token.length === 0) {
    // loadConfig already refuses an empty token; this keeps the verifier
    // self-protecting if it is ever constructed some other way.
    throw new Error('request auth requires a non-empty SANDBOX_TOKEN');
  }

  function authorize(body: string, req: Request): Response | null {
    const url = new URL(req.url);
    // Verify against path + query: clients sign the full request path (see
    // session_client's signedHeaders), and the query carries semantics worth
    // binding (e.g. /files?path=…). Query-less requests are unaffected
    // (url.search is the empty string).
    const result = verify(
      req.method,
      url.pathname + url.search,
      body,
      req.headers.get(SIGNATURE_HEADER),
      req.headers.get(TIMESTAMP_HEADER),
      req.headers.get(NONCE_HEADER),
      token,
    );
    if (!result.ok) {
      // Log the discriminator server-side so operators can diagnose, but DON'T
      // surface it in the response body — distinguishing "wrong signature" from
      // "clock skew" lets an attacker calibrate (audit finding R2-B5).
      console.warn(`[sandbox.auth] unauthorized (${result.reason})`);
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    return null;
  }

  async function readAndAuth(
    req: Request,
  ): Promise<{ body: string } | { error: Response }> {
    let body: string;
    try {
      body = await readBodyCapped(req, maxRequestBodyBytes);
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'httpStatus' in err
          ? Number(err.httpStatus)
          : 400;
      return {
        error: jsonResponse(
          { error: status === 413 ? 'payload_too_large' : 'bad_request' },
          status === 413 ? 413 : 400,
        ),
      };
    }
    const authFail = authorize(body, req);
    if (authFail) return { error: authFail };
    return { body };
  }

  return { authorize, readAndAuth };
}
