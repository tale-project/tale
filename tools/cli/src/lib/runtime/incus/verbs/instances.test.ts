import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../../../utils/fail';
import { runtimeForEngine } from '../../select-runtime';
import {
  clientOf,
  goldenTarget,
  stackIncus,
  testKey,
} from '../apply/apply-fixture';
import type { IncusDeclaration } from '../compile/stack-target';
import type { InstanceSpec } from '../compile/translate';
import { IncusRuntime } from '../incus-runtime';
import {
  createStackInstance,
  declaredGrace,
  freezeStackInstances,
  inspectStackInstance,
  listStackInstances,
  provePid1,
  removeStackInstance,
  startStackInstance,
  stopStackInstance,
  thawStackInstances,
} from './instances';

let fake: FakeIncus;
let stateRoot: string;
let spec: InstanceSpec;

const target = goldenTarget('managed-compose');

function specOf(name: string): InstanceSpec {
  const found = target.instances.find((instance) => instance.name === name);
  if (found === undefined) throw new Error(`no ${name} in the golden target`);
  return structuredClone(found);
}

beforeEach(() => {
  fake = stackIncus();
  stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-instances-'));
  spec = specOf('bgutil-provider');
  fake.addImage(spec.image);
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

/** The stop requests the fake was sent, in order. */
function stopBodies(): unknown[] {
  return fake
    .seen('PUT /1.0/instances/*/state')
    .map((request) => request.body)
    .filter(
      (body) =>
        typeof body === 'object' &&
        body !== null &&
        'action' in body &&
        body.action === 'stop',
    );
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('stack instances', () => {
  test('are made stopped from their spec, and a second of the name is refused', async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    const made = fake.instances.get(spec.name);
    expect(made?.status).toBe('Stopped');
    expect(made?.profiles).toEqual(['tale-stack']);
    expect(made?.config['user.tale.stack']).toBe('tale');
    const error = await refusal(createStackInstance(client, spec));
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('exists already');
  });

  test('a start marks it wanted and records when it started; a later start by Incus is a restart', async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    await startStackInstance(client, spec.name);
    const instance = fake.instances.get(spec.name);
    expect(instance?.status).toBe('Running');
    expect(instance?.config['user.tale.want']).toBe('running');
    expect(instance?.config['user.tale.started']).toBe(instance?.startedAt);

    const info = await inspectStackInstance(client, spec.name, testKey());
    expect(info).toMatchObject({
      name: spec.name,
      service: 'bgutil-provider',
      running: true,
      state: 'running',
      restarted: false,
      startedAt: instance?.startedAt,
    });
    expect(info?.environmentDigest).toMatch(/^[0-9a-f]{64}$/);

    // boot.autorestart started it again: started_at moved past the label.
    if (instance !== undefined)
      instance.startedAt = new Date(
        Date.parse(instance.startedAt) + 5_000,
      ).toISOString();
    expect(
      (await inspectStackInstance(client, spec.name, testKey()))?.restarted,
    ).toBe(true);
    // A start the CLI asks for records the new start.
    await stopStackInstance(client, spec.name, 5);
    await startStackInstance(client, spec.name);
    expect(
      (await inspectStackInstance(client, spec.name, testKey()))?.restarted,
    ).toBe(false);
    expect(await inspectStackInstance(client, 'absent', testKey())).toBeNull();
  });

  test('a label write waits out a start or stop Incus is running', async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    fake.fail({
      match: `PATCH /1.0/instances/${spec.name}`,
      status: 500,
      message:
        'Failed to create instance update operation: Instance is busy running a "stop" operation',
    });
    await startStackInstance(client, spec.name);
    const instance = fake.instances.get(spec.name);
    expect(instance?.config['user.tale.want']).toBe('running');
    expect(instance?.config['user.tale.started']).toBe(instance?.startedAt);
    expect(fake.seen(`PATCH /1.0/instances/${spec.name}`)).toHaveLength(3);
  });

  test('a stop marks it stopped, and is forced with a warning once the grace runs out', async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    await startStackInstance(client, spec.name);
    fake.gracefulStopFails = true;
    const warnings: string[] = [];
    const warn = spyOn(console, 'warn').mockImplementation((line: unknown) => {
      warnings.push(String(line));
    });
    try {
      await stopStackInstance(client, spec.name, 3);
    } finally {
      warn.mockRestore();
    }
    expect(warnings).toEqual([expect.stringContaining('within 3 s; forcing')]);
    const instance = fake.instances.get(spec.name);
    expect(instance?.status).toBe('Stopped');
    expect(instance?.config['user.tale.want']).toBe('stopped');
    expect(stopBodies()).toEqual([
      { action: 'stop', force: false, stateful: false, timeout: 3 },
      { action: 'stop', force: true, stateful: false, timeout: 0 },
    ]);
  });

  test("'forever' waits the declared grace and never forces", async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    await startStackInstance(client, spec.name);
    fake.gracefulStopFails = true;
    const error = await refusal(
      stopStackInstance(client, spec.name, 'forever'),
    );
    expect(error.message).toContain(
      `within its declared ${declaredGrace(spec.config)} s and is left running`,
    );
    expect(fake.instances.get(spec.name)?.status).toBe('Running');
    expect(stopBodies()).toEqual([
      {
        action: 'stop',
        force: false,
        stateful: false,
        timeout: declaredGrace(spec.config),
      },
    ]);
    fake.gracefulStopFails = false;
    await stopStackInstance(client, spec.name, 'forever');
    expect(fake.instances.get(spec.name)?.status).toBe('Stopped');
    // A stopped instance is only marked.
    await stopStackInstance(client, spec.name, 'forever');
  });

  test('remove stops a running instance first, refuses another stack, and counts a gone one as removed', async () => {
    const client = clientOf(fake);
    await createStackInstance(client, spec);
    await startStackInstance(client, spec.name);
    expect(await removeStackInstance(client, 'tale', spec.name)).toBe(true);
    expect(fake.instances.has(spec.name)).toBe(false);
    expect(await removeStackInstance(client, 'tale', spec.name)).toBe(true);
    fake.seedInstance('foreign', { 'user.tale.stack': 'other' });
    expect(
      (await refusal(removeStackInstance(client, 'tale', 'foreign'))).message,
    ).toContain('belongs to the stack other');
  });

  test('freeze and thaw go out together, and a failed thaw still thaws the rest', async () => {
    const client = clientOf(fake);
    for (const name of ['a1', 'a2'])
      fake.seedInstance(
        name,
        { 'user.tale.stack': 'tale' },
        { ephemeral: false },
      );
    await freezeStackInstances(client, ['a1', 'a2']);
    expect(fake.instances.get('a1')?.status).toBe('Frozen');
    expect(fake.instances.get('a2')?.status).toBe('Frozen');
    fake.fail({
      match: 'PUT /1.0/instances/a1/state',
      status: 500,
      message: 'cgroup busy',
    });
    expect(
      (await refusal(thawStackInstances(client, ['a1', 'a2']))).message,
    ).toContain('cgroup busy');
    expect(fake.instances.get('a2')?.status).toBe('Running');
  });

  test('the census lists one stack by service and index, without one-offs', async () => {
    const client = clientOf(fake);
    const seed = (name: string, config: Record<string, string>) =>
      fake.seedInstance(
        name,
        { 'user.tale.stack': 'tale', ...config },
        {
          ephemeral: false,
        },
      );
    seed('platform-2', {
      'user.tale.service': 'platform',
      'user.tale.index': '2',
    });
    seed('platform-1', {
      'user.tale.service': 'platform',
      'user.tale.index': '1',
    });
    seed('db', { 'user.tale.service': 'db' });
    seed('job-backup-0a0b0c0d', { 'user.tale.role': 'helper' });
    seed('tale-probe-aaaaaaaaaaaa-0a0b0c', { 'user.tale.role': 'probe' });
    fake.seedInstance('other-db', {
      'user.tale.stack': 'other',
      'user.tale.service': 'db',
    });
    const listed = await listStackInstances(
      client,
      { stack: 'tale' },
      testKey(),
    );
    expect(listed.map((instance) => instance.name)).toEqual([
      'db',
      'platform-1',
      'platform-2',
    ]);
    expect(listed[1]).toEqual({
      stack: 'tale',
      service: 'platform',
      index: 1,
      oneOff: false,
      name: 'platform-1',
      running: true,
      state: 'running',
    });
    expect(
      (
        await listStackInstances(
          client,
          { stack: 'tale', service: 'db' },
          testKey(),
        )
      ).map((instance) => instance.name),
    ).toEqual(['db']);
  });

  test("PID 1 is proven by its cmdline against the instance's entrypoint", async () => {
    const client = clientOf(fake);
    const db = specOf('db');
    fake.addImage(db.image);
    for (const volume of ['db-data', 'db-backup'])
      fake.seedVolume(volume, { 'user.tale.stack': 'tale' });
    await createStackInstance(client, db);
    await startStackInstance(client, db.name);
    const words = (db.config['oci.entrypoint'] ?? '').split(' ');
    expect(words[0]).toBe('/init');
    fake.exec = (call, io) => {
      if (call.command.join(' ') === 'cat /proc/1/cmdline')
        io.write(1, `${words.join('\0')}\0`);
      return 0;
    };
    expect(await provePid1(client, db.name)).toEqual({
      argv: words,
      matches: true,
    });
    fake.exec = (_call, io) => {
      io.write(1, '/sbin/init\0');
      return 0;
    };
    expect((await provePid1(client, db.name)).matches).toBe(false);
  });
});

describe('the Incus runtime as a StackRuntime', () => {
  const declaration: IncusDeclaration = {
    project: 'tale-stack',
    pool: 'tale',
    network: {
      name: 'talebr0',
      subnet: '10.30.0.0/16',
      gateway: '10.30.0.1',
      block: '10.30.2.0/25',
    },
    sessions: { subnet: '10.31.0.0/24' },
    ingress: { mode: 'routed' },
  };

  test('runtimeForEngine builds it from a connection, and refuses incus without one', () => {
    const runtime = runtimeForEngine('incus', {
      incus: { client: clientOf(fake), declaration, stack: 'tale', stateRoot },
    });
    expect(runtime).toBeInstanceOf(IncusRuntime);
    expect(runtime.engine).toBe('incus');
    expect(() => runtimeForEngine('incus')).toThrow('not available yet');
  });

  test('answers the census, stops and removes through the verbs', async () => {
    const runtime = new IncusRuntime({
      client: clientOf(fake),
      declaration,
      stack: 'tale',
      stateRoot,
    });
    await runtime.createInstance(spec);
    await runtime.start(spec.name);
    expect(await runtime.exists(spec.name)).toBe(true);
    expect(await runtime.isRunning(spec.name)).toBe(true);
    expect(await runtime.state(spec.name)).toBe('running');
    expect((await runtime.list({ stack: 'tale' })).map((i) => i.name)).toEqual([
      spec.name,
    ]);
    expect(await runtime.listByName('bgutil')).toEqual([
      { name: spec.name, status: 'Running' },
    ]);
    expect(await runtime.stop(spec.name)).toBe(true);
    expect(await runtime.isRunning(spec.name)).toBe(false);
    expect(await runtime.remove(spec.name)).toBe(true);
    expect(await runtime.exists(spec.name)).toBe(false);
    expect(await runtime.stop(spec.name)).toBe(false);
    expect(await runtime.ensureNetwork('talebr0')).toBe(true);
    expect(await runtime.ensureNetwork('elsewhere')).toBe(false);
  });

  test('a verb it cannot answer yet is refused in words, never with Docker meaning', async () => {
    const runtime = new IncusRuntime({
      client: clientOf(fake),
      declaration,
      stack: 'tale',
      stateRoot,
    });
    for (const call of [
      () => runtime.exec(),
      () => runtime.converge(),
      () => runtime.health(),
      () => runtime.withdraw(),
      () => runtime.oneShot(),
    ]) {
      const error = await refusal(call());
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain('The Incus runtime cannot');
    }
    expect(await runtime.imagePresent('ghcr.io/x/y:1')).toBe(false);
    const ensured = await runtime.ensureImages([
      { reference: 'ghcr.io/x/y:1' },
      {
        reference: `ghcr.io/x/z@sha256:${'a'.repeat(64)}`,
        alias: 'tale-sandbox:latest',
      },
    ]);
    expect(ensured.failed.map((item) => item.detail)).toEqual([
      expect.stringContaining('by digest only'),
      expect.stringContaining('under the alias tale-sandbox:latest, not'),
    ]);
  });
});
