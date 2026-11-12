// The Incus runtime's verbs against a real Incus: the probe, a pull of
// tale-proxy by digest, the image facts read through a stopped probe
// instance, a volume made with the owner they name, an instance made,
// started, proven by its PID 1, stopped and removed, the empty-volume
// boot of the platform and sandbox images (design R3-20), and exec (both
// paths, stdin, deadlines, the byte cap, a held session), the copies, the
// console and a one-shot helper (TI-12). Gated: it runs only
// with TALE_INCUS_REAL=1, and then needs TALE_INCUS_DIR (client.crt,
// client.key, server.crt of a certificate restricted to a throwaway project
// whose `tale-stack` profile has a root disk) — a run asked for without one
// fails instead of passing empty. Every object it makes carries the run's
// name and is deleted after; the images stay for the next run.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IncusClient } from '@tale/incus/client';
import { execWithOutput } from '@tale/incus/exec';
import { statFile } from '@tale/incus/files';
import { readIncusTlsMaterial } from '@tale/incus/tls';

import { CliError } from '../../../../utils/fail';
import { readImageFacts, type ImageFacts } from '../../../oci/image-facts';
import { createRegistryClient } from '../../../oci/registry';
import { testKey } from '../apply/apply-fixture';
import { readJournal } from '../apply/journal';
import type {
  StackImage,
  StackTarget,
  StackVolume,
} from '../compile/stack-target';
import { imageAlias, type InstanceSpec } from '../compile/translate';
import {
  execInInstance,
  execSessionInInstance,
  type IncusVerbContext,
} from './exec';
import { copyIntoInstance, copyOutOfInstance } from './files';
import { IncusHealth } from './health';
import { imageFsFacts, type ImageFsFacts } from './image-facts-cache';
import { ensureImages } from './images';
import {
  createStackInstance,
  inspectStackInstance,
  provePid1,
  removeStackInstance,
  startStackInstance,
  stopStackInstance,
} from './instances';
import { CRASH_TAIL_LABEL, crashTail, readInstanceLogs } from './logs';
import { runOneShot } from './oneshot';
import { probeIncus } from './probe';
import { ensureStackVolumes, removeStackVolume, volumeOwners } from './volumes';

const env = process.env;
const REAL = env.TALE_INCUS_REAL === '1';
const DIR = env.TALE_INCUS_DIR ?? '';
const ENDPOINT = env.TALE_INCUS_ENDPOINT ?? 'https://127.0.0.1:8443';
const PROJECT = env.TALE_INCUS_PROJECT ?? 'ti-11';
const POOL = env.TALE_INCUS_POOL ?? 'ti-11';
const NETWORK = env.TALE_INCUS_NETWORK ?? 'ti-11-app';
/** The bridge's gateway; the run's instances take addresses in its /24. */
const GATEWAY = env.TALE_INCUS_GATEWAY ?? '10.211.1.1';
const PREFIX = GATEWAY.split('.').slice(0, 3).join('.');
/** The release whose images the run pulls (main's line). */
const TAG = env.TALE_INCUS_TAG ?? '0.5.105';
const REGISTRY = 'ghcr.io/tale-project/tale';
const PLATFORM = 'linux/amd64';
/** An image, by digest, that ships the patched `/init` (a tale-proxy built
 * from the Incus-ready images); the PID 1 proof's positive case. */
const INIT_IMAGE = env.TALE_INCUS_INIT_IMAGE ?? '';

if (REAL && DIR === '')
  throw new Error(
    'TALE_INCUS_REAL=1 needs TALE_INCUS_DIR: the directory of client.crt, client.key and server.crt',
  );

setDefaultTimeout(900_000);

const run = Date.now().toString(36);
const STACK = `ti11-real-${run}`;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface Mount {
  volume: string;
  path: string;
  readOnly?: boolean;
}

/** One service of the run: its image, address, entrypoint and volumes. */
interface Service {
  name: string;
  image: StackImage;
  address: string;
  entrypoint: string;
  environment: Record<string, string>;
  mounts: Mount[];
}

function instanceSpec(service: Service): InstanceSpec {
  const config: Record<string, string> = {
    'security.idmap.isolated': 'true',
    'oci.entrypoint': service.entrypoint,
    'oci.dns.nameservers': GATEWAY,
    'user.tale.stack': STACK,
    'user.tale.service': service.name,
    'user.tale.role': service.name,
    'user.tale.image': service.image.digest,
    'user.tale.grace': '20',
  };
  for (const [key, value] of Object.entries(service.environment))
    config[`environment.${key}`] = value;
  const devices: InstanceSpec['devices'] = {
    eth0: {
      type: 'nic',
      network: NETWORK,
      name: 'eth0',
      'ipv4.address': `${service.address}/24`,
      'ipv4.gateway': GATEWAY,
      'ipv6.address': 'none',
    },
  };
  for (const mount of service.mounts)
    devices[mount.volume] = {
      type: 'disk',
      pool: POOL,
      source: mount.volume,
      path: mount.path,
      ...(mount.readOnly === true ? { readonly: 'true' } : {}),
    };
  return {
    name: `${service.name}-${run}`,
    service: service.name,
    index: null,
    colour: null,
    image: service.image.alias,
    address: service.address,
    config,
    devices,
    healthcheck: { disabled: true },
    stop: { signal: 15, graceSeconds: 20 },
    dependsOn: [],
  };
}

function targetOf(services: Service[]): StackTarget {
  const volumes: StackVolume[] = services.flatMap((service) =>
    service.mounts.map((mount) => ({
      name: mount.volume,
      kind: 'data' as const,
      pool: POOL,
      config: {},
    })),
  );
  return {
    schemaVersion: 1,
    path: 'managed',
    stack: STACK,
    project: PROJECT,
    pool: POOL,
    network: {
      name: NETWORK,
      subnet: `${PREFIX}.0/24`,
      gateway: GATEWAY,
      block: `${PREFIX}.0/25`,
    },
    images: services.map((service) => service.image),
    volumes,
    files: [],
    instances: services.map(instanceSpec),
    names: { stack: {}, sessions: {} },
    switch: { platform: [], 'backend-api': [] },
    ingress: { mode: 'routed', proxy: 'proxy', ports: [] },
    ignored: [],
    omitted: [],
  };
}

describe.skipIf(!REAL)('the Incus runtime verbs against a real Incus', () => {
  let client: IncusClient;
  let stateRoot: string;
  const registry = createRegistryClient();
  const registryFacts = new Map<string, ImageFacts>();
  const made: { instances: string[]; volumes: string[] } = {
    instances: [],
    volumes: [],
  };

  /** A service of main's release `TAG`, its image resolved to a digest. */
  async function release(
    name: string,
    repository: string,
    rest: Omit<Service, 'name' | 'image'>,
  ): Promise<Service> {
    const facts = await readImageFacts(
      registry,
      `${REGISTRY}/${repository}:${TAG}`,
      PLATFORM,
    );
    registryFacts.set(facts.digest, facts);
    return {
      name,
      image: {
        alias: imageAlias(facts),
        reference: facts.reference,
        digest: facts.digest,
        services: [name],
      },
      ...rest,
    };
  }

  /** Pull, read the facts, make the volumes with their owners, then make
   * and start the instances. */
  async function boot(services: Service[]): Promise<{
    target: StackTarget;
    facts: Map<string, ImageFsFacts>;
  }> {
    const target = targetOf(services);
    const ensured = await ensureImages(client, target.images, { stateRoot });
    expect(ensured.failed).toEqual([]);
    const facts = await imageFsFacts(
      client,
      services.map((one) => ({
        alias: one.image.alias,
        digest: one.image.digest,
        env: registryFacts.get(one.image.digest)?.env ?? [],
        labels: registryFacts.get(one.image.digest)?.labels ?? {},
        paths: one.mounts.map((mount) => mount.path),
      })),
      { stateRoot, stack: STACK },
    );
    for (const record of facts.values())
      console.info(`[real] image facts ${JSON.stringify(record)}`);
    const owners = volumeOwners(target, facts);
    made.volumes.push(...target.volumes.map((volume) => volume.name));
    await ensureStackVolumes(client, target, target.volumes, owners);
    for (const volume of target.volumes) {
      const root = await statFile(
        client,
        { pool: POOL, volume: volume.name },
        '/',
      );
      const owner = owners.get(volume.name);
      console.info(
        `[real] volume ${volume.name} root ${JSON.stringify(root)} made as ${JSON.stringify(owner)}`,
      );
      if (owner !== undefined)
        expect(root).toMatchObject({ uid: owner.uid, gid: owner.gid });
    }
    for (const spec of target.instances) {
      made.instances.push(spec.name);
      await createStackInstance(client, spec);
      await startStackInstance(client, spec.name);
    }
    return { target, facts };
  }

  async function exec(name: string, argv: string[]) {
    try {
      const output = await execWithOutput(client, name, argv, {
        timeoutSeconds: 30,
        maxOutputBytes: 1024 * 1024,
      });
      return {
        code: output.exitCode,
        out: text(output.stdout).trim(),
        err: text(output.stderr).trim(),
      };
    } catch (error) {
      return { code: -1, out: '', err: String(error) };
    }
  }

  /** Poll `check` until it holds or `seconds` pass; the last answer. */
  async function within<T>(
    seconds: number,
    check: () => Promise<T>,
    holds: (value: T) => boolean,
  ): Promise<T> {
    const deadline = Date.now() + seconds * 1000;
    let value = await check();
    while (!holds(value) && Date.now() < deadline) {
      await Bun.sleep(2_000);
      value = await check();
    }
    return value;
  }

  async function consoleOf(name: string): Promise<string> {
    return text(await client.readConsole(name, { maxBytes: 256 * 1024 }));
  }

  beforeAll(async () => {
    stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-real-'));
    client = new IncusClient({
      endpoint: ENDPOINT,
      project: PROJECT,
      tls: await readIncusTlsMaterial({
        clientCertFile: join(DIR, 'client.crt'),
        clientKeyFile: join(DIR, 'client.key'),
        serverCertFile: join(DIR, 'server.crt'),
      }),
      signal: () => undefined,
    });
  });

  afterAll(async () => {
    for (const name of made.instances.reverse())
      await removeStackInstance(client, STACK, name).catch((error: unknown) => {
        console.warn(`[real] could not remove ${name}:`, error);
      });
    for (const name of made.volumes)
      await removeStackVolume(client, POOL, STACK, name).catch(
        (error: unknown) => {
          console.warn(`[real] could not remove volume ${name}:`, error);
        },
      );
    rmSync(stateRoot, { recursive: true, force: true });
  });

  describe('exec, copies, the console, a helper and health (TI-12)', () => {
    let name = '';
    let context: IncusVerbContext;
    let proxy: Service;
    const volume = `files-${run}`;
    const sha = async (bytes: Uint8Array) =>
      new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

    beforeAll(async () => {
      proxy = await release('ti12', 'tale-proxy', {
        address: `${PREFIX}.25`,
        entrypoint:
          "sh -c 'i=0; while [ $i -lt 40 ]; do i=$((i+1)); echo console-$i; done; exec caddy file-server --listen :8080 --root /srv'",
        environment: {},
        mounts: [{ volume, path: '/data' }],
      });
      const { target, facts } = await boot([proxy]);
      name = target.instances[0]?.name ?? '';
      context = { client, stack: STACK, stateRoot };
      console.info(
        `[real] tale-proxy timeout fact: ${facts.get(proxy.image.digest)?.timeout ?? 'none'}`,
      );
      expect(facts.get(proxy.image.digest)?.timeout).not.toBeNull();
    });

    test('mode 2 runs under the image timeout; stdin goes as a file or over the websocket', async () => {
      const who = await execInInstance(context, name, ['id', '-u']);
      console.info(`[real] exec id -u ${JSON.stringify(who)}`);
      expect(who).toEqual({
        success: true,
        stdout: '0',
        stderr: '',
        exitCode: 0,
      });
      for (const size of [1024, 2 * 1024 * 1024]) {
        const payload = crypto.getRandomValues(new Uint8Array(size));
        const encoded = Buffer.from(payload).toString('base64');
        const started = Date.now();
        const result = await execInInstance(context, name, ['sha256sum'], {
          stdin: encoded,
        });
        console.info(
          `[real] stdin ${encoded.length} bytes: ${JSON.stringify(result)} in ${Date.now() - started} ms`,
        );
        expect(result.stdout.split(' ')[0]).toBe(
          await sha(new TextEncoder().encode(encoded)),
        );
      }
      const shm = await execInInstance(context, name, ['ls', '-a', '/dev/shm']);
      expect(shm.stdout).not.toContain('tale-exec-');
      expect((await readJournal(stateRoot))?.payloads ?? []).toEqual([]);
    });

    test('a command past its time ends: by the image timeout in mode 2, by the control socket over the websocket', async () => {
      let started = Date.now();
      let timed = '';
      try {
        await execInInstance(context, name, ['sleep', '30'], { timeoutS: 2 });
      } catch (error) {
        timed = error instanceof Error ? error.message : String(error);
      }
      const recordMs = Date.now() - started;
      console.info(
        `[real] mode 2 sleep 30 under timeout 2: ${timed} in ${recordMs} ms`,
      );
      expect(timed).toBe('Command exceeded its time limit.');
      expect(recordMs).toBeLessThan(10_000);
      // A command's own exit code passes through, 124 included.
      expect(
        (await execInInstance(context, name, ['sh', '-c', 'exit 124']))
          .exitCode,
      ).toBe(124);
      // An instance whose image facts are unknown runs over the websocket.
      await client.patchInstance(name, {
        config: { 'user.tale.image': `sha256:${'0'.repeat(64)}` },
      });
      try {
        started = Date.now();
        let failure = '';
        try {
          await execInInstance(context, name, ['sleep', '30'], { timeoutS: 2 });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        console.info(
          `[real] websocket sleep 30 under 2 s: ${failure} in ${Date.now() - started} ms`,
        );
        expect(failure).toBe('Command exceeded its time limit.');
        expect(Date.now() - started).toBeLessThan(10_000);
        const procs = await execInInstance(context, name, ['ps']);
        expect(procs.stdout).not.toContain('sleep 30');
      } finally {
        await client.patchInstance(name, {
          config: { 'user.tale.image': proxy.image.digest },
        });
      }
      let capped = '';
      try {
        await execInInstance(
          context,
          name,
          ['head', '-c', '100000', '/dev/zero'],
          {
            maxOutputBytes: 1000,
          },
        );
      } catch (error) {
        capped = error instanceof Error ? error.message : String(error);
      }
      expect(capped).toBe('Command output exceeded its byte limit.');
    });

    test('a held session streams both ways and ends with its code', async () => {
      const session = await execSessionInInstance(context, name, [
        'sh',
        '-c',
        'while read line; do echo "got $line"; done; exit 7',
      ]);
      session.stdin.write('one\n');
      const reader = session.stdout.getReader();
      const first = await reader.read();
      expect(text(first.value ?? new Uint8Array())).toBe('got one\n');
      session.stdin.end();
      expect(await session.exited).toBe(7);
    });

    test('copies go through the volume API on a stack volume, the instance API elsewhere, with owners; the copy out stops at its cap', async () => {
      const source = join(stateRoot, 'copy-source');
      mkdirSync(join(source, 'acme'), { recursive: true, mode: 0o750 });
      writeFileSync(join(source, 'top.json'), '{"a":1}', { mode: 0o640 });
      writeFileSync(join(source, 'acme', 'agent.json'), '{"b":2}', {
        mode: 0o600,
      });
      for (const target of ['/data/', '/tmp/import'])
        expect(
          await copyIntoInstance(context, name, source, target, {
            user: 'nobody',
            group: 'nobody',
          }),
        ).toEqual({ success: true });
      const owners = await execInInstance(context, name, [
        'stat',
        '-c',
        '%n %u:%g %a',
        '/data/top.json',
        '/data/acme',
        '/data/acme/agent.json',
        '/tmp/import/top.json',
      ]);
      console.info(`[real] copied owners ${JSON.stringify(owners)}`);
      expect(owners.stdout.split('\n')).toEqual([
        '/data/top.json 65534:65534 640',
        '/data/acme 65534:65534 750',
        '/data/acme/agent.json 65534:65534 600',
        '/tmp/import/top.json 65534:65534 640',
      ]);
      const out = join(stateRoot, 'copy-out');
      expect(
        (
          await copyOutOfInstance(context, name, '/data', out, {
            maxBytes: 1000,
            timeoutS: 60,
          })
        ).success,
      ).toBe(true);
      expect(readFileSync(join(out, 'acme', 'agent.json'), 'utf8')).toBe(
        '{"b":2}',
      );
      const capped = await copyOutOfInstance(
        context,
        name,
        '/data',
        join(stateRoot, 'copy-capped'),
        { maxBytes: 10, timeoutS: 60 },
      );
      expect(capped.stderr).toContain('more than 10 bytes');
    });

    test('a one-shot helper runs from tale-proxy over a volume, with no network, and is deleted', async () => {
      const helpers = () =>
        client
          .listInstances()
          .then((all) =>
            all.filter((one) => one.config['user.tale.role'] === 'helper'),
          );
      const job = await runOneShot(
        context,
        {
          image: 'alpine:3.22',
          purpose: 'ti12',
          mounts: [{ volume, target: '/data', readOnly: true }],
          argv: [
            'sh',
            '-c',
            'cat /data/top.json; cat; ls /sys/class/net; exit 3',
          ],
          stdin: '|stdin\n',
          timeoutS: 60,
        },
        {
          image: proxy.image.alias,
          digest: proxy.image.digest,
          pool: POOL,
          active: new Set(),
        },
      );
      console.info(`[real] one-shot ${JSON.stringify(job)}`);
      expect(job.exitCode).toBe(3);
      expect(job.stdout.split('\n')).toEqual(['{"a":1}|stdin', 'lo']);
      expect(await helpers()).toEqual([]);
    });

    test('health runs the healthcheck by exec and judges it as Docker does', async () => {
      const healthy = new IncusHealth(context, () => ({
        test: ['CMD-SHELL', '[ -d /data ] && pidof caddy >/dev/null'],
        intervalMs: 1_000,
        timeoutMs: 5_000,
        retries: 2,
        startPeriodMs: 0,
      }));
      expect(await healthy.health(name)).toBe('healthy');
      let now = Date.now();
      const broken = new IncusHealth(
        context,
        () => ({
          test: ['CMD', 'false'],
          intervalMs: 1_000,
          timeoutMs: 5_000,
          retries: 2,
          startPeriodMs: 0,
        }),
        () => now,
      );
      expect(await broken.health(name)).toBe('starting');
      now += 1_000;
      expect(await broken.health(name)).toBe('unhealthy');
    });

    test('the console: refused running without --consume, taken by a read, and the stopped one is what no read took', async () => {
      const refusal = await readInstanceLogs(
        context,
        name,
        { follow: false },
        () => undefined,
      ).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CliError);
      const lines: string[] = [];
      const warnings: string[] = [];
      await readInstanceLogs(
        context,
        name,
        { follow: false, consume: true },
        (line) => lines.push(line),
        { warn: (line) => warnings.push(line) },
      );
      console.info(
        `[real] running console read: ${lines.length} lines, warning ${JSON.stringify(warnings)}`,
      );
      expect(warnings).toHaveLength(1);
      expect(lines.filter((line) => line.startsWith('console-'))).toEqual(
        Array.from({ length: 40 }, (_, index) => `console-${index + 1}`),
      );
      // A second read finds nothing of what the first took.
      const again: string[] = [];
      await readInstanceLogs(
        context,
        name,
        { follow: false, consume: true },
        (line) => again.push(line),
        { warn: () => undefined },
      );
      expect(again.filter((line) => line.startsWith('console-'))).toEqual([]);
      expect(await crashTail(context, name)).toBeNull();
      await stopStackInstance(client, name, 10);
      const tail = await crashTail(context, name);
      console.info(`[real] stopped console ${JSON.stringify(tail)}`);
      expect(tail?.label).toBe(CRASH_TAIL_LABEL);
      expect(tail?.lines.filter((line) => line.startsWith('console-'))).toEqual(
        [],
      );
    });
  });

  test('the probe finds the project ready', async () => {
    const probe = await probeIncus(client, {
      pool: POOL,
      registries: ['ghcr.io'],
    });
    console.info(`[real] probe ${JSON.stringify(probe)}`);
    expect(probe.errors).toEqual([]);
    expect(probe.facts?.platform).toBe(PLATFORM);
  });

  test('tale-proxy is pulled by digest, and a second ensure keeps it', async () => {
    const proxy = await release('proxy', 'tale-proxy', {
      address: `${PREFIX}.20`,
      entrypoint: '',
      environment: {},
      mounts: [],
    });
    // An earlier run's copy goes first, so this pull is a real one.
    const earlier = await client.getImageAlias(proxy.image.alias);
    if (earlier !== undefined)
      await client.deleteImage(earlier.target, 120_000);
    const first = await ensureImages(client, [proxy.image], { stateRoot });
    console.info(`[real] first ensure ${JSON.stringify(first)}`);
    expect(first).toEqual({
      pulled: [proxy.image.alias],
      kept: [],
      failed: [],
    });
    const again = await ensureImages(client, [proxy.image], { stateRoot });
    expect(again).toEqual({
      pulled: [],
      kept: [proxy.image.alias],
      failed: [],
    });
    expect((await client.getImageAlias(proxy.image.alias))?.target).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  test('an instance is made, started, read back, stopped and removed; its volume is made as the image owns the path', async () => {
    const proxy = await release('proxy', 'tale-proxy', {
      address: `${PREFIX}.21`,
      entrypoint: 'caddy file-server --listen :8080 --root /data',
      environment: {},
      mounts: [{ volume: `proxy-data-${run}`, path: '/data' }],
    });
    const { target, facts } = await boot([proxy]);
    expect(facts.get(proxy.image.digest)?.paths['/data']?.type).toBe(
      'directory',
    );
    const name = target.instances[0]?.name ?? '';
    const info = await inspectStackInstance(client, name, testKey());
    console.info(`[real] inspect ${JSON.stringify(info)}`);
    expect(info).toMatchObject({ running: true, restarted: false });
    expect(info?.startedAt).not.toBeNull();
    const read = await client.getInstance(name);
    expect(read?.instance.config['user.tale.want']).toBe('running');
    expect(read?.instance.config['user.tale.started']).toBe(
      info?.startedAt ?? '',
    );
    // Main's image ships no /init: Incus's lxc-init is PID 1, and the proof
    // says the entrypoint does not run as PID 1.
    const pid1 = await provePid1(client, name);
    console.info(`[real] pid1 without /init ${JSON.stringify(pid1)}`);
    expect(pid1).toEqual({ argv: ['init'], matches: false });
    const started = Date.now();
    await stopStackInstance(client, name, 10);
    console.info(`[real] stop took ${Date.now() - started} ms`);
    const stopped = await client.getInstance(name);
    expect(stopped?.instance.status).toBe('Stopped');
    expect(stopped?.instance.config['user.tale.want']).toBe('stopped');
    expect(await removeStackInstance(client, STACK, name)).toBe(true);
    expect(await client.getInstance(name)).toBeUndefined();
  });

  test.skipIf(INIT_IMAGE === '')(
    'an image with the patched /init runs the entrypoint as PID 1',
    async () => {
      const digest = INIT_IMAGE.slice(INIT_IMAGE.indexOf('@') + 1);
      const image: StackImage = {
        alias: imageAlias({ reference: INIT_IMAGE, digest }),
        reference: INIT_IMAGE,
        digest,
        services: ['initproof'],
      };
      const ensured = await ensureImages(client, [image], { stateRoot });
      expect(ensured.failed).toEqual([]);
      const words = [
        '/init',
        '--single-child',
        '--rewrite',
        '30:15',
        '--rewrite',
        '37:15',
        '--rewrite',
        '38:15',
        '--',
        'caddy',
        'file-server',
        '--listen',
        ':8080',
        '--root',
        '/srv',
      ];
      const spec = instanceSpec({
        name: 'initproof',
        image,
        address: `${PREFIX}.24`,
        entrypoint: words.join(' '),
        environment: {},
        mounts: [],
      });
      made.instances.push(spec.name);
      await createStackInstance(client, spec);
      await startStackInstance(client, spec.name);
      const pid1 = await provePid1(client, spec.name);
      console.info(`[real] pid1 with /init ${JSON.stringify(pid1)}`);
      expect(pid1).toEqual({ argv: words, matches: true });
      const started = Date.now();
      await stopStackInstance(client, spec.name, 'forever');
      console.info(
        `[real] /init stop ('forever' = the declared 20 s) took ${Date.now() - started} ms`,
      );
      expect((await client.getInstance(spec.name))?.instance.status).toBe(
        'Stopped',
      );
    },
  );

  test("main's platform image boots on empty volumes (R3-20)", async () => {
    const platform = await release('platform', 'tale-platform', {
      address: `${PREFIX}.22`,
      entrypoint: '/usr/bin/tini -- /app/docker-entrypoint.sh',
      environment: {
        TALE_ROLE: 'web',
        SITE_URL: `http://${PREFIX}.22:3000`,
        BETTER_AUTH_SECRET: `ti11-${run}-${'x'.repeat(32)}`,
        TALE_BACKEND_URL: 'http://127.0.0.1:3005',
        // The entrypoint refuses to start without one; no database runs here.
        DB_PASSWORD: `ti11-${run}`,
      },
      mounts: [
        { volume: `config-data-${run}`, path: '/app/data', readOnly: true },
        { volume: `static-assets-${run}`, path: '/app/static-assets' },
      ],
    });
    const { target, facts } = await boot([platform]);
    const name = target.instances[0]?.name ?? '';
    const app = facts.get(platform.image.digest)?.appUser;
    expect(app).not.toBeNull();
    const health = await within(
      150,
      () =>
        exec(name, [
          'sh',
          '-c',
          'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health',
        ]),
      (value) => value.out === '200',
    );
    const owners = await exec(name, [
      'stat',
      '-c',
      '%n %u:%g %a',
      '/app/data',
      '/app/static-assets',
    ]);
    const log = await consoleOf(name);
    console.info(
      `[real] platform /api/health ${JSON.stringify(health)} owners ${JSON.stringify(owners)} console tail:\n${log.slice(-4000)}`,
    );
    expect((await client.getInstance(name))?.instance.status).toBe('Running');
    expect(health.out).toBe('200');
    expect(owners.out).toContain(`/app/data ${app?.uid}:${app?.gid}`);
    expect(owners.out).toContain(`/app/static-assets ${app?.uid}:${app?.gid}`);
    expect(log).not.toMatch(/permission denied|not writable/i);
  });

  test("main's sandbox image boots on empty volumes (R3-20)", async () => {
    const sandbox = await release('sandbox', 'tale-sandbox', {
      address: `${PREFIX}.23`,
      entrypoint: '/docker-entrypoint.sh',
      environment: { SANDBOX_TOKEN: `ti11-${run}-${'y'.repeat(48)}` },
      mounts: [
        {
          volume: `platform-config-${run}`,
          path: '/app/platform-config',
          readOnly: true,
        },
      ],
    });
    const { target } = await boot([sandbox]);
    const name = target.instances[0]?.name ?? '';
    const answer = await within(
      90,
      () =>
        exec(name, [
          'sh',
          '-c',
          'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8003/health',
        ]),
      (value) => /^[1-5][0-9][0-9]$/.test(value.out),
    );
    const listing = await exec(name, ['ls', '-la', '/app/platform-config']);
    const log = await consoleOf(name);
    console.info(
      `[real] sandbox /health ${JSON.stringify(answer)} platform-config ${JSON.stringify(listing)} console tail:\n${log.slice(-4000)}`,
    );
    expect((await client.getInstance(name))?.instance.status).toBe('Running');
    expect(answer.out).toMatch(/^[1-5][0-9][0-9]$/);
    expect(listing.code).toBe(0);
    expect(log).not.toMatch(/permission denied|not writable/i);
  });
});
