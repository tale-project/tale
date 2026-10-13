import { randomUUID } from 'node:crypto';

import { createCimdClientDiscovery } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type {
  ClientDiscovery,
  ClientMetadataResourceFetch,
} from '@better-auth/oauth-provider';
import type { Sql } from 'postgres';

import {
  isAgentScope,
  MCP_PATH,
  MCP_RESOURCE_SCOPES,
  OFFLINE_ACCESS,
  requestsAgentAccess,
  scopesOf,
} from '../../lib/shared/agent-access.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import {
  basePath,
  publicOrigin,
  siteOrigins,
} from '../core/lib/helpers/public_origin.ts';
import {
  checkIpRateLimit,
  checkKeyedRateLimit,
  RateLimitExceededError,
} from '../lib/rate-limit.ts';
import {
  type AgentConsentDeps,
  agentConsentGate,
  CONSENT_PATH,
} from './agent-consent.ts';
import { type AgentOAuthOptions, agentSignInOn } from './agent-oauth-config.ts';
import {
  endAgentsAfterReuse,
  tokenRequestFields,
  usedRefreshToken,
} from './agent-reuse.ts';

/**
 * Coding agents signing in to Tale's MCP endpoint, on the Better Auth OAuth
 * provider the deployment already runs for single sign-on:
 *
 * - the endpoint is an OAuth resource on every address the deployment
 *   answers on (`mcpResourceIdentifiers`), and its metadata (RFC 9728) tells
 *   an agent where to sign in (`protectedResourceMetadataAnswer`);
 * - an agent identifies itself by a client metadata document it publishes
 *   on its own HTTPS host (`agentClientDiscovery`), or, where the operator
 *   leaves it on, registers itself — restricted to the agent scopes, local
 *   redirects and the web hosts of known agents (`registerPrecheck`);
 * - an agent's authorization request is bound to the MCP endpoint even when
 *   the agent left the resource out (`authorizePrecheck`), so its token
 *   names the endpoint as its audience, and keeps only the scopes the
 *   endpoint grants: a client that asks for everything the sign-in server
 *   lists, identity scopes included, is not refused for it;
 * - a source that keeps failing at the token endpoint is slowed down
 *   (`chargeTokenFailure`).
 *
 * Single sign-on for an organization's own applications passes through all
 * of this untouched: its clients ask for no agent scope and name no agent
 * resource.
 */

const AUTH_MOUNT = '/api/auth';
const REGISTER_PATH = `${AUTH_MOUNT}/oauth2/register`;
const AUTHORIZE_PATH = `${AUTH_MOUNT}/oauth2/authorize`;
const TOKEN_PATH = `${AUTH_MOUNT}/oauth2/token`;

/** Where a protected resource's metadata lives (RFC 9728 §3). */
export const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource';

// ------------------------------------------------------------ the resource

/** How long an agent's access token lives: a disconnect or a lost seat is
 * also refused at the door on the next call, whatever the token says. */
const AGENT_ACCESS_TOKEN_SECONDS = 300;

/** How long a coding agent stays signed in without being used: every
 * refresh rotates its refresh token and restarts the window. */
export const AGENT_REFRESH_TOKEN_SECONDS = 30 * 86_400;

/** What marks a resource row as the MCP endpoint's, among the provider's
 * resource rows. */
const MCP_RESOURCE_MARK = { taleResource: 'mcp' } as const;

/** The MCP endpoint as an OAuth resource on one origin: its URL, the
 * deployment's base path kept, scheme and host lower-cased. */
function mcpResourceOn(origin: string, base: string): string {
  return `${new URL(origin).origin}${base}${MCP_PATH}`;
}

/** The MCP endpoint on every origin the deployment answers on, the
 * canonical one first — one resource each, so an agent's token names the
 * address the agent connected to. */
export function mcpResourceIdentifiers(
  origins: readonly string[],
  base: string,
): string[] {
  return [...new Set(origins.map((origin) => mcpResourceOn(origin, base)))];
}

/** The MCP resource of the configured origin a request arrived on — never
 * an origin the deployment does not answer on (`publicOrigin`). */
export function mcpResourceFor(request: Request): string {
  return mcpResourceOn(publicOrigin(request), basePath());
}

/** The MCP endpoint on every origin this deployment is configured with
 * (`SITE_URL`, `ADDITIONAL_SITE_URLS`, `BASE_PATH`). */
export function configuredMcpResources(): string[] {
  return mcpResourceIdentifiers(siteOrigins(), basePath());
}

/**
 * The MCP endpoint's resource rows at the provider, written once the boot
 * migrations made its tables: one per address, holding the token lifetimes
 * and the scope allowlist configured here — the configuration wins over a
 * row edited since — and a row of an address the deployment no longer
 * answers on taken out of issuance (disabled; a token already issued for it
 * is refused at the door all the same). Written here rather than by the
 * provider's own start-up, which reads the database before the boot waits
 * out an unavailable one, and stays failed for the life of the process
 * when that read fails.
 */
export async function seedMcpResources(
  sql: Sql,
  identifiers: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  if (identifiers.length === 0) return;
  await sql.begin(async (tx) => {
    for (const identifier of identifiers) {
      await tx`
        INSERT INTO "oauthResource" (
          "id", "identifier", "name", "accessTokenTtl", "refreshTokenTtl",
          "signingAlgorithm", "signingKeyId", "allowedScopes", "customClaims",
          "dpopBoundAccessTokensRequired", "disabled", "createdAt",
          "updatedAt", "policyVersion", "metadata"
        ) VALUES (
          ${randomUUID()}, ${identifier}, 'Tale MCP endpoint',
          ${AGENT_ACCESS_TOKEN_SECONDS}, ${AGENT_REFRESH_TOKEN_SECONDS},
          NULL, NULL, ${tx.json([...MCP_RESOURCE_SCOPES])}, NULL,
          false, false, ${now}, ${now}, 1, ${tx.json(MCP_RESOURCE_MARK)}
        )
        ON CONFLICT ("identifier") DO UPDATE SET
          "name" = EXCLUDED."name",
          "accessTokenTtl" = EXCLUDED."accessTokenTtl",
          "refreshTokenTtl" = EXCLUDED."refreshTokenTtl",
          "signingAlgorithm" = NULL,
          "signingKeyId" = NULL,
          "allowedScopes" = EXCLUDED."allowedScopes",
          "customClaims" = NULL,
          "dpopBoundAccessTokensRequired" = false,
          "disabled" = false,
          "updatedAt" = EXCLUDED."updatedAt",
          "metadata" = EXCLUDED."metadata"
      `;
    }
    await tx`
      UPDATE "oauthResource" SET "disabled" = true, "updatedAt" = ${now}
      WHERE "metadata" @> ${tx.json(MCP_RESOURCE_MARK)}
        AND NOT ("identifier" = ANY(${[...identifiers]}))
        AND "disabled" = false
    `;
  });
}

/** Where a resource's metadata lives: its own path inserted after the
 * well-known prefix (RFC 9728 §3.1). */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}${path}`;
}

/**
 * The MCP endpoint's resource metadata: itself, the one authorization
 * server an agent signs in with (the issuer), the scopes it takes and how a
 * token is presented. Written out rather than built by the provider's
 * resource helper, which would advertise DPoP: the endpoint takes bearer
 * tokens only.
 */
export function protectedResourceMetadata(resource: string, issuer: string) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...MCP_RESOURCE_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Tale',
  };
}

/**
 * The answer at `/.well-known/oauth-protected-resource[<path>]`: the MCP
 * endpoint's metadata for the address the request arrived on, at the root
 * (where an agent looks second) and at the endpoint's own path; any other
 * path names no resource of this deployment, and none does while the
 * operator leaves agents no way in. Public, cacheable for five minutes, and
 * per host.
 */
export function protectedResourceMetadataAnswer(
  request: Request,
  issuer: string,
  options: AgentOAuthOptions,
): Response {
  const path = new URL(request.url).pathname;
  const suffix = path.slice(PROTECTED_RESOURCE_METADATA_PATH.length);
  const resource = mcpResourceFor(request);
  if (
    !agentSignInOn(options) ||
    (suffix !== '' && suffix !== new URL(resource).pathname)
  ) {
    return Response.json(
      { error: 'Not found', code: 'NOT_FOUND' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
  return Response.json(protectedResourceMetadata(resource, issuer), {
    headers: { 'cache-control': 'public, max-age=300', vary: 'Host' },
  });
}

// ------------------------------------------------------------ discovery

/**
 * Whether Tale fetches the client metadata document at this URL: never one
 * on a host the deployment itself answers on (a client cannot make Tale
 * fetch from itself), and, when the operator names the hosts agents may
 * publish from, only those. The library refuses what is not public HTTPS
 * before this is asked, and its transport refuses an address that resolves
 * to a private network.
 */
export function metadataDocumentAllowed(
  url: string,
  allowedHosts: readonly string[],
  ownOrigins: readonly string[],
): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (error) {
    console.warn(
      '[agent-oauth] a client id that is not a URL reached the metadata policy:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
  if (ownOrigins.some((origin) => new URL(origin).hostname === host)) {
    return false;
  }
  return allowedHosts.length === 0 || allowedHosts.includes(host);
}

function logClientDocument(event: 'created' | 'refreshed', clientId: string) {
  let host = 'unknown';
  try {
    host = new URL(clientId).host;
  } catch (error) {
    console.warn(
      '[agent-oauth] a metadata-document client without a URL id:',
      error instanceof Error ? error.message : error,
    );
  }
  console.log(`[agent-oauth] client metadata document ${event} host=${host}`);
}

/**
 * The transport with the reason a fetch failed in the log. The discovery
 * tells the agent one sentence for every failure of the transport ("network
 * error or redirect blocked"), so without this line an operator cannot tell
 * a resolver that hands out a private address for the agent's host (a
 * fake-IP VPN, a split-horizon DNS, refused as non-public) from an egress
 * that drops the connection or a host that is down. The failure itself is
 * passed on unchanged.
 */
export function loggedMetadataFetch(
  fetchMetadataDocument: ClientMetadataResourceFetch,
): ClientMetadataResourceFetch {
  return async (input, init) => {
    try {
      return await fetchMetadataDocument(input, init);
    } catch (error) {
      console.warn(
        `[agent-oauth] client metadata document fetch failed url=${requestUrl(input)}:`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  };
}

/** The address as fetched: the discovery validates a client id without
 * canonicalizing it, so the raw string may still carry what the URL parser
 * strips (a tab, a newline), which a log line must not. */
function requestUrl(input: Parameters<ClientMetadataResourceFetch>[0]): string {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw).href;
  } catch {
    return JSON.stringify(raw);
  }
}

/**
 * The client discovery that lets an agent identify itself by a client
 * metadata document (an HTTPS URL as its `client_id`, MCP's preferred way),
 * or null where the operator turned it off. A document is fetched through a
 * transport that resolves the host once, refuses private addresses, pins
 * the connection and never follows a redirect, and that says in the log why
 * a fetch failed; Tale never fetches or shows the logo a document names.
 */
export function agentClientDiscovery(input: {
  readonly options: AgentOAuthOptions;
  /** Every origin the deployment answers on. */
  readonly siteOrigins: readonly string[];
  /** The transport documents are fetched with — a test stub in the
   * integration lane, the pinned-address transport otherwise. */
  readonly fetchMetadataDocument?: ClientMetadataResourceFetch;
}): ClientDiscovery | null {
  if (!input.options.metadataDocuments) return null;
  return createCimdClientDiscovery({
    fetchClientMetadataResource: loggedMetadataFetch(
      input.fetchMetadataDocument ?? fetchClientMetadataResource,
    ),
    metadataProfile: 'mcp-2026-07-28',
    isMetadataDocumentUrlAllowed: (url) =>
      metadataDocumentAllowed(
        url,
        input.options.metadataHosts,
        input.siteOrigins,
      ),
    onClientCreated: ({ client }) => {
      logClientDocument('created', client.clientId);
    },
    onClientRefreshed: ({ client }) => {
      logClientDocument('refreshed', client.clientId);
    },
  });
}

// ------------------------------------------------------------ registration

/** The largest registration body judged here; agents send a few hundred
 * bytes. */
const REGISTRATION_BODY_BYTES = 16 * 1024;

/** The most self-registered agent clients a deployment keeps; the daily
 * clean-up removes the ones nobody connected. */
export const SELF_REGISTERED_CLIENT_CAP = 5_000;

const REGISTRATION_GRANTS: ReadonlySet<string> = new Set([
  'authorization_code',
  'refresh_token',
]);

const REGISTRATION_AUTH_METHODS: ReadonlySet<string> = new Set([
  'none',
  'client_secret_basic',
  'client_secret_post',
]);

/** What a step in front of the provider decided: answer here, or hand the
 * (possibly rewritten) request on. */
export type AgentOAuthStep =
  | { readonly kind: 'answer'; readonly response: Response }
  | { readonly kind: 'continue'; readonly request: Request };

/** The scopes an agent's connection can hold: what the endpoint grants. */
function isGrantable(scope: string): boolean {
  return isAgentScope(scope) || scope === OFFLINE_ACCESS;
}

/** An RFC 6749 / RFC 7591 error answer, never cached. */
function oauthErrorAnswer(
  status: 400 | 429 | 503,
  error: string,
  description: string,
  retryAfterMs?: number,
): Response {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        pragma: 'no-cache',
        ...(retryAfterMs === undefined
          ? {}
          : {
              'retry-after': String(
                Math.max(1, Math.ceil(retryAfterMs / 1000)),
              ),
            }),
      },
    },
  );
}

function refuseRegistration(
  error: 'invalid_client_metadata' | 'invalid_redirect_uri',
  description: string,
): AgentOAuthStep {
  return {
    kind: 'answer',
    response: oauthErrorAnswer(400, error, description),
  };
}

/** Whether a redirect URI is one a native app uses: HTTP on the exact
 * loopback hosts, or an app's own scheme. */
function isNativeRedirect(uri: URL): boolean {
  if (uri.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname);
  }
  return uri.protocol !== 'https:';
}

/** How many self-registered agent clients exist, up to the cap. */
async function selfRegisteredClients(sql: Sql): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (
      SELECT 1 FROM "oauthClient"
      WHERE "clientDiscoveryId" IS NULL
        AND "referenceId" IS NULL
        AND "userId" IS NULL
        AND "scopes" @> '["tale:mcp"]'::jsonb
      LIMIT ${SELF_REGISTERED_CLIENT_CAP}
    ) capped
  `;
  return rows[0]?.count ?? 0;
}

/** Charge one registration to its source and to the deployment; null when
 * it may proceed. */
async function chargeRegistration(
  sql: Sql,
  clientIp: string,
): Promise<RateLimitExceededError | null> {
  try {
    await checkIpRateLimit(sql, 'oauth:register-ip', clientIp);
    await checkKeyedRateLimit(sql, 'oauth:register-global', 'global');
    return null;
  } catch (error) {
    if (error instanceof RateLimitExceededError) return error;
    throw error;
  }
}

/**
 * The checks Tale runs before the provider registers a client
 * (`POST /api/auth/oauth2/register`, RFC 7591), while the operator leaves
 * open registration on:
 *
 * 1. a source registers at most ten clients an hour and the deployment 500
 *    a day; past 5,000 self-registered clients, none (503);
 * 2. a client may use the authorization-code and refresh grants only, the
 *    code response type and no signing keys of its own; its scope is cut to
 *    the agent scopes (a client that registers with every scope the sign-in
 *    server lists, identity scopes included, is registered for the agent
 *    ones, as RFC 7591 §3.2.1 allows);
 * 3. an HTTPS redirect must go to a known agent's web host — everything
 *    else signs in through a local (loopback) or app redirect;
 * 4. a client that leaves out its application type and only names local or
 *    app redirects is registered as the native app it is (the provider
 *    would take it for a web app and refuse its loopback redirect);
 * 5. the request reaches the provider without the caller's session cookie:
 *    a registration here is always the open lane for agents, never an
 *    organization's own client.
 *
 * With registration off the request passes as it came, and the provider
 * refuses it as before.
 */
export async function registerPrecheck(
  request: Request,
  deps: {
    readonly sql: Sql;
    readonly clientIp: () => Promise<string>;
    readonly options: AgentOAuthOptions;
  },
): Promise<AgentOAuthStep> {
  if (!deps.options.dynamicRegistration) {
    return { kind: 'continue', request };
  }
  const limited = await chargeRegistration(deps.sql, await deps.clientIp());
  if (limited !== null) {
    return {
      kind: 'answer',
      response: oauthErrorAnswer(
        429,
        'temporarily_unavailable',
        `too many client registrations; retry in ${Math.max(1, Math.ceil(limited.retryAfter / 1000))} s`,
        limited.retryAfter,
      ),
    };
  }
  if ((await selfRegisteredClients(deps.sql)) >= SELF_REGISTERED_CLIENT_CAP) {
    return {
      kind: 'answer',
      response: oauthErrorAnswer(
        503,
        'temporarily_unavailable',
        'this server takes no new client registrations right now; try again later',
      ),
    };
  }
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('content-length');
  const declared = Number(request.headers.get('content-length') ?? '0');
  const text = await request.clone().text();
  if (
    (Number.isFinite(declared) && declared > REGISTRATION_BODY_BYTES) ||
    Buffer.byteLength(text) > REGISTRATION_BODY_BYTES
  ) {
    return refuseRegistration(
      'invalid_client_metadata',
      'a client registration is at most 16 KiB of JSON',
    );
  }
  const media = (request.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  let body: unknown;
  try {
    body = media === 'application/json' ? JSON.parse(text) : undefined;
  } catch (error) {
    // Not the JSON it claims to be: the provider's own parser refuses it in
    // its words; only the session cookie is taken off on the way.
    console.warn(
      '[agent-oauth] a client registration whose body is not JSON:',
      error instanceof Error ? error.name : 'unknown',
    );
    body = undefined;
  }
  if (!isRecord(body)) {
    return {
      kind: 'continue',
      request: new Request(request.url, {
        method: request.method,
        headers,
        body: text,
      }),
    };
  }
  const grants: unknown = body.grant_types;
  if (
    Array.isArray(grants) &&
    grants.some(
      (grant) => typeof grant !== 'string' || !REGISTRATION_GRANTS.has(grant),
    )
  ) {
    return refuseRegistration(
      'invalid_client_metadata',
      'grant_types may name authorization_code and refresh_token only',
    );
  }
  const responseTypes: unknown = body.response_types;
  if (
    Array.isArray(responseTypes) &&
    responseTypes.some((type) => type !== 'code')
  ) {
    return refuseRegistration(
      'invalid_client_metadata',
      'response_types may name code only',
    );
  }
  if (body.jwks !== undefined || body.jwks_uri !== undefined) {
    return refuseRegistration(
      'invalid_client_metadata',
      'a self-registered client signs in without keys of its own: leave out jwks and jwks_uri',
    );
  }
  const authMethod: unknown = body.token_endpoint_auth_method;
  if (
    authMethod !== undefined &&
    (typeof authMethod !== 'string' ||
      !REGISTRATION_AUTH_METHODS.has(authMethod))
  ) {
    return refuseRegistration(
      'invalid_client_metadata',
      'token_endpoint_auth_method may be none, client_secret_basic or client_secret_post',
    );
  }
  // A scope beyond the agent ones is dropped, not refused: clients register
  // with the whole list the sign-in server publishes, and what is dropped is
  // never granted. What is left is what the client is registered for; with
  // nothing left the provider's own default (the agent scopes) applies.
  let scope: string | null | undefined;
  if (body.scope !== undefined) {
    if (typeof body.scope !== 'string') {
      return refuseRegistration(
        'invalid_client_metadata',
        `scope is a space-separated list of ${MCP_RESOURCE_SCOPES.join(', ')}`,
      );
    }
    const asked = scopesOf(body.scope);
    const kept = asked.filter(isGrantable);
    if (kept.length !== asked.length) {
      scope = kept.length === 0 ? null : kept.join(' ');
    }
  }
  const redirects: URL[] = [];
  const rawRedirects: unknown = body.redirect_uris;
  for (const value of Array.isArray(rawRedirects) ? rawRedirects : []) {
    // A value that is not a URL is the provider's to refuse, in its words.
    if (typeof value !== 'string' || !URL.canParse(value)) continue;
    const uri = new URL(value);
    if (
      uri.protocol === 'https:' &&
      !deps.options.webRedirectHosts.includes(uri.hostname.toLowerCase())
    ) {
      return refuseRegistration(
        'invalid_redirect_uri',
        'this server accepts web redirects only to known agent hosts; use a local (loopback) redirect',
      );
    }
    redirects.push(uri);
  }
  const inferNative =
    body.application_type === undefined &&
    redirects.length > 0 &&
    redirects.every(isNativeRedirect);
  const rewritten: Record<string, unknown> = { ...body };
  if (inferNative) rewritten.application_type = 'native';
  if (scope === null) delete rewritten.scope;
  else if (scope !== undefined) rewritten.scope = scope;
  return {
    kind: 'continue',
    request: new Request(request.url, {
      method: request.method,
      headers,
      body:
        inferNative || scope !== undefined ? JSON.stringify(rewritten) : text,
    }),
  };
}

// ------------------------------------------------------------ authorization

/** The largest authorization form judged here; a browser sends a few
 * hundred bytes. */
const AUTHORIZATION_FORM_BYTES = 64 * 1024;

/** Whether a registered client is an agent client: its scopes hold the
 * MCP scope (single sign-on clients hold only the OIDC ones). */
async function isAgentClient(sql: Sql, clientId: string): Promise<boolean> {
  if (clientId === '') return false;
  const rows = await sql<{ found: number }[]>`
    SELECT 1 AS found FROM "oauthClient"
    WHERE "clientId" = ${clientId} AND "scopes" @> '["tale:mcp"]'::jsonb
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Whether a client id is a client metadata document's URL. */
function isMetadataDocumentClientId(clientId: string): boolean {
  return URL.canParse(clientId) && new URL(clientId).protocol === 'https:';
}

/**
 * An agent's authorization request, made right for the MCP endpoint:
 *
 * - bound to it: an agent that leaves out RFC 8707's `resource` (several
 *   do) gets the endpoint's own address on the origin it came to, so the
 *   code, its token and every refresh name the endpoint as their audience;
 * - cut to what the endpoint grants: a client that asks for every scope the
 *   sign-in server lists — Codex does, identity scopes (`openid`, `profile`,
 *   `email`, `tale:organization`) included — keeps the agent scopes and
 *   `offline_access` and is not refused for the rest (RFC 6749 §3.3 lets a
 *   server grant less than was asked; the consent page and the token answer
 *   say what was granted). Identity scopes are never granted to an agent.
 *
 * A request is an agent's when it asks for an agent scope, names a client
 * metadata document as its client, or comes from a registered agent client
 * (one read). Everything else — single sign-on above all, and any request
 * that passes its parameters by reference — reaches the provider exactly as
 * it came; so does a request that needs neither change.
 */
export async function authorizePrecheck(
  request: Request,
  deps: { readonly sql: Sql; readonly options: AgentOAuthOptions },
): Promise<Request> {
  const url = new URL(request.url);
  let params = url.searchParams;
  if (request.method === 'POST') {
    const media = (request.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (media !== 'application/x-www-form-urlencoded') return request;
    const text = await request.clone().text();
    if (Buffer.byteLength(text) > AUTHORIZATION_FORM_BYTES) return request;
    params = new URLSearchParams(text);
  }
  if (params.has('request_uri') || params.has('request')) return request;
  const clientId = params.get('client_id') ?? '';
  const asked = scopesOf(params.get('scope'));
  const agent =
    requestsAgentAccess(asked) ||
    (deps.options.metadataDocuments && isMetadataDocumentClientId(clientId)) ||
    (await isAgentClient(deps.sql, clientId));
  if (!agent) return request;
  let changed = false;
  if (requestsAgentAccess(asked)) {
    const kept = asked.filter(isGrantable);
    if (kept.length !== asked.length) {
      params.set('scope', kept.join(' '));
      changed = true;
    }
  }
  if (!params.has('resource')) {
    params.set('resource', mcpResourceFor(request));
    changed = true;
  }
  if (!changed) return request;
  if (request.method === 'POST') {
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    return new Request(request.url, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  }
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
  });
}

// ------------------------------------------------------------ token

/**
 * A token request that failed (400 or 401) charged to its source: past
 * twenty a minute (forty at once) the source is answered 429 until it
 * slows down. Successes cost nothing — hosted agents share their egress
 * addresses, and a refresh that works is no abuse.
 */
export async function chargeTokenFailure(
  sql: Sql,
  clientIp: () => Promise<string>,
  response: Response,
): Promise<Response> {
  if (response.status !== 400 && response.status !== 401) return response;
  try {
    await checkIpRateLimit(sql, 'oauth:token-fail-ip', await clientIp());
    return response;
  } catch (error) {
    if (!(error instanceof RateLimitExceededError)) throw error;
    return oauthErrorAnswer(
      429,
      'temporarily_unavailable',
      `too many failed token requests from this address; retry in ${Math.max(1, Math.ceil(error.retryAfter / 1000))} s`,
      error.retryAfter,
    );
  }
}

// ------------------------------------------------------------ the mount

/**
 * A refresh the provider refused as an identity that is no longer eligible
 * — the person left the organization the agent was connected to, or the
 * organization has since blocked them — answered as the RFC says: the grant
 * is no longer valid (`invalid_grant`), which an agent reads as "sign in
 * again", rather than the 403 the provider's claims hook raises. A code
 * exchange keeps its refusal as it was; so does every other answer.
 */
async function refreshRefusal(
  fields: Readonly<Record<string, string>> | null,
  response: Response,
): Promise<Response> {
  if (response.status !== 403) return response;
  if (fields?.grant_type !== 'refresh_token') return response;
  let body: unknown;
  try {
    body = JSON.parse(await response.clone().text());
  } catch (error) {
    console.warn(
      '[agent-oauth] a refused refresh whose answer is not JSON:',
      error instanceof Error ? error.name : 'unknown',
    );
    return response;
  }
  if (!isRecord(body) || body.message !== 'IDENTITY_NOT_ELIGIBLE') {
    return response;
  }
  return oauthErrorAnswer(
    400,
    'invalid_grant',
    'the person can no longer use the organization this connection was made for',
  );
}

/**
 * The agent sign-in steps around the provider's handler at the auth mount:
 * registration and authorization are checked (and rewritten) before it, a
 * consent for agent access is made only for an organization the person may
 * connect an agent to, a refused refresh is answered as an invalid grant, a
 * refresh token used twice ends the connections it signed in, and a failed
 * token request is charged to its source after it; every other request
 * passes through untouched.
 */
export async function withAgentOAuth(
  request: Request,
  deps: {
    readonly options: AgentOAuthOptions;
  } & AgentConsentDeps,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path === REGISTER_PATH) {
    const step = await registerPrecheck(request, deps);
    return step.kind === 'answer' ? step.response : handle(step.request);
  }
  if (
    (request.method === 'GET' || request.method === 'POST') &&
    path === AUTHORIZE_PATH
  ) {
    return handle(await authorizePrecheck(request, deps));
  }
  if (request.method === 'POST' && path === CONSENT_PATH) {
    return agentConsentGate(request, deps, handle);
  }
  if (request.method === 'POST' && path === TOKEN_PATH) {
    const fields = await tokenRequestFields(request);
    // Read before the provider answers: a refresh token it has already
    // retired is gone from its table once it ends the sign-in over a reuse.
    const used =
      fields === null ? null : await usedRefreshToken(deps.sql, fields);
    const answered = await handle(request);
    if (used !== null && answered.status === 400) {
      await endAgentsAfterReuse(deps.sql, used);
    }
    return chargeTokenFailure(
      deps.sql,
      deps.clientIp,
      await refreshRefusal(fields, answered),
    );
  }
  return handle(request);
}
