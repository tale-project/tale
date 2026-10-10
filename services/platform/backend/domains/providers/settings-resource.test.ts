// @vitest-environment node

/**
 * The organization's own AI providers over MCP, through the writers the AI
 * providers page uses: the config store is a temporary directory, the
 * database a double, and the provider's catalog and the audit chain are
 * doubles that record.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { bearer, catalog, createAuditLog, credentials } = vi.hoisted(() => ({
  bearer: vi.fn(),
  catalog: vi.fn(),
  createAuditLog: vi.fn(),
  // How many of the organization's credentials name the provider.
  credentials: { count: 0 },
}));

vi.mock('../audit_logs/service', () => ({ createAuditLog }));
vi.mock('../provider_credentials/service.ts', async (original) => ({
  ...(await original<typeof import('../provider_credentials/service.ts')>()),
  resolveCatalogBearer: bearer,
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', async (original) => ({
  ...(await original<
    typeof import('../../core/lib/providers/catalog_fetch.ts')
  >()),
  getProviderCatalog: catalog,
}));

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { providerSettings } from './settings-resource.ts';

const registry = { provider: providerSettings };

const definition = {
  name: 'local-chat',
  displayName: 'Local chat',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.test/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'env' }],
};

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    if (text.includes('FROM "user"'))
      return [{ email: `${role}@example.test` }];
    if (text.includes('app.provider_credentials')) {
      return [{ count: credentials.count }];
    }
    return [];
  };
  const sql = Object.assign(tag, {
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, caller };
}

const set = (config: unknown, id?: string) => ({
  kind: 'provider' as const,
  ...(id === undefined ? {} : { id }),
  op: 'set' as const,
  config,
});

/** Define the provider as an admin, and answer its hash. */
async function defined(config: unknown = definition): Promise<string> {
  const answer = await applySettings(
    contextOf('admin'),
    registry,
    [set(config)],
    {
      'provider/local-chat': null,
    },
  );
  const [applied] = (answer.applied ?? []) as Array<{ hash: string }>;
  if (applied === undefined) throw new Error(JSON.stringify(answer));
  createAuditLog.mockClear();
  return applied.hash;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tale-provider-kind-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  credentials.count = 0;
  bearer.mockReset();
  catalog.mockReset();
  createAuditLog.mockReset();
  createAuditLog.mockResolvedValue('row-1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('who reads and changes the providers [MCP-R10]', () => {
  it('lets an owner, admin or developer read and change them, and refuses a member', async () => {
    for (const role of ['owner', 'admin', 'developer']) {
      expect(await providerSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
    expect(await providerSettings.access(contextOf('member'))).toEqual({
      read: false,
      write: false,
    });
    const answer = await getSettings(contextOf('member'), registry, {
      kinds: ['provider'],
    });
    expect(answer.refused).toEqual([
      expect.objectContaining({
        code: 'FORBIDDEN',
        error: 'Only owners, admins and developers can change AI providers.',
      }),
    ]);
  });
});

describe('defining a provider', () => {
  it('saves it through the page’s writer and lists it with its hash, audited under the key holder', async () => {
    const hash = await defined();
    const answer = await getSettings(contextOf('developer'), registry, {
      kinds: ['provider'],
    });
    expect(answer.resources).toEqual([
      {
        kind: 'provider',
        id: 'local-chat',
        key: 'provider/local-chat',
        hash,
        config: expect.objectContaining({ name: 'local-chat' }),
      },
    ]);
    await applySettings(
      contextOf('developer'),
      registry,
      [set({ ...definition, displayName: 'Local models' })],
      { 'provider/local-chat': hash },
    );
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'provider_definition.saved',
      actorId: 'user-developer',
      actorEmail: 'developer@example.test',
      resourceId: 'local-chat',
    });
  });

  it.each([
    [
      'an id another than the name',
      set(definition, 'other'),
      'SETTINGS_ID_INVALID',
    ],
    [
      'a provider Tale ships',
      set({ ...definition, name: 'openai' }),
      'PROVIDER_NAME_RESERVED',
    ],
    [
      'an endpoint carrying a password',
      set({ ...definition, baseUrl: 'https://u:p@models.example.test/v1' }),
      'PROVIDER_ENDPOINT_INVALID',
    ],
    [
      'a field a provider does not have',
      set({ ...definition, baseURL: 'https://models.example.test/v2' }),
      'SETTINGS_INVALID',
    ],
  ])('refuses %s before anything is written', async (_what, change, code) => {
    const plan = await planSettings(contextOf('admin'), registry, [change]);
    expect(plan.changes[0]?.refusal?.code).toBe(code);
  });

  it('says when a change sends the organization’s requests to another endpoint', async () => {
    await defined();
    const plan = await planSettings(contextOf('admin'), registry, [
      set({ ...definition, baseUrl: 'https://other.example.test/v1' }),
      // A new display name sends nothing elsewhere.
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      effects: ['changes-serving-account'],
      risk: 'high',
    });
    const renamed = await planSettings(contextOf('admin'), registry, [
      set({ ...definition, displayName: 'Local models' }),
    ]);
    expect(renamed.changes[0]).toMatchObject({ action: 'update', effects: [] });
  });
});

describe('removing a provider', () => {
  it('is refused while credentials still name it, and removes it once none does', async () => {
    const hash = await defined();
    credentials.count = 2;
    const refused = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider', id: 'local-chat', op: 'delete' },
    ]);
    expect(refused.changes[0]?.refusal).toMatchObject({
      code: 'PROVIDER_IN_USE',
      error: '2 credentials still use this provider. Delete them first.',
      data: { credentials: 2 },
    });
    credentials.count = 0;
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [{ kind: 'provider', id: 'local-chat', op: 'delete' }],
      { 'provider/local-chat': hash },
    );
    expect(answer).toMatchObject({
      applied: [{ action: 'delete', hash: null }],
    });
    expect(await providerSettings.read(contextOf('admin'), 'local-chat')).toBe(
      null,
    );
  });
});

describe('refreshing a provider’s catalog', () => {
  it('reads it afresh with the organization’s key, and never repeats what the provider answered', async () => {
    const hash = await defined();
    bearer.mockResolvedValue('sk-listing');
    catalog.mockResolvedValue([{ id: 'model-a' }]);
    const act = {
      kind: 'provider' as const,
      id: 'local-chat',
      op: 'act' as const,
      act: 'refresh-catalogs',
    };
    const plan = await planSettings(contextOf('admin'), registry, [act]);
    expect(plan.changes[0]).toMatchObject({
      action: 'act',
      effects: ['reaches-vendor'],
    });
    const answer = await applySettings(contextOf('admin'), registry, [act], {
      'provider/local-chat': hash,
    });
    expect(answer).toMatchObject({ applied: [{ action: 'act', hash }] });
    expect(catalog).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'local-chat' }),
      { forceRefresh: true, bearerToken: 'sk-listing' },
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    catalog.mockRejectedValue(new Error('private upstream request data'));
    const failed = await applySettings(contextOf('admin'), registry, [act], {
      'provider/local-chat': hash,
    });
    expect(failed).toMatchObject({ code: 'CATALOG_REFRESH_FAILED' });
    expect(JSON.stringify(failed)).not.toContain('private upstream');
    warn.mockRestore();
  });
});
