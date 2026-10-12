/**
 * Real Postgres and HTTP proof of a coding agent at the sign-in server: its
 * discovery documents, the MCP endpoint's resource metadata, a self-
 * registration through Tale's checks (accepted, refused and slowed down),
 * an authorization request bound to the MCP endpoint, a client identified by
 * its metadata document, and an organization's own application kept off the
 * endpoint. The provider's tables are Better Auth's own, so this is where
 * Tale's raw reads and writes of them meet the real schema.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { AGENT_SCOPES, OFFLINE_ACCESS } from '../../lib/shared/agent-access.ts';
import { signUpUser } from '../integration-lane-helpers.ts';
import { configuredMcpResources, seedMcpResources } from './agent-oauth.ts';
import { OIDC_SCOPES } from './oidc.ts';

const DOCUMENT_URL = 'https://agent.example.test/oauth/client.json';
const AGENT_REDIRECT = 'http://127.0.0.1:33418/callback';
const APP_REDIRECT =
  'https://identity-client.example.test/api/auth/oauth2/callback/tale';
const AGENT_SCOPE_SET = [...AGENT_SCOPES, OFFLINE_ACCESS];

/**
 * The transport a client metadata document is fetched with in this lane: the
 * one agent the lane knows, published at a host that does not exist. The
 * production transport resolves a real host and refuses private addresses.
 */
export const agentLaneMetadataFetch: ClientMetadataResourceFetch = (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== DOCUMENT_URL) {
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  return Promise.resolve(
    Response.json({
      client_id: DOCUMENT_URL,
      client_name: 'Lane Agent',
      redirect_uris: [AGENT_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  );
};

export async function checkAgentOAuth(
  sql: Sql,
  base: string,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const check = (name: string, ok: boolean, detail?: string) => {
    record(
      `agent sign-in: ${name}`,
      ok,
      ok ? 'observed' : (detail ?? 'failed'),
    );
    assert(ok, detail === undefined ? name : `${name} — ${detail}`);
  };
  const suffix = randomUUID().slice(0, 8);
  const issuer = `${base}/api/auth`;
  const mcp = `${base}/api/v1/mcp`;
  // The deployment answers on the lane's own address, as a configured
  // origin, for the endpoint's resource and its metadata.
  const savedSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = base;
  const created: string[] = [];
  try {
    // What the boot does once the provider's tables exist.
    await seedMcpResources(sql, configuredMcpResources());

    const post = (route: string, body: unknown, cookie = '') =>
      fetch(`${base}${route}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Origin: base, cookie },
        body: JSON.stringify(body),
      });
    const user = await signUpUser(base, `agent-oauth-${suffix}`);
    await sql`UPDATE "user" SET "emailVerified" = true WHERE "id" = ${user.userId}`;
    const register = async (body: Record<string, unknown>, cookie = '') => {
      const response = await post('/api/auth/oauth2/register', body, cookie);
      const answer = z
        .looseObject({
          client_id: z.string().optional(),
          error: z.string().optional(),
          application_type: z.string().optional(),
        })
        .parse(await response.json());
      if (answer.client_id !== undefined) created.push(answer.client_id);
      return { status: response.status, headers: response.headers, answer };
    };

    // Discovery and the endpoint's resource metadata.
    const discovery = z
      .looseObject({
        issuer: z.string(),
        grant_types_supported: z.array(z.string()),
        scopes_supported: z.array(z.string()),
        token_endpoint_auth_methods_supported: z.array(z.string()),
        code_challenge_methods_supported: z.array(z.string()),
        registration_endpoint: z.string(),
        client_id_metadata_document_supported: z.boolean(),
      })
      .parse(
        await (
          await fetch(`${base}/.well-known/oauth-authorization-server/api/auth`)
        ).json(),
      );
    check(
      'discovery offers the refresh grant, the agent scopes, public clients, PKCE, registration and metadata-document clients',
      discovery.issuer === issuer &&
        discovery.grant_types_supported.join() ===
          'authorization_code,refresh_token' &&
        [...OIDC_SCOPES, ...AGENT_SCOPE_SET].every((scope) =>
          discovery.scopes_supported.includes(scope),
        ) &&
        discovery.token_endpoint_auth_methods_supported.includes('none') &&
        discovery.code_challenge_methods_supported.join() === 'S256' &&
        discovery.registration_endpoint === `${issuer}/oauth2/register` &&
        discovery.client_id_metadata_document_supported,
      JSON.stringify(discovery).slice(0, 300),
    );
    const resourceDocuments = await Promise.all(
      [
        '/.well-known/oauth-protected-resource/api/v1/mcp',
        '/.well-known/oauth-protected-resource',
      ].map(async (path) => {
        const response = await fetch(`${base}${path}`);
        return { status: response.status, body: await response.json() };
      }),
    );
    const stray = await fetch(
      `${base}/.well-known/oauth-protected-resource/api/v1/contacts`,
    );
    check(
      'the MCP endpoint names its resource, its sign-in server and its scopes at its own path and at the root, and no other path',
      resourceDocuments.every(
        (document) =>
          document.status === 200 &&
          JSON.stringify(document.body) ===
            JSON.stringify({
              resource: mcp,
              authorization_servers: [issuer],
              scopes_supported: AGENT_SCOPE_SET,
              bearer_methods_supported: ['header'],
              resource_name: 'Tale',
            }),
      ) && stray.status === 404,
      JSON.stringify(resourceDocuments).slice(0, 300),
    );
    const resources = await sql<
      {
        accessTokenTtl: number;
        refreshTokenTtl: number;
        allowedScopes: string[];
        disabled: boolean;
      }[]
    >`
      SELECT "accessTokenTtl", "refreshTokenTtl", "allowedScopes", "disabled"
      FROM "oauthResource" WHERE "identifier" = ${mcp}
    `;
    check(
      'the boot wrote the endpoint as a resource: five-minute tokens, thirty-day refresh, the agent scopes',
      resources.length === 1 &&
        resources[0]?.accessTokenTtl === 300 &&
        resources[0].refreshTokenTtl === 30 * 86_400 &&
        resources[0].allowedScopes.join() === AGENT_SCOPE_SET.join() &&
        !resources[0].disabled,
      JSON.stringify(resources),
    );

    // Self-registration through Tale's checks.
    const cli = await register(
      {
        client_name: 'Lane CLI agent',
        redirect_uris: [AGENT_REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      },
      user.cookie,
    );
    const cliClient = cli.answer.client_id ?? '';
    const stored = await sql<
      {
        scopes: string[];
        userId: string | null;
        referenceId: string | null;
      }[]
    >`
      SELECT "scopes", "userId", "referenceId" FROM "oauthClient"
      WHERE "clientId" = ${cliClient}
    `;
    check(
      'a CLI agent with a loopback redirect registers as a native app holding the agent scopes, owned by neither the caller nor an organization',
      cli.status === 201 &&
        cli.answer.application_type === 'native' &&
        stored[0]?.scopes.join() === AGENT_SCOPE_SET.join() &&
        stored[0].userId === null &&
        stored[0].referenceId === null,
      `${cli.status} ${JSON.stringify(cli.answer)} ${JSON.stringify(stored)}`,
    );
    const hosted = await register({
      client_name: 'Lane hosted agent',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
    });
    const refusals = await Promise.all([
      register({ redirect_uris: ['https://evil.example/callback'] }),
      register({ redirect_uris: [AGENT_REDIRECT], scope: 'openid tale:mcp' }),
      register({ redirect_uris: [AGENT_REDIRECT], jwks_uri: 'https://x.test' }),
      register({
        redirect_uris: [AGENT_REDIRECT],
        grant_types: ['client_credentials'],
      }),
    ]);
    check(
      'a known agent host registers; a foreign web redirect, a scope beyond the agent ones, keys of its own and another grant are refused',
      hosted.status === 201 &&
        refusals.map((refusal) => refusal.status).join() ===
          '400,400,400,400' &&
        refusals[0]?.answer.error === 'invalid_redirect_uri' &&
        refusals
          .slice(1)
          .every((r) => r.answer.error === 'invalid_client_metadata'),
      JSON.stringify(refusals.map((r) => [r.status, r.answer.error])),
    );

    // An authorization request, signed in, as a browser navigates it.
    const authorize = (query: Record<string, string>) =>
      fetch(
        `${issuer}/oauth2/authorize?${new URLSearchParams({
          response_type: 'code',
          state: randomBytes(8).toString('base64url'),
          code_challenge: createHash('sha256')
            .update(randomBytes(32).toString('base64url'))
            .digest('base64url'),
          code_challenge_method: 'S256',
          ...query,
        }).toString()}`,
        {
          headers: {
            cookie: user.cookie,
            Accept: 'text/html',
            'Sec-Fetch-Mode': 'navigate',
          },
          redirect: 'manual',
        },
      );
    /** Where the answer sends the browser: its Location, or the url a
     * fetch is told in JSON (the provider answers one or the other). */
    const locationOf = async (response: Response) => {
      const returned = z.object({ url: z.string() }).safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      return new URL(
        response.headers.get('location') ??
          (returned.success ? returned.data.url : '/'),
        base,
      );
    };
    const registeredAsk = await authorize({
      client_id: cliClient,
      redirect_uri: AGENT_REDIRECT,
      scope: 'tale:mcp offline_access',
    });
    const registeredNext = await locationOf(registeredAsk);
    check(
      'a registered agent that names no resource is bound to the MCP endpoint, and goes on to consent',
      registeredNext.pathname === '/oauth/consent' &&
        registeredNext.searchParams.get('resource') === mcp,
      `${registeredAsk.status} ${registeredNext.href}`,
    );
    const documentAsk = await authorize({
      client_id: DOCUMENT_URL,
      redirect_uri: AGENT_REDIRECT,
      scope: 'tale:mcp offline_access',
    });
    const documentNext = await locationOf(documentAsk);
    created.push(DOCUMENT_URL);
    const documentClient = await sql<
      { clientDiscoveryId: string | null; name: string | null }[]
    >`
      SELECT "clientDiscoveryId", "name" FROM "oauthClient"
      WHERE "clientId" = ${DOCUMENT_URL}
    `;
    check(
      'a client identified by its metadata document is created from it, and bound to the MCP endpoint',
      documentNext.pathname === '/oauth/consent' &&
        documentNext.searchParams.get('resource') === mcp &&
        documentClient[0]?.clientDiscoveryId === 'cimd' &&
        documentClient[0].name === 'Lane Agent',
      `${documentAsk.status} ${documentNext.href} ${JSON.stringify(documentClient)}`,
    );
    // The deployment's own host, on the scheme a document needs.
    const ownDocument = `https://${new URL(base).host}/agents/client.json`;
    const ownHost = await authorize({
      client_id: ownDocument,
      redirect_uri: AGENT_REDIRECT,
      scope: 'tale:mcp',
    });
    const ownHostBody = await ownHost.text();
    const ownHostClient = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "oauthClient"
      WHERE "clientId" = ${ownDocument}
    `;
    check(
      'a metadata document is never fetched from the deployment itself, and its client is never sent anywhere',
      ownHostBody.includes('invalid_client') &&
        !ownHostBody.includes(AGENT_REDIRECT) &&
        ownHostClient[0]?.n === 0,
      `${ownHost.status} ${ownHostBody.slice(0, 200)}`,
    );

    // An organization's own application stays off the endpoint.
    const owner = await signUpUser(base, `agent-oauth-owner-${suffix}`);
    await sql`UPDATE "user" SET "emailVerified" = true WHERE "id" = ${owner.userId}`;
    const org = z
      .object({ id: z.string() })
      .parse(
        await (
          await post(
            '/api/auth/organization/create',
            { name: 'Agent sign-in lane', slug: `agent-oauth-${suffix}` },
            owner.cookie,
          )
        ).json(),
      );
    assert.equal(
      (
        await post(
          '/api/auth/organization/set-active',
          { organizationId: org.id },
          owner.cookie,
        )
      ).status,
      200,
    );
    const identity = z
      .object({ client: z.object({ client_id: z.string() }) })
      .parse(
        await (
          await post(
            `/api/app/identity/clients?orgId=${org.id}`,
            {
              key: 'lane-app',
              name: 'Lane application',
              redirectUri: APP_REDIRECT,
            },
            owner.cookie,
          )
        ).json(),
      );
    created.push(identity.client.client_id);
    const application = async (scope: string, resource?: string) => {
      const response = await fetch(
        `${issuer}/oauth2/authorize?${new URLSearchParams({
          client_id: identity.client.client_id,
          redirect_uri: APP_REDIRECT,
          response_type: 'code',
          scope,
          state: 'lane',
          nonce: 'lane',
          code_challenge: createHash('sha256')
            .update('lane-verifier')
            .digest('base64url'),
          code_challenge_method: 'S256',
          ...(resource === undefined ? {} : { resource }),
        }).toString()}`,
        {
          headers: {
            cookie: owner.cookie,
            Accept: 'text/html',
            'Sec-Fetch-Mode': 'navigate',
          },
          redirect: 'manual',
        },
      );
      return locationOf(response);
    };
    const withResource = await application(OIDC_SCOPES.join(' '), mcp);
    const widened = await application('openid tale:mcp');
    const linked = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "oauthClientResource"
      WHERE "clientId" = ${identity.client.client_id}
    `;
    check(
      "an organization's own application cannot reach the MCP endpoint, nor ask for an agent scope",
      withResource.searchParams.get('error') === 'invalid_scope' &&
        widened.searchParams.get('error') === 'invalid_scope' &&
        linked[0]?.n === 0,
      `${withResource.href} ${widened.href} linked=${linked[0]?.n}`,
    );

    // The source that registered is slowed down: ten an hour — other lanes
    // may have spent some of them — and the next is turned away before the
    // provider sees it, with a time to wait.
    let slowed = await register({ redirect_uris: [AGENT_REDIRECT] });
    let attempts = 1;
    while (slowed.status !== 429 && attempts < 12) {
      slowed = await register({
        redirect_uris: ['https://evil.example/callback'],
      });
      attempts += 1;
    }
    check(
      'a source that keeps registering is turned away with a time to wait',
      slowed.status === 429 &&
        slowed.answer.error === 'temporarily_unavailable' &&
        Number(slowed.headers.get('retry-after')) > 0,
      `after ${attempts} more: ${slowed.status} ${slowed.answer.error} retry-after=${slowed.headers.get('retry-after')}`,
    );
  } finally {
    if (created.length > 0) {
      await sql`DELETE FROM "oauthClient" WHERE "clientId" = ANY(${created})`;
    }
    if (savedSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSiteUrl;
  }
}
