import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resourceId,
  type PlatformResource,
} from '@tale/shared/config/platform-resources';
import type { ManagedProjectDispatch } from '@tale/shared/schemas/managed-configuration';

import { managedConfigurationHash } from '../../../../../services/platform/backend/core/lib/config_store/value_hash';
import { CliError } from '../../utils/fail';
import { readManagedResource } from './managed-resources';
import {
  applyPlatformConfiguration,
  planPlatformConfiguration,
} from './platform-apply';
import type { PlatformConfigurationClient } from './platform-client';
import { parsePlatformConfiguration } from './platform-model';
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
        kind: 'agent-model',
        config: {
          projectId: 'project-1',
          agentId: 'agent-1',
          harness: 'codex',
          model: 'next-model',
          modelProvider: 'example',
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

/** The facet a managed request addresses, by its native path: the automation
 * routes name their kind, every other facet has a path of its own. */
function facetOf(path: string): string {
  if (path.includes('/dispatch/by-project/')) return 'project-dispatch';
  if (path.includes('/configuration/review-context'))
    return 'task-review-context';
  if (path.endsWith('/configuration/model')) return 'agent-model';
  if (path.endsWith('/configuration/tools')) return 'agent-tools';
  if (path.startsWith('/api/app/tasks/')) return 'task-instructions';
  if (path.includes('/agents/')) return 'agent-instructions';
  return 'project-instructions';
}

function native(resources: PlatformResource[]) {
  const state = new Map<string, unknown>(
    resources.map((resource) => [
      resourceId(resource),
      resource.kind.startsWith('automation-') ||
      resource.kind === 'task-review-context' ||
      resource.kind === 'project-dispatch'
        ? null
        : {
            ...resource.config,
            ...(resource.kind === 'agent-model'
              ? { model: 'before-model', modelProvider: null }
              : resource.kind === 'agent-tools'
                ? { tools: ['task_get'] }
                : 'description' in resource.config
                  ? { description: 'before' }
                  : { instructions: 'before' }),
          },
    ]),
  );
  const writes: { kind: string; body: Record<string, unknown> }[] = [];
  const checks: string[] = [];
  let refusal: { path: string; message: string }[] | undefined;
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
            ) ?? facetOf(path))
          : ((body?.resource as PlatformResource | undefined)?.kind ??
            facetOf(path));
      const selected = resources.find(
        (resource) =>
          resource.kind === kind &&
          ('agentId' in resource.config
            ? path.includes(
                `/agents/${encodeURIComponent(resource.config.agentId)}/`,
              )
            : 'taskId' in resource.config
              ? path.includes(
                  `/tasks/${encodeURIComponent(resource.config.taskId)}/`,
                )
              : resource.kind === 'project-dispatch'
                ? path.includes(
                    `/by-project/${encodeURIComponent(resource.config.projectId)}/`,
                  )
                : true),
      );
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
      // The platform's check of a dispatch save: its verdict, nothing kept.
      if (path.endsWith('/configuration/check')) {
        checks.push(key);
        return refusal === undefined
          ? { ok: true, changed: true, hash: valueHash(selected.config) }
          : { ok: false, issues: refusal };
      }
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
    checks,
    get versions() {
      return versions;
    },
    lose(kind: string) {
      loseResponse = kind;
    },
    /** Make the platform refuse every dispatch it is asked about. */
    refuse(issues: { path: string; message: string }[]) {
      refusal = issues;
    },
  };
}

describe('managed native configuration', () => {
  test.each([
    'agent-tools',
    'agent-model',
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
        'agent-model',
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
        ({ kind }) =>
          kind.endsWith('instructions') ||
          kind === 'agent-tools' ||
          kind === 'agent-model',
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

  test('explicit creation survives planning and lost-response reconciliation without a second POST', async () => {
    const creation = {
      ...resource,
      createIfMissing: true as const,
      config: {
        ...resource.config,
        taskId: '2045dc63-4934-40fc-89f8-f66b82a30152',
      },
    };
    const config = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [creation],
    });
    const api = native(config.resources);
    const requests: { path: string; method?: string }[] = [];
    const request = api.client.request.bind(api.client);
    api.client.request = async (path, method, body) => {
      requests.push({ path, method });
      return request(path, method, body);
    };
    const directory = await mkdtemp(
      join(tmpdir(), 'managed-review-bootstrap-'),
    );
    roots.push(directory);
    const receipt = join(directory, 'receipt.json');
    const plan = await planPlatformConfiguration(config, api.client);
    expect(requests[0]?.path).toEndWith('&createIfMissing=true');
    api.lose(creation.kind);
    await expect(
      applyPlatformConfiguration(config, plan, api.client, receipt),
    ).rejects.toThrow('Configuration apply stopped');
    await applyPlatformConfiguration(config, plan, api.client, receipt);
    expect(api.writes).toEqual([
      {
        kind: creation.kind,
        body: {
          config: creation.config,
          expectedHash: null,
          createIfMissing: true,
        },
      },
    ]);
    expect(
      requests.find((entry) => entry.method === 'POST')?.path,
    ).not.toContain('createIfMissing');
    expect(
      (await planPlatformConfiguration(config, api.client)).resources.every(
        (change) => change.action === 'unchanged',
      ),
    ).toBe(true);
  });

  test('plans the complete 107-resource fleet inventory with 19 stable creation identities', async () => {
    const existing = Array.from({ length: 68 }, (_, index) => ({
      kind: 'agent-instructions',
      config: {
        projectId: 'project-1',
        agentId: `existing-${index}`,
        instructions: 'Existing role',
      },
    }));
    const models = Array.from({ length: 20 }, (_, index) => ({
      kind: 'agent-model',
      config: {
        projectId: 'project-1',
        agentId: `worker-${index}`,
        harness: index < 6 ? 'claude-code' : 'codex',
        model: index < 6 ? 'claude-opus-5-5' : 'gpt-6.1-sol',
        modelProvider: index < 6 ? 'anthropic' : 'openai',
      },
    }));
    const contexts = Array.from({ length: 19 }, (_, index) => ({
      ...resource,
      createIfMissing: true as const,
      config: {
        ...resource.config,
        taskId: `2045dc63-4934-40fc-89f8-${String(index).padStart(12, '0')}`,
        reviewerAgentId: `worker-${index + 1}`,
      },
    }));
    const config = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [...existing, ...models, ...contexts],
    });
    const api = native(config.resources);
    const plan = await planPlatformConfiguration(config, api.client);
    expect(plan.resources).toHaveLength(107);
    expect(new Set(plan.resources.map((change) => change.id)).size).toBe(107);
    expect(
      config.resources.filter(
        (entry) =>
          entry.kind === 'task-review-context' &&
          entry.createIfMissing === true,
      ),
    ).toHaveLength(19);
    expect(api.writes).toEqual([]);
  });

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

describe('managed model preimages', () => {
  const resource = {
    kind: 'agent-model' as const,
    config: {
      projectId: 'project-1',
      agentId: 'agent-1',
      harness: 'codex',
      model: 'next-model',
      modelProvider: 'example',
    },
  };
  test.each([null, ' legacy-provider '])(
    'preserves raw legacy provider %j and model bytes for native CAS',
    async (modelProvider) => {
      const config = {
        ...resource.config,
        model: ' legacy-model ',
        modelProvider,
      };
      const client = {
        request: async () => ({ config, hash: valueHash(config) }),
      } as unknown as PlatformConfigurationClient;
      expect(await readManagedResource(client, resource)).toEqual({
        config,
        revision: valueHash(config),
      });
      expect(resourceId(resource)).toBe('agent-model/project-1/agent-1');
    },
  );
  test.each([
    { ...resource.config, projectId: 'other' },
    { ...resource.config, agentId: 'other' },
    { ...resource.config, harness: '' },
    { ...resource.config, secrets: ['PRIVATE_TOKEN'] },
    null,
  ])(
    'refuses another identity, malformed or widened model readback %j',
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
  test('refuses a substituted model hash', async () => {
    const client = {
      request: async () => ({ config: resource.config, hash: '0'.repeat(64) }),
    } as unknown as PlatformConfigurationClient;
    await expect(readManagedResource(client, resource)).rejects.toThrow(
      'native identity or hash',
    );
  });
  test('refuses a changed serving tuple before any planned writes', async () => {
    const configuration = declaration();
    const api = native(configuration.resources);
    const plan = await planPlatformConfiguration(configuration, api.client);
    api.state.set(resourceId(resource), {
      ...resource.config,
      model: 'concurrent-model',
    });
    const directory = await mkdtemp(join(tmpdir(), 'managed-model-'));
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
  test('fails closed on an older runtime without model adoption', async () => {
    const configuration = declaration();
    const api = native(configuration.resources);
    const supported = api.client.request;
    api.client.request = async (...args) => {
      if (args[0].endsWith('/configuration/model'))
        throw new Error('404 unsupported native model facet');
      return supported(...args);
    };
    await expect(
      planPlatformConfiguration(configuration, api.client),
    ).rejects.toThrow('unsupported native model facet');
    expect(api.writes).toEqual([]);
  });
});

describe('managed project dispatch', () => {
  const dispatch = {
    projectId: 'project-1',
    enabled: true,
    agents: ['agent-1'],
    maxConcurrentRuns: 3,
    statuses: ['todo', 'backlog'],
    assignment: 'pool',
    admission: { preset: 'conservative', recheckSeconds: [60, 120, 240] },
    standingRoles: [
      {
        key: 'manager',
        taskId: 'task-1',
        agentId: 'agent-1',
        cron: '0,30 * * * *',
        // Node and Bun spell this alias differently; the dispatch keeps it.
        timezone: 'Etc/UTC',
        mode: 'light',
      },
    ],
    labels: { include: ['ci', 'docs'], exclude: ['blocked'] },
    // A gate is declared with the rest of the document; what is reported on
    // it is runtime state the configuration never holds.
    gates: [
      {
        key: 'ci',
        labels: ['ci'],
        holdAt: 20,
        recoverBelow: 10,
        staleAfterSeconds: 900,
        whenStale: 'hold',
        startSpacingSeconds: 300,
      },
      { key: 'freeze' },
    ],
  } satisfies ManagedProjectDispatch;
  const id = 'project-dispatch/project-1';

  function declared(config: object = dispatch) {
    const [resource] = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [{ kind: 'project-dispatch', config }],
    }).resources;
    if (resource?.kind !== 'project-dispatch')
      throw new Error('the declaration holds no dispatch');
    return resource;
  }

  /** The fixture fleet with a dispatch listed first, to prove apply order. */
  function withDispatch() {
    return parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        { kind: 'project-dispatch', config: dispatch },
        ...declaration().resources,
      ],
    });
  }

  async function receipt() {
    const directory = await mkdtemp(join(tmpdir(), 'managed-dispatch-'));
    roots.push(directory);
    return join(directory, 'receipt.json');
  }

  test('hashes as the platform hashes the dispatch it stores, and keeps one per project', () => {
    const resource = declared();
    expect(resource.config).toEqual(dispatch);
    expect(resourceId(resource)).toBe(id);
    // The platform stores the document without its project, and reads it
    // back as `{ projectId, ...document }` after a JSON round trip.
    const { projectId, ...document } = dispatch;
    const readback: unknown = JSON.parse(
      JSON.stringify({ ...document, projectId }),
    );
    expect(valueHash(resource.config)).toBe(
      managedConfigurationHash(readback) ?? '',
    );
    expect(() =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          { kind: 'project-dispatch', config: dispatch },
          { kind: 'project-dispatch', config: { ...dispatch, enabled: false } },
        ],
      }),
    ).toThrow();
    expect(
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          { kind: 'project-dispatch', config: dispatch },
          {
            kind: 'project-dispatch',
            config: { ...dispatch, projectId: 'project-2' },
          },
        ],
      }).resources.map(resourceId),
    ).toEqual([id, 'project-dispatch/project-2']);
  });

  test('creates a dispatch the project lacks after everything it names, then re-applies unchanged', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const paths: string[] = [];
    const request = api.client.request.bind(api.client);
    api.client.request = async (path, method, body) => {
      if (path.includes('/dispatch/')) paths.push(`${method ?? 'GET'} ${path}`);
      return request(path, method, body);
    };
    const plan = await planPlatformConfiguration(config, api.client);
    expect(plan.resources.at(-1)).toEqual({
      id,
      scope: 'organization',
      currentSha256: valueHash(null),
      desiredSha256: valueHash(dispatch),
      revision: null,
      action: 'create',
      effects: [],
    });
    const path = join(await receipt());
    await applyPlatformConfiguration(config, plan, api.client, path);
    expect(api.writes.map(({ kind }) => kind)).toEqual([
      'project-instructions',
      'agent-instructions',
      'agent-tools',
      'agent-model',
      'task-instructions',
      'automation-definition',
      'automation-deployment',
      'automation-schedule',
      'project-dispatch',
    ]);
    expect(api.writes.at(-1)?.body).toEqual({
      config: dispatch,
      expectedHash: null,
    });
    expect(new Set(paths)).toEqual(
      new Set([
        'GET /api/app/tasks/dispatch/by-project/project-1/configuration',
        'POST /api/app/tasks/dispatch/by-project/project-1/configuration/check',
        'POST /api/app/tasks/dispatch/by-project/project-1/configuration',
      ]),
    );
    const before = api.writes.length;
    const again = await applyPlatformConfiguration(
      config,
      plan,
      api.client,
      path,
    );
    expect(again.unchanged).toBe(true);
    expect(api.writes).toHaveLength(before);
    expect(
      (await planPlatformConfiguration(config, api.client)).resources.every(
        (change) => change.action === 'unchanged',
      ),
    ).toBe(true);
  });

  test('switches a dispatch off, and creates one switched off rather than reading none as off', async () => {
    const off = { ...dispatch, enabled: false };
    const configuration = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [{ kind: 'project-dispatch', config: off }],
    });
    const running = native(configuration.resources);
    running.state.set(id, structuredClone(dispatch));
    const update = await planPlatformConfiguration(
      configuration,
      running.client,
    );
    expect(update.resources).toMatchObject([
      { id, action: 'update', revision: valueHash(dispatch) },
    ]);
    await applyPlatformConfiguration(
      configuration,
      update,
      running.client,
      await receipt(),
    );
    expect(running.writes).toEqual([
      {
        kind: 'project-dispatch',
        body: { config: off, expectedHash: valueHash(dispatch) },
      },
    ]);
    expect(running.state.get(id)).toEqual(off);

    const fresh = native(configuration.resources);
    const create = await planPlatformConfiguration(configuration, fresh.client);
    expect(create.resources).toMatchObject([
      { id, action: 'create', revision: null },
    ]);
    await applyPlatformConfiguration(
      configuration,
      create,
      fresh.client,
      await receipt(),
    );
    expect(fresh.writes).toEqual([
      { kind: 'project-dispatch', body: { config: off, expectedHash: null } },
    ]);
  });

  test('reads a stored dispatch whose agent holds more runs than the pool, and corrects it', async () => {
    // Saved before a write had to keep runs per agent within the pool.
    const stored = {
      ...dispatch,
      maxConcurrentRuns: 2,
      perAgentConcurrency: 5,
    };
    expect(() => declared(stored)).toThrow();
    const fixed = {
      ...dispatch,
      maxConcurrentRuns: 256,
      perAgentConcurrency: 256,
    };
    const configuration = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [{ kind: 'project-dispatch', config: fixed }],
    });
    const api = native(configuration.resources);
    api.state.set(id, structuredClone(stored));
    expect(
      await readManagedResource(api.client, declared(fixed)),
    ).toMatchObject({ config: stored, revision: valueHash(stored) });
    const plan = await planPlatformConfiguration(configuration, api.client);
    expect(plan.resources).toMatchObject([
      { id, action: 'update', revision: valueHash(stored) },
    ]);
    await applyPlatformConfiguration(
      configuration,
      plan,
      api.client,
      await receipt(),
    );
    expect(api.writes).toEqual([
      {
        kind: 'project-dispatch',
        body: { config: fixed, expectedHash: valueHash(stored) },
      },
    ]);
  });

  test('reconciles a lost response without writing the dispatch twice', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const path = await receipt();
    const plan = await planPlatformConfiguration(config, api.client);
    api.lose('project-dispatch');
    await expect(
      applyPlatformConfiguration(config, plan, api.client, path),
    ).rejects.toThrow(`Configuration apply stopped at ${id}`);
    expect(JSON.parse(await readFile(path, 'utf8')).phase).toBe('pending');
    await applyPlatformConfiguration(config, plan, api.client, path);
    expect(
      api.writes.filter(({ kind }) => kind === 'project-dispatch'),
    ).toHaveLength(1);
    expect(JSON.parse(await readFile(path, 'utf8')).phase).toBe('ready');
  });

  test('asks the platform about a changed dispatch while planning, and plans nothing it refuses', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    api.refuse([
      {
        path: 'gates.0.labels.0',
        message: 'No label named "ci" is in this project.',
      },
    ]);
    const planning = planPlatformConfiguration(config, api.client);
    await expect(planning).rejects.toThrow(
      'The platform refuses the dispatch declared for project project-1 at gates.0.labels.0.',
    );
    expect(api.checks).toEqual([id]);
    expect(api.writes).toEqual([]);
  });

  test('stops a declaration whose dispatch serves a board the key may not edit, before anything is written', async () => {
    const config = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        {
          kind: 'project-dispatch',
          config: {
            ...dispatch,
            sources: [{ projectId: 'project-2' }],
            reviewers: ['agent-1'],
          },
        },
        ...declaration().resources,
      ],
    });
    const api = native(config.resources);
    api.refuse([
      {
        path: 'sources.0.projectId',
        message:
          'Serving that project’s board needs the right to edit it, which you do not have.',
      },
    ]);
    const planning = planPlatformConfiguration(config, api.client);
    await expect(planning).rejects.toThrow(
      'The platform refuses the dispatch declared for project project-1 at sources.0.projectId.',
    );
    const error: unknown = await planning.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CliError);
    expect(String((error as CliError).info.next)).toContain(
      'the right to edit every project the dispatch serves',
    );
    expect(api.writes).toEqual([]);
  });

  test('writes nothing of a declaration whose dispatch the platform refuses at apply', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const plan = await planPlatformConfiguration(config, api.client);
    // Between plan and apply the project loses a label the gate names: the
    // dispatch is written last, so the schedules switched off before it
    // must not be written either.
    api.refuse([
      {
        path: 'gates.0.labels.0',
        message: 'No label named "ci" is in this project.',
      },
    ]);
    const path = await receipt();
    await expect(
      applyPlatformConfiguration(config, plan, api.client, path),
    ).rejects.toThrow('at gates.0.labels.0');
    expect(api.writes).toEqual([]);
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  test('names only the fields the platform refuses, never its words', async () => {
    const api = native([declared()]);
    api.refuse([
      { path: 'standingRoles.0.taskId', message: 'secret-looking words' },
      { path: 'agents.0', message: 'No agent with the id "agent-1".' },
      { path: 'agents.0', message: 'the same field twice' },
      { path: 'gates; rm -rf /', message: 'not a field' },
    ]);
    const planning = planPlatformConfiguration(
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [{ kind: 'project-dispatch', config: dispatch }],
      }),
      api.client,
    );
    await expect(planning).rejects.toThrow(
      'The platform refuses the dispatch declared for project project-1 at standingRoles.0.taskId, agents.0.',
    );
    const error: unknown = await planning.catch((caught: unknown) => caught);
    expect(String(error)).not.toContain('secret-looking words');
    expect(String(error)).not.toContain('rm -rf');
  });

  test('applies a dispatch again, unchanged, while it skips a board only this key could serve again [TASK-R72]', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    await applyPlatformConfiguration(
      config,
      await planPlatformConfiguration(config, api.client),
      api.client,
      await receipt(),
    );
    // Whoever saved the dispatch last lost the right to a board it serves,
    // and this key has it: the platform says saving it again serves it.
    let skipped = true;
    const request = api.client.request.bind(api.client);
    api.client.request = async (path, method, body) => {
      const answer = await request(path, method, body);
      if (path.endsWith('/dispatch/by-project/project-1/configuration')) {
        if (method === 'POST') skipped = false;
        else if (skipped) return { ...(answer as object), servesAgain: true };
      }
      return answer;
    };
    const before = api.writes.length;
    const plan = await planPlatformConfiguration(config, api.client);
    expect(plan.resources.find((change) => change.id === id)).toMatchObject({
      action: 'update',
      currentSha256: valueHash(dispatch),
      desiredSha256: valueHash(dispatch),
    });
    await applyPlatformConfiguration(config, plan, api.client, await receipt());
    expect(api.writes.slice(before)).toEqual([
      expect.objectContaining({
        kind: 'project-dispatch',
        body: expect.objectContaining({ config: dispatch }),
      }),
    ]);
    expect(
      (await planPlatformConfiguration(config, api.client)).resources.every(
        (change) => change.action === 'unchanged',
      ),
    ).toBe(true);
  });

  test('never asks about a dispatch that is already as declared', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const plan = await planPlatformConfiguration(config, api.client);
    await applyPlatformConfiguration(config, plan, api.client, await receipt());
    const asked = api.checks.length;
    api.refuse([{ path: 'agents.0', message: 'refused' }]);
    const again = await planPlatformConfiguration(config, api.client);
    expect(
      again.resources.every((change) => change.action === 'unchanged'),
    ).toBe(true);
    expect(api.checks).toHaveLength(asked);
  });

  test('refuses a dispatch edited after planning before any resource is written', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const plan = await planPlatformConfiguration(config, api.client);
    api.state.set(id, { ...dispatch, maxConcurrentRuns: 9 });
    await expect(
      applyPlatformConfiguration(config, plan, api.client, await receipt()),
    ).rejects.toThrow('changed since planning');
    expect(api.writes).toEqual([]);
  });

  test.each([
    { ...dispatch, projectId: 'project-2' },
    { ...dispatch, pool: ['agent-1'] },
    { ...dispatch, maxConcurrentRuns: 0 },
    { ...dispatch, gates: [{ key: 'ci', held: true, value: 23 }] },
  ])(
    'refuses a readback for another project or in a shape it does not know: %j',
    async (config) => {
      const client = {
        request: async () => ({ config, hash: valueHash(config) }),
      } as unknown as PlatformConfigurationClient;
      await expect(readManagedResource(client, declared())).rejects.toThrow();
    },
  );

  test.each([
    { state: 'hold' },
    { held: true },
    { value: 23 },
    { reason: 'runner queue full' },
    { reportedAt: 1_760_000_000_000 },
  ])(
    'never declares what is reported on a gate, only the gate: %j',
    (reported) => {
      const [gate, ...rest] = dispatch.gates;
      expect(() =>
        declared({ ...dispatch, gates: [{ ...gate, ...reported }, ...rest] }),
      ).toThrow();
    },
  );

  test('refuses a hash that does not describe the dispatch, or a hash without one', async () => {
    for (const [view, message] of [
      [{ config: dispatch, hash: '0'.repeat(64) }, 'native identity or hash'],
      [{ config: null, hash: valueHash(dispatch) }, 'missing or inconsistent'],
    ] as const) {
      const client = {
        request: async () => view,
      } as unknown as PlatformConfigurationClient;
      await expect(readManagedResource(client, declared())).rejects.toThrow(
        message,
      );
    }
  });

  test('fails closed on a runtime without the dispatch facet', async () => {
    const config = withDispatch();
    const api = native(config.resources);
    const supported = api.client.request;
    api.client.request = async (...args) => {
      if (args[0].includes('/dispatch/by-project/'))
        throw new Error('404 unsupported native dispatch facet');
      return supported(...args);
    };
    await expect(planPlatformConfiguration(config, api.client)).rejects.toThrow(
      'unsupported native dispatch facet',
    );
    expect(api.writes).toEqual([]);
  });
});
