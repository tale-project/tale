import { afterEach, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

const repository = resolve(import.meta.dir, '../../..');
const temporary: string[] = [];
type Step = {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string | number>;
  with?: Record<string, unknown>;
};
type Workflow = { jobs: Record<string, { needs?: string[]; steps: Step[] }> };
async function workflow(name = 'release'): Promise<Workflow> {
  const file: Workflow = parse(
    await readFile(join(repository, `.github/workflows/${name}.yml`), 'utf8'),
  );
  return file;
}
async function step(job: string, name: string) {
  const found = (await workflow()).jobs[job]?.steps.find(
    (entry) => entry.name === name,
  );
  if (!found?.run) throw new Error(`Missing executable release step ${name}`);
  return found;
}
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-release-performance-'));
  temporary.push(directory);
  return directory;
}
async function execute(
  script: string,
  directory: string,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(
    [
      process.platform === 'darwin' ? '/bin/bash' : 'bash',
      '-euo',
      'pipefail',
      '-c',
      script,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        PROOF_DIR: directory,
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test('Build and Release use the repository Bun version for container harnesses and release tooling', async () => {
  for (const name of ['build', 'release']) {
    const file = await workflow(name);
    const setup = Object.values(file.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((entry) => entry.uses?.startsWith('oven-sh/setup-bun@'));
    expect(setup.length).toBeGreaterThan(0);
    for (const entry of setup)
      expect(entry.with?.['bun-version']).toBe('1.4.2');
  }
});

test('release checkouts remove persisted credentials while retaining complete contract history', async () => {
  const file = await workflow();
  for (const job of Object.values(file.jobs))
    for (const checkout of (job.steps ?? []).filter((entry) =>
      entry.uses?.startsWith('actions/checkout@'),
    ))
      expect(checkout.with?.['persist-credentials']).toBe(false);
  expect(
    file.jobs['create-release']?.steps.find(
      (entry) => entry.name === 'Checkout',
    )?.with?.['fetch-depth'],
  ).toBe(0);
});

test.skipIf(process.platform === 'win32').each([
  ['sites with headroom', 'true', '20971520', false],
  ['sites without headroom', 'true', '20971519', true],
  ['full release with headroom', 'false', '41943040', false],
  ['full release without headroom', 'false', '41943039', true],
  ['unreadable free space', 'true', 'invalid', false],
])('release cleanup: %s', async (_label, sites, available, reclaim) => {
  const directory = await fixture();
  await writeFile(
    join(directory, 'df'),
    '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nroot 99999999 0 %s 0%% /\\n" "$AVAILABLE_KB"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(directory, 'sudo'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROOF_DIR/reclaim"\n',
    { mode: 0o755 },
  );
  const result = await execute(
    (await step('container-test', 'Reclaim disk space if needed')).run!,
    directory,
    { MIN_FREE_GIB: sites === 'true' ? '20' : '40', AVAILABLE_KB: available },
  );
  expect(result.code).toBe(available === 'invalid' ? 1 : 0);
  const calls = Bun.file(join(directory, 'reclaim'));
  expect(await calls.exists()).toBe(reclaim);
  if (reclaim)
    expect((await calls.text()).trim().split('\n')).toEqual([
      'rm -rf -- /usr/share/dotnet',
      'rm -rf -- /usr/local/lib/android',
      'rm -rf -- /opt/ghc',
      'rm -rf -- /opt/hostedtoolcache/CodeQL',
      'docker image prune -af',
    ]);
});

async function probeFixture(expected: string[], failed: string) {
  const directory = await fixture();
  await writeFile(
    join(directory, 'bun'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = run ]; then shift; fi
test "$#" -eq 1
SERVICE="$(basename "$1" .ts)"
SERVICE="\${SERVICE#container-}"
SERVICE="\${SERVICE%-test}"
test "$SKIP_BUILD" = true
test "$PULL_POLICY" = never
touch "$PROOF_DIR/\${SERVICE}.start"
# A real dependency barrier proves overlap without asserting elapsed wall time.
for ((ATTEMPT = 0; ATTEMPT < 100; ATTEMPT++)); do
  READY=1
  for REQUIRED in $EXPECTED_PROBES; do
    if [ ! -f "$PROOF_DIR/\${REQUIRED}.start" ]; then READY=0; fi
  done
  if [ "$READY" = 1 ]; then break; fi
  sleep 0.01
done
test "$READY" = 1
sleep 0.02
printf '%s complete\\n' "$SERVICE"
touch "$PROOF_DIR/\${SERVICE}.finish"
if [ "$SERVICE" = "$FAILED_PROBE" ]; then exit 37; fi
`,
    { mode: 0o755 },
  );
  return {
    directory,
    env: {
      EXPECTED_PROBES: expected.join(' '),
      FAILED_PROBE: failed,
      SKIP_BUILD: 'true',
      PULL_POLICY: 'never',
    },
  };
}

test.skipIf(process.platform === 'win32').each(['', 'image', 'smoke'])(
  'release stack waits for both independent probes when %s fails',
  async (failed) => {
    const expected = ['image', 'smoke'];
    const proof = await probeFixture(expected, failed);
    const gate = await step('container-test', 'Run stack validation');
    expect(gate.if).toBe("needs.prepare.outputs.sites_only != 'true'");
    expect(gate.env).toEqual({
      PULL_POLICY: 'never',
      SKIP_BUILD: 'true',
      SMOKE_TEST_TIMEOUT: 300,
    });
    const result = await execute(gate.run!, proof.directory, proof.env);
    expect(result.code, result.stdout + result.stderr).toBe(failed ? 1 : 0);
    for (const name of expected) {
      expect(
        await Bun.file(join(proof.directory, `${name}.finish`)).exists(),
      ).toBe(true);
      expect(result.stdout).toContain(`${name} complete`);
    }
  },
);

test.skipIf(process.platform === 'win32').each([
  ['true', ''],
  ['true', 'docs'],
  ['false', ''],
  ['false', 'ai-gateway'],
])(
  'release standalone checks preserve sites_only=%s and await every child when %s fails',
  async (sites, failed) => {
    const expected = [
      'web',
      'docs',
      'ui-docs',
      ...(sites === 'false' ? ['ai-gateway'] : []),
    ];
    const proof = await probeFixture(expected, failed);
    const result = await execute(
      (await step('container-test', 'Run standalone container tests')).run!,
      proof.directory,
      { ...proof.env, SITES_ONLY: sites },
    );
    expect(result.code, result.stdout + result.stderr).toBe(failed ? 1 : 0);
    expect(
      (await readdir(proof.directory))
        .filter((name) => name.endsWith('.finish'))
        .sort(),
    ).toEqual(expected.map((name) => `${name}.finish`).sort());
    for (const name of expected)
      expect(result.stdout).toContain(`${name} complete`);
  },
);

test('release validation logs remain available after failed probes and manifest publication requires the complete gate', async () => {
  const file = await workflow();
  const gate = file.jobs['container-test'];
  const upload = gate.steps.find(
    (entry) => entry.name === 'Upload release validation logs',
  );
  expect(upload?.if).toBe('always()');
  expect(upload?.with).toEqual({
    name: 'release-validation-logs-attempt-${{ github.run_attempt }}',
    path: '${{ runner.temp }}/release-validation.*/*.log',
    'retention-days': 7,
    'if-no-files-found': 'ignore',
  });
  expect(file.jobs.manifest?.needs).toEqual([
    'prepare',
    'build',
    'container-test',
  ]);
  expect(gate.steps.find((entry) => entry.name === 'Summary')?.run).toContain(
    '${{ job.status }}',
  );
});

test
  .skipIf(process.platform === 'win32')
  .each(['', '65534', '10001', 'reject'])(
  'native document checks inspect labels once and await both UIDs with failure %s',
  async (failure) => {
    const directory = await fixture();
    const library = join(directory, 'services/platform/tests/integration/lib');
    await mkdir(library, { recursive: true });
    await writeFile(
      join(library, 'document-tools.ts'),
      `export async function checkDocumentTools(image: string, uid: number, platform: string) {
    if (!image.endsWith('@sha256:' + 'a'.repeat(64)) || platform !== 'linux/arm64') throw new Error('Wrong image identity');
    await Bun.write(process.env.PROOF_DIR + '/' + uid + '.start', '');
    for (let tries = 0; tries < 100; tries++) {
      if (await Bun.file(process.env.PROOF_DIR + '/65534.start').exists() && await Bun.file(process.env.PROOF_DIR + '/10001.start').exists()) break;
      if (tries === 99) throw new Error('UID checks serialized');
      await Bun.sleep(10);
    }
    await Bun.sleep(uid === 10001 ? 40 : 5);
    await Bun.write(process.env.PROOF_DIR + '/' + uid + '.finish', '');
    if (process.env.FAILURE === 'reject' && uid === 65534) throw new Error('Injected rejection');
    return { exitCode: process.env.FAILURE === String(uid) ? 23 : 0, combined: 'uid ' + uid + ' completed' };
  }\n`,
    );
    await writeFile(
      join(directory, 'docker'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROOF_DIR/docker-calls"\nif [ "$1 $2" = "image inspect" ]; then\n  printf "%s\\n" "$LABELS"\nfi\n',
      { mode: 0o755 },
    );
    const result = await execute(
      (await step('build', 'Verify native document tools')).run!,
      directory,
      {
        DOCUMENT_IMAGE: `ghcr.io/tale-project/tale/tale-sandbox-runtime:1.2.3-arm64@sha256:${'a'.repeat(64)}`,
        DOCUMENT_PLATFORM: 'linux/arm64',
        DOCUMENT_REVISION: 'b'.repeat(40),
        DOCUMENT_VERSION: '1.2.3',
        DOCUMENT_SOURCE: 'https://github.com/tale-project/tale',
        FAILURE: failure,
        LABELS: JSON.stringify({
          'org.opencontainers.image.revision': 'b'.repeat(40),
          'org.opencontainers.image.version': '1.2.3',
          'org.opencontainers.image.source':
            'https://github.com/tale-project/tale',
        }),
      },
    );
    expect(result.code, result.stdout + result.stderr).toBe(failure ? 1 : 0);
    expect(
      (await readFile(join(directory, 'docker-calls'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(2);
    for (const uid of [65534, 10001])
      expect(await Bun.file(join(directory, `${uid}.finish`)).exists()).toBe(
        true,
      );
  },
);

test
  .skipIf(process.platform === 'win32')
  .each(['revision', 'version', 'source'])(
  'native document labels reject wrong %s before launching either UID',
  async (label) => {
    const directory = await fixture();
    await writeFile(
      join(directory, 'docker'),
      '#!/bin/sh\nif [ "$1 $2" = "image inspect" ]; then printf "%s\\n" "$LABELS"; fi\n',
      { mode: 0o755 },
    );
    await writeFile(
      join(directory, 'bun'),
      '#!/bin/sh\ntouch "$PROOF_DIR/unexpected-probe"\n',
      { mode: 0o755 },
    );
    const labels = {
      'org.opencontainers.image.revision': 'b'.repeat(40),
      'org.opencontainers.image.version': '1.2.3',
      'org.opencontainers.image.source': 'https://github.com/tale-project/tale',
      [`org.opencontainers.image.${label}`]: 'wrong',
    };
    const result = await execute(
      (await step('build', 'Verify native document tools')).run!,
      directory,
      {
        DOCUMENT_IMAGE: `ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:${'a'.repeat(64)}`,
        DOCUMENT_PLATFORM: 'linux/amd64',
        DOCUMENT_REVISION: 'b'.repeat(40),
        DOCUMENT_VERSION: '1.2.3',
        DOCUMENT_SOURCE: 'https://github.com/tale-project/tale',
        LABELS: JSON.stringify(labels),
      },
    );
    expect(result.code).not.toBe(0);
    expect(await Bun.file(join(directory, 'unexpected-probe')).exists()).toBe(
      false,
    );
  },
);

test
  .skipIf(process.platform === 'win32')
  .each(['', 'platform', 'sandbox-runtime'])(
  'final manifest checks preserve all twelve services and aggregate failure %s',
  async (failure) => {
    const directory = await fixture();
    const services = [
      'platform',
      'db',
      'proxy',
      'web',
      'docs',
      'ui-docs',
      'ai-gateway',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'sandbox-buildkitd',
      'sandbox-runtime',
    ];
    await writeFile(
      join(directory, 'docker'),
      `#!/usr/bin/env python3
import fcntl, json, os, sys, time
service = sys.argv[-1].split('tale-')[-1].split(':')[0]
def event(delta):
    with open(os.environ['PROOF_DIR'] + '/state', 'r+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        state = json.load(stream)
        state['active'] += delta
        state['peak'] = max(state['peak'], state['active'])
        if delta < 0: state['finished'].append(service)
        stream.seek(0); json.dump(state, stream); stream.truncate()
event(1); time.sleep(0.03); event(-1)
sys.exit(1 if service == os.environ['FAILURE'] else 0)
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(directory, 'state'),
      JSON.stringify({ active: 0, peak: 0, finished: [] }),
    );
    const result = await execute(
      (await step('create-release', 'Verify manifests are pullable')).run!,
      directory,
      {
        SERVICE_NAMES: JSON.stringify(services),
        REGISTRY_PATH: 'ghcr.io/tale-project/tale',
        VERSION: '1.2.3',
        FAILURE: failure,
      },
    );
    expect(result.code, result.stdout + result.stderr).toBe(failure ? 1 : 0);
    const state: { active: number; peak: number; finished: string[] } =
      JSON.parse(await readFile(join(directory, 'state'), 'utf8'));
    expect(state.active).toBe(0);
    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(3);
    expect(state.finished.sort()).toEqual(services.sort());
    expect(result.stdout.includes('All service manifests verified')).toBe(
      failure === '',
    );
  },
);

test('release validation chooses the sites/full headroom and shares progressive cleanup with builders', async () => {
  const cleanup = await step('container-test', 'Reclaim disk space if needed');
  expect(cleanup.env?.MIN_FREE_GIB).toBe(
    "${{ needs.prepare.outputs.sites_only == 'true' && '20' || '40' }}",
  );
  expect(cleanup.run).toBe((await step('build', 'Reclaim disk space')).run);
});
