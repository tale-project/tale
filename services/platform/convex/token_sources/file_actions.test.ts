import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Convex codegen wrapper is unavailable in a unit test — passthrough the
// `action({...})` config so we can call its `handler` directly.
vi.mock('../_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
}));

// `getTokenSource` is membership-gated; the gate itself is covered elsewhere,
// so stub it to a resolved member and focus this spec on the `hasSecret`
// computation (the false-positive env-ref regression, #2319).
const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

// `testTokenSource` must never hit the network in a unit test — stub only
// `safeFetch`; `SafeFetchError` stays real so the error-class narrowing runs.
const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));
vi.mock('../lib/http/safe_fetch', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/http/safe_fetch')>();
  return { ...actual, safeFetch: safeFetchMock };
});

const { getTokenSource, testTokenSource } = await import('./file_actions');
type TestTokenSourceResult = import('./file_actions').TestTokenSourceResult;

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<{ hasSecret: boolean } | null>;
};
const getHandler = (getTokenSource as unknown as ActionConfig).handler;

type TestActionConfig = {
  handler: (ctx: never, args: never) => Promise<TestTokenSourceResult>;
};
const testHandler = (testTokenSource as unknown as TestActionConfig).handler;

const CONFIG_ENV = 'TALE_CONFIG_DIR';
const SECRET_ENV = 'TALE_TOKEN_SOURCE_EXAMPLE';
const ORG_SLUG = 'default';
const SLUG = 'example-broker';

let configRoot: string;
let prevConfigDir: string | undefined;
let prevSecretEnv: string | undefined;

async function writeSource(secretEnv: string | undefined): Promise<void> {
  const dir = path.join(configRoot, ORG_SLUG, 'token-sources');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${SLUG}.json`),
    JSON.stringify({
      slug: SLUG,
      displayName: 'Example Broker',
      endpoint: 'https://broker.example.com/api/tokens',
      auth: { method: 'bearer', ...(secretEnv && { secretEnv }) },
      responseMapping: { tokensPath: '$.tokens', tokenField: 'access_token' },
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    }),
    'utf8',
  );
}

const ctx = {} as never;
const args = { organizationId: 'org_test', slug: SLUG } as never;

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), 'token-sources-'));
  prevConfigDir = process.env[CONFIG_ENV];
  process.env[CONFIG_ENV] = configRoot;
  prevSecretEnv = process.env[SECRET_ENV];
  delete process.env[SECRET_ENV];
  safeFetchMock.mockReset();
  mockRequireOrgMembershipById.mockReset();
  mockRequireOrgMembershipById.mockResolvedValue({
    orgId: 'org-123',
    orgSlug: ORG_SLUG,
    userId: 'user-1',
    email: 'a@b.com',
    name: 'A',
    member: { _id: 'm-1', role: 'owner' },
  });
});

afterEach(async () => {
  if (prevConfigDir === undefined) delete process.env[CONFIG_ENV];
  else process.env[CONFIG_ENV] = prevConfigDir;
  if (prevSecretEnv === undefined) delete process.env[SECRET_ENV];
  else process.env[SECRET_ENV] = prevSecretEnv;
  await rm(configRoot, { recursive: true, force: true });
});

describe('getTokenSource hasSecret', () => {
  it('reports not-configured when secretEnv is declared but the env var is unset', async () => {
    await writeSource(SECRET_ENV);
    const res = await getHandler(ctx, args);
    expect(res?.hasSecret).toBe(false);
  });

  it('reports not-configured when the declared env var is set but empty', async () => {
    await writeSource(SECRET_ENV);
    process.env[SECRET_ENV] = '';
    const res = await getHandler(ctx, args);
    expect(res?.hasSecret).toBe(false);
  });

  it('reports configured when the declared env var is actually set', async () => {
    await writeSource(SECRET_ENV);
    process.env[SECRET_ENV] = 'broker-secret-value';
    const res = await getHandler(ctx, args);
    expect(res?.hasSecret).toBe(true);
  });

  it('reports configured when a secret sidecar exists regardless of env', async () => {
    await writeSource(SECRET_ENV);
    await writeFile(
      path.join(configRoot, ORG_SLUG, 'token-sources', `${SLUG}.secrets.json`),
      `${JSON.stringify({ authSecret: 'stored' })}\n`,
      'utf8',
    );
    const res = await getHandler(ctx, args);
    expect(res?.hasSecret).toBe(true);
  });
});

describe('testTokenSource', () => {
  const TEST_CONFIG = {
    slug: SLUG,
    displayName: 'Example Broker',
    endpoint: 'https://broker.example.com/api/tokens',
    method: 'GET',
    auth: { method: 'bearer' },
    responseMapping: {
      tokensPath: '$.tokens',
      tokenField: 'access_token',
      statusField: 'status',
      statusActiveValue: 'active',
      expiryField: 'expires_at',
    },
    targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    selection: 'random',
  };

  const testArgs = (over: Record<string, unknown> = {}): never =>
    ({
      organizationId: 'org_test',
      config: TEST_CONFIG,
      secret: 'draft-secret',
      ...over,
    }) as never;

  it('returns pool counts and never the tokens for a healthy broker', async () => {
    const future = Date.now() + 3_600_000;
    safeFetchMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({
        tokens: [
          { access_token: 'tok-usable', status: 'active', expires_at: future },
          { access_token: 'tok-revoked', status: 'inactive' },
          { status: 'active' }, // missing token field
        ],
      }),
    });

    const res = await testHandler(ctx, testArgs());
    expect(res).toEqual({
      ok: true,
      httpStatus: 200,
      itemCount: 3,
      usableCount: 1,
      missingTokenField: 1,
      inactiveCount: 1,
      expiredCount: 0,
      nextExpiryMs: future,
    });
    // The probe result must never leak a token value.
    expect(JSON.stringify(res)).not.toContain('tok-usable');

    // The draft secret rides as the same auth header the runtime fetch sends.
    expect(safeFetchMock).toHaveBeenCalledWith(
      TEST_CONFIG.endpoint,
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer draft-secret' },
      }),
    );
  });

  it('flags a mapping miss when tokensPath matches nothing', async () => {
    safeFetchMock.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ items: [] }),
    });
    expect(await testHandler(ctx, testArgs())).toEqual({
      ok: false,
      error: 'tokens_path_miss',
      httpStatus: 200,
    });
  });

  it('flags an invalid tokensPath (no leading $) instead of throwing', async () => {
    safeFetchMock.mockResolvedValue({ status: 200, body: '{"tokens":[]}' });
    const config = {
      ...TEST_CONFIG,
      responseMapping: { ...TEST_CONFIG.responseMapping, tokensPath: 'tokens' },
    };
    expect(await testHandler(ctx, testArgs({ config }))).toEqual({
      ok: false,
      error: 'tokens_path_invalid',
      httpStatus: 200,
    });
  });

  it('reports a non-2xx broker status without echoing the response', async () => {
    safeFetchMock.mockResolvedValue({ status: 401, body: 'nope' });
    expect(await testHandler(ctx, testArgs())).toEqual({
      ok: false,
      error: 'http_error',
      httpStatus: 401,
    });
  });

  it('reports a non-JSON body', async () => {
    safeFetchMock.mockResolvedValue({ status: 200, body: '<html>' });
    expect(await testHandler(ctx, testArgs())).toEqual({
      ok: false,
      error: 'non_json',
      httpStatus: 200,
    });
  });

  it('maps a failed fetch to its sanitized failure class only', async () => {
    const { SafeFetchError } = await import('../lib/http/safe_fetch');
    safeFetchMock.mockRejectedValue(
      new SafeFetchError('timeout', 'Request timed out after 10000ms'),
    );
    expect(await testHandler(ctx, testArgs())).toEqual({
      ok: false,
      error: 'request_failed',
      detail: 'timeout',
    });
  });

  it('asks for the secret (and never fetches) when none is resolvable', async () => {
    expect(await testHandler(ctx, testArgs({ secret: undefined }))).toEqual({
      ok: false,
      error: 'secret_missing',
    });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the stored sidecar secret when the form field is blank', async () => {
    const dir = path.join(configRoot, ORG_SLUG, 'token-sources');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${SLUG}.secrets.json`),
      `${JSON.stringify({ authSecret: 'stored-secret' })}\n`,
      'utf8',
    );
    safeFetchMock.mockResolvedValue({ status: 200, body: '{"tokens":[]}' });

    await testHandler(ctx, testArgs({ secret: undefined }));
    expect(safeFetchMock).toHaveBeenCalledWith(
      TEST_CONFIG.endpoint,
      expect.objectContaining({
        headers: { authorization: 'Bearer stored-secret' },
      }),
    );
  });

  it('rejects an invalid draft config with per-field VALIDATION_ERROR data', async () => {
    const config = { ...TEST_CONFIG, endpoint: 'not-a-url' };
    await expect(testHandler(ctx, testArgs({ config }))).rejects.toMatchObject({
      data: {
        code: 'VALIDATION_ERROR',
        fieldErrors: { endpoint: expect.anything() },
      },
    });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
