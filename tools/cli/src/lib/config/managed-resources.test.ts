import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { managedConfigurationHash } from '../../../../../services/platform/backend/core/lib/config_store/value_hash';
import { readManagedResource } from './managed-resources';
import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
} from './platform-apply';
import type { PlatformConfigurationClient } from './platform-client';
import {
  parsePlatformConfiguration,
  resourceId,
  type PlatformResource,
} from './platform-model';
import { valueHash } from './releases/identity';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function declaration() {
  const definition = {
    name: 'example/review',
    projectId: 'project-1',
    document: {
      name: 'example/review',
      nodes: [],
      tests: [{ name: 'guard', input: {}, expect: {} }],
    },
    settings: null,
    presentation: null,
    taskContract: null,
  };
  return parsePlatformConfiguration({
    schemaVersion: 1,
    resources: [
      {
        kind: 'automation-schedule',
        config: {
          name: definition.name,
          projectId: definition.projectId,
          cron: '0 */4 * * *',
          timezone: 'UTC',
          enabled: true,
        },
      },
      {
        kind: 'automation-deployment',
        config: {
          name: definition.name,
          projectId: definition.projectId,
          definitionSha256: valueHash(definition),
        },
      },
      { kind: 'automation-definition', config: definition },
      {
        kind: 'project-instructions',
        config: { projectId: 'project-1', instructions: 'Project policy' },
      },
      {
        kind: 'agent-instructions',
        config: {
          projectId: 'project-1',
          agentId: 'agent-1',
          instructions: 'Worker policy',
        },
      },
      {
        kind: 'agent-tools',
        config: {
          projectId: 'project-1',
          agentId: 'agent-1',
          tools: ['task_review', 'task_get', 'task_review'],
        },
      },
      {
        kind: 'task-instructions',
        config: {
          projectId: 'project-1',
          taskId: 'task-1',
          description: 'Role policy',
        },
      },
    ],
  });
}

function native(resources: PlatformResource[]) {
  const state = new Map<string, unknown>(
    resources.map((resource) => [
      resourceId(resource),
      resource.kind.startsWith('automation-') ||
      resource.kind === 'task-review-context'
        ? null
        : {
            ...resource.config,
            ...(resource.kind === 'agent-tools'
              ? { tools: ['task_get'] }
              : 'description' in resource.config
                ? { description: 'before' }
                : { instructions: 'before' }),
          },
    ]),
  );
  const writes: { kind: string; body: Record<string, unknown> }[] = [];
  let loseResponse: string | undefined;
  let versions = 0;
  const client: PlatformConfigurationClient = {
    target: {
      origin: 'https://example.invalid',
      organizationId: 'org-1',
      organizationSlug: 'example',
    },
    request: async (path, method = 'GET', raw) => {
      const body = raw as Record<string, unknown> | undefined;
      const kind =
        method === 'GET'
          ? (new URL(path, 'https://example.invalid').searchParams.get(
              'kind',
            ) ??
            (path.includes('/configuration/review-context')
              ? 'task-review-context'
              : path.endsWith('/configuration/tools')
                ? 'agent-tools'
                : path.startsWith('/api/app/tasks/')
                  ? 'task-instructions'
                  : path.includes('/agents/')
                    ? 'agent-instructions'
                    : 'project-instructions'))
          : ((body?.resource as PlatformResource | undefined)?.kind ??
            (path.includes('/configuration/review-context')
              ? 'task-review-context'
              : path.endsWith('/configuration/tools')
                ? 'agent-tools'
                : path.startsWith('/api/app/tasks/')
                  ? 'task-instructions'
                  : path.includes('/agents/')
                    ? 'agent-instructions'
                    : 'project-instructions'));
      const selected = resources.find((resource) => resource.kind === kind);
      if (!selected) throw new Error('unknown native resource');
      const key = resourceId(selected);
      const current = state.get(key) ?? null;
      if (method === 'GET')
        return {
          config: current,
          hash: current === null ? null : valueHash(current),
        };
      if (
        !body ||
        body.expectedHash !== (current === null ? null : valueHash(current))
      )
        throw new Error('stale native preimage');
      writes.push({ kind: selected.kind, body });
      if (selected.kind === 'automation-schedule') {
        const dependency = resources.find(
          (resource) => resource.kind === 'automation-deployment',
        );
        expect(body.definitionSha256).toBe(
          dependency?.kind === 'automation-deployment'
            ? dependency.config.definitionSha256
            : undefined,
        );
        expect(state.get(resourceId(dependency!))).toEqual(dependency!.config);
      }
      if (selected.kind === 'automation-deployment') {
        const dependency = resources.find(
          (resource) => resource.kind === 'automation-definition',
        );
        expect(valueHash(state.get(resourceId(dependency!)))).toBe(
          selected.config.definitionSha256,
        );
      }
      if (selected.kind === 'automation-definition') versions++;
      state.set(key, structuredClone(selected.config));
      if (loseResponse === selected.kind) {
        loseResponse = undefined;
        throw new Error('response lost after native commit');
      }
      return { ok: true };
    },
  };
  return {
    state,
    client,
    writes,
    get versions() {
      return versions;
    },
    lose(kind: string) {
      loseResponse = kind;
    },
  };
}

describe('managed native configuration', () => {
  test.each([
    'agent-tools',
    'automation-definition',
    'automation-deployment',
    'automation-schedule',
  ])(
    'recovers a lost %s response without duplicate versions, starts or writes',
    async (failedKind) => {
      const config = declaration();
      const api = native(config.resources);
      const directory = await mkdtemp(join(tmpdir(), 'managed-config-'));
      roots.push(directory);
      const receipt = join(directory, 'receipt.json');
      const plan = await planPlatformConfiguration(config, api.client);
      api.lose(failedKind);
      await expect(
        applyPlatformConfiguration(config, plan, api.client, receipt),
      ).rejects.toThrow('Configuration apply stopped');
      expect(JSON.parse(await readFile(receipt, 'utf8')).phase).toBe('pending');
      await applyPlatformConfiguration(config, plan, api.client, receipt);
      expect(api.versions).toBe(1);
      expect(api.writes.map(({ kind }) => kind)).toEqual([
        'project-instructions',
        'agent-instructions',
        'agent-tools',
        'task-instructions',
        'automation-definition',
        'automation-deployment',
        'automation-schedule',
      ]);
      const before = api.writes.length;
      const result = await applyPlatformConfiguration(
        config,
        plan,
        api.client,
        receipt,
      );
      expect(result.unchanged).toBe(true);
      expect(api.writes).toHaveLength(before);
      for (const { body } of api.writes.filter(
        ({ kind }) => kind.endsWith('instructions') || kind === 'agent-tools',
      )) {
        expect(Object.keys(body).sort()).toEqual(['config', 'expectedHash']);
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('secrets');
      }
    },
  );

  test('refuses an unrelated native edit before any resource is written', async () => {
    const config = declaration();
    const api = native(config.resources);
    const plan = await planPlatformConfiguration(config, api.client);
    const role = config.resources.find(
      (resource) => resource.kind === 'task-instructions',
    )!;
    api.state.set(resourceId(role), {
      ...role.config,
      description: 'a concurrent edit',
    });
    const directory = await mkdtemp(join(tmpdir(), 'managed-config-'));
    roots.push(directory);
    await expect(
      applyPlatformConfiguration(
        config,
        plan,
        api.client,
        join(directory, 'receipt.json'),
      ),
    ).rejects.toThrow('changed since planning');
    expect(api.writes).toHaveLength(0);
  });

  test('rejects missing or changed definition prerequisites and duplicate project ownership', () => {
    const config = declaration();
    expect(() =>
      parsePlatformConfiguration({
        ...config,
        resources: config.resources.filter(
          (resource) => resource.kind !== 'automation-definition',
        ),
      }),
    ).toThrow();
    expect(() =>
      parsePlatformConfiguration({
        ...config,
        resources: config.resources.map((resource) =>
          resource.kind === 'automation-deployment'
            ? {
                ...resource,
                config: {
                  ...resource.config,
                  definitionSha256: 'a'.repeat(64),
                },
              }
            : resource,
        ),
      }),
    ).toThrow();
    const definition = config.resources.find(
      (resource) => resource.kind === 'automation-definition',
    )!;
    expect(() =>
      parsePlatformConfiguration({
        ...config,
        resources: [
          ...config.resources,
          {
            ...definition,
            config: { ...definition.config, projectId: 'another-project' },
          },
        ],
      }),
    ).toThrow();
  });
});

test('native and CLI value identity agree for JSON strings, numeric keys and nested arrays', () => {
  for (const value of [
    '',
    ' café 😺 ',
    { '10': 1, '2': ['x', { z: true, a: null }], '1': { '20': 2, '3': 3 } },
  ])
    expect(managedConfigurationHash(value)).toBe(valueHash(value));
});

test('adopts a legacy agent text preimage without silently trimming its native hash', async () => {
  const config = {
    projectId: 'project-1',
    agentId: 'agent-1',
    instructions: '  legacy instructions  ',
  };
  const client = {
    request: async () => ({ config, hash: valueHash(config) }),
  } as unknown as PlatformConfigurationClient;
  const result = await readManagedResource(client, {
    kind: 'agent-instructions',
    config: { ...config, instructions: 'new instructions' },
  });
  expect(result).toEqual({ config, revision: valueHash(config) });
});

test('CLI cache inputs include both native JSON identity modules used by the parity proof', async () => {
  const turbo: unknown = JSON.parse(
    await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'),
  );
  expect(turbo).toMatchObject({
    tasks: {
      test: {
        inputs: expect.arrayContaining([
          '$TURBO_ROOT$/services/platform/backend/core/lib/config_store/value_hash.ts',
          '$TURBO_ROOT$/services/platform/lib/shared/utils/stable-stringify.ts',
        ]),
      },
    },
  });
});

describe('managed tool preimages', () => {
  const resource = {
    kind: 'agent-tools' as const,
    config: {
      projectId: 'project-1',
      agentId: 'agent-1',
      tools: ['task_get', 'task_review'],
    },
  };

  test('canonical grant sets have one source identity and hash', () => {
    const parsed = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        {
          ...resource,
          config: {
            ...resource.config,
            tools: ['task_review', 'task_get', 'task_review'],
          },
        },
      ],
    });
    expect(parsed.resources).toEqual([resource]);
    expect(resourceId(resource)).toBe('agent-tools/project-1/agent-1');
    const nativeHash = managedConfigurationHash(resource.config);
    if (nativeHash === null) throw new Error('Expected an existing resource');
    expect(valueHash(parsed.resources[0]!.config)).toBe(nativeHash);
    expect(() =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [resource, resource],
      }),
    ).toThrow();
  });

  test.each([
    { ...resource.config, projectId: 'other-project' },
    { ...resource.config, agentId: 'other-agent' },
    { ...resource.config, tools: ['future_unknown_grant'] },
    { ...resource.config, tools: ['task_review', 'task_get'] },
    { ...resource.config, secrets: ['PRIVATE_TOKEN'] },
    null,
  ])(
    'rejects inconsistent, noncanonical or unowned native readback: %j',
    async (config) => {
      const client = {
        request: async () => ({
          config,
          hash: config === null ? null : valueHash(config),
        }),
      } as unknown as PlatformConfigurationClient;
      await expect(readManagedResource(client, resource)).rejects.toThrow();
    },
  );

  test('refuses a tool edit after planning before any source resource is written', async () => {
    const configuration = declaration();
    const api = native(configuration.resources);
    const plan = await planPlatformConfiguration(configuration, api.client);
    api.state.set(resourceId(resource), {
      ...resource.config,
      tools: ['task_find', 'task_get'],
    });
    const directory = await mkdtemp(join(tmpdir(), 'managed-tools-'));
    roots.push(directory);
    await expect(
      applyPlatformConfiguration(
        configuration,
        plan,
        api.client,
        join(directory, 'receipt.json'),
      ),
    ).rejects.toThrow('changed since planning');
    expect(api.writes).toEqual([]);
  });

  test('fails closed when the selected runtime lacks the native tools facet', async () => {
    const configuration = declaration();
    const api = native(configuration.resources);
    const supported = api.client.request;
    api.client.request = async (...args) => {
      if (args[0].endsWith('/configuration/tools'))
        throw new Error('404 unsupported native configuration facet');
      return supported(...args);
    };
    await expect(
      planPlatformConfiguration(configuration, api.client),
    ).rejects.toThrow('unsupported native configuration facet');
    expect(api.writes).toEqual([]);
  });

  test('rejects a native hash that does not describe the returned tools', async () => {
    const client = {
      request: async () => ({ config: resource.config, hash: '0'.repeat(64) }),
    } as unknown as PlatformConfigurationClient;
    await expect(readManagedResource(client, resource)).rejects.toThrow(
      'native identity or hash',
    );
  });
});

test('carries a schedule’s slot-wake opt-in through plan, apply and an unchanged re-apply (#4540)', async () => {
  const config = declaration();
  const schedule = config.resources.find(
    (resource) => resource.kind === 'automation-schedule',
  );
  if (schedule?.kind !== 'automation-schedule')
    throw new Error('the fixture declares no schedule');
  schedule.config.wakeOnSlotFreed = true;
  const api = native(config.resources);
  const directory = await mkdtemp(join(tmpdir(), 'managed-config-'));
  roots.push(directory);
  const receipt = join(directory, 'receipt.json');
  const plan = await planPlatformConfiguration(config, api.client);
  await applyPlatformConfiguration(config, plan, api.client, receipt);
  const written = api.writes.find(({ kind }) => kind === 'automation-schedule');
  expect(JSON.stringify(written?.body)).toContain('"wakeOnSlotFreed":true');
  const before = api.writes.length;
  const again = await applyPlatformConfiguration(
    config,
    plan,
    api.client,
    receipt,
  );
  expect(again.unchanged).toBe(true);
  expect(api.writes).toHaveLength(before);
});

describe('managed review context adoption', () => {
  const resource = {
    kind: 'task-review-context' as const,
    config: {
      projectId: 'project-1',
      taskId: 'context-1',
      reviewerAgentId: 'reviewer-1',
      enabled: true,
    },
  };

  test('enrolls an absent context through native CAS and reconciles a lost response without duplicate writes', async () => {
    const config = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [resource],
    });
    const api = native(config.resources);
    const directory = await mkdtemp(join(tmpdir(), 'managed-review-context-'));
    roots.push(directory);
    const receipt = join(directory, 'receipt.json');
    const plan = await planPlatformConfiguration(config, api.client);
    api.lose(resource.kind);
    await expect(
      applyPlatformConfiguration(config, plan, api.client, receipt),
    ).rejects.toThrow('Configuration apply stopped');
    await applyPlatformConfiguration(config, plan, api.client, receipt);
    expect(api.writes).toHaveLength(1);
    expect(api.writes[0]).toEqual({
      kind: resource.kind,
      body: { config: resource.config, expectedHash: null },
    });
    expect(resourceId(resource)).toBe(
      'task-review-context/project-1/context-1',
    );
  });

  test.each([
    { ...resource.config, projectId: 'other' },
    { ...resource.config, taskId: 'other' },
    { ...resource.config, reviewerAgentId: 'other' },
    { ...resource.config, purpose: 'implementation' },
  ])('refuses inconsistent or retargeted identity: %j', async (config) => {
    const client = {
      request: async () => ({ config, hash: valueHash(config) }),
    } as unknown as PlatformConfigurationClient;
    await expect(readManagedResource(client, resource)).rejects.toThrow();
  });

  test('requires native support and never turns an unavailable facet into absent enrollment', async () => {
    const api = native([resource]);
    api.client.request = async () => {
      throw new Error('404 unsupported native configuration facet');
    };
    await expect(
      planPlatformConfiguration(
        parsePlatformConfiguration({ schemaVersion: 1, resources: [resource] }),
        api.client,
      ),
    ).rejects.toThrow('unsupported native configuration facet');
    expect(api.writes).toEqual([]);
  });
});
