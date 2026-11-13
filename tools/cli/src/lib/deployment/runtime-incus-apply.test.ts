import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { FakeIncus } from '@tale/incus/fake';
import { parse } from 'yaml';

import { setRestorePending } from '../runtime/incus/apply/journal';
import type { IncusDeclaration } from '../runtime/incus/compile/stack-target';
import { createIncusRuntime } from '../runtime/incus/incus-runtime';
import { registryHosts } from '../runtime/incus/verbs/images';
import { REQUIRED_EXTENSIONS } from '../runtime/incus/verbs/probe';
import { AUTOMATION_PROTOCOL_MIGRATION } from './automation-model';
import { instanceIdentity } from './runtime-access-incus';
import {
  applyIncusRuntime,
  describeIncusPlan,
  INCUS_APPLY_SENTENCES,
  observeReadyIncusState,
  type ApplyIncusRuntimeOptions,
  type IncusRuntimeDependencies,
} from './runtime-incus-apply';
import {
  hash,
  INCUS_STACK_FILE,
  readRuntimeBundle,
  type RuntimeBundle,
} from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import { SANDBOX_INCUS_FILES } from './runtime-sandbox';
import {
  commitRepositorySource,
  fakeRegistry,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// The git runtime fixture spawns git; a slow runner needs more than 5 s.
setDefaultTimeout(60_000);

/**
 * The managed path on Incus against the fake (design 7.1): prepare reads the
 * registry and never Docker, the bundle pins the compiled stack without a
 * secret, and the apply probes, checks, plans, converges and reads back
 * into the shared runtime receipt.
 */

const DECLARATION: IncusDeclaration = {
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
};

interface Setup {
  fixture: RuntimeFixture;
  registry: ReturnType<typeof fakeRegistry>;
  fake: FakeIncus;
  bundle: RuntimeBundle;
  options: ApplyIncusRuntimeOptions;
  dependencies: IncusRuntimeDependencies;
  calls: string[];
}

const fixtures: Setup[] = [];
afterEach(() => {
  for (const made of fixtures.splice(0)) {
    made.fake.close();
    rmSync(made.fixture.directory, { recursive: true, force: true });
  }
});

function readyIncus(registries: string[]): FakeIncus {
  const fake = new FakeIncus({
    project: DECLARATION.project,
    profile: 'tale-stack',
    network: DECLARATION.network.name,
    pool: DECLARATION.pool,
    image: 'tale-unused',
  });
  fake.extensions = [...REQUIRED_EXTENSIONS, 'instance_create_start'];
  fake.projectConfig = {
    'features.images': 'true',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
    'restricted.images.servers': registries.join(','),
  };
  // The installed migration ledger the protocol admission reads in `db`.
  fake.exec = (call, io) => {
    if (call.instance.name === 'db' && call.command.join(' ') === 'sh -s')
      io.write(
        1,
        JSON.stringify({
          schema: 'public',
          ids: [AUTOMATION_PROTOCOL_MIGRATION],
        }),
      );
    return 0;
  };
  return fake;
}

/** Prepare an Incus bundle of the runtime fixture and a state directory
 * holding both credential directories. */
async function setup(declared: { egressProxy?: string } = {}): Promise<Setup> {
  // The repository's own compose file and proxy, as a release carries them.
  const fixture = runtimeFixture();
  commitRepositorySource(fixture);
  const registry = fakeRegistry(() => fixture.revision);
  const docker: string[] = [];
  const bundle = await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
      incus: {
        declaration: DECLARATION,
        stack: fixture.options.composeProject,
        registry,
        ...declared,
      },
    },
    {
      exec: async (command, args) => {
        docker.push([command, ...args].join(' '));
        throw new Error('prepare called Docker');
      },
    },
  );
  expect(docker).toEqual([]);
  for (const directory of ['sandbox-incus', 'incus']) {
    const path = join(fixture.options.stateDirectory, directory);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(fixture.options.stateDirectory, 0o700);
    for (const name of SANDBOX_INCUS_FILES)
      writeFileSync(join(path, name), `${directory}/${name} bytes\n`, {
        mode: 0o600,
      });
  }
  const fake = readyIncus(
    registryHosts(bundle.images.filter((image) => image.services.length > 0)),
  );
  const calls: string[] = [];
  const runtime = createIncusRuntime({
    client: fake.client(),
    declaration: DECLARATION,
    stack: fixture.options.composeProject,
    stateRoot: fixture.options.stateDirectory,
    registry,
  });
  const dependencies: IncusRuntimeDependencies = {
    incusRuntime: runtime,
    serverCertificateSha256: 'a'.repeat(64),
    nodeCheck: async () => ({ ok: true, findings: [], probes: [] }),
    hooks: {
      volumeOwner: () => ({ uid: 0, gid: 0, mode: '0755' }),
      waitHealthy: async (instance) => {
        calls.push(`healthy ${instance.name}`);
      },
      drainSandbox: async (instance) => {
        calls.push(
          `drain ${instance} ${fake.instances.get(instance)?.status ?? ''}`,
        );
      },
      withdraw: async (instance) => {
        calls.push(`withdraw ${instance}`);
        return null;
      },
      admit: async () => undefined,
    },
  };
  const options: ApplyIncusRuntimeOptions = {
    ...fixture.options,
    incus: DECLARATION,
    ...declared,
  };
  const made: Setup = {
    fixture,
    registry,
    fake,
    bundle,
    options,
    dependencies,
    calls,
  };
  fixtures.push(made);
  return made;
}

describe('preparing a managed bundle for Incus', () => {
  test('reads every image from its registry, never Docker, and pins the compiled stack', async () => {
    const { fixture, registry, bundle } = await setup();
    expect(bundle.runtime).toBe('incus');
    expect(registry.reads.length).toBeGreaterThan(0);
    const read = readRuntimeBundle(fixture.options.bundleDirectory);
    const stack = read.contents[INCUS_STACK_FILE];
    expect(stack).toBeDefined();
    expect(hash(stack!)).toBe(bundle.files[INCUS_STACK_FILE]!);
    // The compiled stack carries the environment's keys, never a value.
    const target = JSON.parse(stack!.toString('utf8')) as {
      instances: { config: Record<string, string> }[];
    };
    for (const instance of target.instances)
      for (const [key, value] of Object.entries(instance.config))
        if (key.startsWith('environment.')) expect(value).toBe('');
  });

  test('runs the sandbox in its Incus shape on the address plan and publishes nothing', async () => {
    const { fixture, bundle } = await setup();
    expect(bundle.sandbox).toMatchObject({
      backend: 'incus',
      address: '10.30.2.5',
      egressProxy: 'http://10.30.2.10:3128',
    });
    const compose = parse(
      readFileSync(
        join(fixture.options.bundleDirectory, 'compose.yml'),
        'utf8',
      ),
    ) as { services: Record<string, { ports?: string[] }> };
    expect(compose.services['backend-api']?.ports).toBeUndefined();
    expect(compose.services['sandbox-llm-gateway']?.ports).toBeUndefined();
  });

  test('keeps a declared egress proxy (R-13)', async () => {
    const { bundle } = await setup({ egressProxy: 'http://192.0.2.7:3128' });
    expect(bundle.sandbox?.egressProxy).toBe('http://192.0.2.7:3128');
  });

  test('a bundle whose compose file publishes the session ports is refused for Incus', async () => {
    const { fixture } = await setup();
    const file = join(fixture.options.bundleDirectory, 'compose.yml');
    const compose = parse(readFileSync(file, 'utf8')) as {
      services: Record<string, { ports?: string[] }>;
    };
    compose.services['backend-api']!.ports = ['10.30.2.5:3005:3005'];
    const { stringify } = await import('yaml');
    const text = stringify(compose, { lineWidth: 0 });
    writeFileSync(file, text);
    const manifest = join(fixture.options.bundleDirectory, 'runtime.json');
    const value = JSON.parse(readFileSync(manifest, 'utf8')) as RuntimeBundle;
    value.files['compose.yml'] = hash(text);
    writeFileSync(manifest, JSON.stringify(value, null, 2));
    expect(() => readRuntimeBundle(fixture.options.bundleDirectory)).toThrow(
      'published port',
    );
  });
});

describe('applying a managed bundle on Incus', () => {
  test('a first deploy converges the stack, reads it back and records the shared receipt', async () => {
    const { fake, options, dependencies, bundle } = await setup();
    const result = await applyIncusRuntime(options, dependencies);
    expect(result.changed).toBe(true);
    expect(result.existing).toBe(false);
    expect(result.backendContainer).toBe(
      instanceIdentity(
        DECLARATION.project,
        fake.instances.get('backend-api-1')!,
      ),
    );
    const receipt = JSON.parse(
      readFileSync(
        join(options.stateDirectory, '.tale', 'runtime.json'),
        'utf8',
      ),
    ) as { phase: string; images: unknown };
    expect(receipt.phase).toBe('ready');
    expect(receipt.images).toEqual(bundle.images);
    for (const file of ['src/compose.yml', 'src/.env', 'secrets.env'])
      expect(existsSync(join(options.stateDirectory, file))).toBe(true);
    expect([...fake.instances.keys()].sort()).toContain('switch');
    // The receipt and the plan carry no secret value.
    const secrets = readFileSync(
      join(options.stateDirectory, 'secrets.env'),
      'utf8',
    );
    const value = /='([^']{16,})'/.exec(secrets)?.[1];
    expect(value).toBeDefined();
    expect(JSON.stringify(result.plan)).not.toContain(value!);
    expect(JSON.stringify(receipt)).not.toContain(value!);
  });

  test('a first deploy that stopped at a health gate resumes, though only the data tier runs', async () => {
    const { fake, options, dependencies } = await setup();
    const hooks = dependencies.hooks!;
    const failing: IncusRuntimeDependencies = {
      ...dependencies,
      hooks: {
        ...hooks,
        waitHealthy: async (instance) => {
          if (instance.name === 'sandbox')
            throw new Error('sandbox never became healthy');
          await hooks.waitHealthy?.(instance);
        },
      },
    };
    await expect(applyIncusRuntime(options, failing)).rejects.toThrow(
      'sandbox never became healthy',
    );
    expect(fake.instances.get('db')?.status).toBe('Running');
    expect(fake.instances.has('backend-api-1')).toBe(false);
    const receipt = JSON.parse(
      readFileSync(
        join(options.stateDirectory, '.tale', 'runtime.json'),
        'utf8',
      ),
    ) as { phase: string; existing: boolean };
    expect(receipt).toMatchObject({ phase: 'pending', existing: false });

    const resumed = await applyIncusRuntime(options, dependencies);
    expect(resumed.changed).toBe(true);
    expect(fake.instances.has('backend-api-1')).toBe(true);
    expect(
      JSON.parse(
        readFileSync(
          join(options.stateDirectory, '.tale', 'runtime.json'),
          'utf8',
        ),
      ).phase,
    ).toBe('ready');
  });

  test('a second apply of the same bundle changes nothing', async () => {
    const { fake, options, dependencies } = await setup();
    await applyIncusRuntime(options, dependencies);
    const versions = [...fake.instances.values()].map((i) => i.version);
    const again = await applyIncusRuntime(options, dependencies);
    expect(again.changed).toBe(false);
    expect(describeIncusPlan(again.plan, { instances: [] } as never)).toEqual([
      'The Incus stack is as planned; nothing changes.',
    ]);
    expect([...fake.instances.values()].map((i) => i.version)).toEqual(
      versions,
    );
  });

  test('the plan alone changes nothing, and a reviewed plan applies only while the node still needs it', async () => {
    const { fake, options, dependencies } = await setup();
    const planned = await applyIncusRuntime(
      { ...options, dryRun: true },
      dependencies,
    );
    expect(fake.instances.size).toBe(0);
    expect(planned.planLines.some((line) => line.startsWith('create'))).toBe(
      true,
    );
    expect(
      existsSync(join(options.stateDirectory, '.tale', 'runtime.json')),
    ).toBe(false);
    await expect(
      applyIncusRuntime(
        { ...options, plan: { ...planned.plan, resources: [] } },
        dependencies,
      ),
    ).rejects.toThrow(INCUS_APPLY_SENTENCES.reviewed);
    await applyIncusRuntime({ ...options, plan: planned.plan }, dependencies);
    expect(fake.instances.size).toBeGreaterThan(0);
  });

  test('a pending restore stops the deploy (R3-22)', async () => {
    const { options, dependencies } = await setup();
    await setRestorePending(options.stateDirectory, options.composeProject, {
      id: 'snap-1',
      startedAt: '2026-11-13T10:00:00.000Z',
      volumes: ['db-data'],
      steps: { 'db-data': 'renamed' },
      holders: {},
    });
    await expect(applyIncusRuntime(options, dependencies)).rejects.toThrow(
      'tale deploy waits until it is',
    );
  });

  test('the node check refuses before anything is made', async () => {
    const { fake, options, dependencies } = await setup();
    await expect(
      applyIncusRuntime(options, {
        ...dependencies,
        nodeCheck: async () => ({
          ok: false,
          findings: [{ level: 'refusal', sentence: 'profile drifted.' }],
          probes: [],
        }),
      }),
    ).rejects.toThrow('profile drifted.');
    expect(fake.instances.size).toBe(0);
  });

  test('a compose file the prepared stack does not describe is refused', async () => {
    const { fixture, options, dependencies } = await setup();
    const file = join(fixture.options.bundleDirectory, INCUS_STACK_FILE);
    const stack = JSON.parse(readFileSync(file, 'utf8')) as {
      instances: { address: string }[];
    };
    stack.instances[0]!.address = '10.30.2.99';
    const text = `${JSON.stringify(stack, null, 2)}\n`;
    writeFileSync(file, text);
    const manifest = join(fixture.options.bundleDirectory, 'runtime.json');
    const value = JSON.parse(readFileSync(manifest, 'utf8')) as RuntimeBundle;
    value.files[INCUS_STACK_FILE] = hash(text);
    writeFileSync(manifest, JSON.stringify(value, null, 2));
    await expect(applyIncusRuntime(options, dependencies)).rejects.toThrow(
      INCUS_APPLY_SENTENCES.prepared,
    );
  });

  test('a new release drains the spawner before it is replaced, and names the in-place window', async () => {
    const made = await setup();
    await applyIncusRuntime(made.options, made.dependencies);
    // The next release: every Tale image under a new digest.
    const next = fakeRegistry(() => made.fixture.revision, {
      'ghcr.io/tale-project/tale/tale-sandbox': `sha256:${'7'.repeat(64)}`,
      'ghcr.io/tale-project/tale/tale-platform': `sha256:${'8'.repeat(64)}`,
    });
    rmSync(made.fixture.options.bundleDirectory, {
      recursive: true,
      force: true,
    });
    await prepareRuntime({
      repoRoot: made.fixture.repoRoot,
      revision: made.fixture.revision,
      output: made.fixture.options.bundleDirectory,
      platform: 'linux/amd64',
      incus: {
        declaration: DECLARATION,
        stack: made.fixture.options.composeProject,
        registry: next,
      },
    });
    const runtime = createIncusRuntime({
      client: made.fake.client(),
      declaration: DECLARATION,
      stack: made.fixture.options.composeProject,
      stateRoot: made.fixture.options.stateDirectory,
      registry: next,
    });
    made.calls.length = 0;
    const result = await applyIncusRuntime(made.options, {
      ...made.dependencies,
      incusRuntime: runtime,
    });
    const drain = made.calls.findIndex((call) =>
      call.startsWith('drain sandbox'),
    );
    expect(drain).toBeGreaterThanOrEqual(0);
    // Drained while it still ran: before its replacement stopped it.
    expect(made.calls[drain]).toBe('drain sandbox Running');
    const notice = result.planLines.find((line) => line.startsWith('Notice:'));
    expect(notice).toContain('backend-api and platform');
    // Each switched replica is withdrawn before it is replaced.
    expect(made.calls).toContain('withdraw platform-1');
    expect(made.calls).toContain('withdraw backend-api-1');
    expect(notice).toContain('maintenance page');
  });

  test('the spawner is drained through the stack access, and a spawner that keeps sessions refuses its replacement', async () => {
    for (const sessions of [0, 2]) {
      const made = await setup();
      await applyIncusRuntime(made.options, made.dependencies);
      const next = fakeRegistry(() => made.fixture.revision, {
        'ghcr.io/tale-project/tale/tale-sandbox': `sha256:${'7'.repeat(64)}`,
      });
      rmSync(made.fixture.options.bundleDirectory, {
        recursive: true,
        force: true,
      });
      await prepareRuntime({
        repoRoot: made.fixture.repoRoot,
        revision: made.fixture.revision,
        output: made.fixture.options.bundleDirectory,
        platform: 'linux/amd64',
        incus: {
          declaration: DECLARATION,
          stack: made.fixture.options.composeProject,
          registry: next,
        },
      });
      // The spawner's control CLI, answered by the fake.
      const controls: string[] = [];
      const ledger = made.fake.exec;
      made.fake.exec = (call, io) => {
        const command = call.command.join(' ');
        if (command.includes('bun /app/src/control-cli.ts ')) {
          const verb = call.command.at(-1) ?? '';
          controls.push(`${call.instance.name} ${verb}`);
          io.write(
            1,
            JSON.stringify(
              verb === 'drain'
                ? { draining: true }
                : {
                    draining: true,
                    sessions,
                    sessionIds: Array.from(
                      { length: sessions },
                      (_, i) => `s${i}`,
                    ),
                  },
            ),
          );
          return 0;
        }
        return ledger(call, io);
      };
      const { drainSandbox: _drain, ...hooks } = made.dependencies.hooks ?? {};
      const run = applyIncusRuntime(made.options, {
        ...made.dependencies,
        hooks,
        sleep: async () => undefined,
        incusRuntime: createIncusRuntime({
          client: made.fake.client(),
          declaration: DECLARATION,
          stack: made.fixture.options.composeProject,
          stateRoot: made.fixture.options.stateDirectory,
          registry: next,
        }),
      });
      if (sessions === 0) {
        await run;
        expect(controls.slice(0, 2)).toEqual([
          'sandbox drain',
          'sandbox drain-status',
        ]);
      } else {
        await expect(run).rejects.toThrow(
          INCUS_APPLY_SENTENCES.drained(sessions),
        );
        // The spawner still runs its sessions: it was not replaced.
        expect(made.fake.instances.get('sandbox')?.status).toBe('Running');
      }
    }
  });

  test('a ready runtime reads back in the shape the managed checks read', async () => {
    const { fake, options, dependencies } = await setup();
    await applyIncusRuntime(options, dependencies);
    const ready = await observeReadyIncusState(options, dependencies);
    const backend = ready.containers.find(
      (container) =>
        container.Config.Labels['com.docker.compose.service'] === 'backend-api',
    );
    expect(ready.runtime.backendContainer).toBe(backend?.Id ?? null);
    expect(backend?.Config.Image).toContain('/tale-platform@sha256:');
    // A hand edit is drift a ready runtime refuses.
    fake.instances.get('db')!.config['limits.memory'] = '1GiB';
    await expect(observeReadyIncusState(options, dependencies)).rejects.toThrow(
      'changed outside the CLI',
    );
  });

  test('state of a deployment the Incus project holds nothing of is refused', async () => {
    const { fake, options, dependencies } = await setup();
    mkdirSync(join(options.stateDirectory, 'src'), { recursive: true });
    writeFileSync(join(options.stateDirectory, 'secrets.env'), "A='b'\n", {
      mode: 0o600,
    });
    writeFileSync(join(options.stateDirectory, 'src', '.env'), 'A="b"\n', {
      mode: 0o600,
    });
    await expect(applyIncusRuntime(options, dependencies)).rejects.toThrow(
      INCUS_APPLY_SENTENCES.docker,
    );
    expect(fake.instances.size).toBe(0);
  });

  test('environment of the Incus shape stays the CLI own', async () => {
    const { options, dependencies } = await setup();
    await expect(
      applyIncusRuntime(
        { ...options, environment: { SANDBOX_BACKEND: 'docker' } },
        dependencies,
      ),
    ).rejects.toThrow('the Incus sandbox shape sets itself');
  });
});
