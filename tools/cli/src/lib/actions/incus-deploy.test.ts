import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../utils/fail';
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { AUTOMATION_PROTOCOL_LABEL } from '../deployment/automation-model';
import type { RegistryClient, ResolvedImage } from '../oci/registry';
import { setProjectId } from '../project/project-context';
import {
  readJournal,
  setRestorePending,
  type FlipPhase,
} from '../runtime/incus/apply/journal';
import { DOTENV, factsFor } from '../runtime/incus/compile/compile-fixture';
import type { IncusDeclaration } from '../runtime/incus/compile/stack-target';
import { createIncusRuntime } from '../runtime/incus/incus-runtime';
import { incusStateDirectory } from '../runtime/incus/plan/digest';
import { IMAGE_FACTS_FILE } from '../runtime/incus/verbs/image-facts-cache';
import { registryHosts } from '../runtime/incus/verbs/images';
import { REQUIRED_EXTENSIONS } from '../runtime/incus/verbs/probe';
import { getCurrentColor } from '../state/get-current-color';
import { getPreviousVersion } from '../state/get-previous-version';
import {
  deployOnIncus,
  IncusWorkspace,
  readWorkspacePlan,
  restrictPlan,
  rollbackOnIncus,
  servingApiReplica,
  type IncusDeployDependencies,
} from './incus-deploy';
import { status as showStatus } from './status';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

/**
 * The workspace path on Incus against the fake (design 7.2, 7.3): a first
 * deploy, a flip from release N to N+1 through the switch, a crash in every
 * phase of it and the resume, a rollback, an in-place roll of `--services`
 * one replica at a time, and the restore guard (R3-22).
 */

const REGISTRY = 'ghcr.io/tale-project/tale';
const N = '0.5.95';
const NEXT = '0.5.96';

const DECLARATION: IncusDeclaration = {
  project: 'tale-stack',
  pool: 'tale',
  network: {
    name: 'talebr0',
    subnet: '10.30.0.0/16',
    gateway: '10.30.0.1',
    block: '10.30.1.0/24',
  },
  sessions: { subnet: '10.40.0.0/24' },
  // The fake refuses proxy devices; the operator's forward reaches the
  // edge (design D-19).
  ingress: { mode: 'routed' },
};

/** A digest per reference, so each release's tag names its own image. */
function digestOf(reference: string): string {
  return `sha256:${createHash('sha256').update(reference).digest('hex')}`;
}

/** A registry serving every image of every release by its own digest, with
 * the shapes the compiler's fixtures use. */
function registry(): RegistryClient & { digests: Set<string> } {
  const digests = new Set<string>();
  return {
    digests,
    async resolve(reference: string): Promise<ResolvedImage> {
      const at = reference.indexOf('@');
      const digest = at === -1 ? digestOf(reference) : reference.slice(at + 1);
      const repository = (
        at === -1 ? reference : reference.slice(0, at)
      ).replace(/:[^/:]+$/, '');
      digests.add(digest);
      let facts;
      try {
        facts = factsFor(`${repository}@${digest}`);
      } catch {
        // The sessions' image, which no stack instance runs.
        facts = {
          labels: {},
          env: ['PATH=/usr/bin:/bin'],
          entrypoint: null,
          cmd: ['/bin/sh'],
          user: null,
          stopSignal: null,
          volumes: [] as string[],
        };
      }
      const labels: Record<string, string> = { ...facts.labels };
      if (repository.endsWith('/tale-platform'))
        labels[AUTOMATION_PROTOCOL_LABEL] = '2';
      if (at === -1 && repository.includes('/tale-project/tale/'))
        labels['org.opencontainers.image.version'] = reference.slice(
          reference.lastIndexOf(':') + 1,
        );
      return {
        reference: `${repository}@${digest}`,
        digest,
        manifestDigest: digest,
        configDigest: digest,
        os: 'linux',
        architecture: 'amd64',
        variant: null,
        config: {
          config: {
            Labels: labels,
            Env: facts.env,
            ...(facts.entrypoint ? { Entrypoint: facts.entrypoint } : {}),
            ...(facts.cmd ? { Cmd: facts.cmd } : {}),
            ...(facts.user ? { User: facts.user } : {}),
            ...(facts.stopSignal ? { StopSignal: facts.stopSignal } : {}),
            Volumes: Object.fromEntries(facts.volumes.map((v) => [v, {}])),
          },
        },
      };
    },
  };
}

interface Exec {
  instance: string;
  command: string;
  user: number;
}

interface Setup {
  fake: FakeIncus;
  deployDir: string;
  registry: ReturnType<typeof registry>;
  execs: Exec[];
  steps: string[];
  workspace(
    dependencies?: IncusDeployDependencies,
    stop?: boolean,
  ): IncusWorkspace;
  /** Write the image facts every image the registry served has. */
  seedFacts(): void;
}

let setup: Setup;

beforeEach(() => {
  setProjectId('tale');
  const deployDir = mkdtempSync(join(tmpdir(), 'tale-incus-deploy-'));
  writeFileSync(join(deployDir, '.env'), DOTENV, { mode: 0o600 });
  const credentials = join(deployDir, '.tale', 'sandbox-incus');
  mkdirSync(credentials, { recursive: true, mode: 0o700 });
  for (const file of ['client.crt', 'client.key', 'server.crt'])
    writeFileSync(join(credentials, file), `${file}\n`, { mode: 0o600 });
  const fake = new FakeIncus({
    project: DECLARATION.project,
    profile: 'tale-stack',
    network: DECLARATION.network.name,
    pool: DECLARATION.pool,
    image: 'tale-unused',
  });
  fake.extensions = [...REQUIRED_EXTENSIONS, 'instance_create_start'];
  const served = registry();
  const execs: Exec[] = [];
  // A withdrawal marker is a file `touch` makes and `rm -f` removes; the
  // control doors answer an idle drain.
  fake.exec = (call, io) => {
    const command = call.command.join(' ');
    execs.push({ instance: call.instance.name, command, user: call.user });
    const [verb, ...args] = call.command;
    if (verb === 'touch')
      for (const path of args)
        call.instance.files.set(path, { content: '', mode: '0644' });
    if (verb === 'rm')
      for (const path of args.filter((arg) => arg.startsWith('/')))
        call.instance.files.delete(path);
    // The spawner's control CLI, then the backend's control door.
    if (command.includes('control-cli.ts drain-status'))
      io.write(1, '{"draining":true,"sessions":0,"sessionIds":[]}');
    else if (command.includes('control-cli.ts drain'))
      io.write(1, '{"draining":true}');
    else if (command.includes('drain-status'))
      io.write(1, '{"draining":true,"inFlight":0}');
    return 0;
  };
  const steps: string[] = [];
  setup = {
    fake,
    deployDir,
    registry: served,
    execs,
    steps,
    workspace(dependencies = {}, stop = false) {
      const runtime = createIncusRuntime({
        client: fake.client(),
        declaration: DECLARATION,
        stack: 'tale',
        stateRoot: deployDir,
        registry: served,
        switchDependencies: { sleep: async () => undefined },
      });
      return new IncusWorkspace({
        runtime,
        deployDir,
        registry: REGISTRY,
        hostAlias: 'demo.tale.dev',
        replicas: { platform: 2, 'backend-api': 1, 'backend-worker': 1 },
        healthTimeout: 5,
        drainTimeout: 0,
        stop,
        environment: {},
        dependencies: {
          serverCertificateSha256: 'a'.repeat(64),
          nodeCheck: async () => ({ ok: true, findings: [], probes: [] }),
          hooks: { volumeOwner: () => ({ uid: 0, gid: 0, mode: '0755' }) },
          waitHealthy: async (name) =>
            fake.instances.get(runtime.instanceName(name))?.status ===
            'Running',
          afterStep: (step) => {
            steps.push(step);
          },
          ...dependencies,
        },
      });
    },
    seedFacts() {
      const directory = incusStateDirectory(deployDir);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(directory, IMAGE_FACTS_FILE),
        JSON.stringify({
          schemaVersion: 1,
          images: Object.fromEntries(
            [...served.digests].map((digest) => [
              digest,
              {
                digest,
                paths: {},
                appUser: { uid: 1001, gid: 1001 },
                timeout: '/usr/bin/timeout',
                infraFormats: [],
                readAt: '2026-11-13T00:00:00.000Z',
              },
            ]),
          ),
        }),
        { mode: 0o600 },
      );
    },
  };
});

afterEach(() => {
  setup.fake.close();
  rmSync(setup.deployDir, { recursive: true, force: true });
});

/** The registries the stack pulls from, as the project allows them. */
async function allowRegistries(): Promise<void> {
  const workspace = setup.workspace();
  const target = await workspace.compile({
    stateful: N,
    colours: { blue: N, green: NEXT },
  });
  setup.fake.projectConfig = {
    ...setup.fake.projectConfig,
    'restricted.images.servers': registryHosts(target.images).join(','),
  };
}

async function deploy(
  version: string,
  options: {
    dependencies?: IncusDeployDependencies;
    services?: Parameters<typeof deployOnIncus>[0]['services'];
    stop?: boolean;
  } = {},
): Promise<void> {
  await deployOnIncus({
    workspace: setup.workspace(options.dependencies, options.stop),
    version,
    dryRun: false,
    skipBackup: true,
    ...(options.services === undefined ? {} : { services: options.services }),
  });
  setup.seedFacts();
}

/** Each instance of the stack and the release it runs. */
function census(): Record<string, string> {
  return Object.fromEntries(
    [...setup.fake.instances.values()]
      .filter((instance) => instance.config['user.tale.stack'] === 'tale')
      .map((instance) => [
        instance.name,
        `${instance.status} ${instance.config['user.tale.version'] ?? ''}`,
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

const COLOUR_ROLES = (colour: string, status = 'Running', version = N) => ({
  [`backend-api-${colour}-1`]: `${status} ${version}`,
  [`backend-worker-${colour}-1`]: `${status} ${version}`,
  [`platform-${colour}-1`]: `${status} ${version}`,
  [`platform-${colour}-2`]: `${status} ${version}`,
});

function decode(content: Uint8Array | string | undefined): string {
  return typeof content === 'string'
    ? content
    : new TextDecoder().decode(content ?? new Uint8Array());
}

function volumeFile(volume: string, path: string): string {
  const file = setup.fake.volumes.get(volume)?.files?.get(path);
  return file?.bytes === undefined ? (file?.content ?? '') : decode(file.bytes);
}

describePosix('the first deploy (design 7.2)', () => {
  test('makes the volumes, the infrastructure, the stateful tier and blue', async () => {
    await allowRegistries();
    await deploy(N);
    const instances = census();
    for (const singleton of [
      'db',
      'names',
      'names-sessions',
      'object-store',
      'proxy',
      'sandbox',
      'sandbox-egress',
      'sandbox-llm-gateway',
      'switch',
    ])
      expect(instances[singleton]).toStartWith('Running');
    expect(instances).toMatchObject(COLOUR_ROLES('blue'));
    expect(Object.keys(instances).some((name) => name.includes('green'))).toBe(
      false,
    );
    expect(await getCurrentColor(setup.deployDir)).toBe('blue');
    for (const volume of ['backups', 'db-data', 'config-data', 'static-assets'])
      expect(setup.fake.volumes.has(volume)).toBe(true);
    // The switch lists every slot of both colours, written with it.
    expect(volumeFile('switch-config', '/platform.upstreams')).toContain(
      '10.30.1.128:3000',
    );
    expect((await readJournal(setup.deployDir))?.flip ?? null).toBeNull();
  });

  test('a runtime that compiled nothing reads each health from the instance (tale status)', async () => {
    await allowRegistries();
    await deploy(N);
    const fresh = setup.workspace().runtime;
    expect(await fresh.health('tale-db')).toBe('healthy');
    expect(await fresh.health('platform-blue-1')).toBe('healthy');
    expect(await fresh.admission('platform-blue-1')).toBe('admitted');
    expect(await fresh.admission('tale-db')).toBeNull();
    // The bgutil sidecar declares its healthcheck; one with none reads none.
    expect(await fresh.health('backend-worker-blue-1')).toBe('none');
  });

  test('tale status names a service stopped after repeated crashes, with the console Incus kept (D-24)', async () => {
    await allowRegistries();
    await deploy(N);
    const sandbox = setup.fake.instances.get('sandbox');
    if (sandbox === undefined) throw new Error('no sandbox instance');
    sandbox.status = 'Stopped';
    sandbox.config['user.tale.want'] = 'running';
    sandbox.consoleLog = 'booting\nfatal: the spawner cannot start\n';
    const lines: string[] = [];
    const collect = (chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    };
    const stdout = spyOn(process.stdout, 'write').mockImplementation(collect);
    setActiveOutputMode(resolveOutputMode({ json: true }));
    try {
      await showStatus({
        deployDir: setup.deployDir,
        json: true,
        runtime: setup.workspace().runtime,
      });
    } finally {
      stdout.mockRestore();
      setActiveOutputMode(resolveOutputMode({}));
    }
    const report = JSON.parse(lines.join('')) as {
      data: {
        stateful: {
          service: string;
          status: string;
          crashTail?: { label: string; lines: string[] };
        }[];
      };
    };
    const row = report.data.stateful.find((item) => item.service === 'sandbox');
    expect(row?.status).toBe('stopped after repeated crashes');
    expect(row?.crashTail).toEqual({
      label: 'the last console lines Incus kept',
      lines: ['booting', 'fatal: the spawner cannot start'],
    });
    expect(
      report.data.stateful.find((item) => item.service === 'db')?.crashTail,
    ).toBeUndefined();
  });

  test('a plan changes nothing; the reviewed plan applies, a stale one is refused', async () => {
    await allowRegistries();
    const workspace = setup.workspace();
    const lines: string[] = [];
    const collect = (chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    };
    const stdout = spyOn(process.stdout, 'write').mockImplementation(collect);
    setActiveOutputMode(resolveOutputMode({ json: true }));
    try {
      await deployOnIncus({ workspace, version: N, dryRun: true });
    } finally {
      stdout.mockRestore();
      setActiveOutputMode(resolveOutputMode({}));
    }
    expect(census()).toEqual({});
    expect(setup.fake.volumes.size).toBe(0);
    const printed = lines.join('');
    expect(printed).toContain('instance/platform-blue-1');

    // The printed envelope is the reviewed plan `--plan <file>` reads.
    const reviewedFile = join(setup.deployDir, 'plan.json');
    writeFileSync(reviewedFile, printed);
    const reviewed = readWorkspacePlan(reviewedFile);
    expect(reviewed.scopes.map((entry) => entry.scope)).toEqual([
      'volumes',
      'infrastructure',
      'stateful',
      'colour-blue',
    ]);
    const stale = structuredClone(reviewed);
    stale.scopes[3]?.plan.resources.pop();
    const refused = await deployOnIncus({
      workspace: setup.workspace(),
      version: N,
      dryRun: false,
      skipBackup: true,
      plan: stale,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CliError);
    expect((refused as CliError).message).toContain('reviewed plan differs');
    // Refused before anything changed.
    expect(census()).toEqual({});
    expect(setup.fake.volumes.size).toBe(0);

    await deployOnIncus({
      workspace: setup.workspace(),
      version: N,
      dryRun: false,
      skipBackup: true,
      plan: reviewed,
    });
    expect(census()).toMatchObject(COLOUR_ROLES('blue'));
  });
});

describePosix('a flip from N to N+1 (design 7.3, R3-02, R3-34)', () => {
  test('brings green up, withdraws blue by marker before its drain, and never touches the switch', async () => {
    await allowRegistries();
    await deploy(N);
    const switchBefore = setup.fake.instances.get('switch');
    const upstreams = volumeFile('switch-config', '/platform.upstreams');
    setup.execs.length = 0;

    await deploy(NEXT);

    expect(census()).toMatchObject(COLOUR_ROLES('green', 'Running', NEXT));
    expect(Object.keys(census()).some((name) => name.includes('blue'))).toBe(
      false,
    );
    expect(await getCurrentColor(setup.deployDir)).toBe('green');
    expect(await getPreviousVersion(setup.deployDir)).toBe(N);
    // The switch was neither made again nor reloaded, and its lists are
    // the ones it was made with. It runs nothing but the admission probes
    // of the replicas made (each green replica's, once).
    expect(setup.fake.instances.get('switch')).toBe(switchBefore);
    expect(volumeFile('switch-config', '/platform.upstreams')).toBe(upstreams);
    const inSwitch = setup.execs
      .filter((exec) => exec.instance === 'switch')
      .map((exec) => exec.command);
    expect(inSwitch.length).toBeGreaterThan(0);
    for (const command of inSwitch)
      expect(command).toMatch(
        /^sh -c ip neigh flush to [0-9.]+ 2>\/dev\/null; wget -q -T 2 -O \/dev\/null http:\/\/[0-9.]+:(3000\/api|3005)\/admission$/,
      );
    // Withdraw (as the app user) before the drain, on Incus.
    const withdraw = setup.execs.findIndex(
      (exec) =>
        exec.instance === 'platform-blue-1' &&
        exec.command === 'touch /tmp/platform-withdrawn',
    );
    const drain = setup.execs.findIndex((exec) =>
      exec.command.includes('/api/control/drain'),
    );
    expect(withdraw).toBeGreaterThanOrEqual(0);
    expect(drain).toBeGreaterThan(withdraw);
    expect(setup.execs[withdraw]?.user).toBe(1001);
    expect(
      setup.execs.some(
        (exec) =>
          exec.instance === 'backend-api-blue-1' &&
          exec.command === 'touch /tmp/backend-withdrawn',
      ),
    ).toBe(true);
    // The spawner was drained through its control CLI before its
    // replacement.
    const spawnerDrain = setup.execs.findIndex(
      (exec) =>
        exec.instance === 'sandbox' &&
        exec.command.includes('control-cli.ts drain'),
    );
    expect(spawnerDrain).toBeGreaterThanOrEqual(0);
    // The resolvers no longer name the retired colour; the journal holds
    // no flip and no marker.
    const records = [...(setup.fake.volumes.get('names-config')?.files ?? [])]
      .map(([, file]) => decode(file.bytes ?? file.content))
      .join('\n');
    expect(records).toContain('platform-green');
    expect(records).not.toContain('platform-blue');
    const journal = await readJournal(setup.deployDir);
    expect(journal?.flip ?? null).toBeNull();
    expect(journal?.withdrawn).toEqual([]);
  });

  const phases: Array<[string, FlipPhase | null]> = [
    ['stateful', null],
    ['flip-recorded', 'starting'],
    ['colour-up', 'starting'],
    ['admitted', 'admitted'],
    ['retired', 'retiring'],
  ];
  for (const [step, phase] of phases)
    test(`a crash after "${step}" resumes from the journal and ends where an unbroken flip ends`, async () => {
      await allowRegistries();
      await deploy(N);
      const crash = new Error(`crash after ${step}`);
      const failed = await deploy(NEXT, {
        dependencies: {
          afterStep: (name) => {
            if (name === step) throw crash;
          },
        },
      }).catch((error: unknown) => error);
      expect(failed).toBe(crash);
      expect((await readJournal(setup.deployDir))?.flip?.phase ?? null).toBe(
        phase,
      );
      setup.seedFacts();

      await deploy(NEXT);

      expect(census()).toMatchObject(COLOUR_ROLES('green', 'Running', NEXT));
      expect(Object.keys(census()).some((name) => name.includes('blue'))).toBe(
        false,
      );
      expect(await getCurrentColor(setup.deployDir)).toBe('green');
      const journal = await readJournal(setup.deployDir);
      expect(journal?.flip ?? null).toBeNull();
      expect(journal?.withdrawn).toEqual([]);
    });

  test('a stale marker an aborted flip left is removed by admit', async () => {
    await allowRegistries();
    await deploy(N);
    // An aborted flip left green withdrawn: it is up, the flip is at
    // `starting`, and green carries the marker.
    const failed = await deploy(NEXT, {
      dependencies: {
        afterStep: async (name) => {
          if (name !== 'colour-up') return;
          setup.seedFacts();
          await setup.workspace().runtime.withdraw('tale-green', ['platform']);
          throw new Error('abort');
        },
      },
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(
      setup.fake.instances
        .get('platform-green-1')
        ?.files.has('/tmp/platform-withdrawn'),
    ).toBe(true);
    await deploy(NEXT);
    expect(
      setup.execs.some(
        (exec) =>
          exec.instance === 'platform-green-1' &&
          exec.command === 'rm -f /tmp/platform-withdrawn',
      ),
    ).toBe(true);
    expect(
      setup.fake.instances
        .get('platform-green-1')
        ?.files.has('/tmp/platform-withdrawn'),
    ).toBe(false);
  });
});

describePosix('rollback on Incus (design 7.3)', () => {
  test('flips back to N on the opposite colour', async () => {
    await allowRegistries();
    await deploy(N);
    await deploy(NEXT);
    const stateful = census().sandbox;
    await rollbackOnIncus({
      workspace: setup.workspace(),
      currentColor: 'green',
      currentVersion: NEXT,
      rollbackVersion: N,
    });
    expect(census()).toMatchObject(COLOUR_ROLES('blue', 'Running', N));
    expect(Object.keys(census()).some((name) => name.includes('green'))).toBe(
      false,
    );
    expect(await getCurrentColor(setup.deployDir)).toBe('blue');
    expect(await getPreviousVersion(setup.deployDir)).toBe(NEXT);
    // The stateful tier and the infrastructure kept what they run.
    expect(census().sandbox).toBe(stateful);
    expect(stateful).toBe(`Running ${NEXT}`);
  });

  test('a deploy flip a crash left starting turns toward the previous release', async () => {
    await allowRegistries();
    await deploy(N);
    await deploy(NEXT);
    const LATER = '0.5.97';
    const failed = await deploy(LATER, {
      dependencies: {
        afterStep: (name) => {
          if (name === 'colour-up') throw new Error('crash');
        },
      },
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect((await readJournal(setup.deployDir))?.flip?.version).toBe(LATER);
    setup.seedFacts();

    await rollbackOnIncus({
      workspace: setup.workspace(),
      currentColor: 'green',
      currentVersion: NEXT,
      rollbackVersion: N,
    });

    // Blue runs the previous release, never the interrupted deploy's.
    expect(census()).toMatchObject(COLOUR_ROLES('blue', 'Running', N));
    expect(Object.keys(census()).some((name) => name.includes('green'))).toBe(
      false,
    );
    expect(await getCurrentColor(setup.deployDir)).toBe('blue');
    expect((await readJournal(setup.deployDir))?.flip ?? null).toBeNull();
  });

  test('a deploy flip past its admission is refused, and nothing changes', async () => {
    await allowRegistries();
    await deploy(N);
    const failed = await deploy(NEXT, {
      dependencies: {
        afterStep: (name) => {
          if (name === 'admitted') throw new Error('crash');
        },
      },
    }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    setup.seedFacts();
    const before = census();

    const refused = await rollbackOnIncus({
      workspace: setup.workspace(),
      currentColor: 'green',
      currentVersion: NEXT,
      rollbackVersion: N,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(CliError);
    expect((refused as CliError).message).toContain(
      'a rollback does not finish it',
    );
    expect(census()).toEqual(before);
    expect((await readJournal(setup.deployDir))?.flip?.phase).toBe('admitted');
  });
});

describePosix('--services rolls one replica at a time', () => {
  test('each platform replica is withdrawn, replaced and healthy before the next', async () => {
    await allowRegistries();
    await deploy(N);
    const seen: Array<Record<string, string>> = [];
    await deploy(NEXT, {
      services: ['platform'],
      dependencies: {
        afterStep: (step) => {
          if (step.startsWith('rolled ')) seen.push(census());
        },
      },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.['platform-blue-1']).toBe(`Running ${NEXT}`);
    expect(seen[0]?.['platform-blue-2']).toBe(`Running ${N}`);
    expect(seen[1]?.['platform-blue-2']).toBe(`Running ${NEXT}`);
    // The other roles and the colour stay as they were.
    expect(census()['backend-api-blue-1']).toBe(`Running ${N}`);
    expect(await getCurrentColor(setup.deployDir)).toBe('blue');
    expect(await getPreviousVersion(setup.deployDir)).toBe(N);
    const touched = setup.execs.filter(
      (exec) => exec.command === 'touch /tmp/platform-withdrawn',
    );
    expect(touched.map((exec) => exec.instance)).toEqual([
      'platform-blue-1',
      'platform-blue-2',
    ]);
  });
});

describePosix('the restore guard (R3-22)', () => {
  test('deploy, --services and rollback refuse while a restore is pending', async () => {
    await allowRegistries();
    await deploy(N);
    await setRestorePending(setup.deployDir, 'tale', {
      id: 'snap',
      startedAt: '2026-11-13T10:00:00.000Z',
      volumes: ['db-data'],
      steps: { 'db-data': 'renamed' },
      holders: {},
    });
    const before = census();
    for (const run of [
      () => deploy(NEXT),
      () => deploy(NEXT, { services: ['platform'] }),
      () =>
        rollbackOnIncus({
          workspace: setup.workspace(),
          currentColor: 'blue',
          currentVersion: N,
          rollbackVersion: '0.5.94',
        }),
      () => servingApiReplica(setup.workspace().runtime, 'migrate'),
    ]) {
      const refused = await run().catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CliError);
      expect((refused as CliError).message).toContain('restore');
    }
    expect(census()).toEqual(before);
  });
});

describe('restrictPlan', () => {
  test('leaves every resource it does not keep unchanged', () => {
    const plan = {
      schemaVersion: 1 as const,
      targetSha256: 'a'.repeat(64),
      phase: 'colour-blue' as const,
      destination: {
        endpoint: 'https://incus.fake:8443',
        serverCertificateSha256: 'a'.repeat(64),
        project: 'tale-stack',
        pool: 'tale',
        architecture: 'x86_64',
      },
      resources: ['instance/platform-blue-1', 'instance/platform-blue-2'].map(
        (id) => ({
          id,
          currentSha256: 'b'.repeat(64),
          desiredSha256: 'c'.repeat(64),
          revision: null,
          action: 'replace' as const,
          effects: ['drain-backend' as const],
        }),
      ),
    };
    const kept = restrictPlan(
      plan,
      (resource) => resource.id === 'instance/platform-blue-2',
    );
    expect(kept.resources.map((resource) => resource.action)).toEqual([
      'unchanged',
      'replace',
    ]);
    expect(kept.resources[0]?.effects).toEqual([]);
  });
});
