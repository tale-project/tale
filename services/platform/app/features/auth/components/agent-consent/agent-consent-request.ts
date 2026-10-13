import { requestsAgentAccess, scopesOf } from '@/lib/shared/agent-access';

/**
 * The authorization request the consent page was opened with. The provider
 * signs the query and it expires there; the page only reads from it what it
 * shows and what the server asks about — which app, which access, where the
 * person is sent back to — and passes the query on whole, byte for byte, when
 * they decide. It never interprets the signature.
 */

export interface AgentConsentRequest {
  /** The query as it arrived, without the leading `?`. */
  query: string;
  clientId: string;
  /** The scopes the app asked for, space separated. */
  scope: string;
  /** Where the person is sent back to, as the app named it. */
  redirectUri: string | null;
  /** The app's PKCE challenge: it names this authorization request however
   * many times the provider signs its query anew. */
  codeChallenge: string | null;
  /** When the signed request stops being accepted, in epoch milliseconds. */
  expiresAt: number | null;
}

/** Whether a consent page query is a coding agent's: it asks for an access a
 * connection grants, which a single sign-on never does. */
export function isAgentRequest(search: string): boolean {
  return requestsAgentAccess(
    scopesOf(new URLSearchParams(search).get('scope')),
  );
}

export function readAgentConsentRequest(search: string): AgentConsentRequest {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const exp = Number(params.get('exp'));
  return {
    query,
    clientId: params.get('client_id') ?? '',
    scope: params.get('scope') ?? '',
    redirectUri: params.get('redirect_uri'),
    codeChallenge: params.get('code_challenge'),
    expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : null,
  };
}

/** Whether the request can no longer be accepted. A request that names no
 * expiry is left to the provider to judge. */
export function isExpired(
  request: Pick<AgentConsentRequest, 'expiresAt'>,
  now: number,
): boolean {
  return request.expiresAt !== null && now >= request.expiresAt;
}

/** Where the person is sent back to, as the page says it. */
export interface RedirectPlace {
  /** The host, or the scheme of an app's own address. */
  host: string;
  /** Whether it is the person's own computer. */
  loopback: boolean;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/** The place a `redirect_uri` leads to, or null when it names none that can
 * be read. */
export function redirectPlaceOf(
  redirectUri: string | null,
): RedirectPlace | null {
  if (redirectUri === null || !URL.canParse(redirectUri)) return null;
  const url = new URL(redirectUri);
  const host = url.hostname === '' ? url.protocol : url.hostname;
  return { host, loopback: LOOPBACK_HOSTS.has(url.hostname) };
}
