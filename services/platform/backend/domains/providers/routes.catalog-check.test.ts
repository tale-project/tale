// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../../../lib/net/safe-fetch';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { OrgEnv } from '../../auth/org';
import { invalidateCatalogFetchCache } from '../../core/lib/providers/catalog_fetch';
import { RateLimitExceededError } from '../../lib/rate-limit';
import { createProviderSettingRoutes } from './routes';

/**
 * The listing with a key the caller names (`POST /catalog-check`): the key a
 * dialog holds before anything is saved, or a saved credential's. Over the
 * real catalog fetch, with only the wire stubbed, so what goes out — and
 * what is kept — is what the endpoint would see.
 */

const { caller, credentialBearer, userLimit } = vi.hoisted(() => ({
  caller: { role: 'admin', orgId: 'org-a', slug: 'north', userId: 'ada' },
  credentialBearer: vi.fn(),
  userLimit: vi.fn(),
}));
vi.mock('../../../lib/net/safe-fetch', async (original) => ({
  ...(await original<typeof import('../../../lib/net/safe-fetch')>()),
  safeFetch: vi.fn(),
}));
vi.mock('../provider_credentials/service', async (original) => ({
  ...(await original<typeof import('../provider_credentials/service')>()),
  resolveCredentialListingBearer: credentialBearer,
}));
vi.mock('../../lib/rate-limit', async (original) => ({
  ...(await original<typeof import('../../lib/rate-limit')>()),
  checkUserRateLimit: userLimit,
}));
vi.mock('../audit_logs/service', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config', async (original) => ({
  ...(await original<typeof import('../../lib/org-config')>()),
  resolveOrgSlug: vi.fn(async () => caller.slug),
}));
vi.mock('../../auth/session', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: caller.userId, email: 'operator@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org', async (original) => ({
  ...(await original<typeof import('../../auth/org')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', caller.orgId);
      c.set('orgMember', { role: caller.role } as never);
      await next();
    },
}));

const mockedFetch = vi.mocked(safeFetch);

const draft = {
  name: 'bifrost',
  displayName: 'Bifrost',
  apiFormat: 'openai',
  baseUrl: 'https://gateway.example.test/v1',
  catalog: { source: 'models-endpoint' },
  auth: [{ method: 'api-key' }, { method: 'env' }],
};

function listing() {
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    body: JSON.stringify({
      object: 'list',
      data: [{ id: 'gpt-5.5', object: 'model' }],
    }),
    finalUrl: 'https://gateway.example.test/v1/models',
  };
}
function unauthorized() {
  return {
    status: 401,
    statusText: 'Unauthorized',
    headers: new Headers(),
    body: '{"type":"virtual_key_required"}',
    finalUrl: 'https://gateway.example.test/v1/models',
  };
}
/** The gateway: lists for `sk-right`, refuses everything else. */
function gateway() {
  mockedFetch.mockImplementation(async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.authorization === 'Bearer sk-right'
      ? listing()
      : unauthorized();
  });
}
/** What each listing request carried as its authorization, in order. */
function sentAuthorizations(): (string | undefined)[] {
  return mockedFetch.mock.calls.map(
    ([, init]) =>
      ((init?.headers ?? {}) as Record<string, string>).authorization,
  );
}

function app() {
  const tag = async () => [];
  const sql = Object.assign(tag, {
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  return createProviderSettingRoutes({
    sql: sql as unknown as Sql,
    auth: {} as never,
  });
}
function check(body: unknown) {
  return app().request(`/catalog-check?orgId=${caller.orgId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'provider-catalog-check-'));
  vi.stubEnv('TALE_CONFIG_DIR', directory);
  Object.assign(caller, {
    role: 'admin',
    orgId: 'org-a',
    slug: 'north',
    userId: 'ada',
  });
  userLimit.mockReset().mockResolvedValue(undefined);
  credentialBearer.mockReset();
  mockedFetch.mockReset();
  gateway();
});
afterEach(async () => {
  invalidateCatalogFetchCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('POST /catalog-check — a listing with the key the caller names', () => {
  it('lists a provider being set up with the key its dialog holds, as the bearer and nowhere else', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await check({ definition: draft, secret: 'sk-right' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      models: [{ id: 'gpt-5.5', provider: 'bifrost' }],
    });
    expect(mockedFetch).toHaveBeenCalledExactlyOnceWith(
      'https://gateway.example.test/v1/models',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          authorization: 'Bearer sk-right',
        },
      }),
    );
    // The key went in the body and out as the bearer: never in a URL.
    expect(mockedFetch.mock.calls[0]?.[0]).not.toContain('sk-right');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-right');
    // A rate-limit charge per person, before anything went out.
    expect(userLimit).toHaveBeenCalledWith(
      expect.anything(),
      'provider:catalog-check',
      'ada',
    );
  });

  it('keeps one listing to the caller that asked: never cached for another key, organization or the anonymous reader [PROV-R5]', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      (await check({ definition: draft, secret: 'sk-right' })).status,
    ).toBe(200);
    // Another organization's dialog with the same gateway and no key is asked
    // afresh, without a key, and told precisely that.
    Object.assign(caller, { orgId: 'org-b', slug: 'south', userId: 'bob' });
    const anonymous = await check({ definition: draft });
    expect(anonymous.status).toBe(502);
    expect(await anonymous.json()).toMatchObject({
      error: 'PROVIDER_CATALOG_KEY_REQUIRED',
    });
    // Its own wrong key goes out too, and is refused as a key.
    const wrong = await check({ definition: draft, secret: 'sk-wrong' });
    expect(await wrong.json()).toMatchObject({
      error: 'PROVIDER_CATALOG_KEY_REFUSED',
    });
    // Back in the first organization, the right key is asked again: the
    // refusal of the wrong key is not remembered for it either.
    Object.assign(caller, { orgId: 'org-a', slug: 'north', userId: 'ada' });
    expect(
      (await check({ definition: draft, secret: 'sk-right' })).status,
    ).toBe(200);
    expect(sentAuthorizations()).toEqual([
      'Bearer sk-right',
      undefined,
      'Bearer sk-wrong',
      'Bearer sk-right',
    ]);
  });

  it('says whether a key went with a refused listing, and never echoes the key [PROV-R5]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = await check({ definition: draft, secret: 'sk-wrong' });
    expect(refused.status).toBe(502);
    const refusedText = await refused.text();
    expect(JSON.parse(refusedText)).toMatchObject({
      error: 'PROVIDER_CATALOG_KEY_REFUSED',
    });
    expect(refusedText).not.toContain('sk-wrong');
    const missing = await check({ definition: draft });
    expect(await missing.json()).toMatchObject({
      error: 'PROVIDER_CATALOG_KEY_REQUIRED',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('HTTP 401 for the API key sent');
    expect(logged).toContain('HTTP 401 without an API key');
    expect(logged).not.toContain('sk-wrong');
    // Each refusal asked once.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('lists a saved provider with the credential the caller names, default or not', async () => {
    const saved = await app().request(
      `/definitions/bifrost?orgId=${caller.orgId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: draft, expectedHash: null }),
      },
    );
    expect(saved.status).toBe(200);
    credentialBearer.mockResolvedValue('sk-right');
    const response = await check({ name: 'bifrost', credentialId: 'cred-2' });
    expect(response.status).toBe(200);
    expect(credentialBearer).toHaveBeenCalledWith(
      expect.anything(),
      'org-a',
      expect.objectContaining({ name: 'bifrost' }),
      'cred-2',
    );
    expect(sentAuthorizations()).toEqual(['Bearer sk-right']);

    // A credential of another organization or provider is refused by code,
    // and nothing goes out.
    credentialBearer.mockRejectedValue(
      new AppError({ code: 'CREDENTIAL_NOT_FOUND', message: 'Not found.' }),
    );
    const foreign = await check({ name: 'bifrost', credentialId: 'cred-9' });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'CREDENTIAL_NOT_FOUND' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    // A name the organization does not resolve is no provider.
    expect((await check({ name: 'absent', secret: 'sk-right' })).status).toBe(
      404,
    );
  });

  it('refuses a member, a malformed request, a forbidden endpoint and a spent budget before anything goes out', async () => {
    caller.role = 'member';
    expect(
      (await check({ definition: draft, secret: 'sk-right' })).status,
    ).toBe(403);
    caller.role = 'developer';
    for (const body of [
      {},
      { name: 'bifrost', definition: draft },
      { definition: draft, secret: 'sk-right', credentialId: 'cred-1' },
      { definition: draft, credentialId: 'cred-1' },
      { definition: draft, secret: 'sk-right', extra: true },
    ]) {
      const refused = await check(body);
      expect(refused.status).toBe(400);
      expect(await refused.text()).not.toContain('sk-right');
    }
    const metadata = await check({
      definition: { ...draft, baseUrl: 'http://169.254.169.254/v1' },
      secret: 'sk-right',
    });
    expect(metadata.status).toBe(400);
    expect(await metadata.json()).toMatchObject({
      error: 'PROVIDER_ENDPOINT_INVALID',
    });
    const shipped = await check({
      definition: { ...draft, name: 'openai' },
      secret: 'sk-right',
    });
    expect(shipped.status).toBe(409);
    userLimit.mockRejectedValue(
      new RateLimitExceededError('Rate limit exceeded.', 4_000),
    );
    const limited = await check({ definition: draft, secret: 'sk-right' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('4');
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
