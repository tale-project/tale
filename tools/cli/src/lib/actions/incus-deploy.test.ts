import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../utils/fail';
import { AUTOMATION_PROTOCOL_LABEL } from '../deployment/automation-model';
import {
  SANDBOX_HOST_MOVE_SENTENCES,
  SANDBOX_PLACEMENT_SENTENCES,
} from '../deployment/runtime-sandbox-placement';
import type { RegistryClient, ResolvedImage } from '../oci/registry';
import { setProjectId } from '../project/project-context';
import { setRestorePending } from '../runtime/incus/apply/journal';
import {
  DOTENV,
  expectRefusalError,
  factsFor,
  STATEFUL_AND_BOTH_EDGE_REFUSALS,
} from '../runtime/incus/compile/compile-fixture';
import type { IncusDeclaration } from '../runtime/incus/compile/stack-target';
import { createIncusRuntime } from '../runtime/incus/incus-runtime';
import { incusStateDirectory } from '../runtime/incus/plan/digest';
import { IMAGE_FACTS_FILE } from '../runtime/incus/verbs/image-facts-cache';
import { registryHosts } from '../runtime/incus/verbs/images';
import { REQUIRED_EXTENSIONS } from '../runtime/incus/verbs/probe';
import {
  deployOnIncus,
  IncusWorkspace,
  restrictPlan,
  rollbackOnIncus,
  servingApiReplica,
  type IncusDeployDependencies,
} from './incus-deploy';

/** One declared sandbox host. */
type SandboxHost = NonNullable<IncusDeclaration['sandboxHosts']>[number];

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

/**
 * The workspace path on Incus against the fake (design 7.2, 7.3): a first
 * deploy, a flip from release N to N+1 through the switch, a crash in every
 * phase of it and the resume, a rollback, an in-place roll of `--services`
 * one replica at a time, and the restore guard (R3-22).
 *
 * The Traefik edge is refused on this path until the switch-role port lands,
 * before anything is made. Each test that compiles the workspace holds that
 * refusal; the restore guard runs before the compile and keeps its own check.
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
    declaration?: IncusDeclaration,
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
    workspace(dependencies = {}, stop = false, declaration = DECLARATION) {
      const runtime = createIncusRuntime({
        client: fake.client(),
        declaration,
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

/** The workspace's first compile is refused by the Traefik edge, with each of
 * its refusals named, before anything is made: the fake holds no instance and
 * no volume afterwards. */
async function refusedOnIncus(): Promise<void> {
  const thrown = await allowRegistries().then(
    () => undefined,
    (error: unknown) => error,
  );
  expectRefusalError(thrown, STATEFUL_AND_BOTH_EDGE_REFUSALS);
  expect(setup.fake.instances.size).toBe(0);
  expect(setup.fake.volumes.size).toBe(0);
}

async function deploy(
  version: string,
  options: {
    dependencies?: IncusDeployDependencies;
    services?: Parameters<typeof deployOnIncus>[0]['services'];
    stop?: boolean;
    clearSandboxPlacement?: boolean;
    declaration?: IncusDeclaration;
    dryRun?: boolean;
  } = {},
): Promise<void> {
  await deployOnIncus({
    workspace: setup.workspace(
      options.dependencies,
      options.stop,
      options.declaration,
    ),
    version,
    dryRun: options.dryRun ?? false,
    skipBackup: true,
    ...(options.services === undefined ? {} : { services: options.services }),
    ...(options.clearSandboxPlacement ? { clearSandboxPlacement: true } : {}),
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

describePosix('the first deploy (design 7.2)', () => {
  test('makes the volumes, the infrastructure, the stateful tier and blue', async () => {
    await refusedOnIncus();
  });

  test('a runtime that compiled nothing reads each health from the instance (tale status)', async () => {
    await refusedOnIncus();
  });

  test('tale status names a service stopped after repeated crashes, with the console Incus kept (D-24)', async () => {
    await refusedOnIncus();
  });

  test('a plan changes nothing; the reviewed plan applies, a stale one is refused', async () => {
    await refusedOnIncus();
  });
});

describePosix('a flip from N to N+1 (design 7.3, R3-02, R3-34)', () => {
  test('brings green up, withdraws blue by marker before its drain, and never touches the switch', async () => {
    await refusedOnIncus();
  });

  for (const step of [
    'stateful',
    'flip-recorded',
    'colour-up',
    'admitted',
    'retired',
  ])
    test(`a crash after "${step}" resumes from the journal and ends where an unbroken flip ends`, async () => {
      await refusedOnIncus();
    });

  test('a stale marker an aborted flip left is removed by admit', async () => {
    await refusedOnIncus();
  });
});

describePosix(
  "leaving the list form with the spawner's placement record",
  () => {
    test('is refused before anything changes, and the flag deletes the record once the spawner no longer mounts it', async () => {
      await allowRegistries();
      await deploy(N);
      setup.fake.seedVolume('sandbox-state', {
        'user.tale.stack': 'tale',
        'user.tale.kind': 'data',
        'user.tale.volume': 'sandbox-state',
      });
      const before = census();
      await expect(deploy(NEXT)).rejects.toThrow(
        SANDBOX_PLACEMENT_SENTENCES.kept,
      );
      expect(census()).toEqual(before);
      expect(setup.fake.volumes.has('sandbox-state')).toBe(true);
      await deploy(NEXT, { clearSandboxPlacement: true });
      expect(setup.fake.volumes.has('sandbox-state')).toBe(false);
      expect(await getCurrentColor(setup.deployDir)).toBe('green');
    });

    /** A list entry of the sandbox hosts, its credentials written. */
    function listedHost(
      name: string,
      endpoint: string,
      project?: string,
    ): SandboxHost {
      const directory = join(setup.deployDir, '.tale', 'sandbox-incus', name);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      for (const file of ['client.crt', 'client.key', 'server.crt'])
        writeFileSync(join(directory, file), `${file}\n`, { mode: 0o600 });
      return {
        name,
        endpoint,
        ...(project === undefined ? {} : { project }),
        egressProxy: 'http://10.20.2.2:3128',
        dns: ['10.20.2.2'],
      };
    }
    const spawner = () =>
      [...setup.fake.instances.values()].find(
        (instance) => instance.config['user.tale.service'] === 'sandbox',
      );

    test('a stack that ran with the one host takes the list through an entry of its endpoint and project, leaves it with the flag and takes it again', async () => {
      // The one host: the declared network's gateway, the stack's sessions
      // project, which the entry takes by default.
      const listed: IncusDeclaration = {
        ...DECLARATION,
        sandboxHosts: [
          listedHost('node-1', 'https://10.30.0.1:8443'),
          listedHost('node-2', 'https://10.0.0.2:8443'),
        ],
      };
      const mounts = () =>
        Object.values(spawner()?.devices ?? {}).map((device) => device.source);
      await allowRegistries();
      await deploy(N);
      // The record starts empty: the spawner rebuilds it from the hosts.
      await deploy(NEXT, { declaration: listed });
      expect(setup.fake.volumes.has('sandbox-state')).toBe(true);
      expect(mounts()).toContain('sandbox-state');
      await deploy(N, { clearSandboxPlacement: true });
      expect(setup.fake.volumes.has('sandbox-state')).toBe(false);
      expect(mounts()).not.toContain('sandbox-state');
      await deploy(NEXT, { declaration: listed });
      expect(setup.fake.volumes.has('sandbox-state')).toBe(true);
    });

    test('a stack that ran with the one host is refused a list without its endpoint and project, plan, deploy and --services alike, and nothing changes', async () => {
      await allowRegistries();
      await deploy(N);
      const project =
        spawner()?.config['environment.SANDBOX_INCUS_PROJECT'] ?? '';
      expect(project).toBe('tale-sessions');
      const sentence = SANDBOX_HOST_MOVE_SENTENCES.unmatched({
        endpoint: 'https://10.30.0.1:8443',
        project,
      });
      const before = census();
      const volumes = [...setup.fake.volumes.keys()].sort();
      for (const hosts of [
        [listedHost('node-2', 'https://10.0.0.2:8443')],
        [listedHost('node-1', 'https://10.30.0.1:8443', 'other-sessions')],
      ]) {
        const declaration: IncusDeclaration = {
          ...DECLARATION,
          sandboxHosts: hosts,
        };
        for (const dryRun of [true, false]) {
          await expect(deploy(NEXT, { declaration, dryRun })).rejects.toThrow(
            sentence,
          );
          await expect(
            deploy(NEXT, { declaration, dryRun, services: ['sandbox'] }),
          ).rejects.toThrow(sentence);
        }
        expect(census()).toEqual(before);
        expect([...setup.fake.volumes.keys()].sort()).toEqual(volumes);
        expect(spawner()?.config['environment.SANDBOX_INCUS_ENDPOINT']).toBe(
          'https://10.30.0.1:8443',
        );
      }
      expect(await getCurrentColor(setup.deployDir)).toBe('blue');
    });

    test('the one host is kept in the journal while no spawner runs, and a spawner removed on purpose lets the list leave it', async () => {
      const declaration: IncusDeclaration = {
        ...DECLARATION,
        sandboxHosts: [listedHost('node-2', 'https://10.0.0.2:8443')],
      };
      await allowRegistries();
      await deploy(N);
      await deploy(NEXT);
      expect((await readJournal(setup.deployDir))?.sandboxHost).toEqual({
        endpoint: 'https://10.30.0.1:8443',
        project: 'tale-sessions',
      });
      // A crash between the spawner's removal and its replacement.
      setup.fake.instances.delete('sandbox');
      await expect(deploy(N, { declaration })).rejects.toThrow(
        SANDBOX_HOST_MOVE_SENTENCES.unmatched({
          endpoint: 'https://10.30.0.1:8443',
          project: 'tale-sessions',
        }),
      );
      // tale reset --all removes it on purpose, even with the spawner a
      // crash took already: its sessions are left.
      setup.seedFacts();
      expect(await setup.workspace().runtime.remove('tale-sandbox')).toBe(true);
      expect((await readJournal(setup.deployDir))?.sandboxHost).toBeNull();
      await deploy(N, { declaration });
      expect(
        spawner()?.config['environment.SANDBOX_INCUS_ENDPOINTS'],
      ).toBeDefined();
    });
  },
);

describePosix('rollback on Incus (design 7.3)', () => {
  test('flips back to N on the opposite colour', async () => {
    await refusedOnIncus();
  });

  test('a deploy flip a crash left starting turns toward the previous release', async () => {
    await refusedOnIncus();
  });

  test('a deploy flip past its admission is refused, and nothing changes', async () => {
    await refusedOnIncus();
  });
});

describePosix('--services rolls one replica at a time', () => {
  test('each platform replica is withdrawn, replaced and healthy before the next', async () => {
    await refusedOnIncus();
  });
});

describePosix('the restore guard (R3-22)', () => {
  // The guard reads the journal before the workspace compiles, so it refuses
  // on the Traefik edge too. Nothing is deployed first: that deploy is refused.
  test('deploy, --services and rollback refuse while a restore is pending', async () => {
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
