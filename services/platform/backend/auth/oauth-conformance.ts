import {
  authorizeRedirectFor,
  OIDC_AUTHORIZE_PATH,
  OIDC_DISCOVERY_PATHS,
  OIDC_PROMPT_VALUES_SUPPORTED,
  OIDC_TOKEN_PATH,
  oauthRefusalFor,
  tokenRequestRefusal,
} from './oidc.ts';

const AUTH_MOUNT = '/api/auth';

/** A token request is a handful of form fields; a body past this is not
 * one this precheck can judge, and the library's own limits apply. */
const TOKEN_REQUEST_PEEK_BYTES = 64 * 1024;

/** The redirect the provider hands a fetch-mode client: a 200 whose
 * body says where a browser navigation would have been sent. */
function isRedirectAnswer(
  body: unknown,
): body is { redirect: true; url: string } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'redirect' in body &&
    body.redirect === true &&
    'url' in body &&
    typeof body.url === 'string'
  );
}

/**
 * The OAuth/OIDC answers in their RFC envelopes, applied to what the auth
 * handler produced: a JSON refusal under `/api/auth/oauth2/*` is read back,
 * re-shaped by `oauthRefusalFor`, and answered with the status and challenge
 * header the RFC names; the authorization endpoint's redirect to the error
 * page is corrected for an unknown client (`authorizeRedirectFor`); the
 * discovery documents advertise only what this issuer honours
 * (`withDiscoveryConformance`). Everything else — successes, redirects to
 * the client, HTML consent pages, other auth routes — passes through
 * untouched. Done at the mount rather than in an auth hook because a hook
 * can change a refusal's body but never its status, and because the
 * serialized answer is the one shape every runtime agrees on.
 */
export async function withOAuthConformance(
  request: Request,
  response: Response,
  realm: string,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (OIDC_DISCOVERY_PATHS.includes(pathname)) {
    return withDiscoveryConformance(response);
  }
  if (!pathname.startsWith(`${AUTH_MOUNT}/oauth2/`)) return response;
  if (
    response.status === 302 &&
    pathname === `${AUTH_MOUNT}${OIDC_AUTHORIZE_PATH}`
  ) {
    const location = response.headers.get('location');
    const corrected =
      location === null
        ? null
        : authorizeRedirectFor({ requestUrl: request.url, location });
    if (corrected === null) return response;
    const headers = new Headers(response.headers);
    headers.set('location', corrected);
    return new Response(null, { status: 302, headers });
  }
  if (
    response.status === 200 &&
    pathname === `${AUTH_MOUNT}${OIDC_AUTHORIZE_PATH}` &&
    (response.headers.get('content-type') ?? '').includes('application/json')
  ) {
    // The same redirect, in the form the library hands a fetch-mode client
    // (`sec-fetch-mode: cors`, or `Accept: application/json`): a 200 whose
    // body says `{redirect: true, url}` — Node's fetch is one such client.
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Not the JSON the header promised: hand it on exactly as it was.
      return new Response(text, {
        status: response.status,
        headers: response.headers,
      });
    }
    if (!isRedirectAnswer(body)) {
      return new Response(text, {
        status: response.status,
        headers: response.headers,
      });
    }
    const corrected = authorizeRedirectFor({
      requestUrl: request.url,
      location: body.url,
    });
    if (corrected === null) {
      return new Response(text, {
        status: response.status,
        headers: response.headers,
      });
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify({ ...body, url: corrected }), {
      status: 200,
      headers,
    });
  }
  if (response.status < 400) return response;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return response;
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not the JSON the header promised: hand it on exactly as it was.
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  }
  const refusal = oauthRefusalFor({
    path: pathname.slice(AUTH_MOUNT.length),
    status: response.status,
    body,
    authorization: request.headers.get('authorization'),
    realm,
  });
  if (refusal === null) {
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  for (const [name, value] of Object.entries(refusal.headers)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(refusal.body), {
    status: refusal.status,
    headers,
  });
}

/**
 * The token endpoint's `invalid_request` for a request that names no
 * `grant_type` — answered BEFORE the auth handler, from a clone of the
 * request, because the handler consumes the body and its schema layer
 * reads the absence as an unsupported grant (RFC 6749 §5.2 says otherwise).
 * Null for every other request, and for a body too large to be a token
 * request, which the library judges as it always did.
 */
export async function oauthTokenPrecheck(
  request: Request,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    request.method !== 'POST' ||
    pathname !== `${AUTH_MOUNT}${OIDC_TOKEN_PATH}`
  ) {
    return null;
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > TOKEN_REQUEST_PEEK_BYTES) {
    return null;
  }
  const body = await request.clone().text();
  if (body.length > TOKEN_REQUEST_PEEK_BYTES) return null;
  const refusal = tokenRequestRefusal({
    method: request.method,
    path: OIDC_TOKEN_PATH,
    contentType: request.headers.get('content-type'),
    body,
  });
  if (refusal === null) return null;
  return new Response(JSON.stringify(refusal.body), {
    status: refusal.status,
    headers: {
      'content-type': 'application/json',
      // RFC 6749 §5.2: the token endpoint's answers are never cached.
      'cache-control': 'no-store',
      pragma: 'no-cache',
      ...refusal.headers,
    },
  });
}

/**
 * The discovery document as this issuer honours it: the provider library
 * hard-codes `prompt_values_supported` to every value it knows, two of
 * which this deployment refuses or misroutes (`OIDC_PROMPT_VALUES_SUPPORTED`
 * says which and why). A document that is not a 200 JSON object passes
 * through untouched.
 */
export async function withDiscoveryConformance(
  response: Response,
): Promise<Response> {
  if (
    response.status !== 200 ||
    !(response.headers.get('content-type') ?? '').includes('application/json')
  ) {
    return response;
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return new Response(text, {
      status: response.status,
      headers: response.headers,
    });
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(
    JSON.stringify({
      ...body,
      prompt_values_supported: [...OIDC_PROMPT_VALUES_SUPPORTED],
    }),
    { status: 200, headers },
  );
}
