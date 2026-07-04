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

const { getTokenSource } = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<{ hasSecret: boolean } | null>;
};
const getHandler = (getTokenSource as unknown as ActionConfig).handler;

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
