// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org';
import { createProviderSettingRoutes } from './routes';

const { caller, catalog } = vi.hoisted(() => ({
  caller: { role: 'admin', orgId: 'org-a', slug: 'north' },
  catalog: vi.fn(),
}));
vi.mock('../../core/lib/providers/catalog_fetch', async (original) => ({
  ...(await original<
    typeof import('../../core/lib/providers/catalog_fetch')
  >()),
  getProviderCatalog: catalog,
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
        user: { id: 'operator', email: 'operator@example.test' },
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

let directory: string;
const definition = {
  name: 'local-chat',
  displayName: 'Local chat',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.test/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'env' }],
};
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
function put(value: unknown, name = definition.name) {
  return app().request(`/definitions/${name}?orgId=${caller.orgId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'provider-config-route-'));
  vi.stubEnv('TALE_CONFIG_DIR', directory);
  Object.assign(caller, { role: 'admin', orgId: 'org-a', slug: 'north' });
  catalog.mockReset();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('native custom provider definition HTTP door', () => {
  it('updates a reviewed definition and returns strict canonical native readback', async () => {
    expect(
      await (await app().request('/definitions/local-chat?orgId=org-a')).json(),
    ).toEqual({ config: null, hash: null });
    const created = await put({ config: definition, expectedHash: null });
    expect(created.status).toBe(200);
    const first = (await created.json()) as {
      hash: string;
      config: typeof definition;
    };
    expect(first.config).toEqual(definition);
    expect(
      (
        await put({
          config: { ...definition, displayName: 'Updated' },
          expectedHash: null,
        })
      ).status,
    ).toBe(409);
    const changed = await put({
      config: { ...definition, displayName: 'Updated' },
      expectedHash: first.hash,
    });
    expect(changed.status).toBe(200);
    expect(
      await (await app().request('/definitions/local-chat?orgId=org-a')).json(),
    ).toMatchObject({ config: { displayName: 'Updated' } });
    Object.assign(caller, { orgId: 'org-b', slug: 'south' });
    expect(
      await (await app().request('/definitions/local-chat?orgId=org-b')).json(),
    ).toEqual({ config: null, hash: null });
  });

  it('rejects non-admin writes, malformed JSON and unknown fields without echoing submitted content', async () => {
    caller.role = 'member';
    expect((await put({ config: definition, expectedHash: null })).status).toBe(
      403,
    );
    caller.role = 'developer';
    expect((await put({ config: definition })).status).toBe(400);
    const unknown = await put({
      config: definition,
      expectedHash: null,
      secret: 'private-value',
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).not.toContain('private-value');
    const invalid = await app().request('/definitions/local-chat?orgId=org-a', {
      method: 'PUT',
      body: '{"secret":"private-value"',
      headers: { 'content-type': 'application/json' },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain('private-value');
    const duplicate = await app().request(
      '/definitions/local-chat?orgId=org-a',
      {
        method: 'PUT',
        body: `{"config":${JSON.stringify(definition)},"expectedHash":null,"expectedHash":"${'a'.repeat(64)}"}`,
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(duplicate.status).toBe(400);
    expect(
      (
        await app().request('/definitions/local-chat?orgId=org-a', {
          method: 'PUT',
          body: ' '.repeat(256 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await put(
          { config: { ...definition, name: 'openai' }, expectedHash: null },
          'openai',
        )
      ).status,
    ).toBe(409);
    expect(
      (await put({ config: definition, expectedHash: null }, 'local-chat%0A'))
        .status,
    ).toBe(400);
  });

  it('refreshes only the selected native custom catalog and never reports stale success on failure', async () => {
    expect((await put({ config: definition, expectedHash: null })).status).toBe(
      200,
    );
    const models = [
      {
        id: 'model-a',
        provider: 'local-chat',
        contextWindow: 4096,
        supportsTools: true,
        supportsVision: false,
        tags: ['chat'],
      },
    ];
    catalog.mockResolvedValue(models);
    const good = await app().request(
      '/definitions/local-chat/catalog?orgId=org-a',
    );
    expect(await good.json()).toEqual({ models });
    expect(catalog).toHaveBeenCalledExactlyOnceWith(definition, {
      forceRefresh: true,
    });
    catalog.mockRejectedValue(new Error('private upstream request data'));
    const unavailable = await app().request(
      '/definitions/local-chat/catalog?orgId=org-a',
    );
    expect(unavailable.status).toBe(502);
    expect(await unavailable.text()).not.toContain(
      'private upstream request data',
    );
    expect(
      (await app().request('/definitions/absent/catalog?orgId=org-a')).status,
    ).toBe(404);
  });
});
