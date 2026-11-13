import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError } from '../../utils/fail';
import { createIncusRuntime } from '../runtime/incus/incus-runtime';
import {
  seedStackInstance,
  verbsFixture,
  WITH_TIMEOUT,
  type VerbsFixture,
} from '../runtime/incus/verbs/verbs-fixture';
import { COPY_OUT_LIMIT_SENTENCE, type RuntimeBudget } from './runtime-access';
import {
  deferredSession,
  incusRuntimeAccess,
  instanceIdentity,
  wrappedArgv,
} from './runtime-access-incus';

/**
 * The Incus form of `RuntimeAccess` (design 4; M1 carry-overs 1-4): one
 * normalized readback, Compose-named labels, a 64-hex identity per instance
 * incarnation, the bundled-database fact decided inside the access, and the
 * byte cap of `copyOut`.
 */

const SECRET = 'incus-access-secret-3b9e';
const IMAGE = `ghcr.io/tale-project/tale/tale-platform@${WITH_TIMEOUT}`;

const fixtures: VerbsFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.remove();
});

function setup(budget?: Partial<RuntimeBudget>) {
  const fixture = verbsFixture();
  fixtures.push(fixture);
  const runtime = createIncusRuntime({
    client: fixture.context.client,
    declaration: {
      project: 'tale-stack',
      pool: 'tale',
      network: {
        name: 'talebr0',
        subnet: '10.30.0.0/16',
        gateway: '10.30.0.1',
        block: '10.30.2.0/25',
      },
      sessions: { subnet: '10.40.0.0/24' },
      ingress: { mode: 'routed' },
    },
    stack: 'tale',
    stateRoot: fixture.stateRoot,
  });
  const failures: string[] = [];
  const access = incusRuntimeAccess({
    runtime,
    images: [IMAGE],
    budget: {
      bounds: () => ({ timeout: 30, maxOutputBytes: 65536 }),
      failed: () => {
        failures.push('failed');
        return new Error('failed');
      },
      refused: () => new Error('refused'),
      ...budget,
    },
  });
  const api = seedStackInstance(fixture.fake, 'backend-api-1', {
    service: 'backend-api',
    config: {
      'user.tale.index': '1',
      'environment.DATABASE_URL': `postgresql://tale:${SECRET}@db:5432/tale_app`,
      'environment.BETTER_AUTH_SECRET': SECRET,
      'environment.TALE_ROLE': 'api',
    },
    devices: {
      'config-data': {
        type: 'disk',
        pool: 'tale',
        source: 'config-data',
        path: '/app/data',
      },
      eth0: {
        type: 'nic',
        network: 'talebr0',
        'ipv4.address': '10.30.2.80/16',
      },
    },
  });
  return { fixture, runtime, access, api, failures };
}

describe('the Incus runtime access', () => {
  test('lists and inspects by a 64-hex identity, with Compose-named labels and no environment value', async () => {
    const { fixture, access, api } = setup();
    const id = instanceIdentity('tale-stack', api);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(await access.list({ stack: 'tale' })).toEqual([id]);
    expect(await access.listServices('tale')).toEqual([
      { id, service: 'backend-api' },
    ]);
    const [instance] = await access.inspect([id]);
    expect(instance).toMatchObject({
      id,
      image: WITH_TIMEOUT,
      imageReference: IMAGE,
      running: true,
      restartCount: 0,
      status: 'running',
      environmentSize: 3,
      bundledDatabase: true,
      networks: { talebr0: { address: '10.30.2.80' } },
      mounts: [{ type: 'volume', source: 'config-data', target: '/app/data' }],
    });
    expect(instance?.labels).toMatchObject({
      'com.docker.compose.project': 'tale',
      'com.docker.compose.service': 'backend-api',
      'com.docker.compose.container-number': '1',
      'com.docker.compose.oneoff': 'False',
    });
    const text = JSON.stringify(instance);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('postgresql://');
    // A name of the stack is taken as well.
    expect((await access.inspect(['backend-api-1']))[0]?.id).toBe(id);
    fixture.fake.instances.get('backend-api-1')!.config[
      'environment.DATABASE_URL'
    ] = `postgresql://tale:${SECRET}@external.invalid:5432/tale_app`;
    expect((await access.inspect([id]))[0]?.bundledDatabase).toBe(false);
  });

  test('the metadata projection carries the identity, state, stack, service and mounts alone', async () => {
    const { access, api } = setup();
    const [instance] = await access.inspect(
      [instanceIdentity('tale-stack', api)],
      { metadataOnly: true },
    );
    expect(Object.keys(instance ?? {}).sort()).toEqual(
      [
        'id',
        'image',
        'labels',
        'mounts',
        'restartCount',
        'running',
        'startedAt',
      ].sort(),
    );
    expect(instance?.labels).toEqual({
      'com.docker.compose.project': 'tale',
      'com.docker.compose.service': 'backend-api',
    });
  });

  test('a new incarnation under the same name has a new identity', async () => {
    const { fixture, access, api } = setup();
    const before = instanceIdentity('tale-stack', api);
    fixture.fake.instances.get('backend-api-1')!.createdAt =
      '2027-01-01T00:00:00Z';
    const [after] = await access.list({ stack: 'tale' });
    expect(after).not.toBe(before);
    await expect(access.inspect([before])).rejects.toThrow('failed');
  });

  test('exec runs as a uid:gid account, with the working directory and variables in its argv', async () => {
    const { fixture, access, api } = setup();
    const result = await access.exec(
      instanceIdentity('tale-stack', api),
      ['tale', 'deploy'],
      { user: '1001:1001', workdir: '/', environment: { NO_PROXY: '*' } },
    );
    expect(result.success).toBe(true);
    const call = fixture.fake.execs.at(-1);
    expect(call?.user).toBe(1001);
    expect(call?.group).toBe(1001);
    expect(call?.command).toEqual(
      wrappedArgv(['tale', 'deploy'], {
        workdir: '/',
        environment: { NO_PROXY: '*' },
      }),
    );
    await expect(
      access.exec('backend-api-1', ['true'], { user: 'app' }),
    ).rejects.toBeInstanceOf(CliError);
  });

  test('an unsuccessful exec is refused unless it allows failure', async () => {
    const { fixture, access } = setup();
    fixture.fake.exec = () => 3;
    await expect(access.exec('backend-api-1', ['false'])).rejects.toThrow(
      'refused',
    );
    expect(
      (await access.exec('backend-api-1', ['false'], { allowFailure: true }))
        .exitCode,
    ).toBe(3);
  });

  test('copyOut over its cap is refused with the fixed sentence; copyIn of a file pushes it executable', async () => {
    const { fixture, access } = setup();
    const instance = fixture.fake.instances.get('backend-api-1')!;
    instance.files.set('/tmp/out', {
      content: '',
      mode: '0700',
      uid: 0,
      gid: 0,
      type: 'directory',
    });
    instance.files.set('/tmp/out/big', {
      content: 'x'.repeat(4096),
      mode: '0600',
      uid: 0,
      gid: 0,
    });
    const receive = mkdtempSync(join(tmpdir(), 'tale-incus-receive-'));
    try {
      await expect(
        access.copyOut('backend-api-1', '/tmp/out', receive, {
          maxBytes: 1024,
        }),
      ).rejects.toThrow(COPY_OUT_LIMIT_SENTENCE);
      const binary = join(receive, 'tale');
      writeFileSync(binary, 'binary');
      await access.copyIn('backend-api-1', { file: binary }, '/tmp/tale');
      expect(instance.files.get('/tmp/tale')).toMatchObject({
        content: 'binary',
        mode: '0550',
      });
    } finally {
      rmSync(receive, { recursive: true, force: true });
    }
  });

  test('a session handed out before its command starts delivers its stdin and exit code', async () => {
    const chunks: string[] = [];
    const session = deferredSession(
      Promise.resolve({
        stdin: {
          write: (chunk: string | Uint8Array) => chunks.push(String(chunk)),
          flush: () => undefined,
          end: () => chunks.push('<end>'),
        },
        stdout: new Response('out').body!,
        stderr: new Response('').body!,
        exited: Promise.resolve(0),
        exitCode: 0,
        kill: () => undefined,
      }),
    );
    session.stdin.write('SELECT 1;');
    session.stdin.end();
    expect(await new Response(session.stdout).text()).toBe('out');
    expect(await session.exited).toBe(0);
    expect(chunks).toEqual(['SELECT 1;', '<end>']);
    const failed = deferredSession(Promise.reject(new Error('no exec')));
    expect(await failed.exited).toBe(1);
  });
});
