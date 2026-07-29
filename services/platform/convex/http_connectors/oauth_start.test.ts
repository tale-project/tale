// @vitest-environment node

/**
 * The `start` half of the OAuth2 flow.
 *
 * The handler is called directly with a stubbed action context (the pattern the
 * SSO login handlers use) so the authorization rules are exercised without
 * standing up the auth component — but the connector lookup is delegated to the
 * REAL catalog reader, so every assertion about scopes and endpoints is an
 * assertion about the shipped `connector.yml`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';
import { readOauth2Endpoints } from './connector_catalog';
import {
  createPendingAuthorizationRef,
  getOauth2EndpointsRef,
} from './function_refs';
import { oauth2StartHandler } from './oauth_handlers';
import { hashStateToken } from './oauth_state';
import { resolveSessionUser } from './session';

vi.mock('./session', () => ({ resolveSessionUser: vi.fn() }));

const SITE_URL = 'https://tale.example';
const EXPECTED_REDIRECT_URI = `${SITE_URL}/api/connectors/oauth2/callback`;
const ORG = 'org_start_test';
const USER = 'user_start_test';

interface PendingRow {
  stateHash: string;
  organizationId: string;
  userId: string;
  connectorSlug: string;
  codeVerifier: string;
  redirectUri: string;
}

interface Harness {
  ctx: ActionCtx;
  pending: PendingRow[];
}

/**
 * A context that answers the membership query with `role` and resolves the
 * connector through the real catalog; every pending-authorization write is
 * captured for inspection.
 */
function harness(role: string | null): Harness {
  const pending: PendingRow[] = [];
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(role),
    runAction: vi.fn(async (ref: unknown, args: { connectorSlug: string }) => {
      if (ref !== getOauth2EndpointsRef) {
        throw new Error('unexpected action call');
      }
      const endpoints = readOauth2Endpoints(args.connectorSlug);
      return endpoints ? { ...endpoints, scopes: [...endpoints.scopes] } : null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: PendingRow) => {
      if (ref !== createPendingAuthorizationRef) {
        throw new Error('unexpected mutation call');
      }
      pending.push(args);
      return null;
    }),
  } as unknown as ActionCtx;
  return { ctx, pending };
}

function startRequest(params: Record<string, string>): Request {
  const url = new URL(`${SITE_URL}/api/connectors/oauth2/start`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

function locationOf(res: Response): URL {
  const location = res.headers.get('Location');
  expect(location).not.toBeNull();
  return new URL(location as string);
}

describe('oauth2StartHandler', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_URL', SITE_URL);
    vi.stubEnv('BASE_PATH', '');
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_ID', 'slack-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_SECRET', 'slack-client-secret');
    vi.stubEnv('CONNECTOR_OAUTH_GMAIL_CLIENT_ID', 'gmail-client-id');
    vi.stubEnv('CONNECTOR_OAUTH_GMAIL_CLIENT_SECRET', 'gmail-client-secret');
    vi.stubEnv('CONNECTOR_OAUTH_OUTLOOK_CLIENT_ID', 'outlook-client-id');
    vi.stubEnv(
      'CONNECTOR_OAUTH_OUTLOOK_CLIENT_SECRET',
      'outlook-client-secret',
    );
    vi.mocked(resolveSessionUser).mockResolvedValue({
      userId: USER,
      email: 'member@example.com',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(resolveSessionUser).mockResolvedValue(null);
    const { ctx, pending } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(401);
    expect(pending).toHaveLength(0);
  });

  it('refuses a caller who is not a member of the organization', async () => {
    const { ctx, pending } = harness(null);

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(403);
    expect(pending).toHaveLength(0);
  });

  it('refuses a member whose role cannot manage credentials', async () => {
    const { ctx, pending } = harness('member');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(403);
    expect(pending).toHaveLength(0);
  });

  it('refuses a soft-removed member', async () => {
    const { ctx } = harness('disabled');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(403);
  });

  it('redirects to the connector authorize URL declared in its catalog file', async () => {
    const { ctx } = harness('admin');
    const catalog = readOauth2Endpoints('slack');
    expect(catalog).not.toBeNull();

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(302);
    const target = locationOf(res);
    expect(`${target.origin}${target.pathname}`).toBe(catalog?.authorizeUrl);
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(target.searchParams.get('client_id')).toBe('slack-client-id');
    expect(target.searchParams.get('scope')).toBe(
      (catalog?.scopes ?? []).join(' '),
    );
    expect(target.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
  });

  it('sends an S256 PKCE challenge and keeps the verifier server-side', async () => {
    const { ctx, pending } = harness('owner');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    const target = locationOf(res);
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = target.searchParams.get('code_challenge') ?? '';
    expect(challenge).toMatch(/^[\w-]{43}$/);

    expect(pending).toHaveLength(1);
    const verifier = pending[0].codeVerifier;
    expect(verifier).toMatch(/^[\w-]{43}$/);
    // The verifier is the secret half: it must never appear on the wire.
    expect(res.headers.get('Location')).not.toContain(verifier);

    // …and the challenge really is its SHA-256, i.e. a real S256 pair.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    expect(challenge).toBe(expected);
  });

  it('stores only the HASH of the state it hands to the browser', async () => {
    const { ctx, pending } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    const state = locationOf(res).searchParams.get('state') ?? '';
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(pending).toHaveLength(1);
    expect(pending[0].stateHash).toBe(await hashStateToken(state));
    expect(pending[0].stateHash).not.toBe(state);
    // Bound to the organization and the user who asked, not to the request.
    expect(pending[0].organizationId).toBe(ORG);
    expect(pending[0].userId).toBe(USER);
    expect(pending[0].connectorSlug).toBe('slack');
    expect(pending[0].redirectUri).toBe(EXPECTED_REDIRECT_URI);
  });

  it('ignores a redirect_uri supplied on the request', async () => {
    const { ctx, pending } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({
        connector: 'slack',
        organizationId: ORG,
        redirect_uri: 'https://attacker.example/steal',
        redirectUri: 'https://attacker.example/steal',
      }),
    );

    const target = locationOf(res);
    expect(target.searchParams.get('redirect_uri')).toBe(EXPECTED_REDIRECT_URI);
    expect(res.headers.get('Location')).not.toContain('attacker.example');
    expect(pending[0].redirectUri).toBe(EXPECTED_REDIRECT_URI);
  });

  it('ignores a spoofed Host header when building the redirect URI', async () => {
    const { ctx, pending } = harness('admin');
    const url = new URL('https://attacker.example/api/connectors/oauth2/start');
    url.searchParams.set('connector', 'slack');
    url.searchParams.set('organizationId', ORG);

    const res = await oauth2StartHandler(
      ctx,
      new Request(url.toString(), { headers: { Host: 'attacker.example' } }),
    );

    expect(locationOf(res).searchParams.get('redirect_uri')).toBe(
      EXPECTED_REDIRECT_URI,
    );
    expect(pending[0].redirectUri).toBe(EXPECTED_REDIRECT_URI);
  });

  it('asks Google for offline access so a refresh token is issued', async () => {
    const { ctx } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'gmail', organizationId: ORG }),
    );

    const target = locationOf(res);
    expect(target.host).toBe('accounts.google.com');
    expect(target.searchParams.get('access_type')).toBe('offline');
    expect(target.searchParams.get('prompt')).toBe('consent');
  });

  it('adds offline_access for Microsoft without dropping catalog scopes', async () => {
    const { ctx } = harness('admin');
    const catalog = readOauth2Endpoints('outlook');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'outlook', organizationId: ORG }),
    );

    const target = locationOf(res);
    expect(target.host).toBe('login.microsoftonline.com');
    const scopes = (target.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toContain('offline_access');
    for (const scope of catalog?.scopes ?? []) {
      expect(scopes).toContain(scope);
    }
    expect(target.searchParams.get('prompt')).toBe('select_account');
  });

  it('refuses a connector that offers no OAuth2 method', async () => {
    const { ctx, pending } = harness('admin');

    // github ships a `bearer` auth method only.
    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'github', organizationId: ORG }),
    );

    expect(res.status).toBe(400);
    expect(pending).toHaveLength(0);
  });

  it('refuses an unknown connector slug', async () => {
    const { ctx } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'not-a-connector', organizationId: ORG }),
    );

    expect(res.status).toBe(400);
  });

  it('refuses to start when the deployment has no OAuth app for the connector', async () => {
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_ID', '');
    vi.stubEnv('CONNECTOR_OAUTH_SLACK_CLIENT_SECRET', '');
    const { ctx, pending } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(503);
    expect(pending).toHaveLength(0);
  });

  it('refuses to derive a redirect URI when SITE_URL is unset', async () => {
    vi.stubEnv('SITE_URL', '');
    const { ctx, pending } = harness('admin');

    const res = await oauth2StartHandler(
      ctx,
      startRequest({ connector: 'slack', organizationId: ORG }),
    );

    expect(res.status).toBe(503);
    expect(pending).toHaveLength(0);
  });
});
