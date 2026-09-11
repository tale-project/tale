import { oauthRefusalFor } from './oidc.ts';

const AUTH_MOUNT = '/api/auth';

/**
 * The OAuth/OIDC answers in their RFC envelopes, applied to what the auth
 * handler produced: a JSON refusal under `/api/auth/oauth2/*` is read back,
 * re-shaped by `oauthRefusalFor`, and answered with the status and challenge
 * header the RFC names; everything else — successes, redirects, HTML consent
 * pages, other auth routes — passes through untouched. Done at the mount
 * rather than in an auth hook because a hook can change a refusal's body
 * but never its status, and because the serialized answer is the one shape
 * every runtime agrees on.
 */
export async function withOAuthConformance(
  request: Request,
  response: Response,
  realm: string,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(`${AUTH_MOUNT}/oauth2/`) || response.status < 400) {
    return response;
  }
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
