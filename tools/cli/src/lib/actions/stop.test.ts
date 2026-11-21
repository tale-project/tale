import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError } from '../../utils/fail';
import { SPLIT, THREE_WAY, UNIFIED } from '../compose/app-tier';
import { setProjectId } from '../project/project-context';
import { FakeRuntime } from '../runtime/fake-runtime';
import { setRestorePending } from '../runtime/incus/apply/journal';
import {
  declaredGraces,
  startEnvironment,
  stopEnvironment,
  stopGroupOf,
} from './stop';

const testPosix = test.skipIf(process.platform === 'win32');

/**
 * `tale stop` and `tale start` (design D-23, R3-05, R3-28): the three stop
 * groups in order on both runtimes, each instance within its grace, the
 * start the other way round behind health gates, and the restore guard.
 */

const PROJECT = 'tale';
const IMAGE = 'ghcr.io/tale-project/tale/tale-platform:0.5.95';

let deployDir: string;

beforeEach(() => {
  setProjectId(PROJECT);
  deployDir = mkdtempSync(join(tmpdir(), 'tale-stop-'));
});

afterEach(() => {
  rmSync(deployDir, { recursive: true, force: true });
});

/** A whole environment: the stateful stack (with the Incus singletons on
 * Incus) and the blue colour, named as each runtime names them. */
function environment(engine: 'docker' | 'incus'): FakeRuntime {
  const fake = new FakeRuntime({ engine });
  const singletons = [
    'db',
    'object-store',
    'proxy',
    'sandbox',
    'sandbox-egress',
    'sandbox-llm-gateway',
    'bgutil-provider',
    ...(engine === 'incus' ? ['names', 'names-sessions', 'switch'] : []),
  ];
  for (const service of singletons)
    fake.seedInstance({
      name: engine === 'incus' ? service : `${PROJECT}-${service}`,
      stack: PROJECT,
      service,
      image: IMAGE,
    });
  for (const service of ['platform', 'backend-api', 'backend-worker'])
    fake.seedInstance({ stack: `${PROJECT}-blue`, service, image: IMAGE });
  return fake;
}

/** The services each `verb` reached, in the order of the calls, as groups
 * of the stop table. */
function groupsOf(fake: FakeRuntime, verb: string): number[] {
  const groups: number[] = [];
  for (const entry of fake.journal) {
    if (!entry.startsWith(`${verb} `)) continue;
    const name = entry.slice(verb.length + 1).split(' ')[0] ?? '';
    const instance = fake.instances.get(name);
    const group = stopGroupOf(instance?.service ?? '');
    if (groups.at(-1) !== group) groups.push(group);
  }
  return groups;
}

describe('tale stop', () => {
  for (const engine of ['docker', 'incus'] as const)
    test(`${engine}: the edge and the colours, then the middle tier, then data`, async () => {
      const fake = environment(engine);
      const stopped = await stopEnvironment({ deployDir, runtime: fake });
      expect(stopped).toBe(fake.instances.size);
      expect(groupsOf(fake, 'stop')).toEqual([90, 50, 10]);
      expect(
        [...fake.instances.values()].every(
          (instance) => instance.state === 'exited',
        ),
      ).toBe(true);
    });

  test('Docker stops each container within the grace its compose file declares', async () => {
    const fake = environment('docker');
    await stopEnvironment({ deployDir, runtime: fake });
    const graces = declaredGraces();
    expect(graces.db).toBe(60);
    expect(graces.platform).toBe(45);
    expect(fake.journal).toContain(`stop ${PROJECT}-db -t 60`);
    expect(fake.journal).toContain(`stop ${PROJECT}-blue-platform-1 -t 45`);
    // A service that declares none keeps Docker's own.
    expect(fake.journal).toContain(`stop ${PROJECT}-bgutil-provider`);
  });

  // `platform` as the whole application hands its automation runs on like a
  // worker: `-t` overrides the container's own stop timeout, so a grace read
  // off three services would kill it 45 s in, mid-drain.
  test('Docker gives a colour the grace its own shape declares', async () => {
    expect(declaredGraces(UNIFIED).platform).toBe(120);
    expect(declaredGraces(SPLIT).platform).toBe(45);
    expect(declaredGraces(SPLIT)['backend-worker']).toBe(120);
    expect(declaredGraces(THREE_WAY)).toEqual(declaredGraces());

    const fake = environment('docker');
    // Mid-flip: blue is three services, green one process.
    fake.seedInstance({
      stack: `${PROJECT}-green`,
      service: 'platform',
      image: IMAGE,
      environment: { TALE_ROLE: 'all' },
    });
    await stopEnvironment({ deployDir, runtime: fake });
    expect(fake.journal).toContain(`stop ${PROJECT}-green-platform-1 -t 120`);
    expect(fake.journal).toContain(`stop ${PROJECT}-blue-platform-1 -t 45`);
    expect(fake.journal).toContain(`stop ${PROJECT}-blue-backend-api-1 -t 30`);
    expect(fake.journal).toContain(
      `stop ${PROJECT}-blue-backend-worker-1 -t 120`,
    );
  });

  test('a colour whose shape cannot be read is still stopped, within the graces of three services', async () => {
    const fake = environment('docker');
    const inspect = fake.inspect.bind(fake);
    fake.inspect = async (name) =>
      name === `${PROJECT}-blue-platform-1` ? null : inspect(name);
    const stopped = await stopEnvironment({ deployDir, runtime: fake });
    expect(stopped).toBe(fake.instances.size);
    expect(fake.journal).toContain(`stop ${PROJECT}-blue-platform-1 -t 45`);
  });

  test('Incus stops each instance within its own declared grace', async () => {
    const fake = environment('incus');
    await stopEnvironment({ deployDir, runtime: fake });
    expect(fake.journal).toContain('stop db');
    expect(fake.journal.some((entry) => entry.includes(' -t '))).toBe(false);
  });

  test('a dry run names the order and stops nothing', async () => {
    const fake = environment('docker');
    expect(
      await stopEnvironment({ deployDir, runtime: fake, dryRun: true }),
    ).toBe(0);
    expect(fake.journal.some((entry) => entry.startsWith('stop '))).toBe(false);
  });
});

describe('tale start', () => {
  for (const engine of ['docker', 'incus'] as const)
    test(`${engine}: data first, each group healthy before the next`, async () => {
      const fake = environment(engine);
      await stopEnvironment({ deployDir, runtime: fake });
      fake.journal.length = 0;
      const started = await startEnvironment({
        deployDir,
        runtime: fake,
        healthTimeout: 5,
      });
      expect(started).toBe(fake.instances.size);
      expect(groupsOf(fake, 'start')).toEqual([10, 50, 90]);
      expect(
        [...fake.instances.values()].every(
          (instance) => instance.state === 'running',
        ),
      ).toBe(true);
    });

  test('an instance that will not become healthy stops the start before the next group', async () => {
    const fake = environment('docker');
    await stopEnvironment({ deployDir, runtime: fake });
    const db = fake.instances.get(`${PROJECT}-db`);
    if (db === undefined) throw new Error('no db');
    db.health = 'unhealthy';
    fake.journal.length = 0;
    await expect(
      startEnvironment({ deployDir, runtime: fake, healthTimeout: 1 }),
    ).rejects.toThrow(`${PROJECT}-db did not become healthy`);
    expect(groupsOf(fake, 'start')).toEqual([10]);
  });

  // The Incus runtime file's mode-0600 owner guard runs before the restore guard, and main refuses the Incus
  // runtime on Windows, so this case is POSIX-only like the other Incus suites.
  testPosix(
    'Incus refuses to start while a restore is pending (R3-22)',
    async () => {
      const fake = environment('incus');
      await stopEnvironment({ deployDir, runtime: fake });
      await setRestorePending(deployDir, PROJECT, {
        id: 'snap',
        startedAt: '2026-11-13T10:00:00.000Z',
        volumes: ['db-data'],
        steps: { 'db-data': 'renamed' },
        holders: {},
      });
      fake.journal.length = 0;
      const refused = await startEnvironment({
        deployDir,
        runtime: fake,
        healthTimeout: 5,
      }).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CliError);
      expect((refused as CliError).message).toContain('tale start');
      expect(fake.journal.some((entry) => entry.startsWith('start '))).toBe(
        false,
      );
    },
  );
});
