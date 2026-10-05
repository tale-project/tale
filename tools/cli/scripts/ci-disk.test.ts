import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse } from 'yaml';

type Step = {
  name: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
};
type Workflow = { jobs: Record<string, { steps: Step[] }> };
const repository = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
const toolchains = [
  '/usr/share/dotnet',
  '/usr/local/lib/android',
  '/opt/ghc',
  '/opt/hostedtoolcache/CodeQL',
];
const kibPerGib = 1024 * 1024;
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function cleanupSteps() {
  const result: { workflow: string; job: string; step: Step }[] = [];
  for (const workflow of ['build', 'release']) {
    const file = parse(
      await readFile(
        join(repository, `.github/workflows/${workflow}.yml`),
        'utf8',
      ),
    ) as Workflow;
    for (const [job, value] of Object.entries(file.jobs)) {
      for (const step of value.steps ?? []) {
        if (step.name.startsWith('Reclaim disk space'))
          result.push({ workflow, job, step });
      }
    }
  }
  return result;
}

test('every image cleanup uses one candidate-independent policy and preserves cold-build headroom', async () => {
  const entries = await cleanupSteps();
  expect(
    entries.map(({ workflow, job, step }) => [
      workflow,
      job,
      step.env?.MIN_FREE_GIB,
    ]),
  ).toEqual([
    ['build', 'build', '40'],
    ['build', 'smoke-test', '28'],
    ['build', 'smoke-test-fork', '40'],
    ['build', 'web-test', '20'],
    ['build', 'docs-test', '20'],
    ['build', 'ui-docs-test', '20'],
    ['build', 'ai-gateway-test', '20'],
    ['build', 'image-validate', '28'],
    ['build', 'image-validate-fork', '40'],
    ['release', 'build', '40'],
    ['release', 'container-test', '28'],
  ]);
  expect(new Set(entries.map(({ step }) => step.run)).size).toBe(1);
  for (const { job, step } of entries) {
    expect(step.run).not.toContain('.github/scripts');
    if (job === 'build') {
      expect(step.if).toContain("'platform'");
      expect(step.if).toContain("'sandbox-runtime'");
    } else expect(step.if).toBeUndefined();
  }
});

async function execute(options: {
  available: number | string;
  target?: string;
  reclaimed?: number;
  pruned?: number;
  fail?: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-ci-disk-'));
  directories.push(directory);
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(join(directory, 'available'), String(options.available));
  await writeFile(join(directory, 'calls'), '');
  const scripts = {
    df: `#!/usr/bin/env bash
set -euo pipefail
printf 'df %s\\n' "$*" >> "$FIXTURE/calls"
if [ "\${FAIL:-}" = df ] || { [ "\${FAIL:-}" = df-k ] && [ "$1" = -Pk ]; }; then exit 31; fi
if [ "$1" = -h ]; then
  printf 'Filesystem Size Used Avail Use%% Mounted on\\nfixture 80G 40G 40G 50%% /\\n'
else
  read -r AVAILABLE < "$FIXTURE/available" || true
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 999999999 1 %s 1%% /\\n' "$AVAILABLE"
fi
`,
    sudo: `#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\\n' "$*" >> "$FIXTURE/calls"
if [ "\${FAIL:-}" = "$1" ]; then exit 32; fi
read -r AVAILABLE < "$FIXTURE/available" || true
case "$1" in
  rm) AVAILABLE=$((AVAILABLE + RECLAIMED)) ;;
  docker) AVAILABLE=$((AVAILABLE + PRUNED)) ;;
  *) exit 33 ;;
esac
printf '%s\\n' "$AVAILABLE" > "$FIXTURE/available"
`,
  };
  for (const [name, script] of Object.entries(scripts)) {
    await writeFile(join(bin, name), script);
    await chmod(join(bin, name), 0o755);
  }
  const entries = await cleanupSteps();
  // macOS CI exercises its oldest supported native shell, Bash 3.2.
  const shell = process.platform === 'darwin' ? '/bin/bash' : 'bash';
  const child = Bun.spawn([shell, '-c', entries[0]!.step.run!], {
    cwd: directory,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      FIXTURE: directory,
      MIN_FREE_GIB: options.target ?? '28',
      RECLAIMED: String(options.reclaimed ?? 0),
      PRUNED: String(options.pruned ?? 0),
      FAIL: options.fail ?? '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const calls = (await readFile(join(directory, 'calls'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean);
  return { code, stdout, stderr, calls };
}

describe.skipIf(process.platform === 'win32')(
  'measured disk reclamation',
  () => {
    test.each(['20', '28', '40'])(
      'sufficient %sGiB requires no deletion or prune',
      async (target) => {
        const result = await execute({
          available: Number(target) * kibPerGib,
          target,
        });
        expect(result.code, result.stderr).toBe(0);
        expect(result.calls).toEqual(['df -h /', 'df -Pk /']);
        expect(result.stdout).toContain(`cleanup target: ${target} GiB`);
      },
    );

    test.each(['20', '28', '40'])(
      'rechecks after each directory and stops immediately on reaching %sGiB',
      async (target) => {
        const result = await execute({
          available: (Number(target) - 2) * kibPerGib,
          target,
          reclaimed: kibPerGib,
        });
        expect(result.code, result.stderr).toBe(0);
        expect(result.calls).toEqual([
          'df -h /',
          'df -Pk /',
          `sudo rm -rf -- ${toolchains[0]}`,
          'df -h /',
          'df -Pk /',
          `sudo rm -rf -- ${toolchains[1]}`,
          'df -h /',
          'df -Pk /',
        ]);
      },
    );

    test.each([0, 40 * kibPerGib])(
      'exhausted directory cleanup retains the image-prune fallback (%sKiB reclaimed)',
      async (pruned) => {
        const result = await execute({ available: 0, target: '40', pruned });
        expect(result.code, result.stderr).toBe(0);
        expect(result.calls.filter((call) => call.startsWith('sudo '))).toEqual(
          [
            ...toolchains.map((path) => `sudo rm -rf -- ${path}`),
            'sudo docker image prune -af',
          ],
        );
        expect(result.calls.filter((call) => call === 'df -Pk /')).toHaveLength(
          6,
        );
        expect(result.stdout.includes('::warning::')).toBe(pruned === 0);
      },
    );

    test.each(['', 'unknown', '-1', '1.5'])(
      'invalid capacity %j fails before any cleanup',
      async (available) => {
        const result = await execute({ available });
        expect(result.code).not.toBe(0);
        expect(result.stdout).toContain('Could not measure free disk space');
        expect(result.calls.some((call) => call.startsWith('sudo '))).toBe(
          false,
        );
      },
    );

    test('an invalid target fails before disk inspection', async () => {
      const result = await execute({ available: 0, target: '0' });
      expect(result.code).not.toBe(0);
      expect(result.calls).toEqual([]);
    });

    test.each(['df', 'df-k', 'rm', 'docker'])(
      '%s failures remain blocking',
      async (fail) => {
        const result = await execute({ available: 0, fail });
        expect(result.code).not.toBe(0);
        if (fail === 'df') expect(result.calls).toEqual(['df -h /']);
        if (fail === 'df-k')
          expect(result.calls).toEqual(['df -h /', 'df -Pk /']);
        if (fail === 'rm')
          expect(
            result.calls.filter((call) => call.startsWith('sudo ')),
          ).toEqual([`sudo rm -rf -- ${toolchains[0]}`]);
        if (fail === 'docker')
          expect(result.calls.at(-1)).toBe('sudo docker image prune -af');
      },
    );
  },
);
