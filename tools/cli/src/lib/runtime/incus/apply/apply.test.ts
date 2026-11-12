import { afterEach, describe, expect, test } from 'bun:test';

import { incusPlanSchema, type IncusPlan } from '../plan/plan-model';
import {
  applyIncusPlan,
  startStackInstance,
  stopStackInstance,
  writeStackRecord,
  type ApplyHooks,
} from './apply';
import {
  clientOf,
  converge,
  desiredOf,
  FIXED_NOW,
  goldenTarget,
  planned,
  recordingHooks,
  renderedFiles,
  stackIncus,
  stateRootFixture,
  testKey,
  withNewImage,
} from './apply-fixture';
import {
  assertNoRestorePending,
  clearRestorePending,
  forgetPayload,
  installInterruptJournal,
  readJournal,
  recordPayload,
  restorePendingNotice,
  setRestorePending,
  updateJournal,
  type RestoreGuardedVerb,
} from './journal';
import { readStackRecord } from './readback';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const fake = stackIncus();
  const client = clientOf(fake);
  const hooks = recordingHooks(fake, client);
  const state = stateRootFixture();
  cleanups.push(state.remove, () => fake.close());
  return { fake, client, hooks, root: state.root };
}

const managed = () => desiredOf(goldenTarget('managed-compose'));

async function apply(
  context: ReturnType<typeof setup>,
  desired: ReturnType<typeof managed>,
  made: IncusPlan,
  stop = false,
  hooks: ApplyHooks = context.hooks,
) {
  return applyIncusPlan({
    client: context.client,
    stateRoot: context.root,
    desired,
    plan: made,
    hooks,
    options: { stop, now: FIXED_NOW },
  });
}

describe('a first deploy', () => {
  test('converges the whole stack, health-gated tier by tier, and records it', async () => {
    const context = setup();
    const desired = managed();
    const { plan: made } = await converge(
      context.client,
      context.hooks,
      context.root,
      desired,
    );
    const { fake } = context;
    expect(fake.names()).toEqual(
      desired.target.instances.map((spec) => spec.name).sort(),
    );
    for (const instance of fake.instances.values()) {
      expect(instance.status).toBe('Running');
      expect(instance.config['user.tale.want']).toBe('running');
      expect(instance.config['user.tale.config']).toBe(
        made.resources.find((item) => item.id === `instance/${instance.name}`)
          ?.desiredSha256 ?? 'missing',
      );
      expect(instance.ephemeral).toBe(false);
      expect(instance.profiles).toEqual(['tale-stack']);
    }
    // Volumes carry the stack's labels and are shifted.
    expect(fake.volumes.get('db-data')?.config).toMatchObject({
      'security.shifted': 'true',
      'user.tale.stack': 'tale',
      'user.tale.kind': 'data',
      size: '50GiB',
      'snapshots.expiry': '14d',
    });
    expect(fake.volumes.get('names-config')?.config['user.tale.kind']).toBe(
      'runtime',
    );
    // Resolver records by generation; the switch's lists beside it.
    const names = fake.volumes.get('names-config')?.files;
    expect([...(names?.keys() ?? [])]).toContain('/stack/hosts/records.1');
    expect(
      fake.volumes.get('switch-config')?.files?.get('/platform.upstreams')
        ?.content,
    ).toStartWith('to 10.30.2.64:3000 10.30.2.65:3000 ');

    // A dependency was healthy before its dependant was made.
    const order = fake.requests
      .filter(
        (request) =>
          request.method === 'POST' && request.path === '/1.0/instances',
      )
      .map((request) => (request.body as { name: string }).name);
    const healthy = context.hooks.calls
      .filter((call) => call.hook === 'waitHealthy')
      .map((call) => call.name);
    expect(order.indexOf('sandbox')).toBeGreaterThan(
      order.indexOf('sandbox-egress'),
    );
    expect(healthy).toContain('sandbox-egress');
    expect(order.at(-1)).toBe('switch');
    expect(
      context.hooks.calls.every(
        (call) => call.hook !== 'waitHealthy' || call.status === 'Running',
      ),
    ).toBe(true);

    expect(await readStackRecord(context.client, 'tale', 'tale')).toEqual({
      schemaVersion: 1,
      stack: 'tale',
      deployedAt: FIXED_NOW().toISOString(),
    });
    const journal = await readJournal(context.root);
    expect(journal?.phase).toBe('ready');
    expect(journal?.steps.length).toBe(
      made.resources.filter((item) => item.action !== 'unchanged').length,
    );

    // The second plan is empty.
    const again = await planned(context.client, desired);
    expect(
      again.plan.resources.every((item) => item.action === 'unchanged'),
    ).toBe(true);
  });

  test('applying the same plan twice adopts what the first wrote', async () => {
    const context = setup();
    const desired = managed();
    const { plan: made } = await planned(context.client, desired);
    await apply(context, desired, made);
    const writes = context.fake.requests.length;
    const receipt = await apply(context, desired, made);
    expect(receipt.changed).toEqual([]);
    expect(receipt.adopted.length).toBeGreaterThan(0);
    const mutations = context.fake.requests
      .slice(writes)
      .filter((request) => !['GET', 'HEAD'].includes(request.method));
    expect(mutations.map((request) => request.path)).toEqual([]);
  });
});

describe('a release upgrade', () => {
  test('replaces what changed: withdraws, drains, stops, and retires old records', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const before = context.fake.instances.get('db')?.createdAt;
    const target = withNewImage(
      desired.target,
      'tale-platform',
      '9'.repeat(64),
    );
    target.instances = target.instances.filter(
      (spec) => spec.name !== 'bgutil-provider',
    );
    const next = desiredOf(target, testKey(), renderedFiles(target, 'v2'));
    context.hooks.calls.length = 0;
    const { plan: made, receipt } = await converge(
      context.client,
      context.hooks,
      context.root,
      next,
    );
    const actions = Object.fromEntries(
      made.resources
        .filter((item) => item.action !== 'unchanged')
        .map((item) => [item.id, item.action]),
    );
    expect(actions).toMatchObject({
      'instance/platform-1': 'replace',
      'instance/backend-api-1': 'replace',
      'instance/backend-worker-1': 'replace',
      'instance/bgutil-provider': 'delete',
      'file/names-config/stack/hosts/records': 'update',
    });
    expect(receipt.changed).toContain('instance/bgutil-provider');
    const calls = context.hooks.calls.map(
      (call) => `${call.hook}:${call.name}:${call.status ?? ''}`,
    );
    // A switched replica is withdrawn and a backend drained while running.
    expect(calls).toContain('withdraw:platform-1:Running');
    expect(calls).toContain('withdraw:backend-api-1:Running');
    expect(calls).toContain('drainBackend:backend-api-1:Running');
    expect(calls).toContain('drainBackend:backend-worker-1:Running');
    expect(calls.indexOf('withdraw:backend-api-1:Running')).toBeLessThan(
      calls.indexOf('drainBackend:backend-api-1:Running'),
    );
    expect(context.fake.instances.has('bgutil-provider')).toBe(false);
    expect(context.fake.instances.get('db')?.createdAt).toBe(before);
    expect(
      context.fake.instances.get('platform-1')?.config['user.tale.image'],
    ).toBe(`sha256:${'9'.repeat(64)}`);
    // The new records are a new generation, and the old one is gone.
    const names = [
      ...(context.fake.volumes.get('names-config')?.files?.keys() ?? []),
    ];
    expect(names).toContain('/stack/hosts/records.2');
    expect(names).not.toContain('/stack/hosts/records.1');
    // The deploy record is written once, by the first deploy.
    expect([
      ...(context.fake.volumes.get('backups')?.files?.keys() ?? []),
    ]).toEqual(['/stack.1.json']);
    expect((await readJournal(context.root))?.withdrawn).toEqual([]);
  });

  test('a live change patches in place under the planned ETag', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const target = structuredClone(desired.target);
    for (const spec of target.instances)
      if (spec.name === 'sandbox-llm-gateway')
        spec.config['limits.memory'] = '3GiB';
    const created = context.fake.instances.get(
      'sandbox-llm-gateway',
    )?.createdAt;
    const next = desiredOf(target);
    const { plan: made } = await planned(context.client, next);
    expect(
      made.resources.find((item) => item.id === 'instance/sandbox-llm-gateway')
        ?.action,
    ).toBe('update');
    await apply(context, next, made);
    const patch = context.fake
      .seen('PATCH /1.0/instances/sandbox-llm-gateway')
      .at(-1);
    expect(patch?.headers['if-match']).toBeDefined();
    const instance = context.fake.instances.get('sandbox-llm-gateway');
    expect(instance?.config['limits.memory']).toBe('3GiB');
    expect(instance?.createdAt).toBe(created);
  });

  test('a change made after planning is refused (compare-and-swap)', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const target = structuredClone(desired.target);
    for (const spec of target.instances)
      if (spec.name === 'sandbox-llm-gateway')
        spec.config['limits.memory'] = '3GiB';
    const next = desiredOf(target);
    const { plan: made } = await planned(context.client, next);
    // Someone edits the instance between the plan and the apply.
    const instance = context.fake.instances.get('sandbox-llm-gateway');
    if (!instance) throw new Error('missing');
    instance.config = { ...instance.config, 'limits.processes': '99' };
    instance.version += 1;
    await expect(apply(context, next, made)).rejects.toThrow(
      'instance/sandbox-llm-gateway changed since planning',
    );
    expect(
      context.fake.seen('PATCH /1.0/instances/sandbox-llm-gateway'),
    ).toEqual([]);
    expect(instance.config['limits.memory']).not.toBe('3GiB');
    expect((await readJournal(context.root))?.phase).toBe('pending');
  });

  test('a change that lands between the read and the PATCH fails If-Match and is refused', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const target = structuredClone(desired.target);
    for (const spec of target.instances)
      if (spec.name === 'sandbox-llm-gateway')
        spec.config['limits.memory'] = '3GiB';
    const next = desiredOf(target);
    const { plan: made } = await planned(context.client, next);
    // A racing writer edits the instance just before the PATCH arrives.
    const racing = clientOf(context.fake, (fetch) => async (url, init) => {
      if (init.method === 'PATCH' && url.includes('sandbox-llm-gateway')) {
        const instance = context.fake.instances.get('sandbox-llm-gateway');
        if (instance) {
          instance.config = { ...instance.config, 'limits.processes': '77' };
          instance.version += 1;
        }
      }
      return fetch(url, init);
    });
    await expect(
      applyIncusPlan({
        client: racing,
        stateRoot: context.root,
        desired: next,
        plan: made,
        hooks: context.hooks,
        options: { stop: false, now: FIXED_NOW },
      }),
    ).rejects.toThrow('changed since planning');
    const patches = context.fake.seen(
      'PATCH /1.0/instances/sandbox-llm-gateway',
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.headers['if-match']).toBe(
      made.resources.find((item) => item.id === 'instance/sandbox-llm-gateway')
        ?.revision ?? 'none',
    );
    expect(
      context.fake.instances.get('sandbox-llm-gateway')?.config[
        'limits.memory'
      ],
    ).not.toBe('3GiB');
  });

  test('a plan of another target or destination is refused', async () => {
    const context = setup();
    const desired = managed();
    const { plan: made } = await planned(context.client, desired);
    const other = withNewImage(desired.target, 'tale-db', '8'.repeat(64));
    await expect(apply(context, desiredOf(other), made)).rejects.toThrow(
      'another stack target',
    );
    await expect(
      apply(context, desired, {
        ...made,
        destination: {
          ...made.destination,
          endpoint: 'https://elsewhere:8443',
        },
      }),
    ).rejects.toThrow('another Incus destination');
  });
});

describe('the ingress (design D-19, 7.1)', () => {
  test('proxy devices are added once the stack runs, and removed when the ingress is routed', async () => {
    const context = setup();
    // The fake refuses proxy devices in a restricted project, as Incus does
    // without restricted.devices.proxy=allow, which only bootstrap sets.
    context.fake.projectConfig.restricted = 'false';
    const desired = desiredOf(goldenTarget('stateful'));
    const { plan: made } = await converge(
      context.client,
      context.hooks,
      context.root,
      desired,
    );
    expect(made.resources.at(-1)).toMatchObject({
      id: 'ingress/proxy',
      action: 'create',
    });
    const create = context.fake
      .seen('POST /1.0/instances')
      .find((request) => (request.body as { name: string }).name === 'proxy');
    const body = create?.body as { devices: object } | undefined;
    expect(Object.keys(body?.devices ?? {}).sort()).toEqual([
      'caddy-config',
      'caddy-data',
      'eth0',
    ]);
    expect(
      Object.keys(context.fake.instances.get('proxy')?.devices ?? {}).sort(),
    ).toEqual([
      'caddy-config',
      'caddy-data',
      'eth0',
      'ingress-443',
      'ingress-80',
    ]);

    const routed = structuredClone(desired.target);
    for (const spec of routed.instances)
      if (spec.name === 'proxy')
        spec.devices = Object.fromEntries(
          Object.entries(spec.devices).filter(
            ([name]) => !name.startsWith('ingress-'),
          ),
        );
    const { plan: removal } = await converge(
      context.client,
      context.hooks,
      context.root,
      desiredOf(routed),
    );
    expect(
      removal.resources.filter((item) => item.action !== 'unchanged'),
    ).toMatchObject([{ id: 'ingress/proxy', action: 'delete' }]);
    expect(
      Object.keys(context.fake.instances.get('proxy')?.devices ?? {}).sort(),
    ).toEqual(['caddy-config', 'caddy-data', 'eth0']);
  });
});

describe('effects are gates', () => {
  test('a running stop-gated service: deferred without --stop, replaced with it', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const target = withNewImage(desired.target, 'tale-db', '3'.repeat(64));
    const next = desiredOf(target);
    const created = context.fake.instances.get('db')?.createdAt;
    const { receipt } = await converge(
      context.client,
      context.hooks,
      context.root,
      next,
    );
    // db is stop-gated as on Docker (STOP_GATED_SERVICES); knowledge-db,
    // which compose recreates, rolls.
    expect(receipt.deferred.map((item) => item.id)).toEqual(['instance/db']);
    expect(receipt.changed).toContain('instance/knowledge-db');
    expect(context.fake.instances.get('db')?.createdAt).toBe(created);

    const stopPlan = await planned(context.client, next, {
      phase: 'full',
      stop: true,
    });
    await expect(apply(context, next, stopPlan.plan, false)).rejects.toThrow(
      'This deploy stops db.',
    );
    await apply(context, next, stopPlan.plan, true);
    expect(context.fake.instances.get('db')?.config['user.tale.image']).toBe(
      `sha256:${'3'.repeat(64)}`,
    );
  });

  test('the switch on an image that cannot read the format needs --stop', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const proxy = context.fake.instances.get('switch');
    if (!proxy) throw new Error('missing');
    delete proxy.config['user.tale.infra-formats'];
    proxy.version += 1;
    const { plan: made } = await planned(context.client, desired);
    expect(
      made.resources.find((item) => item.id === 'instance/switch'),
    ).toMatchObject({
      action: 'replace',
      effects: ['downtime', 'switch'],
    });
    await expect(apply(context, desired, made)).rejects.toThrow('stops switch');
    await apply(context, desired, made, true);
    expect(
      context.fake.instances.get('switch')?.config['user.tale.infra-formats'],
    ).toBe('switch-upstreams/1');
  });

  test('replacing the spawner drains it first', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    context.hooks.calls.length = 0;
    const next = desiredOf(
      withNewImage(desired.target, 'tale-sandbox', '6'.repeat(64)),
    );
    await converge(context.client, context.hooks, context.root, next);
    expect(
      context.hooks.calls.find((call) => call.hook === 'drainSandbox'),
    ).toEqual({
      hook: 'drainSandbox',
      name: 'sandbox',
      status: 'Running',
    });
  });

  test('a missing data volume of a stack that ran is refused; a reset lets the next deploy make it once', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    const db = context.fake.instances.get('db');
    if (!db) throw new Error('missing');
    // As `tale reset` leaves it: the users gone, the volume gone.
    for (const name of ['db']) {
      context.fake.instances.delete(name);
    }
    context.fake.volumes.delete('db-data');
    const { plan: refused } = await planned(context.client, desired);
    expect(
      refused.resources.find((item) => item.id === 'volume/db-data')?.effects,
    ).toEqual(['data']);
    await expect(apply(context, desired, refused)).rejects.toThrow(
      'its data volume db-data is missing',
    );
    expect(context.fake.volumes.has('db-data')).toBe(false);

    // A recorded reset: the first deploy after it makes the volume again.
    await writeStackRecord(context.client, 'tale', {
      schemaVersion: 1,
      stack: 'tale',
      deployedAt: '2026-11-13T09:00:00.000Z',
      resetAt: '2026-11-13T09:30:00.000Z',
    });
    await converge(context.client, context.hooks, context.root, desired);
    expect(context.fake.volumes.has('db-data')).toBe(true);
    expect(await readStackRecord(context.client, 'tale', 'tale')).toMatchObject(
      {
        deployedAt: FIXED_NOW().toISOString(),
        resetAt: '2026-11-13T09:30:00.000Z',
      },
    );
    // Only once: lose it again and the deploy refuses.
    context.fake.instances.delete('db');
    context.fake.volumes.delete('db-data');
    const { plan: again } = await planned(context.client, desired);
    expect(
      again.resources.find((item) => item.id === 'volume/db-data')?.effects,
    ).toEqual(['data']);
  });
});

describe('the journal', () => {
  test('a pending restore stops every guarded verb, naming --resume and --abort', async () => {
    const context = setup();
    const desired = managed();
    await setRestorePending(context.root, 'tale', {
      id: 'snap-1',
      startedAt: FIXED_NOW().toISOString(),
      volumes: ['db-data'],
      steps: { 'db-data': 'renamed' },
      holders: { 'db-data': 'db-data.pre-restore-20261113T100000Z' },
    });
    const { plan: made } = await planned(context.client, desired);
    await expect(apply(context, desired, made)).rejects.toThrow(
      'A restore of snapshot snap-1 is not finished (db-data renamed).',
    );
    expect(context.fake.instances.size).toBe(0);
    const journal = await readJournal(context.root);
    for (const verb of [
      'converge',
      'start',
      'deploy',
      'rollback',
      'services',
      'migrate',
    ] satisfies RestoreGuardedVerb[]) {
      let caught: unknown;
      try {
        assertNoRestorePending(journal, verb);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const info = (caught as { info: { summary: string; next: string[] } })
        .info;
      expect(info.summary).toContain('snap-1');
      expect(info.next.join('\n')).toContain('tale restore --resume');
      expect(info.next.join('\n')).toContain('tale restore --abort');
    }
    expect(() => assertNoRestorePending(null, 'deploy')).not.toThrow();
  });

  test('status names a pending restore; payload files are recorded for reaping', async () => {
    const context = setup();
    expect(restorePendingNotice(null)).toBeNull();
    const journal = await setRestorePending(context.root, 'tale', {
      id: 'snap-2',
      startedAt: FIXED_NOW().toISOString(),
      volumes: ['db-data', 'config-data'],
      steps: { 'db-data': 'copied', 'config-data': 'detached' },
      holders: {},
    });
    expect(restorePendingNotice(journal)).toBe(
      'A restore of snapshot snap-2 is not finished (db-data copied, config-data detached).',
    );
    // A step for a volume outside the restore is no journal this CLI writes.
    await expect(
      setRestorePending(context.root, 'tale', {
        id: 'snap-3',
        startedAt: FIXED_NOW().toISOString(),
        volumes: ['db-data'],
        steps: { 'db-data': 'pending', other: 'pending' },
        holders: {},
      }),
    ).rejects.toThrow();
    expect(
      (await clearRestorePending(context.root, 'tale')).restorePending,
    ).toBeNull();

    const payload = { instance: 'db', path: '/dev/shm/tale-exec-0a1b' };
    await recordPayload(context.root, 'tale', payload);
    await recordPayload(context.root, 'tale', payload);
    expect((await readJournal(context.root))?.payloads).toEqual([payload]);
    await forgetPayload(context.root, 'tale', payload);
    expect((await readJournal(context.root))?.payloads).toEqual([]);
    // Payloads live in /dev/shm alone (R3-06).
    await expect(
      recordPayload(context.root, 'tale', { instance: 'db', path: '/run/x' }),
    ).rejects.toThrow();
    // A journal of another stack in the same directory is not overwritten.
    await expect(
      updateJournal(context.root, 'other', () => undefined),
    ).rejects.toThrow('records the stack tale, not other');
  });

  test('SIGINT records interrupted and exits 130, cleaning nothing up', async () => {
    const context = setup();
    await updateJournal(context.root, 'tale', (journal) => {
      journal.phase = 'pending';
    });
    const codes: number[] = [];
    const release = installInterruptJournal(context.root, (code) => {
      codes.push(code);
    });
    process.emit('SIGINT');
    release();
    expect(codes).toEqual([130]);
    expect((await readJournal(context.root))?.phase).toBe('interrupted');
  });

  test('a replica a crash left withdrawn, and the plan keeps, is admitted', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    await updateJournal(context.root, 'tale', (journal) => {
      journal.withdrawn.push({
        instance: 'platform-1',
        marker: '/tmp/platform-withdrawn',
      });
    });
    context.hooks.calls.length = 0;
    await converge(context.client, context.hooks, context.root, desired);
    expect(context.hooks.calls).toContainEqual({
      hook: 'admit',
      name: 'platform-1:/tmp/platform-withdrawn',
    });
    expect((await readJournal(context.root))?.withdrawn).toEqual([]);
  });

  test('a CLI stop and start write user.tale.want (R-09)', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    await stopStackInstance(context.client, 'bgutil-provider', 5);
    const instance = context.fake.instances.get('bgutil-provider');
    expect(instance?.status).toBe('Stopped');
    expect(instance?.config['user.tale.want']).toBe('stopped');
    await startStackInstance(context.client, 'bgutil-provider');
    expect(instance?.status).toBe('Running');
    expect(instance?.config['user.tale.want']).toBe('running');
  });

  test('a stop that does not finish within the grace is forced, with a warning', async () => {
    const context = setup();
    const desired = managed();
    await converge(context.client, context.hooks, context.root, desired);
    context.fake.gracefulStopFails = true;
    await stopStackInstance(context.client, 'bgutil-provider', 1);
    expect(context.fake.instances.get('bgutil-provider')?.status).toBe(
      'Stopped',
    );
    const stops = context.fake
      .seen('PUT /1.0/instances/bgutil-provider/state')
      .map((request) => request.body as { action: string; force: boolean })
      .filter((body) => body.action === 'stop')
      .map((body) => body.force);
    expect(stops).toEqual([false, true]);
  });
});

test('the plan model refuses a value where a digest belongs', () => {
  const desired = managed();
  expect(() =>
    incusPlanSchema.parse({
      schemaVersion: 1,
      targetSha256: 'x',
      phase: 'full',
      destination: desired.destination,
      resources: [],
    }),
  ).toThrow();
  expect(() =>
    incusPlanSchema.parse({
      schemaVersion: 1,
      targetSha256: 'a'.repeat(64),
      phase: 'full',
      destination: desired.destination,
      resources: [],
      environment: { DB_PASSWORD: 'x' },
    }),
  ).toThrow();
});
