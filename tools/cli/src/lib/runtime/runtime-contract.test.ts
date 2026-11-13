import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
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

import { FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../utils/fail';
import { logs } from '../actions/logs';
import { status } from '../actions/status';
import { setProjectId } from '../project/project-context';
import { createDockerRuntime } from './docker/docker-runtime';
import {
  FakeRuntime,
  ISOLATED_TEST_VARIABLE,
  fakeDockerCli,
  runIsolatedTestFile,
  type FakeInstance,
  type FakeInstanceSeed,
} from './fake-runtime';
import type { IncusDeclaration } from './incus/compile/stack-target';
import { IncusRuntime } from './incus/incus-runtime';
import { incusStateDirectory } from './incus/plan/digest';
import { IMAGE_FACTS_FILE } from './incus/verbs/image-facts-cache';
import type { InstanceMount, OneShotJob, StackRuntime } from './types';

/**
 * One contract, three runtimes: `FakeRuntime` itself, the Docker runtime
 * driving the real `lib/docker` modules over Docker's command line as the
 * fake answers it, and the Incus runtime over the in-memory Incus of
 * `@tale/incus`, mirrored from the same model. The Incus leg runs the verbs
 * the Incus runtime answers today; the ones it does not (converge, the
 * Docker-shaped readback, volumes, quiescing, image names) and the one it
 * answers with another contract (withdrawal: a marker that cuts nothing,
 * `incus/verbs/switch.test.ts`) are named in its `skips`. Bun's module mocks are process-wide, so the suite
 * runs in a `bun test` of its own.
 */
const PROJECT = 'demo-abc123';
const BLUE = `${PROJECT}-blue`;
const GREEN = `${PROJECT}-green`;
const REGISTRY = 'ghcr.io/tale-project/tale';
/** A secret no reader may ever print. */
const SENTINEL = 'sentinel-secret-7f3a9c';
const PAYLOAD = '{"newPassword":"payload-on-stdin-4b2e"}';

function volume(name: string, target: string, readOnly = false): InstanceMount {
  return { kind: 'volume', source: `${PROJECT}_${name}`, target, readOnly };
}

/** The database, a blue colour with one stopped api replica and a one-off
 *  run, the volumes they mount and the serving networks. */
function seedStack(model: FakeRuntime): void {
  model.seedVolume(`${PROJECT}_db-data`);
  model.seedVolume(`${PROJECT}_config-data`);
  model.seedVolume(`${PROJECT}_spare`);
  model.seedNetwork(`${PROJECT}_internal`);
  model.seedNetwork('tale-sandbox-net', { internal: true, ipv6: false });
  model.seedInstance({
    name: `${PROJECT}-db`,
    stack: PROJECT,
    service: 'db',
    image: `${REGISTRY}/tale-db:0.6.0`,
    mounts: [volume('db-data', '/var/lib/postgresql/data')],
    environment: {
      DB_USER: 'tale',
      POSTGRES_PASSWORD: SENTINEL,
      TALE_DB_ROLE: 'app',
    },
    log: ['database system is ready to accept connections'],
  });
  const platform = `${REGISTRY}/tale-platform:0.6.0`;
  const secrets = {
    DATABASE_URL: `postgresql://tale:${SENTINEL}@db:5432/tale_app`,
    TALE_CONTROL_TOKEN: SENTINEL,
  };
  model.seedInstance({
    stack: BLUE,
    service: 'platform',
    image: platform,
    mounts: [volume('config-data', '/app/data', true)],
    networks: [`${PROJECT}_internal`],
    environment: secrets,
  });
  model.seedInstance({
    stack: BLUE,
    service: 'backend-api',
    image: platform,
    mounts: [volume('config-data', '/app/data')],
    networks: [`${PROJECT}_internal`, 'tale-sandbox-net'],
    environment: { ...secrets, TALE_ROLE: 'api' },
  });
  model.seedInstance({
    stack: BLUE,
    service: 'backend-api',
    index: 2,
    image: platform,
    state: 'exited',
    mounts: [volume('config-data', '/app/data')],
    environment: secrets,
  });
  model.seedInstance({
    stack: BLUE,
    service: 'backend-worker',
    image: platform,
    health: 'none',
    environment: secrets,
  });
  model.seedInstance({
    name: `${BLUE}-backend-api-run-0c1d`,
    stack: BLUE,
    service: 'backend-api',
    oneOff: true,
    image: platform,
  });
}

/** The contract's tests a leg may leave out, with its reason. */
type ContractTest =
  | 'converge'
  | 'readback-shape'
  | 'stop-remove'
  | 'volumes'
  | 'quiesce'
  | 'withdraw'
  | 'images'
  | 'list-by-name';

interface Leg {
  name: string;
  /** A fresh model, and the runtime that answers from it. */
  make(): { runtime: StackRuntime; model: FakeRuntime };
  /** Every argv the leg sent to a command line; empty for FakeRuntime. */
  argv(): string[][];
  /** The image a one-shot job runs from on this runtime; the job's own when
   *  absent. */
  helperImage?: string;
  /** Tests this runtime does not answer yet. */
  skips?: ReadonlySet<ContractTest>;
  /** Release what `make` held. */
  cleanup?(): void;
}

/** What every runtime answers alike. */
function contract(leg: Leg): void {
  const it = (
    key: ContractTest | null,
    name: string,
    body: () => Promise<void>,
    timeout?: number,
  ) =>
    (key !== null && leg.skips?.has(key) === true ? test.skip : test)(
      name,
      body,
      timeout,
    );
  let runtime: StackRuntime;
  let model: FakeRuntime;
  let scratch: string;

  beforeEach(() => {
    setProjectId(PROJECT);
    ({ runtime, model } = leg.make());
    seedStack(model);
    scratch = mkdtempSync(join(tmpdir(), 'tale-runtime-contract-'));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
    leg.cleanup?.();
  });

  test('lists a stack by service then replica, stopped ones in, one-offs out', async () => {
    const blue = await runtime.list({ stack: BLUE });
    expect(
      blue.map(({ name, running, state, colour, oneOff }) => ({
        name,
        running,
        state,
        colour,
        oneOff,
      })),
    ).toEqual([
      {
        name: `${BLUE}-backend-api-1`,
        running: true,
        state: 'running',
        colour: 'blue',
        oneOff: false,
      },
      {
        name: `${BLUE}-backend-api-2`,
        running: false,
        state: 'exited',
        colour: 'blue',
        oneOff: false,
      },
      {
        name: `${BLUE}-backend-worker-1`,
        running: true,
        state: 'running',
        colour: 'blue',
        oneOff: false,
      },
      {
        name: `${BLUE}-platform-1`,
        running: true,
        state: 'running',
        colour: 'blue',
        oneOff: false,
      },
    ]);
    expect(
      (await runtime.list({ stack: BLUE, service: 'backend-api' })).map(
        ({ service, index, stack }) => ({ service, index, stack }),
      ),
    ).toEqual([
      { service: 'backend-api', index: 1, stack: BLUE },
      { service: 'backend-api', index: 2, stack: BLUE },
    ]);
    expect(await runtime.list({ stack: GREEN })).toEqual([]);
  });

  test('reads one instance, and answers for one that is not there', async () => {
    const db = `${PROJECT}-db`;
    expect(await runtime.exists(db)).toBe(true);
    expect(await runtime.isRunning(db)).toBe(true);
    expect(await runtime.state(db)).toBe('running');
    expect(await runtime.health(db)).toBe('healthy');
    expect(await runtime.version(db)).toBe('0.6.0');
    expect(await runtime.isRunning(`${BLUE}-backend-api-2`)).toBe(false);
    expect(await runtime.state(`${BLUE}-backend-api-2`)).toBe('exited');
    expect(await runtime.health(`${BLUE}-backend-worker-1`)).toBe('none');

    const gone = `${PROJECT}-nothing`;
    expect(await runtime.exists(gone)).toBe(false);
    expect(await runtime.isRunning(gone)).toBe(false);
    expect(await runtime.state(gone)).toBeNull();
    expect(await runtime.version(gone)).toBeNull();
    expect(await runtime.health(gone)).toBe('none');
    expect(await runtime.inspect(gone)).toBeNull();
  });

  it(
    'readback-shape',
    'reads an instance back with its allow-listed environment only',
    async () => {
      const info = await runtime.inspect(`${PROJECT}-db`);
      expect(info).toEqual({
        stack: PROJECT,
        service: 'db',
        index: 1,
        oneOff: false,
        name: `${PROJECT}-db`,
        running: true,
        state: 'running',
        startedAt: '2026-11-12T00:00:00Z',
        restarted: false,
        image: {
          reference: `${REGISTRY}/tale-db:0.6.0`,
          digest: model.images.get(`${REGISTRY}/tale-db:0.6.0`)?.id ?? null,
          version: '0.6.0',
          revision: null,
          automationWriterProtocol: null,
        },
        environment: { TALE_VERSION: '0.6.0', TALE_DB_ROLE: 'app' },
        environmentDigest: null,
        mounts: [volume('db-data', '/var/lib/postgresql/data')],
        address: null,
        configDigest: null,
      });
      const api = await runtime.inspect(`${BLUE}-backend-api-1`);
      expect(api?.colour).toBe('blue');
      expect(api?.environment).toEqual({
        TALE_VERSION: '0.6.0',
        TALE_ROLE: 'api',
      });
      expect(JSON.stringify([info, api])).not.toContain(SENTINEL);
    },
  );

  it(
    'converge',
    'converges the scoped services to their scale, keeping what did not change',
    async () => {
      const compose = [
        'services:',
        '  web:',
        '    image: example/web:1',
        '    healthcheck:',
        "      test: ['CMD', 'true']",
        '  job:',
        '    image: example/job:1',
        '',
      ].join('\n');
      const target = { stack: GREEN, compose, cwd: scratch };
      expect(
        (
          await runtime.converge(target, {
            services: ['web'],
            scale: { web: 2 },
          })
        ).success,
      ).toBe(true);
      expect((await runtime.list({ stack: GREEN })).map((i) => i.name)).toEqual(
        [`${GREEN}-web-1`, `${GREEN}-web-2`],
      );
      const first = model.find(`${GREEN}-web-1`)?.id;

      await runtime.converge(target, { services: ['web'], scale: { web: 2 } });
      expect(model.find(`${GREEN}-web-1`)?.id).toBe(first);

      await runtime.converge(target, {
        services: ['web'],
        scale: { web: 1 },
        forceRecreate: true,
      });
      expect(model.find(`${GREEN}-web-1`)?.id).not.toBe(first);
      expect((await runtime.list({ stack: GREEN })).map((i) => i.name)).toEqual(
        [`${GREEN}-web-1`],
      );
      expect(await runtime.health(`${GREEN}-web-1`)).toBe('healthy');
    },
  );

  test('waits for health as Docker judges it', async () => {
    const options = { timeout: 1 };
    expect(await runtime.waitHealthy(`${PROJECT}-db`, options)).toBe(true);
    // No health check: running is the strongest signal it has.
    expect(await runtime.waitHealthy(`${BLUE}-backend-worker-1`, options)).toBe(
      true,
    );
    const api1 = model.find(`${BLUE}-backend-api-1`);
    if (api1) api1.health = 'unhealthy';
    expect(await runtime.waitHealthy(`${BLUE}-backend-api-1`, options)).toBe(
      false,
    );
    // Fewer replicas than asked for is a failure, not something to wait out.
    expect(
      await runtime.waitServiceHealthy(BLUE, 'platform', {
        timeout: 1,
        expectedReplicas: 2,
      }),
    ).toBe(false);
    expect(
      await runtime.waitServiceHealthy(BLUE, 'platform', {
        timeout: 1,
        expectedReplicas: 1,
      }),
    ).toBe(true);
  }, 30_000);

  it(
    'stop-remove',
    'stops and removes; a missing instance counts as removed',
    async () => {
      const api = `${BLUE}-backend-api-1`;
      expect(await runtime.stop(api)).toBe(true);
      expect(await runtime.isRunning(api)).toBe(false);
      expect(await runtime.state(api)).toBe('exited');
      expect(await runtime.remove(api)).toBe(true);
      expect(await runtime.exists(api)).toBe(false);
      expect(await runtime.remove(api)).toBe(true);
      expect(await runtime.stop(`${PROJECT}-nothing`)).toBe(false);
    },
  );

  test('execs with stdin on stdin, never in argv, and keeps the exit code', async () => {
    const seen: Array<{ argv: readonly string[]; stdin: string | undefined }> =
      [];
    model.execHandler = (_instance, argv, stdin) => {
      seen.push({ argv, stdin });
      return argv.includes('fail')
        ? { success: false, stdout: '', stderr: 'boom', exitCode: 7 }
        : { success: true, stdout: 'done', stderr: '', exitCode: 0 };
    };
    const api = `${BLUE}-backend-api-1`;
    const withStdin = await runtime.exec(api, ['sh', '-c', 'cat'], {
      stdin: PAYLOAD,
    });
    expect(withStdin).toMatchObject({ success: true, stdout: 'done' });
    const failing = await runtime.exec(api, ['sh', '-c', 'fail']);
    expect(failing).toMatchObject({ success: false, exitCode: 7 });
    expect(seen).toEqual([
      { argv: ['sh', '-c', 'cat'], stdin: PAYLOAD },
      { argv: ['sh', '-c', 'fail'], stdin: undefined },
    ]);
    expect(
      (await runtime.exec(`${BLUE}-backend-api-2`, ['true'])).success,
    ).toBe(false);
    expect(leg.argv().flat().join(' ')).not.toContain(PAYLOAD);
  });

  test('runs a one-shot job over volumes and keeps its exit code', async () => {
    const jobs: unknown[] = [];
    model.jobHandler = (job) => {
      jobs.push({
        image: job.image,
        mounts: job.mounts.map((mount) => ({
          ...mount,
          readOnly: mount.readOnly === true,
        })),
        argv: job.argv,
        stdin: job.stdin,
      });
      return { success: false, stdout: '', stderr: 'exit 3', exitCode: 3 };
    };
    const result = await runtime.oneShot({
      image: 'alpine:3.22',
      mounts: [
        { volume: `${PROJECT}_db-data`, target: '/data', readOnly: true },
        { volume: `${PROJECT}_spare`, target: '/backup' },
      ],
      argv: ['sh', '-c', 'cat > /backup/x'],
      stdin: PAYLOAD,
      timeoutS: 30,
    });
    expect(result).toMatchObject({ success: false, exitCode: 3 });
    expect(jobs).toEqual([
      {
        image: leg.helperImage ?? 'alpine:3.22',
        mounts: [
          { volume: `${PROJECT}_db-data`, target: '/data', readOnly: true },
          { volume: `${PROJECT}_spare`, target: '/backup', readOnly: false },
        ],
        argv: ['sh', '-c', 'cat > /backup/x'],
        stdin: PAYLOAD,
      },
    ]);
    expect(leg.argv().flat().join(' ')).not.toContain(PAYLOAD);
  });

  test('copies a directory in and back out, within the byte cap', async () => {
    const source = join(scratch, 'source');
    mkdirSync(join(source, 'acme'), { recursive: true });
    writeFileSync(join(source, 'top.json'), '{"a":1}');
    writeFileSync(join(source, 'acme', 'agent.json'), '{"b":2}');
    const api = `${BLUE}-backend-api-1`;
    expect(
      await runtime.copyIn(api, source, '/app/data/', {
        user: 'app',
        group: 'app',
      }),
    ).toEqual({ success: true });
    const out = join(scratch, 'out');
    mkdirSync(out);
    expect(
      (
        await runtime.copyOut(api, '/app/data', out, {
          maxBytes: 1_000,
          timeoutS: 30,
        })
      ).success,
    ).toBe(true);
    expect(readFileSync(join(out, 'top.json'), 'utf8')).toBe('{"a":1}');
    expect(readFileSync(join(out, 'acme', 'agent.json'), 'utf8')).toBe(
      '{"b":2}',
    );
    const capped = join(scratch, 'capped');
    mkdirSync(capped);
    expect(
      (
        await runtime.copyOut(api, '/app/data', capped, {
          maxBytes: 4,
          timeoutS: 30,
        })
      ).success,
    ).toBe(false);
    expect(
      await runtime.copyIn(`${PROJECT}-nothing`, source, '/x/'),
    ).toMatchObject({ success: false, stage: 'copy' });
  });

  it(
    'volumes',
    'keeps volumes: create, find, delete, and the instances that use them',
    async () => {
      expect(await runtime.ensureVolumes(['cache'], `${PROJECT}_`)).toBe(true);
      expect(await runtime.ensureVolumes(['logs'])).toBe(true);
      expect(await runtime.volumeExists(`${PROJECT}_cache`)).toBe(true);
      expect(await runtime.volumeExists(`${PROJECT}_logs`)).toBe(true);
      expect(
        await runtime.volumeRemovalHint(`${PROJECT}_cache`),
      ).not.toBeNull();
      expect(await runtime.removeVolume(`${PROJECT}_cache`)).toBe(true);
      expect(await runtime.volumeExists(`${PROJECT}_cache`)).toBe(false);
      expect(await runtime.volumeRemovalHint(`${PROJECT}_cache`)).toBeNull();
      // A volume an instance still mounts is never deleted under it.
      expect(await runtime.removeVolume(`${PROJECT}_db-data`)).toBe(false);
      expect(await runtime.volumeExists(`${PROJECT}_db-data`)).toBe(true);
      expect(await runtime.volumeUsers(`${PROJECT}_config-data`)).toHaveLength(
        2,
      );
    },
  );

  it(
    'quiesce',
    'quiesces the users of a volume for the work, and only for it',
    async () => {
      const platform = `${BLUE}-platform-1`;
      const during = await runtime.quiesce(
        [`${PROJECT}_config-data`],
        async (frozen) => ({ frozen, state: await runtime.state(platform) }),
      );
      expect(during).toEqual({ frozen: 2, state: 'paused' });
      expect(await runtime.state(platform)).toBe('running');
    },
  );

  it(
    'withdraw',
    'withdraws a colour from the serving names, once',
    async () => {
      await runtime.admit(BLUE, ['platform', 'backend-api']);
      expect(await runtime.withdraw(BLUE, ['platform', 'backend-api'])).toBe(3);
      expect(await runtime.withdraw(BLUE, ['platform', 'backend-api'])).toBe(0);
    },
  );

  it('images', 'pulls, finds and names images', async () => {
    expect(await runtime.imagePresent('example/tool:1')).toBe(false);
    expect(await runtime.pull('example/tool:1')).toBe(true);
    expect(await runtime.imagePresent('example/tool:1')).toBe(true);
    expect((await runtime.tag('example/tool:1', 'tool:latest')).success).toBe(
      true,
    );
    expect(await runtime.imagePresent('tool:latest')).toBe(true);
    model.unpullable.add('example/missing:1');
    expect(await runtime.pull('example/missing:1')).toBe(false);
  });

  it(
    'list-by-name',
    'lists every instance whose name carries the project',
    async () => {
      const listed = await runtime.listByName(PROJECT);
      expect(listed.map((entry) => entry.name).sort()).toEqual(
        [...model.instances.keys()].sort(),
      );
      const stopped = listed.find((e) => e.name === `${BLUE}-backend-api-2`);
      expect(stopped?.status.startsWith('Up')).toBe(false);
      expect(
        listed.find((e) => e.name === `${PROJECT}-db`)?.status.startsWith('Up'),
      ).toBe(true);
    },
  );
}

/** Everything a reader writes while `run` runs. */
async function captureOutput(run: () => Promise<void>): Promise<string> {
  const written: string[] = [];
  const collect = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };
  const stdout = spyOn(process.stdout, 'write').mockImplementation(collect);
  const stderr = spyOn(process.stderr, 'write').mockImplementation(collect);
  const log = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    written.push(args.map(String).join(' '));
  });
  try {
    await run();
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    log.mockRestore();
  }
  return written.join('');
}

/** No reader of a deployment prints a secret its instances carry. */
function secretReaders(leg: Leg): void {
  let runtime: StackRuntime;
  let model: FakeRuntime;
  let deployDir: string;

  beforeEach(() => {
    setProjectId(PROJECT);
    ({ runtime, model } = leg.make());
    seedStack(model);
    deployDir = mkdtempSync(join(tmpdir(), 'tale-runtime-secrets-'));
  });
  afterEach(() => {
    rmSync(deployDir, { recursive: true, force: true });
    leg.cleanup?.();
  });

  test('status, as JSON and as text, names the instances and no secret', async () => {
    for (const json of [true, false]) {
      const output = await captureOutput(() =>
        status({ deployDir, json, runtime }),
      );
      expect(output).toContain(`${PROJECT}-db`);
      expect(output).not.toContain(SENTINEL);
    }
  });

  test('every readback of every instance leaves the secret out', async () => {
    const readbacks = await Promise.all(
      [...model.instances.keys()].map((name) => runtime.inspect(name)),
    );
    expect(readbacks.every((info) => info !== null)).toBe(true);
    expect(JSON.stringify(readbacks)).not.toContain(SENTINEL);
  });
}

/** The Incus project the Incus leg runs in. */
const INCUS_DECLARATION: IncusDeclaration = {
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
const HELPER_ALIAS = 'tale-proxy-0123456789abcdef0123456789abcdef';
/** The probe the Incus leg's healthchecks run; it answers from the model. */
const HEALTH_PROBE = 'tale-contract-health';
const ACCOUNTS = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\napp:x:1001:1001::/app:/bin/sh\n',
  '/etc/group': 'root:x:0:\napp:x:1001:\n',
};

/**
 * The model, mirrored into an in-memory Incus as the Incus runtime would
 * have made it: each instance with its labels, environment, volume devices
 * and console; each volume labelled for the stack; the image facts naming
 * `timeout`. What a command does in an instance, and what a helper job does,
 * the model answers, as it does for the other legs.
 */
class IncusBackedModel extends FakeRuntime {
  readonly incus = new FakeIncus({
    project: INCUS_DECLARATION.project,
    profile: 'tale-stack',
    network: INCUS_DECLARATION.network.name,
    pool: INCUS_DECLARATION.pool,
    image: 'tale-unused',
  });
  readonly stateRoot = mkdtempSync(join(tmpdir(), 'tale-runtime-incus-'));
  readonly runtime: IncusRuntime;
  private readonly facts: Record<string, unknown> = {};

  constructor() {
    super();
    this.incus.addImage(HELPER_ALIAS);
    this.runtime = new IncusRuntime({
      client: this.incus.client(),
      declaration: INCUS_DECLARATION,
      stack: PROJECT,
      stateRoot: this.stateRoot,
      healthchecks: (name) => {
        const instance = this.find(name);
        if (instance === undefined) return undefined;
        if (instance.health === 'none') return { disabled: true };
        return {
          test: ['CMD', HEALTH_PROBE],
          intervalMs: 1_000,
          timeoutMs: 5_000,
          retries: 3,
          startPeriodMs: 0,
        };
      },
      helperImage: { alias: HELPER_ALIAS },
    });
    this.incus.exec = async (call, io) => {
      if (call.command[0] === HEALTH_PROBE)
        return this.find(call.instance.name)?.health === 'healthy' ? 0 : 1;
      const bytes = await io.stdin();
      const stdin =
        bytes.byteLength === 0 ? undefined : new TextDecoder().decode(bytes);
      const result =
        call.instance.config['user.tale.role'] === 'helper'
          ? this.answerJob(
              this.jobOf(call.instance.devices, call.command, stdin),
            )
          : this.answerInstance(call.instance.name, call.command, stdin);
      io.write(1, result.stdout);
      io.write(2, result.stderr);
      return result.exitCode;
    };
  }

  private answerInstance(
    name: string,
    argv: readonly string[],
    stdin: string | undefined,
  ) {
    const instance = this.find(name);
    if (instance === undefined)
      return { success: false, stdout: '', stderr: 'gone', exitCode: 1 };
    return this.answerExec(instance, argv, stdin);
  }

  /** The job a helper runs, as Docker's leg would have been given it. */
  private jobOf(
    devices: Record<string, Record<string, string>>,
    argv: readonly string[],
    stdin: string | undefined,
  ): OneShotJob {
    return {
      image: HELPER_ALIAS,
      mounts: Object.entries(devices)
        .filter(([, device]) => device.type === 'disk')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, device]) => ({
          volume: device.source ?? '',
          target: device.path ?? '',
          readOnly: device.readonly === 'true',
        })),
      argv: [...argv],
      ...(stdin === undefined ? {} : { stdin }),
    };
  }

  override seedVolume(name: string, files: Record<string, string> = {}): void {
    super.seedVolume(name, files);
    this.incus.seedVolume(name, { 'user.tale.stack': PROJECT });
  }

  override seedInstance(seed: FakeInstanceSeed): FakeInstance {
    const instance = super.seedInstance(seed);
    const image = this.images.get(instance.image);
    const digest = image?.id ?? '';
    const version = image?.labels['org.opencontainers.image.version'];
    const colour = instance.stack.endsWith('-blue')
      ? 'blue'
      : instance.stack.endsWith('-green')
        ? 'green'
        : undefined;
    const running = instance.state === 'running';
    const config: Record<string, string> = {
      'user.tale.stack': instance.stack,
      'user.tale.service': instance.service,
      'user.tale.role': instance.oneOff ? 'helper' : instance.service,
      'user.tale.index': String(instance.index),
      ...(colour === undefined ? {} : { 'user.tale.colour': colour }),
      'user.tale.image': digest,
      ...(version === undefined ? {} : { 'user.tale.version': version }),
      'user.tale.want': running ? 'running' : 'stopped',
    };
    for (const [key, value] of Object.entries(instance.environment))
      config[`environment.${key}`] = value;
    const devices: Record<string, Record<string, string>> = {};
    for (const [index, mount] of instance.mounts.entries())
      devices[`volume-${index}`] = {
        type: 'disk',
        pool: INCUS_DECLARATION.pool,
        source: mount.source,
        path: mount.target,
        ...(mount.readOnly ? { readonly: 'true' } : {}),
      };
    const mirrored = this.incus.seedInstance(instance.name, config, {
      ephemeral: false,
      status: running ? 'Running' : 'Stopped',
      devices,
    });
    for (const [path, content] of Object.entries(ACCOUNTS))
      mirrored.files.set(path, { content, mode: '0644', uid: 0, gid: 0 });
    mirrored.consoleLog = instance.log.map((line) => `${line}\n`).join('');
    this.rememberTimeout(digest);
    return instance;
  }

  /** Each image's facts name `timeout`, so execs run in modes 1-2. */
  private rememberTimeout(digest: string): void {
    if (digest === '' || digest in this.facts) return;
    this.facts[digest] = {
      digest,
      paths: {},
      appUser: { uid: 1001, gid: 1001 },
      timeout: '/usr/bin/timeout',
      infraFormats: [],
      readAt: '2026-11-13T00:00:00.000Z',
    };
    const directory = incusStateDirectory(this.stateRoot);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(directory, IMAGE_FACTS_FILE),
      JSON.stringify({ schemaVersion: 1, images: this.facts }),
      { mode: 0o600 },
    );
  }

  close(): void {
    this.incus.close();
    rmSync(this.stateRoot, { recursive: true, force: true });
  }
}

function contractSuite(): void {
  let model = new FakeRuntime();
  let cli = fakeDockerCli(model);
  let sent: string[][] = [];
  mock.module('../docker/exec', () => ({
    exec: (
      command: string,
      args: string[],
      options: { stdin?: string } = {},
    ) => {
      sent.push([command, ...args]);
      return cli(command, args, options);
    },
  }));

  const fake: Leg = {
    name: 'FakeRuntime',
    make: () => {
      const runtime = new FakeRuntime();
      return { runtime, model: runtime };
    },
    argv: () => [],
  };
  const docker: Leg = {
    name: 'the Docker runtime over the fake docker command line',
    make: () => {
      model = new FakeRuntime();
      cli = fakeDockerCli(model);
      sent = [];
      return { runtime: createDockerRuntime(), model };
    },
    argv: () => sent,
  };

  let incusModel: IncusBackedModel | undefined;
  const incus: Leg = {
    name: 'the Incus runtime over the in-memory Incus',
    make: () => {
      incusModel = new IncusBackedModel();
      return { runtime: incusModel.runtime, model: incusModel };
    },
    argv: () => incusModel?.incus.execs.map((call) => call.argv) ?? [],
    helperImage: HELPER_ALIAS,
    skips: new Set<ContractTest>([
      // converge and quiescing are later lanes' verbs on Incus.
      'converge',
      'quiesce',
      // A marker withdrawal cuts no link (`withdrawal`): switch.test.ts.
      'withdraw',
      // Docker's shapes: image tags, the `Up …` status line, prefixed
      // volume names and the readback TI-10's own tests pin on Incus.
      'images',
      'list-by-name',
      'volumes',
      'readback-shape',
      // A colour's instances belong to the workspace stack's custody, which
      // the workspace path (TI-17) sets; the verbs' own tests remove.
      'stop-remove',
    ]),
    cleanup: () => {
      incusModel?.close();
      incusModel = undefined;
    },
  };

  // The Incus runtime needs a POSIX host and is refused on Windows
  // (assertIncusPlatform): its plan key and journal are held by owner and
  // mode, which Windows files do not carry.
  const legs =
    process.platform === 'win32' ? [fake, docker] : [fake, docker, incus];
  for (const leg of legs) {
    describe(`StackRuntime contract: ${leg.name}`, () => contract(leg));
    describe(`no reader prints a secret: ${leg.name}`, () =>
      secretReaders(leg));
  }

  describe('tale logs on Incus: a running console is read only when asked', () => {
    test('refuses without --consume, then warns in one line and shows no secret', async () => {
      setProjectId(PROJECT);
      const mirrored = new IncusBackedModel();
      seedStack(mirrored);
      const deployDir = mkdtempSync(join(tmpdir(), 'tale-runtime-logs-'));
      try {
        let refusal: unknown;
        await captureOutput(async () => {
          try {
            await logs({
              service: 'db',
              follow: false,
              deployDir,
              runtime: mirrored.runtime,
            });
          } catch (error) {
            refusal = error;
          }
        });
        expect(refusal).toBeInstanceOf(CliError);
        expect(mirrored.incus.seen('GET /1.0/instances/*/console')).toEqual([]);
        const output = await captureOutput(() =>
          logs({
            service: 'db',
            follow: false,
            consume: true,
            deployDir,
            runtime: mirrored.runtime,
          }),
        );
        expect(output).toContain('ready to accept connections');
        expect(output).toContain('takes the lines it shows');
        expect(output).not.toContain(SENTINEL);
      } finally {
        mirrored.close();
        rmSync(deployDir, { recursive: true, force: true });
      }
    });
  });

  describe('no reader prints a secret: tale logs', () => {
    test('shows the log and nothing of the environment', async () => {
      setProjectId(PROJECT);
      const runtime = new FakeRuntime();
      seedStack(runtime);
      const deployDir = mkdtempSync(join(tmpdir(), 'tale-runtime-logs-'));
      try {
        const output = await captureOutput(() =>
          logs({ service: 'db', follow: false, deployDir, runtime }),
        );
        expect(output).toContain('ready to accept connections');
        expect(output).not.toContain(SENTINEL);
      } finally {
        rmSync(deployDir, { recursive: true, force: true });
      }
    });
  });
}

// Registered last: the suite reads the constants and classes above.
const isolated = process.env[ISOLATED_TEST_VARIABLE] === import.meta.path;

if (!isolated) {
  test('the runtime contract passes in a process of its own', async () => {
    const { exitCode, output } = await runIsolatedTestFile(import.meta.path);
    if (exitCode !== 0 || !/\b[1-9]\d* pass\b/.test(output))
      throw new Error(output);
  }, 300_000);
} else {
  contractSuite();
}
