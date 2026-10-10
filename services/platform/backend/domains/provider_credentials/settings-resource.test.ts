// @vitest-environment node

/**
 * Provider credentials over MCP. The credential writers are the AI
 * providers page's own, held by their own suites against a real schema;
 * here they are an in-memory table with the same gate, hash and refusals,
 * so what the kind adds — which credentials it takes, its ids, its plan
 * and its compare-and-set on a removal — is what is tested.
 */

import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialListItem, CredentialScope } from './service.ts';

const { follow, table, usedByEmbedding } = vi.hoisted(() => ({
  follow: vi.fn(),
  table: new Map<string, Omit<CredentialListItem, 'hash'>>(),
  usedByEmbedding: new Set<string>(),
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (
    _sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work({}),
}));
vi.mock('./embedding-follow.ts', () => ({
  followEmbeddingCredential: follow,
}));
vi.mock('./service.ts', async (original) => {
  const actual = await original<typeof import('./service.ts')>();
  const { ConfigurationError } =
    await import('../../core/lib/config_store/precondition');
  const hashed = (row: Omit<CredentialListItem, 'hash'>) => ({
    ...row,
    hash: configurationHash(row),
  });
  let next = 0;
  return {
    ...actual,
    listCredentials: async (
      _db: unknown,
      scope: CredentialScope,
      providerSlug?: string,
    ) => {
      actual.assertCredentialAdmin(scope);
      return [...table.values()]
        .filter(
          (row) =>
            providerSlug === undefined || row.providerSlug === providerSlug,
        )
        .map(hashed);
    },
    credentialDependents: async (
      _db: unknown,
      _scope: unknown,
      id: string,
    ) => ({
      usedBy: usedByEmbedding.has(id) ? ['embedding'] : [],
    }),
    createCredential: vi.fn(
      async (
        _tx: unknown,
        scope: CredentialScope,
        args: Record<string, unknown>,
      ) => {
        actual.assertCredentialAdmin(scope);
        const id = `cred-${++next}`;
        table.set(id, {
          id,
          providerSlug: String(args.providerSlug),
          authMethod: String(args.authMethod),
          name: String(args.name),
          envName: typeof args.envName === 'string' ? args.envName : null,
          endpointUrl:
            typeof args.endpointUrl === 'string' ? args.endpointUrl : null,
          maskedPreview: null,
          modelAllowlist: Array.isArray(args.modelAllowlist)
            ? (args.modelAllowlist as string[])
            : null,
          isDefault: args.isDefault === true,
          status: args.status === 'disabled' ? 'disabled' : 'active',
          createdAt: next,
          updatedAt: next,
        });
        return id;
      },
    ),
    updateCredential: vi.fn(
      async (
        _tx: unknown,
        _scope: CredentialScope,
        id: string,
        patch: Record<string, unknown>,
        expectedHash?: string,
      ) => {
        const row = table.get(id);
        if (row === undefined) throw new Error('no such credential');
        if (expectedHash !== undefined && hashed(row).hash !== expectedHash) {
          throw new ConfigurationError(
            'CONFIG_VERSION_CONFLICT',
            'Configuration changed since it was reviewed.',
          );
        }
        const defined = Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        );
        table.set(id, { ...row, ...defined, updatedAt: row.updatedAt + 1 });
      },
    ),
    deleteCredential: vi.fn(
      async (_tx: unknown, _scope: unknown, id: string) => {
        table.delete(id);
        return { providerSlug: 'openai' };
      },
    ),
  };
});

import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import {
  createCredential,
  deleteCredential,
  updateCredential,
} from './service.ts';
import { providerCredentialSettings } from './settings-resource.ts';

const registry = { 'provider-credential': providerCredentialSettings };

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  const tag = async () => [{ email: `${role}@example.test` }];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, caller };
}

const ENV_KEY = {
  providerSlug: 'openai',
  authMethod: 'env',
  name: 'Production key',
  envName: 'TALE_PROVIDER_KEY_OPENAI_PROD',
  endpointUrl: null,
  modelAllowlist: null,
  status: 'active',
  isDefault: true,
};
const ENV_ID = 'openai/Production%20key';

function stored(
  id: string,
  fields: Partial<Omit<CredentialListItem, 'hash'>>,
): void {
  table.set(id, {
    id,
    providerSlug: 'openai',
    authMethod: 'env',
    name: 'Production key',
    envName: 'TALE_PROVIDER_KEY_OPENAI_PROD',
    endpointUrl: null,
    maskedPreview: null,
    modelAllowlist: null,
    isDefault: true,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  });
}

async function hashOf(id: string): Promise<string> {
  const read = await providerCredentialSettings.read(contextOf('admin'), id);
  if (read === null) throw new Error(`no ${id}`);
  return read.hash;
}

beforeEach(() => {
  table.clear();
  usedByEmbedding.clear();
  vi.clearAllMocks();
});

describe('who reads and changes credentials [MCP-R10]', () => {
  it('lets an owner, admin or developer read and change them, and refuses a member as the page does', async () => {
    for (const role of ['owner', 'admin', 'developer']) {
      expect(await providerCredentialSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
    const answer = await getSettings(contextOf('member'), registry, {
      kinds: ['provider-credential'],
    });
    expect(answer.refused).toEqual([
      expect.objectContaining({
        code: 'FORBIDDEN_DEVELOPER_SETTINGS',
        error: 'Admin or developer role required',
      }),
    ]);
  });
});

describe('reading credentials', () => {
  it('lists every credential by provider and name, none with its secret', async () => {
    stored('cred-env', {});
    stored('cred-key', {
      authMethod: 'api-key',
      name: 'Team key',
      envName: null,
      isDefault: false,
      maskedPreview: 'sk-…Z2',
    });
    const answer = await getSettings(contextOf('admin'), registry, {
      kinds: ['provider-credential'],
    });
    expect(answer.resources).toEqual([
      expect.objectContaining({
        key: `provider-credential/${ENV_ID}`,
        id: ENV_ID,
        config: ENV_KEY,
      }),
      expect.objectContaining({
        id: 'openai/Team%20key',
        config: expect.objectContaining({ authMethod: 'api-key' }),
      }),
    ]);
    expect(JSON.stringify(answer)).not.toContain('sk-…Z2');
  });
});

describe('planning a credential change', () => {
  it('creates a credential that reads its key from the environment, as a new default that serves at once', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider-credential', op: 'set', config: ENV_KEY },
    ]);
    expect(plan.changes[0]).toMatchObject({
      id: ENV_ID,
      key: `provider-credential/${ENV_ID}`,
      action: 'create',
      effects: ['changes-serving-account'],
    });
  });

  it('refuses a credential with a key or a subscription, which is entered in Tale', async () => {
    stored('cred-key', { authMethod: 'api-key', envName: null });
    const existing = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider-credential', op: 'set', config: ENV_KEY },
    ]);
    expect(existing.changes[0]?.refusal).toMatchObject({
      code: 'SETTINGS_TALE_ONLY',
      hint: expect.stringContaining('Settings > AI providers'),
    });
    const created = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'provider-credential',
        op: 'set',
        config: { ...ENV_KEY, name: 'Other', authMethod: 'subscription-key' },
      },
    ]);
    expect(created.changes[0]?.refusal?.code).toBe('SETTINGS_TALE_ONLY');
  });

  it('refuses a key typed into the change, naming where, never the key', async () => {
    const plan = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'provider-credential',
        op: 'set',
        config: { ...ENV_KEY, secret: 'sk-000000000000000000000000' },
      },
    ]);
    expect(plan.changes[0]?.refusal).toMatchObject({
      code: 'SECRET_ARGUMENT_REFUSED',
      data: { places: [{ pointer: '/config/secret' }] },
    });
    expect(JSON.stringify(plan)).not.toContain('sk-0000');
  });

  it.each([
    ['an id naming another credential', 'openai/Other', 'SETTINGS_ID_INVALID'],
    ['an id with no provider', 'Production%20key', 'SETTINGS_ID_INVALID'],
  ])('refuses %s', async (_what, id, code) => {
    const plan = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider-credential', id, op: 'set', config: ENV_KEY },
    ]);
    expect(plan.changes[0]?.refusal?.code).toBe(code);
  });

  it('says when an edit changes what serves the provider, and nothing when it narrows the models', async () => {
    stored('cred-env', {});
    const plan = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'provider-credential',
        op: 'set',
        config: { ...ENV_KEY, status: 'disabled', isDefault: false },
      },
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      effects: ['changes-serving-account'],
    });
    const narrowed = await planSettings(contextOf('admin'), registry, [
      {
        kind: 'provider-credential',
        op: 'set',
        config: { ...ENV_KEY, modelAllowlist: ['gpt-6-luna'] },
      },
    ]);
    expect(narrowed.changes[0]).toMatchObject({
      action: 'update',
      effects: [],
    });
  });
});

describe('applying a credential change', () => {
  it('creates and edits through the page’s writers, and the documents follow', async () => {
    const created = await applySettings(
      contextOf('admin'),
      registry,
      [{ kind: 'provider-credential', op: 'set', config: ENV_KEY }],
      { [`provider-credential/${ENV_ID}`]: null },
    );
    expect(created).toMatchObject({
      applied: [{ action: 'create', hash: await hashOf(ENV_ID) }],
    });
    expect(createCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-admin',
        email: 'admin@example.test',
        role: 'admin',
      }),
      {
        providerSlug: 'openai',
        authMethod: 'env',
        name: 'Production key',
        envName: 'TALE_PROVIDER_KEY_OPENAI_PROD',
        status: 'active',
        isDefault: true,
      },
      null,
    );
    expect(follow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      'cred-1',
    );

    const hash = await hashOf(ENV_ID);
    await applySettings(
      contextOf('admin'),
      registry,
      [
        {
          kind: 'provider-credential',
          op: 'set',
          config: { ...ENV_KEY, envName: 'TALE_PROVIDER_KEY_OPENAI_NEXT' },
        },
      ],
      { [`provider-credential/${ENV_ID}`]: hash },
    );
    expect(updateCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'cred-1',
      expect.objectContaining({ envName: 'TALE_PROVIDER_KEY_OPENAI_NEXT' }),
      hash,
    );
  });

  it('refuses removing the credential the embedding model uses, and names what the removal of a default breaks', async () => {
    stored('cred-env', {});
    usedByEmbedding.add('cred-env');
    const refused = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider-credential', id: ENV_ID, op: 'delete' },
    ]);
    expect(refused.changes[0]?.refusal).toMatchObject({
      code: 'CREDENTIAL_IN_USE',
      data: { usedBy: ['embedding'] },
    });
    usedByEmbedding.clear();
    const plan = await planSettings(contextOf('admin'), registry, [
      { kind: 'provider-credential', id: ENV_ID, op: 'delete' },
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'delete',
      effects: ['breaks-dependents'],
    });
  });

  it('removes a credential only as the agent read it, a key entered in Tale included', async () => {
    stored('cred-key', {
      authMethod: 'api-key',
      name: 'Team key',
      envName: null,
      isDefault: false,
    });
    const id = 'openai/Team%20key';
    const read = await hashOf(id);
    // Someone edits the credential in Tale after the agent read it.
    stored('cred-key', {
      authMethod: 'api-key',
      name: 'Team key',
      envName: null,
      isDefault: false,
      status: 'disabled',
    });
    const stale = await applySettings(
      contextOf('admin'),
      registry,
      [{ kind: 'provider-credential', id, op: 'delete' }],
      { [`provider-credential/${id}`]: read },
    );
    expect(stale).toMatchObject({ code: 'SETTINGS_STALE', applied: [] });
    const removed = await applySettings(
      contextOf('admin'),
      registry,
      [{ kind: 'provider-credential', id, op: 'delete' }],
      { [`provider-credential/${id}`]: await hashOf(id) },
    );
    expect(removed).toMatchObject({
      applied: [{ action: 'delete', hash: null }],
    });
    expect(deleteCredential).toHaveBeenCalledOnce();
  });
});
