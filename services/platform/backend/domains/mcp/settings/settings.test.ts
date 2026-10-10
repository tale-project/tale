/**
 * The settings tools' shared core, driven through an in-memory registry
 * whose handlers behave like the native writers they stand for: each read
 * answers a hash, each write checks the expected hash under its "lock" and
 * throws the writers' own `CONFIG_VERSION_CONFLICT` when it moved.
 */

import type { SettingsKind } from '@tale/shared/schemas/settings-kinds';
import { configurationHash } from '@tale/shared/utils/configuration-hash';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationError } from '../../../core/lib/config_store/precondition';
import { runInRequestChannel } from '../../../lib/request-channel';
import type { McpCaller } from '../caller';
import { applySettings } from './apply';
import { getSettings } from './get';
import { planSettings } from './plan';
import type {
  HandlerPlan,
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsRegistry,
} from './registry';

// Providers store one secret here, so the masked round trip runs end to
// end; every real kind of the first release stores none.
vi.mock('@tale/shared/schemas/settings-kinds', async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import('@tale/shared/schemas/settings-kinds')
    >();
  return {
    ...real,
    settingsKindDescriptor: (kind: SettingsKind) => {
      const descriptor = real.settingsKindDescriptor(kind);
      return kind === 'provider'
        ? { ...descriptor, secretPaths: ['/apiKey'] }
        : descriptor;
    },
  };
});

/** A fake stored secret: no answer may ever carry it. */
const SENTINEL = 'SENTINEL-provider-secret-0001';

const ada: McpCaller = {
  organizationId: 'org_1',
  orgSlug: 'acme',
  userId: 'user_ada',
  role: 'admin',
  credential: { kind: 'api-key', apiKeyId: 'key_laptop' },
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the fake handlers never query
const sql = {} as unknown as Sql;

function contextFor(caller: McpCaller = ada): SettingsContext {
  return { sql, caller };
}

interface Fake {
  readonly store: Map<string, unknown>;
  readonly writes: string[];
  readonly registry: SettingsRegistry;
  readonly handlers: Record<string, SettingsKindHandler>;
}

/**
 * Three kinds in memory: providers by name (one secret each), governance
 * policies by key, and the organization's one branding. Changing a policy
 * named `password_policy` may lock members out; a provider named
 * `refused` is refused by its writer, and one named `broken` breaks it.
 */
function fake(): Fake {
  const store = new Map<string, unknown>();
  const writes: string[] = [];
  const handler = (
    kind: SettingsKind,
    single: boolean,
    effects: HandlerPlan['effects'] = [],
  ): SettingsKindHandler => {
    const keyOf = (id: string | null) => (id === null ? kind : `${kind}/${id}`);
    const resource = (id: string | null) => {
      const config = store.get(keyOf(id));
      return config === undefined
        ? null
        : { id, config, hash: configurationHash(config) };
    };
    return {
      kind,
      access: async ({ caller }) => ({
        read: true,
        write: caller.role === 'admin' || caller.role === 'owner',
      }),
      identify: (change) => {
        if (single) return null;
        if (change.id !== undefined) return change.id;
        throw new ConfigurationError(
          'SETTINGS_ID_REQUIRED',
          `a ${kind} change names its id`,
          400,
        );
      },
      list: async (_ctx, query) => ({
        items: [...store.keys()]
          .filter((key) => key === kind || key.startsWith(`${kind}/`))
          .map((key) => (key === kind ? null : key.slice(kind.length + 1)))
          .filter(
            (id) => query.ids === undefined || query.ids.includes(id ?? ''),
          )
          .flatMap((id) => resource(id) ?? []),
        nextCursor: null,
      }),
      read: async (_ctx, id) => resource(id),
      plan: async (_ctx, change, current) => {
        if (change.id === 'invalid') {
          throw new ConfigurationError(
            'SETTINGS_INVALID',
            'minLength must be at least 8',
            400,
          );
        }
        return {
          ...(change.op === 'set' ? { after: change.config } : {}),
          unchanged:
            current !== null &&
            change.op === 'set' &&
            configurationHash(current.config) ===
              configurationHash(change.config),
          effects,
        };
      },
      apply: async (_ctx, change, expectedHash) => {
        const id = single ? null : (change.id ?? null);
        if (id === 'refused') {
          throw new ConfigurationError(
            'PROVIDER_FORBIDDEN',
            'Only owners and admins can change providers.',
            403,
          );
        }
        if (id === 'broken') throw new Error('disk full at /var/lib/tale');
        if ((resource(id)?.hash ?? null) !== expectedHash) {
          throw new ConfigurationError(
            'CONFIG_VERSION_CONFLICT',
            'Configuration changed since it was reviewed.',
          );
        }
        writes.push(keyOf(id));
        if (change.op === 'delete') {
          store.delete(keyOf(id));
          return { hash: null };
        }
        if (change.op === 'set') store.set(keyOf(id), change.config);
        return { hash: resource(id)?.hash ?? null };
      },
    };
  };
  const handlers = {
    provider: handler('provider', false),
    governance: handler('governance', false, ['may-lock-out-members']),
    branding: handler('branding', true),
  };
  return { store, writes, registry: handlers, handlers };
}

function seeded(): Fake {
  const state = fake();
  state.store.set('provider/vendor', {
    name: 'vendor',
    baseUrl: 'https://vendor.example.invalid/v1',
    apiKey: SENTINEL,
  });
  state.store.set('governance/password_policy', { minLength: 8 });
  state.store.set('branding', { accentColor: '#336699' });
  return state;
}

const hashOf = (state: Fake, key: string) =>
  configurationHash(state.store.get(key));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get_settings', () => {
  it('answers the catalog of kinds without kinds: available here, and what the role may do', async () => {
    const state = seeded();
    const catalog = await getSettings(
      contextFor({ ...ada, role: 'member' }),
      state.registry,
      {},
    );
    const kinds = catalog.kinds as Array<Record<string, unknown>>;
    expect(kinds.map((entry) => entry.kind)).toEqual([
      'provider',
      'provider-credential',
      'governance',
      'knowledge-embedding',
      'branding',
      'project-instructions',
      'agent-instructions',
      'agent-tools',
      'agent-model',
      'task-instructions',
      'task-review-context',
      'deployment',
    ]);
    expect(kinds.find((entry) => entry.kind === 'governance')).toMatchObject({
      available: true,
      read: true,
      write: false,
      ops: ['set'],
      baseRisk: 'high',
    });
    expect(kinds.find((entry) => entry.kind === 'deployment')).toMatchObject({
      available: false,
      read: false,
      write: false,
    });
    expect(catalog.resources).toEqual([]);
  });

  it('reads each resource with its key and hash, its secrets masked', async () => {
    const state = seeded();
    const answer = await getSettings(contextFor(), state.registry, {
      kinds: ['provider', 'branding'],
    });
    expect(answer.resources).toEqual([
      {
        kind: 'provider',
        id: 'vendor',
        key: 'provider/vendor',
        hash: hashOf(state, 'provider/vendor'),
        config: {
          name: 'vendor',
          baseUrl: 'https://vendor.example.invalid/v1',
          apiKey: { masked: true, preview: 'SENT…01' },
        },
      },
      {
        kind: 'branding',
        id: null,
        key: 'branding',
        hash: hashOf(state, 'branding'),
        config: { accentColor: '#336699' },
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain(SENTINEL);
  });

  it('answers a kind it cannot read as refused beside the others, never as empty', async () => {
    const state = seeded();
    vi.spyOn(state.handlers.governance!, 'list').mockRejectedValue(
      new ConfigurationError(
        'FORBIDDEN_ORG_SETTINGS',
        'Only owners and admins can read governance policies.',
        403,
      ),
    );
    const answer = await getSettings(contextFor(), state.registry, {
      kinds: ['governance', 'deployment', 'branding'],
    });
    expect(answer.refused).toEqual([
      {
        kind: 'governance',
        code: 'FORBIDDEN_ORG_SETTINGS',
        error: 'Only owners and admins can read governance policies.',
      },
      {
        kind: 'deployment',
        code: 'SETTINGS_KIND_UNAVAILABLE',
        error:
          'settings of kind "deployment" are not served over MCP on this deployment',
        hint: expect.any(String),
      },
    ]);
    expect(answer.resources).toHaveLength(1);
  });

  it('lets a fault through instead of answering it as a refusal', async () => {
    const state = seeded();
    vi.spyOn(state.handlers.branding!, 'list').mockRejectedValue(
      new Error('connection refused'),
    );
    await expect(
      getSettings(contextFor(), state.registry, { kinds: ['branding'] }),
    ).rejects.toThrow('connection refused');
  });
});

describe('plan_settings', () => {
  it('says what each change would do to what is stored, member by member', async () => {
    const state = seeded();
    const plan = await planSettings(contextFor(), state.registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: { minLength: 12 },
      },
      { kind: 'governance', id: 'budgets', op: 'set', config: { rules: [] } },
      { kind: 'branding', op: 'set', config: { accentColor: '#336699' } },
      { kind: 'provider', id: 'vendor', op: 'delete' },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.changes).toEqual([
      {
        kind: 'governance',
        id: 'password_policy',
        key: 'governance/password_policy',
        op: 'set',
        action: 'update',
        currentHash: hashOf(state, 'governance/password_policy'),
        diff: [{ path: '/minLength', before: 8, after: 12 }],
        effects: ['may-lock-out-members'],
        risk: 'critical',
      },
      {
        kind: 'governance',
        id: 'budgets',
        key: 'governance/budgets',
        op: 'set',
        action: 'create',
        currentHash: null,
        diff: [{ path: '/rules', after: [] }],
        effects: ['may-lock-out-members'],
        risk: 'critical',
      },
      {
        kind: 'branding',
        id: null,
        key: 'branding',
        op: 'set',
        action: 'unchanged',
        currentHash: hashOf(state, 'branding'),
        diff: [],
        effects: [],
        risk: 'low',
      },
      {
        kind: 'provider',
        id: 'vendor',
        key: 'provider/vendor',
        op: 'delete',
        action: 'delete',
        currentHash: hashOf(state, 'provider/vendor'),
        diff: [
          {
            path: '',
            before: {
              name: 'vendor',
              baseUrl: 'https://vendor.example.invalid/v1',
              apiKey: { masked: true, preview: 'SENT…01' },
            },
            after: null,
          },
        ],
        effects: [],
        risk: 'high',
      },
    ]);
    expect(JSON.stringify(plan)).not.toContain(SENTINEL);
  });

  it('writes nothing', async () => {
    const state = seeded();
    const before = JSON.stringify([...state.store]);
    await planSettings(contextFor(), state.registry, [
      {
        kind: 'governance',
        id: 'password_policy',
        op: 'set',
        config: { minLength: 12 },
      },
      { kind: 'provider', id: 'vendor', op: 'delete' },
    ]);
    expect(state.writes).toEqual([]);
    expect(JSON.stringify([...state.store])).toBe(before);
  });

  it('refuses each change that cannot be applied as asked, and plans the rest', async () => {
    const state = seeded();
    const plan = await planSettings(contextFor(), state.registry, [
      { kind: 'deployment', op: 'set', config: { version: 1 } },
      { kind: 'governance', op: 'set', config: {} },
      {
        kind: 'governance',
        id: 'invalid',
        op: 'set',
        config: { minLength: 1 },
      },
      { kind: 'provider', id: 'ghost', op: 'act', act: 'refresh-catalogs' },
      { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
      { kind: 'branding', op: 'set', config: { accentColor: '#ffffff' } },
    ]);
    expect(plan.ok).toBe(false);
    expect(
      plan.changes.map((change) => [
        change.key,
        change.refusal?.code ?? change.action,
      ]),
    ).toEqual([
      ['deployment', 'SETTINGS_KIND_UNAVAILABLE'],
      ['governance', 'SETTINGS_ID_REQUIRED'],
      ['governance/invalid', 'SETTINGS_INVALID'],
      ['provider/ghost', 'SETTINGS_NOT_FOUND'],
      ['branding', 'update'],
      ['branding', 'SETTINGS_DUPLICATE'],
    ]);
    // A refused change says why, and nothing of what it would have done.
    expect(plan.changes[5]).toEqual({
      kind: 'branding',
      id: null,
      key: 'branding',
      op: 'set',
      currentHash: hashOf(state, 'branding'),
      diff: [],
      effects: [],
      risk: 'low',
      refusal: expect.objectContaining({ code: 'SETTINGS_DUPLICATE' }),
    });
  });

  it('refuses a credential pasted into a setting, wherever it sits, without repeating it [MCP-R12]', async () => {
    const state = seeded();
    const pasted = 'sk-000000000000000000000000';
    const plan = await planSettings(contextFor(), state.registry, [
      {
        kind: 'governance',
        id: 'system_prompt',
        op: 'set',
        config: { prompt: `Call the API with ${pasted}` },
      },
      {
        kind: 'provider',
        id: 'vendor',
        op: 'set',
        config: { name: 'vendor', apiKey: 'typed-in-new-key' },
      },
    ]);
    expect(plan.changes.map((change) => change.refusal?.data)).toEqual([
      { places: [{ pointer: '/config/prompt', kind: 'API key (sk-…)' }] },
      { places: [{ pointer: '/config/apiKey', kind: 'a secret value' }] },
    ]);
    expect(JSON.stringify(plan)).not.toContain(pasted);
    expect(JSON.stringify(plan)).not.toContain('typed-in-new-key');
  });
});

describe('apply_settings', () => {
  const passwordChange: SettingsChange = {
    kind: 'governance',
    id: 'password_policy',
    op: 'set',
    config: { minLength: 12 },
  };

  it('needs the expected hash of every changed resource, and nothing else, before it reads anything', async () => {
    const state = seeded();
    const read = vi.spyOn(state.handlers.governance!, 'read');
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        passwordChange,
        { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
      ],
      { branding: hashOf(state, 'branding'), 'governance/budgets': null },
    );
    expect(answer).toEqual({
      error:
        'invalid arguments for apply_settings: "expected.governance/budgets" names a resource no change in this call changes (and 1 more)',
      code: 'INVALID_ARGUMENTS',
      hint: expect.any(String),
      data: {
        issues: [
          {
            path: 'expected.governance/budgets',
            code: 'unrecognized_key',
            message: 'names a resource no change in this call changes',
          },
          {
            path: 'expected.governance/password_policy',
            code: 'missing',
            message: expect.stringContaining('changes.0'),
          },
        ],
      },
    });
    expect(read).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });

  it('applies nothing when one resource moved since it was read [MCP-R11]', async () => {
    const state = seeded();
    const read = hashOf(state, 'governance/password_policy');
    // Ben changes the policy in the app between the agent's read and apply.
    state.store.set('governance/password_policy', { minLength: 10 });
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
        passwordChange,
      ],
      {
        branding: hashOf(state, 'branding'),
        'governance/password_policy': read,
      },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_STALE',
      data: { currentHash: hashOf(state, 'governance/password_policy') },
      applied: [],
      failed: {
        key: 'governance/password_policy',
        code: 'SETTINGS_STALE',
        currentHash: hashOf(state, 'governance/password_policy'),
      },
      skipped: [{ kind: 'branding', id: null, key: 'branding' }],
    });
    expect(state.writes).toEqual([]);
    expect(state.store.get('branding')).toEqual({ accentColor: '#336699' });
  });

  it('applies nothing when one change is refused', async () => {
    const state = seeded();
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        passwordChange,
        { kind: 'deployment', op: 'set', config: { version: 1 } },
      ],
      {
        'governance/password_policy': hashOf(
          state,
          'governance/password_policy',
        ),
        deployment: null,
      },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_KIND_UNAVAILABLE',
      applied: [],
      failed: { key: 'deployment' },
      skipped: [{ key: 'governance/password_policy' }],
    });
    expect(state.writes).toEqual([]);
  });

  it('applies in the kinds’ order, whatever order the call names them in', async () => {
    const state = seeded();
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
        passwordChange,
        {
          kind: 'provider',
          id: 'second',
          op: 'set',
          config: { name: 'second' },
        },
      ],
      {
        branding: hashOf(state, 'branding'),
        'governance/password_policy': hashOf(
          state,
          'governance/password_policy',
        ),
        'provider/second': null,
      },
    );
    expect(state.writes).toEqual([
      'provider/second',
      'governance/password_policy',
      'branding',
    ]);
    expect(answer).toEqual({
      applied: [
        {
          kind: 'provider',
          id: 'second',
          key: 'provider/second',
          action: 'create',
          hash: hashOf(state, 'provider/second'),
        },
        {
          kind: 'governance',
          id: 'password_policy',
          key: 'governance/password_policy',
          action: 'update',
          hash: hashOf(state, 'governance/password_policy'),
        },
        {
          kind: 'branding',
          id: null,
          key: 'branding',
          action: 'update',
          hash: hashOf(state, 'branding'),
        },
      ],
      skipped: [],
    });
  });

  it('stops at a refused write: what landed stays, the rest is skipped [MCP-R11]', async () => {
    const state = seeded();
    state.store.set('provider/refused', { name: 'refused' });
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        { kind: 'branding', op: 'set', config: { accentColor: '#000000' } },
        {
          kind: 'provider',
          id: 'second',
          op: 'set',
          config: { name: 'second' },
        },
        {
          kind: 'provider',
          id: 'refused',
          op: 'set',
          config: { name: 'refused', note: 'x' },
        },
      ],
      {
        branding: hashOf(state, 'branding'),
        'provider/second': null,
        'provider/refused': hashOf(state, 'provider/refused'),
      },
    );
    expect(answer).toMatchObject({
      error: 'Only owners and admins can change providers.',
      code: 'PROVIDER_FORBIDDEN',
      applied: [{ key: 'provider/second', action: 'create' }],
      failed: { key: 'provider/refused', code: 'PROVIDER_FORBIDDEN' },
      skipped: [{ key: 'branding' }],
    });
    expect(state.writes).toEqual(['provider/second']);
    expect(state.store.get('provider/second')).toEqual({ name: 'second' });
  });

  it('answers a write that lost a race as stale, with the hash stored now', async () => {
    const state = seeded();
    const read = hashOf(state, 'governance/password_policy');
    const governance = state.handlers.governance!;
    const realApply = governance.apply.bind(governance);
    // Someone saves the policy after the agent's preflight, before its write.
    vi.spyOn(governance, 'apply').mockImplementation(
      async (ctx, change, expected) => {
        state.store.set('governance/password_policy', { minLength: 9 });
        return realApply(ctx, change, expected);
      },
    );
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [passwordChange],
      {
        'governance/password_policy': read,
      },
    );
    expect(answer).toMatchObject({
      code: 'SETTINGS_STALE',
      applied: [],
      failed: {
        key: 'governance/password_policy',
        currentHash: hashOf(state, 'governance/password_policy'),
      },
      skipped: [],
    });
    expect(state.store.get('governance/password_policy')).toEqual({
      minLength: 9,
    });
  });

  it('answers a writer that broke with the request id alone, after what landed', async () => {
    const state = seeded();
    state.store.set('provider/broken', { name: 'broken' });
    const logged = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const answer = await runInRequestChannel(
      { via: 'mcp', requestId: 'req-9' },
      () =>
        applySettings(
          contextFor(),
          state.registry,
          [
            {
              kind: 'provider',
              id: 'second',
              op: 'set',
              config: { name: 'second' },
            },
            {
              kind: 'provider',
              id: 'broken',
              op: 'set',
              config: { name: 'broken', x: 1 },
            },
          ],
          {
            'provider/second': null,
            'provider/broken': hashOf(state, 'provider/broken'),
          },
        ),
    );
    expect(answer).toMatchObject({
      code: 'INTERNAL_ERROR',
      data: { requestId: 'req-9' },
      applied: [{ key: 'provider/second' }],
      failed: { key: 'provider/broken', code: 'INTERNAL_ERROR' },
    });
    expect(JSON.stringify(answer)).not.toContain('disk full');
    expect(logged).toHaveBeenCalledOnce();
  });

  it('writes nothing for a change that already is so', async () => {
    const state = seeded();
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [{ kind: 'branding', op: 'set', config: { accentColor: '#336699' } }],
      { branding: hashOf(state, 'branding') },
    );
    expect(answer).toEqual({
      applied: [
        {
          kind: 'branding',
          id: null,
          key: 'branding',
          action: 'unchanged',
          hash: hashOf(state, 'branding'),
        },
      ],
      skipped: [],
    });
    expect(state.writes).toEqual([]);
  });

  it('keeps a stored secret through the masked value it read: read, edit, write back [MCP-R12]', async () => {
    const state = seeded();
    const read = await getSettings(contextFor(), state.registry, {
      kinds: ['provider'],
      ids: ['vendor'],
    });
    const [vendor] = read.resources as Array<{
      key: string;
      hash: string;
      config: Record<string, unknown>;
    }>;
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        {
          kind: 'provider',
          id: 'vendor',
          op: 'set',
          config: {
            ...vendor!.config,
            baseUrl: 'https://vendor.example.invalid/v2',
          },
        },
      ],
      { [vendor!.key]: vendor!.hash },
    );
    expect(answer).toMatchObject({
      applied: [{ key: 'provider/vendor', action: 'update' }],
    });
    expect(state.store.get('provider/vendor')).toEqual({
      name: 'vendor',
      baseUrl: 'https://vendor.example.invalid/v2',
      apiKey: SENTINEL,
    });
    expect(JSON.stringify([read, answer])).not.toContain(SENTINEL);
  });

  it('refuses a new secret and applies nothing [MCP-R12]', async () => {
    const state = seeded();
    const answer = await applySettings(
      contextFor(),
      state.registry,
      [
        {
          kind: 'provider',
          id: 'vendor',
          op: 'set',
          config: { name: 'vendor', apiKey: 'typed-in-new-key' },
        },
      ],
      { 'provider/vendor': hashOf(state, 'provider/vendor') },
    );
    expect(answer).toMatchObject({
      code: 'SECRET_ARGUMENT_REFUSED',
      applied: [],
    });
    expect(JSON.stringify(answer)).not.toContain('typed-in-new-key');
    expect(state.store.get('provider/vendor')).toMatchObject({
      apiKey: SENTINEL,
    });
  });
});
