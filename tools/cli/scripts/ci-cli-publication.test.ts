import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

type Step = {
  id?: string;
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
const workflow = parse(
  await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  ),
) as {
  on: { push: { paths: string[] }; pull_request: { paths?: string[] } };
  jobs: {
    build: { steps: Step[] };
    release: { needs: string[]; 'timeout-minutes': number; steps: Step[] };
  };
};
const roots: string[] = [];
const binaries = [
  'tale_linux',
  'tale_linux_arm64',
  'tale_macos',
  'tale_macos_x64',
  'tale_windows.exe',
];
const source = '1234567890abcdef1234567890abcdef12345678';
const step = (job: 'build' | 'release', name: string) => {
  const value = workflow.jobs[job].steps.find((item) => item.name === name);
  if (!value) throw new Error(`Missing ${job} step: ${name}`);
  return value;
};
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-cli-publication-'));
  roots.push(root);
  const bin = join(root, 'bin');
  await mkdir(bin);
  return { root, bin };
}
async function executable(path: string, contents: string) {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}
async function execute(
  root: string,
  bin: string,
  command: string,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(['bash', '-e', '-o', 'pipefail', '-c', command], {
    cwd: root,
    env: { PATH: `${bin}:${process.env.PATH}`, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, output: stdout + stderr };
}

test('CLI push and PR scope include install inputs and imported runtime source', async () => {
  const expected = [
    'package.json',
    'bunfig.toml',
    'patches/**',
    'tsconfig*.json',
    'configs/platform/**',
    'services/platform/backend/core/**',
    'services/platform/backend/auth/membership.ts',
    'services/platform/backend/auth/oidc.ts',
    'services/platform/backend/db/sql.ts',
    'services/platform/backend/db/ssl.ts',
    'services/platform/backend/domains/audit_logs/**',
    'services/platform/backend/domains/sandbox/retirement-schedule.ts',
    'services/platform/backend/domains/two_factor/service.ts',
    'services/platform/backend/jobs/enqueue.ts',
    'services/platform/backend/jobs/tasks.ts',
    'services/platform/backend/lib/org-config.ts',
  ];
  const scopes = parse(
    await readFile(
      new URL('../../../.github/ci-scope.yml', import.meta.url),
      'utf8',
    ),
  ) as { cli: string[] };
  expect(workflow.on.pull_request.paths).toBeUndefined();
  expect(scopes.cli).toEqual(workflow.on.push.paths);
  for (const paths of [workflow.on.push.paths, scopes.cli])
    for (const path of expected) expect(paths).toContain(path);
});

test('CLI downloads are saved after install before later checks can fail', () => {
  const steps = workflow.jobs.build.steps;
  const restore = step('build', 'Restore Bun install cache');
  const save = step('build', 'Save installed Bun downloads');
  expect(restore.uses).toBe(
    'actions/cache/restore@27d5ce7f107fe9357f9df03efb73ab90386fccae',
  );
  expect(save.uses).toBe(
    'actions/cache/save@27d5ce7f107fe9357f9df03efb73ab90386fccae',
  );
  expect(restore.id).toBe('bun-cache');
  expect(save.if).toBe("steps.bun-cache.outputs.cache-hit != 'true'");
  expect(save.with?.path).toBe(restore.with?.path);
  expect(restore.with?.path).toBe(
    "${{ (matrix.cross || runner.os == 'Windows') && env.BUN_INSTALL_CACHE_DIR || '~/.bun/install/cache' }}",
  );
  expect(save.with?.key).toBe(
    '${{ steps.bun-cache.outputs.cache-primary-key }}',
  );
  expect(steps.indexOf(save)).toBeGreaterThan(
    steps.indexOf(step('build', 'Install dependencies')),
  );
  expect(steps.indexOf(save)).toBeLessThan(
    steps.indexOf(step('build', 'Run unit tests')),
  );
  const key = String(restore.with?.key);
  for (const input of ['bun.lock', 'package.json', 'patches/**', 'bunfig.toml'])
    expect(key).toContain(`'${input}'`);
  expect(step('build', 'Checkout').with?.['persist-credentials']).toBe(false);
});

test('release download selects only five expected binary artifact names', () => {
  expect(step('release', 'Download artifacts').with?.pattern).toBe(
    `{${binaries.join(',')}}`,
  );
  expect(workflow.jobs.release.needs).toContain('prepare');
  expect(
    step('release', 'Wait for release to exist').env?.EXPECTED_SOURCE_SHA,
  ).toBe('${{ needs.prepare.outputs.source_sha }}');
});

describe.skipIf(process.platform === 'win32')(
  'CLI publication preflight',
  () => {
    async function artifacts() {
      const value = await fixture();
      for (const binary of binaries) {
        await mkdir(join(value.root, 'artifacts', binary), { recursive: true });
        await writeFile(
          join(value.root, 'artifacts', binary, binary),
          `synthetic ${binary} bytes\0`,
        );
      }
      // Exercise the workflow's exact shell while using Bun's maintained SHA-256
      // implementation on hosts that do not install GNU coreutils.
      await executable(
        join(value.bin, 'sha256sum'),
        `#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2))
  console.log(createHash('sha256').update(readFileSync(file)).digest('hex') + '  ' + file);
`,
      );
      return value;
    }

    test('checksums bind every exact binary without renaming arbitrary files', async () => {
      const { root, bin } = await artifacts();
      const result = await execute(
        root,
        bin,
        step('release', 'Generate checksums').run!,
      );
      expect(result.status, result.output).toBe(0);
      const lines = (
        await readFile(join(root, 'release/tale_checksums.txt'), 'utf8')
      )
        .trim()
        .split('\n');
      expect(lines).toEqual(
        binaries.map(
          (binary) =>
            `${createHash('sha256').update(`synthetic ${binary} bytes\0`).digest('hex')}  ${binary}`,
        ),
      );
    });

    test.each([
      'missing',
      'extra-artifact',
      'extra-file',
      'hidden-file',
      'wrong-name',
      'empty',
      'nested-directory',
      'file-symlink',
      'directory-symlink',
      'root-symlink',
    ])('rejects %s artifact state before copying any binary', async (kind) => {
      const { root, bin } = await artifacts();
      const directory = join(root, 'artifacts', binaries[0]!);
      const file = join(directory, binaries[0]!);
      if (kind === 'missing') await rm(file);
      if (kind === 'extra-artifact')
        await mkdir(join(root, 'artifacts/unexpected'));
      if (kind === 'extra-file' || kind === 'hidden-file')
        await writeFile(
          join(directory, kind === 'hidden-file' ? '.hidden' : 'extra'),
          'extra',
        );
      if (kind === 'wrong-name') await rename(file, join(directory, 'wrong'));
      if (kind === 'empty') await writeFile(file, '');
      if (kind === 'nested-directory') {
        await rm(file);
        await mkdir(file);
      }
      if (kind === 'file-symlink') {
        await rename(file, join(root, 'outside'));
        await symlink(join(root, 'outside'), file);
      }
      if (kind === 'directory-symlink') {
        await rename(directory, join(root, 'outside'));
        await symlink(join(root, 'outside'), directory);
      }
      if (kind === 'root-symlink') {
        await rename(join(root, 'artifacts'), join(root, 'outside'));
        await symlink(join(root, 'outside'), join(root, 'artifacts'));
      }
      const result = await execute(
        root,
        bin,
        step('release', 'Generate checksums').run!,
      );
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('::error::');
      expect(
        await Bun.file(join(root, 'release/tale_checksums.txt')).exists(),
      ).toBe(false);
      expect(await Bun.file(join(root, 'release', binaries[0]!)).exists()).toBe(
        false,
      );
    });

    async function releaseWait(attempt: number, sha = source) {
      const { root, bin } = await fixture();
      const calls = join(root, 'calls');
      const sleeps = join(root, 'sleeps');
      await executable(
        join(bin, 'gh'),
        `#!/usr/bin/env bash
set -euo pipefail
if [ "$1/$2" = release/view ]; then
  echo view >> "$FIXTURE_CALLS"
  count=$(wc -l < "$FIXTURE_CALLS")
  [ "$count" -ge "$FIXTURE_READY" ]
elif [ "$1" = api ]; then
  printf '%s\n' "$FIXTURE_SHA"
else
  exit 2
fi
`,
      );
      await executable(
        join(bin, 'sleep'),
        '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$FIXTURE_SLEEPS"\n',
      );
      const result = await execute(
        root,
        bin,
        step('release', 'Wait for release to exist').run!,
        {
          FIXTURE_CALLS: calls,
          FIXTURE_SLEEPS: sleeps,
          FIXTURE_READY: String(attempt),
          FIXTURE_SHA: sha,
          EXPECTED_SOURCE_SHA: source,
          RELEASE_TAG: 'v0.5.64',
          REPO: 'synthetic/repository',
        },
      );
      return {
        ...result,
        attempts: (await readFile(calls, 'utf8')).trim().split('\n').length,
        sleeps: (await Bun.file(sleeps).exists())
          ? (await readFile(sleeps, 'utf8')).trim().split('\n').map(Number)
          : [],
      };
    }

    test('a ready release checks its source and never sleeps', async () => {
      const result = await releaseWait(1);
      expect(result.status, result.output).toBe(0);
      expect(result.attempts).toBe(1);
      expect(result.sleeps).toEqual([]);
    });
    test.each(['', 'a'.repeat(40), 'short-sha'])(
      'refuses moved or invalid release source %j',
      async (sha) => {
        const result = await releaseWait(1, sha);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(
          'Release tag changed after CLI preparation',
        );
        expect(result.sleeps).toEqual([]);
      },
    );
    test('missing releases fail within the job budget without a final delay', async () => {
      const result = await releaseWait(99);
      expect(result.status).not.toBe(0);
      expect(result.attempts).toBe(10);
      expect(result.sleeps).toEqual([15, 30, 30, 30, 30, 30, 30, 30, 30]);
      expect(result.sleeps.reduce((sum, value) => sum + value, 0)).toBeLessThan(
        workflow.jobs.release['timeout-minutes'] * 60 - 120,
      );
    });
  },
);
