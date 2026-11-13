import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError } from '../../utils/fail';
import { setProjectId } from '../project/project-context';
import {
  FakeRuntime,
  ISOLATED_TEST_VARIABLE,
  runIsolatedTestFile,
} from '../runtime/fake-runtime';
import type { CheckReport } from '../runtime/incus/contract/check';
import { workspaceContractSource } from '../runtime/incus/contract/contract';
import { setFlipPending } from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
import { getPreviousVersion } from '../state/get-previous-version';
import {
  assertNoMigrationUnderWay,
  MIGRATION_STEPS,
  readMigrationJournal,
} from '../state/migration-journal';
import { setCurrentColor } from '../state/set-current-color';
import { setPreviousVersion } from '../state/set-previous-version';
import { rollback } from './rollback';
import {
  finishMigration,
  loopbackEdge,
  MIGRATE_SENTENCES,
  migrateToDocker,
  migrateToIncus,
  publishedHostPorts,
  type MigrationContext,
  type MigrationOperations,
} from './runtime-migrate';
import { startEnvironment } from './stop';

/**
 * `tale runtime migrate` (design 14, R-16, R3-13, R3-27) over a pair of fake
 * runtimes: Docker serving the workspace, Incus taking it over. The
 * operations move the fake volumes' files the way the real archive, export,
 * import and restore move the bytes, so a seeded organization and an
 * uploaded file are followed from Docker into Incus.
 */

const PROJECT = 'tale';
const VERSION = '0.5.95';

const incusBlock = {
  project: 'tale-acme',
  pool: 'tank',
  network: {
    name: 'tale-acme',
    subnet: '10.30.0.0/24',
    gateway: '10.30.0.1',
    block: '10.30.0.0/24',
  },
  sessions: { subnet: '10.31.0.0/24' },
  ingress: { mode: 'proxy-device' as const },
};

/** The data a deployment carries: a seeded organization and an upload. */
const DATA = {
  'tale_db-data': { 'base/orgs': 'acme' },
  'tale_object-store-data': { 'uploads/logo.png': 'PNG bytes' },
  'tale_config-data': { 'acme/agents/default.json': '{}' },
};

class Interrupt extends Error {}

const TEST_ENV = {
  GHCR_REGISTRY: 'ghcr.io/tale-project/tale',
  SITE_URL: 'http://localhost',
  HEALTH_CHECK_TIMEOUT: 5,
  DRAIN_TIMEOUT: 1,
  DEPLOY_DIR: '',
  BACKEND_UPSTREAM: 'backend-api:3005',
};

/**
 * Bun's module mocks are process-wide, and other suites mock the colour
 * state and the lock this suite reads for real, so it runs in a `bun test`
 * of its own (see `runIsolatedTestFile`).
 */
const isolated = process.env[ISOLATED_TEST_VARIABLE] === import.meta.path;

let deployDir: string;

function migrationSuite(): void {
  beforeEach(() => {
    setProjectId(PROJECT);
    deployDir = mkdtempSync(join(tmpdir(), 'tale-migrate-'));
    mkdirSync(join(deployDir, '.tale'), { recursive: true });
  });

  afterEach(() => {
    rmSync(deployDir, { recursive: true, force: true });
  });

  function writeTaleJson(runtime: unknown): void {
    writeFileSync(
      join(deployDir, 'tale.json'),
      JSON.stringify({
        version: 1,
        cliVersion: VERSION,
        createdAt: '2026-11-13T00:00:00.000Z',
        id: PROJECT,
        ...(runtime === undefined ? {} : { runtime }),
      }),
    );
  }

  function taleJson(): { runtime?: Record<string, unknown> } {
    return JSON.parse(readFileSync(join(deployDir, 'tale.json'), 'utf8'));
  }

  /** Docker serving blue at VERSION, with its data and its published edge. */
  async function dockerDeployment(version = VERSION): Promise<FakeRuntime> {
    const docker = new FakeRuntime({ engine: 'docker' });
    const image = `ghcr.io/tale-project/tale/tale-platform:${version}`;
    for (const service of ['db', 'object-store', 'proxy', 'sandbox'])
      docker.seedInstance({
        name: `${PROJECT}-${service}`,
        stack: PROJECT,
        service,
        image,
      });
    for (const service of ['platform', 'backend-api', 'backend-worker'])
      docker.seedInstance({ stack: `${PROJECT}-blue`, service, image });
    for (const [volume, files] of Object.entries(DATA))
      docker.seedVolume(volume, files);
    docker.seedVolume('tale_backups');
    await setCurrentColor(deployDir, 'blue');
    await setPreviousVersion(deployDir, '0.5.94');
    return docker;
  }

  interface Harness {
    context: MigrationContext;
    docker: FakeRuntime;
    incus: FakeRuntime;
    /** Every operation, in the order it ran. */
    calls: string[];
    /** What the next check, smoke and `docker ps` answer. */
    answers: {
      check: CheckReport;
      smoke: { passed: boolean; failures: string[] };
      ports: { name: string; ports: string }[];
    };
  }

  const PASSING: CheckReport = { ok: true, findings: [], probes: [] };

  /** The Docker containers that run, with their ports, as `docker ps` lists
   * them: the proxy publishes the edge while it runs. */
  function dockerPs(docker: FakeRuntime): { name: string; ports: string }[] {
    return [...docker.instances.values()]
      .filter((instance) => instance.state === 'running')
      .map((instance) => ({
        name: instance.name,
        ports:
          instance.service === 'proxy'
            ? '0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp'
            : '5432/tcp',
      }));
  }

  function harness(docker: FakeRuntime): Harness {
    const incus = new FakeRuntime({ engine: 'incus' });
    const calls: string[] = [];
    const snapshots = new Map<string, Map<string, Map<string, string>>>();
    const answers: Harness['answers'] = {
      check: PASSING,
      smoke: { passed: true, failures: [] },
      ports: [],
    };
    let portsOverride: Harness['answers']['ports'] | null = null;
    Object.defineProperty(answers, 'ports', {
      get: () => portsOverride ?? dockerPs(docker),
      set: (value: Harness['answers']['ports']) => {
        portsOverride = value;
      },
    });
    const operations: MigrationOperations = {
      check: async () => {
        calls.push('check');
        return answers.check;
      },
      drain: async (runtime) => {
        calls.push(`drain ${runtime.engine}`);
      },
      publishedPorts: async () => {
        calls.push('ports');
        return answers.ports;
      },
      archive: async (runtime, version) => {
        calls.push(`archive ${runtime.engine} ${version}`);
        const running = [...docker.instances.values()].filter(
          (instance) => instance.state === 'running',
        );
        if (running.length > 0)
          throw new Error(
            `archived while ${running.map((i) => i.name).join(', ')} ran`,
          );
        const id = '20261113-120000-manual';
        const set = new Map<string, Map<string, string>>();
        for (const [volume, files] of docker.volumes)
          if (volume !== 'tale_backups')
            set.set(volume.slice(`${PROJECT}_`.length), new Map(files));
        snapshots.set(id, set);
        docker.volumes.get('tale_backups')?.set(`${id}/manifest.json`, '{}');
        return id;
      },
      exportSnapshot: async (runtime, id, file) => {
        calls.push(`export ${runtime.engine} ${id}`);
        const set = snapshots.get(id);
        if (set === undefined) throw new Error(`no snapshot ${id}`);
        writeFileSync(
          file,
          JSON.stringify(
            [...set].map(([volume, files]) => [volume, [...files]]),
          ),
        );
      },
      prepareIncus: async (runtime, version) => {
        calls.push(`prepare ${runtime.engine} ${version}`);
        await incus.ensureVolumes(
          ['db-data', 'object-store-data', 'config-data', 'backups'],
          '',
        );
      },
      hasSnapshot: async (runtime, id) =>
        incus.volumes.get('backups')?.has(`${id}/manifest.json`) ?? false,
      importSnapshot: async (runtime, file) => {
        calls.push(`import ${runtime.engine}`);
        const entries = JSON.parse(readFileSync(file, 'utf8')) as [
          string,
          [string, string][],
        ][];
        const backups = incus.volumes.get('backups');
        if (backups === undefined)
          throw new Error('no backups volume on Incus');
        for (const [volume, files] of entries)
          backups.set(
            `20261113-120000-manual/${volume}`,
            JSON.stringify(files),
          );
        backups.set('20261113-120000-manual/manifest.json', '{}');
      },
      restore: async (runtime, id) => {
        calls.push(`restore ${runtime.engine} ${id}`);
        const backups = incus.volumes.get('backups');
        for (const [path, content] of backups ?? [])
          if (path.startsWith(`${id}/`) && !path.endsWith('manifest.json'))
            incus.seedVolume(
              path.slice(id.length + 1),
              Object.fromEntries(JSON.parse(content) as [string, string][]),
            );
      },
      deploy: async (runtime, version) => {
        calls.push(`deploy ${runtime.engine} ${version}`);
        const image = `ghcr.io/tale-project/tale/tale-platform:${version}`;
        for (const service of ['db', 'object-store', 'proxy', 'switch'])
          incus.seedInstance({ name: service, stack: PROJECT, service, image });
        for (const service of ['platform', 'backend-api'])
          incus.seedInstance({ stack: `${PROJECT}-blue`, service, image });
        await setCurrentColor(deployDir, 'blue');
      },
      smoke: async (runtime, version) => {
        if (runtime !== incus) throw new Error('smoke on another runtime');
        calls.push(`smoke ${version}`);
        return answers.smoke;
      },
      endDrain: async (runtime) => {
        calls.push(`end-drain ${runtime.engine}`);
      },
      settleIncus: async (runtime) => {
        calls.push(`settle ${runtime.engine}`);
      },
    };
    const context: MigrationContext = {
      deployDir,
      cliVersion: VERSION,
      docker,
      incus: async () => incus,
      operations,
      healthTimeout: 5,
    };
    return { context, docker, incus, calls, answers };
  }

  async function refusal(work: Promise<unknown>): Promise<CliError> {
    const error = await work.then(
      () => null,
      (caught: unknown) => caught,
    );
    if (error instanceof CliError) return error;
    throw new Error(`expected a refusal, got ${String(error)}`);
  }

  function runningNames(fake: FakeRuntime): string[] {
    return [...fake.instances.values()]
      .filter((instance) => instance.state === 'running')
      .map((instance) => instance.name)
      .sort();
  }

  /** What a completed migration leaves, however many runs it took. */
  async function expectMigrated(h: Harness): Promise<void> {
    // The data the Docker stack held is in the Incus volumes.
    expect(Object.fromEntries(h.incus.volumes.get('db-data') ?? [])).toEqual(
      DATA['tale_db-data'],
    );
    expect(
      Object.fromEntries(h.incus.volumes.get('object-store-data') ?? []),
    ).toEqual(DATA['tale_object-store-data']);
    // The Docker stack is stopped, its volumes untouched.
    expect(runningNames(h.docker)).toEqual([]);
    expect(
      Object.fromEntries(h.docker.volumes.get('tale_db-data') ?? []),
    ).toEqual(DATA['tale_db-data']);
    // The workspace runs on Incus.
    expect(taleJson().runtime).toEqual({ engine: 'incus', incus: incusBlock });
    expect((await readMigrationJournal(deployDir))?.step).toBe('flipped');
    expect(await getCurrentColor(deployDir)).toBe('blue');
    expect(
      existsSync(
        join(deployDir, '.tale', 'migration-20261113-120000-manual.tar'),
      ),
    ).toBe(false);
  }

  describe('tale runtime migrate --to incus', () => {
    beforeEach(() => {
      writeTaleJson({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
    });

    test('moves the deployment step by step and flips the engine', async () => {
      const h = harness(await dockerDeployment());
      await migrateToIncus(h.context);
      expect(h.calls).toEqual([
        'check',
        'drain docker',
        `archive docker ${VERSION}`,
        'export docker 20261113-120000-manual',
        `prepare incus ${VERSION}`,
        'import incus',
        'restore incus 20261113-120000-manual',
        'ports',
        `deploy incus ${VERSION}`,
        'end-drain incus',
        `smoke ${VERSION}`,
      ]);
      // Every Docker container was stopped with `docker stop`, the proxy
      // among them, the edge group first (R3-27).
      const stops = h.docker.journal.filter((entry) =>
        entry.startsWith('stop '),
      );
      expect(stops.map((entry) => entry.split(' ')[1]).sort()).toEqual(
        [...h.docker.instances.keys()].sort(),
      );
      expect(stops[0]).toContain(`${PROJECT}-proxy`);
      await expectMigrated(h);
      // Docker's state is in the journal for a rollback.
      expect((await readMigrationJournal(deployDir))?.docker).toEqual({
        colour: 'blue',
        previousVersion: '0.5.94',
      });
    });

    test('a second run after the flip changes nothing', async () => {
      const h = harness(await dockerDeployment());
      await migrateToIncus(h.context);
      const before = h.calls.length;
      await migrateToIncus(h.context);
      expect(h.calls.length).toBe(before);
    });

    for (const step of MIGRATION_STEPS.filter((s) => s !== 'flipped'))
      test(`an interruption after ${step} resumes to the same end`, async () => {
        const h = harness(await dockerDeployment());
        let armed = true;
        h.context.afterStep = (done) => {
          if (armed && done === step) {
            armed = false;
            throw new Interrupt(step);
          }
        };
        await expect(migrateToIncus(h.context)).rejects.toBeInstanceOf(
          Interrupt,
        );
        expect((await readMigrationJournal(deployDir))?.step).toBe(step);
        // Until it ends, Docker stays stopped: deploy and start refuse.
        if (step !== 'started') {
          await expect(
            assertNoMigrationUnderWay(deployDir, 'tale deploy'),
          ).rejects.toThrow(
            'A migration of this workspace to Incus is under way',
          );
          await expect(
            startEnvironment({
              deployDir,
              runtime: h.docker,
              healthTimeout: 5,
            }),
          ).rejects.toThrow(
            'A migration of this workspace to Incus is under way',
          );
          await expect(
            rollback({
              env: { ...TEST_ENV, DEPLOY_DIR: deployDir },
              runtime: h.docker,
              assumeYes: true,
            }),
          ).rejects.toThrow(
            'A migration of this workspace to Incus is under way',
          );
        }
        const firstRun = [...h.calls];
        await migrateToIncus(h.context);
        await expectMigrated(h);
        // A step that finished is never run again; the check is the fresh
        // start's alone.
        const resumed = h.calls.slice(firstRun.length);
        expect(resumed).not.toContain('check');
        for (const done of firstRun.filter((call) =>
          ['archive', 'export', 'import', 'restore', 'deploy'].some((verb) =>
            call.startsWith(verb),
          ),
        ))
          expect(resumed).not.toContain(done);
      });

    test('refuses before anything stops when tale incus check refuses', async () => {
      const h = harness(await dockerDeployment());
      h.answers.check = {
        ok: false,
        probes: [
          { rule: 'public-egress', target: '1.1.1.1:443', outcome: 'timeout' },
        ],
        findings: [
          {
            level: 'refusal',
            sentence:
              'Sessions reach the public internet. A connection from the app bridge to 1.1.1.1:443 timed out (ACL rule public-egress).',
            remedy:
              'iptables -I DOCKER-USER -i tale-acme -j ACCEPT\nor set "ip-forward-no-drop": true in /etc/docker/daemon.json',
          },
        ],
      };
      const error = await refusal(migrateToIncus(h.context));
      expect(error.message).toContain(MIGRATE_SENTENCES.check);
      expect(error.message).toContain('DOCKER-USER');
      expect(error.message.indexOf('DOCKER-USER')).toBeLessThan(
        error.message.indexOf('ip-forward-no-drop'),
      );
      expect(h.calls).toEqual(['check']);
      expect(runningNames(h.docker)).toHaveLength(h.docker.instances.size);
      expect(await readMigrationJournal(deployDir)).toBeNull();
    });

    test('refuses a CLI that deploys another version than Docker runs', async () => {
      const h = harness(await dockerDeployment('0.5.94'));
      const error = await refusal(migrateToIncus(h.context));
      expect(error.message).toBe(MIGRATE_SENTENCES.version('0.5.94', VERSION));
      expect(h.calls).toEqual([]);
    });

    test('refuses without runtime.next, and on an unfinished Docker flip', async () => {
      const h = harness(await dockerDeployment());
      writeTaleJson({ engine: 'docker' });
      expect((await refusal(migrateToIncus(h.context))).message).toBe(
        MIGRATE_SENTENCES.noTarget(deployDir),
      );
      writeTaleJson({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });
      expect((await refusal(migrateToIncus(h.context))).message).toBe(
        MIGRATE_SENTENCES.flipPending,
      );
      expect(h.calls).toEqual([]);
      expect(runningNames(h.docker)).toHaveLength(h.docker.instances.size);
    });

    test('refuses a workspace with nothing deployed on Docker', async () => {
      const h = harness(await dockerDeployment());
      rmSync(join(deployDir, '.tale', 'deployment-color'));
      expect((await refusal(migrateToIncus(h.context))).message).toBe(
        MIGRATE_SENTENCES.nothingDeployed,
      );
    });

    test('never deploys the Incus edge while Docker publishes 80 or 443', async () => {
      const h = harness(await dockerDeployment());
      h.answers.ports = [
        { name: 'stray-web', ports: '0.0.0.0:8080->80/tcp' },
        { name: 'other-edge', ports: '0.0.0.0:443->8443/tcp' },
      ];
      const error = await refusal(migrateToIncus(h.context));
      expect(error.message).toContain('other-edge');
      expect(error.message).not.toContain('stray-web');
      expect(h.calls).not.toContain(`deploy incus ${VERSION}`);
      expect((await readMigrationJournal(deployDir))?.step).toBe('restored');
      h.answers.ports = [{ name: 'stray-web', ports: '0.0.0.0:8080->80/tcp' }];
      await migrateToIncus(h.context);
      await expectMigrated(h);
    });

    test('stops at failed smoke checks with the engine still Docker', async () => {
      const h = harness(await dockerDeployment());
      h.answers.smoke = { passed: false, failures: ['health: 502'] };
      const error = await refusal(migrateToIncus(h.context));
      expect(error.message).toContain(MIGRATE_SENTENCES.smoke);
      expect(error.message).toContain('health: 502');
      expect(taleJson().runtime?.engine).toBe('docker');
      expect((await readMigrationJournal(deployDir))?.step).toBe('deployed');
      h.answers.smoke = { passed: true, failures: [] };
      await migrateToIncus(h.context);
      expect(h.calls.filter((call) => call.startsWith('deploy'))).toHaveLength(
        1,
      );
      await expectMigrated(h);
    });
  });

  describe('tale runtime migrate --to docker', () => {
    beforeEach(() => {
      writeTaleJson({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
    });

    test('refuses without a recorded migration', async () => {
      const h = harness(await dockerDeployment());
      expect((await refusal(migrateToDocker(h.context))).message).toBe(
        MIGRATE_SENTENCES.noMigration,
      );
    });

    test('after the flip: the Incus instances go, Docker starts on its state', async () => {
      const h = harness(await dockerDeployment());
      await migrateToIncus(h.context);
      expect(h.incus.instances.size).toBeGreaterThan(0);
      await migrateToDocker(h.context);
      expect(h.incus.instances.size).toBe(0);
      // Their volumes stay.
      expect(h.incus.volumes.has('db-data')).toBe(true);
      expect(h.calls).toContain('settle incus');
      expect(h.calls.at(-1)).toBe('end-drain docker');
      expect(runningNames(h.docker)).toHaveLength(h.docker.instances.size);
      expect(taleJson().runtime).toEqual({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
      expect(await getCurrentColor(deployDir)).toBe('blue');
      expect(await getPreviousVersion(deployDir)).toBe('0.5.94');
      expect((await readMigrationJournal(deployDir))?.step).toBe('rolled-back');
      await assertNoMigrationUnderWay(deployDir, 'tale deploy');
      // A later migration starts afresh, with its check.
      const before = h.calls.length;
      await migrateToIncus(h.context);
      expect(h.calls[before]).toBe('check');
      await expectMigrated(h);
    });

    test('before the Incus side exists: Docker starts again, Incus untouched', async () => {
      const h = harness(await dockerDeployment());
      h.context.afterStep = (step) => {
        if (step === 'archived') throw new Interrupt(step);
      };
      await expect(migrateToIncus(h.context)).rejects.toBeInstanceOf(Interrupt);
      h.context.afterStep = undefined;
      await migrateToDocker(h.context);
      expect(h.calls).not.toContain('settle incus');
      expect(runningNames(h.docker)).toHaveLength(h.docker.instances.size);
      expect(taleJson().runtime?.engine).toBe('docker');
      expect(await getCurrentColor(deployDir)).toBe('blue');
    });
  });

  describe('tale runtime migrate --finish', () => {
    beforeEach(() => {
      writeTaleJson({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
    });

    test('refuses before the migration completed', async () => {
      const h = harness(await dockerDeployment());
      h.context.afterStep = (step) => {
        if (step === 'quiesced') throw new Interrupt(step);
      };
      await expect(migrateToIncus(h.context)).rejects.toBeInstanceOf(Interrupt);
      const error = await refusal(
        finishMigration({ ...h.context, confirm: async () => true }),
      );
      expect(error.message).toBe(MIGRATE_SENTENCES.notFlipped);
      expect(h.docker.instances.size).toBe(7);
    });

    test('asks, and removes the Docker stack only on a yes; backups stays', async () => {
      const h = harness(await dockerDeployment());
      await migrateToIncus(h.context);
      const asked: string[] = [];
      await finishMigration({
        ...h.context,
        confirm: async (message) => {
          asked.push(message);
          return false;
        },
      });
      expect(asked).toEqual(['Remove the Docker stack?']);
      expect(h.docker.instances.size).toBe(7);
      expect((await readMigrationJournal(deployDir))?.step).toBe('flipped');

      await finishMigration({
        ...h.context,
        confirm: async () => true,
      });
      expect(h.docker.instances.size).toBe(0);
      for (const volume of Object.keys(DATA))
        expect(h.docker.volumes.has(volume)).toBe(false);
      expect(h.docker.volumes.has('tale_backups')).toBe(true);
      expect((await readMigrationJournal(deployDir))?.step).toBe('finished');
      expect((await refusal(migrateToDocker(h.context))).message).toBe(
        MIGRATE_SENTENCES.finished,
      );
    });

    test('refuses while a Docker container of the stack runs again', async () => {
      const h = harness(await dockerDeployment());
      await migrateToIncus(h.context);
      await h.docker.start(`${PROJECT}-proxy`);
      const error = await refusal(
        finishMigration({
          ...h.context,
          assumeYes: true,
          confirm: async () => true,
        }),
      );
      expect(error.message).toContain(`${PROJECT}-proxy`);
      expect(h.docker.instances.size).toBe(7);
    });
  });

  describe('the smoke checks of a loopback site', () => {
    test('reach the Incus edge by its address, with the site as Host', async () => {
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) =>
          new Response(
            `${request.headers.get('host')} ${new URL(request.url).pathname}`,
          ),
      });
      try {
        const incus = new FakeRuntime({ engine: 'incus' });
        incus.inspect = async () =>
          ({ address: '127.0.0.1' }) as Awaited<
            ReturnType<FakeRuntime['inspect']>
          >;
        const site = `http://localhost:${server.port}`;
        const request = await loopbackEdge(incus, site);
        expect(request).toBeDefined();
        const answer = await (await request?.(`${site}/api/health`))?.text();
        expect(answer).toBe(`localhost:${server.port} /api/health`);
        // A public site is reached as it is.
        expect(
          await loopbackEdge(incus, 'https://tale.example.com'),
        ).toBeUndefined();
      } finally {
        await server.stop(true);
      }
    });
  });

  describe('the published ports of docker ps', () => {
    test.each([
      ['0.0.0.0:80->80/tcp, [::]:80->80/tcp', [80, 80]],
      ['127.0.0.1:5432->5432/tcp', [5432]],
      ['0.0.0.0:440-444->440-444/tcp', [440, 441, 442, 443, 444]],
      ['5432/tcp', []],
      ['', []],
    ])('%s', (ports, expected) => {
      expect(publishedHostPorts(ports)).toEqual(expected);
    });
  });

  describe('the Incus tooling on a Docker workspace', () => {
    test('the contract source reads the Incus runtime runtime.next declares', async () => {
      writeTaleJson({
        engine: 'docker',
        next: { engine: 'incus', incus: incusBlock },
      });
      const source = await workspaceContractSource(deployDir, VERSION, {});
      expect(source.declaration).toEqual(incusBlock);
      expect(source.stack).toBe(PROJECT);
    });

    test('a Docker workspace without runtime.next has none', async () => {
      writeTaleJson({ engine: 'docker' });
      await expect(
        workspaceContractSource(deployDir, VERSION, {}),
      ).rejects.toThrow('declares no Incus runtime');
    });
  });

  test('a migration journal this CLI cannot read is refused', async () => {
    writeFileSync(
      join(deployDir, '.tale', 'migration.json'),
      JSON.stringify({ schemaVersion: 2 }),
    );
    await expect(readMigrationJournal(deployDir)).rejects.toThrow(
      'is not a migration journal this CLI reads',
    );
  });
}

if (isolated) migrationSuite();
else
  test('the migration suite passes in a process of its own', async () => {
    const { exitCode, output } = await runIsolatedTestFile(import.meta.path);
    if (exitCode !== 0 || !/\b[1-9]\d* pass\b/.test(output))
      throw new Error(output);
  }, 300_000);
