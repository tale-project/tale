// The parts of the CLI Incus lab that need no node: the lab's configuration,
// the specification it deploys, the arithmetic of the load through the edge,
// and the lists the workflow, the suite picker and the image build keep in
// step. An ordinary unit test (`bun run --filter @tale/cli test`).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

import { resolveDeploymentSpec } from '../../src/lib/deployment/model';
import { defaultSessionsZone } from '../../src/lib/runtime/incus/contract/bootstrap';
import { deploymentEnvironment, loadLab, specOf } from './harness';
import { judge, lengthOf, startLoad, windowsOf, type Sample } from './load';

const here = import.meta.dir;
const root = join(here, '../../../..');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function labEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    TALE_E2E_LAB: '1',
    TALE_E2E_DIR: join(tmpdir(), 'tale-cli-e2e-test'),
    TALE_E2E_REVISION: A,
    TALE_E2E_NEXT_REVISION: B,
    TALE_E2E_NEXT_SOURCE: '/next',
    ...overrides,
  };
}

describe('the lab', () => {
  test('runs only when asked to, on a real node', () => {
    expect(() => loadLab({})).toThrow('TALE_E2E_LAB=1');
    expect(() => loadLab(labEnvironment({ TALE_E2E_LAB: '0' }))).toThrow(
      'TALE_E2E_LAB=1',
    );
  });

  test("defaults to the CI lab, whose gateway the lab's server certificate names", () => {
    const lab = loadLab(labEnvironment());
    expect(lab).toMatchObject({
      name: 'cli-e2e',
      pool: 'tank',
      network: {
        subnet: '10.20.0.0/22',
        gateway: '10.20.0.1',
        block: '10.20.1.0/25',
      },
      sessions: '10.21.0.0/24',
      endpoint: 'https://10.20.0.1:8443',
      registry: '127.0.0.1:5000',
      dockerMirror: 'mirror.gcr.io:443',
      version: '0.0.0',
      incus: ['incus'],
      root: [],
    });
    expect(
      loadLab(
        labEnvironment({
          TALE_E2E_INCUS: 'sudo /usr/bin/incus',
          TALE_E2E_ROOT: 'sudo -E',
        }),
      ),
    ).toMatchObject({
      incus: ['sudo', '/usr/bin/incus'],
      root: ['sudo', '-E'],
    });
  });

  test.each([
    ['a name too long for a bridge', { TALE_E2E_NAME: 'a-name-far-too-long' }],
    ['an uppercase name', { TALE_E2E_NAME: 'Lab' }],
    ['a short revision', { TALE_E2E_REVISION: 'abc123' }],
    ['the same release twice', { TALE_E2E_NEXT_REVISION: A }],
    ['a relative directory', { TALE_E2E_DIR: 'run' }],
    ['a version that is no release', { TALE_E2E_VERSION: 'v1' }],
    ['a registry URL', { TALE_E2E_REGISTRY: 'http://127.0.0.1:5000' }],
    ['no next source', { TALE_E2E_NEXT_SOURCE: undefined }],
  ])('refuses %s', (_case, overrides) => {
    expect(() => loadLab(labEnvironment(overrides))).toThrow();
  });
});

describe('the specification', () => {
  const lab = loadLab(labEnvironment({ TALE_E2E_NAME: 'ti-20' }));

  test.each([1, 2] as const)(
    'release %i is a managed specification this CLI accepts, on the Incus runtime of the lab',
    (release) => {
      const environment = Object.fromEntries(
        Object.entries(deploymentEnvironment(lab)).map(([key, value]) => [
          key,
          value,
        ]),
      );
      const spec = resolveDeploymentSpec(specOf(lab, release), environment);
      expect(spec.runtime.revision).toBe(release === 1 ? A : B);
      expect(spec.runtime.engine).toBe('incus');
      expect(spec.runtime.incus).toMatchObject({
        project: 'ti-20',
        pool: 'tank',
        network: { name: 'ti-20', gateway: '10.20.0.1' },
        registryMirror: 'mirror.gcr.io:443',
        registryMirrors: { 'ghcr.io': '127.0.0.1:5000' },
      });
      expect(spec.sandbox).toEqual({ backend: 'incus' });
      expect(spec.identity?.nativeClients).toEqual([]);
      const withClient = resolveDeploymentSpec(
        specOf({ ...lab, nativeClient: true }, release),
        environment,
      );
      expect(
        withClient.identity?.nativeClients.map((client) => client.key),
      ).toEqual(['e2e-portal']);
    },
  );

  test("names the spawner's zone as bootstrap makes it", () => {
    const spec = resolveDeploymentSpec(
      specOf(lab, 1),
      deploymentEnvironment(lab),
    );
    const zone = defaultSessionsZone(spec.runtime.incus!);
    const environment = deploymentEnvironment(lab);
    expect(environment.E2E_SANDBOX_INCUS_PROJECT).toBe(zone.project);
    expect(environment.E2E_SANDBOX_INCUS_NETWORK).toBe(zone.network);
    expect(environment.E2E_SANDBOX_INCUS_PROFILE).toBe(zone.profile);
    expect(environment.E2E_SANDBOX_INCUS_STORAGE_POOL).toBe('tank');
  });

  test('the sentinel is the run’s own and lives only in its directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tale-cli-e2e-sentinel-'));
    try {
      const own = loadLab(labEnvironment({ TALE_E2E_DIR: dir }));
      const first = deploymentEnvironment(own).E2E_SENTINEL;
      expect(first).toMatch(/^e2e-sentinel-[0-9a-f]{24}$/);
      expect(deploymentEnvironment(own).E2E_SENTINEL).toBe(first);
      expect(JSON.stringify(specOf(own, 1))).not.toContain(first!);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the load through the edge', () => {
  test('judges what a visitor sees', () => {
    expect(judge(200, '{"ok":true}')).toEqual({ ok: true });
    expect(judge(0, 'fetch failed')).toEqual({
      ok: false,
      reason: 'no answer',
    });
    expect(judge(502, '')).toEqual({ ok: false, reason: 'HTTP 502' });
    expect(judge(200, '<title>Tale is under maintenance</title>').ok).toBe(
      false,
    );
    expect(judge(503, '{"code":"UPSTREAM_UNAVAILABLE"}').reason).toBe(
      'HTTP 503',
    );
    expect(judge(404, '').ok).toBe(false);
  });

  test('a window runs from a target’s first failure to its next success', () => {
    const sample = (target: string, at: number, ok: boolean): Sample => ({
      target,
      at,
      status: ok ? 200 : 503,
      ok,
    });
    const windows = windowsOf([
      sample('platform', 0, true),
      sample('platform', 100, false),
      sample('backend-api', 150, false),
      sample('platform', 200, false),
      sample('platform', 300, true),
      sample('platform', 400, false),
      sample('backend-api', 450, true),
    ]);
    expect(windows).toEqual([
      { target: 'platform', from: 100, to: 300, failures: 2 },
      { target: 'backend-api', from: 150, to: 450, failures: 1 },
      { target: 'platform', from: 400, to: null, failures: 1 },
    ]);
    expect(windows.map(lengthOf)).toEqual([200, 300, null]);
    expect(windowsOf([sample('platform', 0, true)])).toEqual([]);
  });

  test('asks each target in turn until stopped, and keeps every answer', async () => {
    let clock = 0;
    let calls = 0;
    const load = startLoad(
      [
        { name: 'platform', url: 'http://edge/api/health' },
        { name: 'backend-api', url: 'http://edge/api/health/ready' },
      ],
      {
        intervalMs: 1,
        now: () => (clock += 10),
        fetch: (async (url: string) => {
          calls += 1;
          if (calls === 3) throw new Error('connection refused');
          return new Response(url.endsWith('ready') ? 'maintenance' : 'ok', {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
    );
    await Bun.sleep(30);
    const samples = await load.stop();
    expect(samples.length).toBeGreaterThan(2);
    expect(samples.every((s, i) => i === 0 || s.at >= samples[i - 1]!.at)).toBe(
      true,
    );
    expect(samples.some((s) => s.target === 'platform' && s.ok)).toBe(true);
    expect(
      samples.filter((s) => s.target === 'backend-api').every((s) => !s.ok),
    ).toBe(true);
    expect(samples.some((s) => s.status === 0)).toBe(true);
  });
});

describe('the lists kept in step', () => {
  const picker = (choice: string) =>
    spawnSync('bash', [join(here, 'suites.sh'), choice], { encoding: 'utf8' });
  const suites = picker('all')
    .stdout.trim()
    .split('\n')
    .map((line) => line.replace(/=true$/, ''));

  test('the picker, the suites and the workflow name the same suites, in order', () => {
    expect(
      readdirSync(join(here, 'suites'))
        .filter((file) => file.endsWith('.e2e.ts'))
        .map((file) => file.replace(/\.e2e\.ts$/, ''))
        .toSorted(),
    ).toEqual(suites.toSorted());
    const workflow = parse(
      readFileSync(join(root, '.github/workflows/cli-incus-e2e.yml'), 'utf8'),
    ) as { jobs: { incus: { steps: { if?: string; run?: string }[] } } };
    const order = workflow.jobs.incus.steps.flatMap((step) => {
      const match = /\.\/e2e\/incus\/suites\/([a-z-]+)\.e2e\.ts/.exec(
        step.run ?? '',
      );
      if (match === null) return [];
      expect(step.if).toContain(`steps.pick.outputs.${match[1]} == 'true'`);
      return [match[1]];
    });
    expect(order).toEqual(suites);
    const script = JSON.parse(
      readFileSync(join(root, 'tools/cli/package.json'), 'utf8'),
    ).scripts['test:e2e:incus'] as string;
    expect(
      [...script.matchAll(/suites\/([a-z-]+)\.e2e\.ts/g)].map((m) => m[1]),
    ).toEqual(suites);
  });

  test('the picker refuses a suite it does not know', () => {
    expect(picker('logs,stop').stdout).toContain('logs=true');
    expect(picker('logs,stop').stdout).toContain('managed=false');
    const wrong = picker('logs,flip');
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain("unknown suite 'flip'");
  });

  test('the image build makes every Tale image the managed path pins', () => {
    const compose = readFileSync(join(root, 'compose.yml'), 'utf8');
    const fromCompose = [
      ...compose.matchAll(
        /image: ghcr\.io\/tale-project\/tale\/tale-([a-z-]+):\$\{VERSION:-latest\}/g,
      ),
    ].map((match) => match[1]);
    // The two sandbox images the prepared bundle pins beside the services.
    const wanted = [
      ...new Set([...fromCompose, 'sandbox-runtime', 'sandbox-buildkitd']),
    ].toSorted();
    const script = readFileSync(join(here, 'images.sh'), 'utf8');
    const built = /SERVICES:-([a-z -]+)\}/.exec(script)?.[1]?.split(' ');
    expect(built?.toSorted()).toEqual(wanted);
  });
});
