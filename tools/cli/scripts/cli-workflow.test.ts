import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { commandTargets } from '../tests/fixtures/command-targets';

type Platform = {
  os: string;
  platform: string;
  cross?: boolean;
};
type Step = {
  name: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  'working-directory'?: string;
};
type Workflow = {
  jobs: {
    build: {
      strategy: { 'fail-fast': boolean; matrix: { include: Platform[] } };
      steps: Step[];
    };
  };
};

async function buildJob() {
  const source = await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  );
  return (parse(source) as Workflow).jobs.build;
}

describe('CLI builds retain native execution coverage without duplicate host suites', () => {
  test('each supported host runs source tests and its compiled binary smoke suite', async () => {
    const job = await buildJob();
    const native = job.strategy.matrix.include.filter((entry) => !entry.cross);
    expect(native.map((entry) => entry.platform).toSorted()).toEqual([
      'linux',
      'macos',
      'windows',
    ]);
    expect(new Set(native.map((entry) => entry.os)).size).toBe(native.length);
    expect(job.strategy['fail-fast']).toBe(false);
    for (const name of ['Run unit tests', 'Verify binary', 'Run smoke tests']) {
      const step = job.steps.find((entry) => entry.name === name);
      expect(step?.if).toBe('${{ !matrix.cross }}');
      expect(step?.run).toBeTruthy();
    }
    for (const entry of job.strategy.matrix.include.filter(
      (leg) => leg.cross,
    )) {
      expect(native.some((host) => host.os === entry.os)).toBe(true);
    }
    expect(
      job.steps.find((entry) => entry.name === 'Build binary')?.if,
    ).toBeUndefined();
    const source = job.steps.find((entry) => entry.name === 'Run unit tests')!;
    const compile = job.steps.find((entry) => entry.name === 'Build binary')!;
    const smoke = job.steps.find((entry) => entry.name === 'Run smoke tests')!;
    expect(source.run).toBe(
      "${{ matrix.platform == 'windows' && 'bun run test' || 'bun run test --parallel=2' }}",
    );
    expect(source.env?.TALE_BINARY).toBe('');
    expect(smoke.run).toBe('bun run test tests/');
    expect(smoke.env?.TALE_BINARY).toBe('dist/${{ matrix.artifact }}');
    expect(job.steps.indexOf(source)).toBeLessThan(job.steps.indexOf(compile));
    expect(job.steps.indexOf(compile)).toBeLessThan(job.steps.indexOf(smoke));
  });

  test('compiled smoke follows binary and macOS signature verification', async () => {
    const job = await buildJob();
    const names = [
      'Build binary',
      'Normalize macOS code signature',
      'Verify binary',
      'Verify macOS code signature',
      'Run smoke tests',
    ];
    const indices = names.map((name) => {
      const index = job.steps.findIndex((step) => step.name === name);
      expect(index, name).toBeGreaterThanOrEqual(0);
      return index;
    });
    for (let index = 1; index < indices.length; index++) {
      expect(
        indices[index - 1]!,
        `${names[index - 1]} before ${names[index]}`,
      ).toBeLessThan(indices[index]!);
    }
  });

  test('one install step selects native or cross dependencies before generation', async () => {
    const job = await buildJob();
    const installs = job.steps.filter((entry) =>
      entry.run?.includes('bun install'),
    );
    expect(installs).toHaveLength(1);
    const install = installs[0];
    expect(install?.name).toBe('Install dependencies');
    expect(install?.if).toBeUndefined();
    expect(install?.env?.CROSS).toBe('${{ matrix.cross }}');
    expect(install?.['working-directory']).toBe('tools/cli');
    expect(job.steps.indexOf(install!)).toBeLessThan(
      job.steps.findIndex((entry) => entry.name === 'Generate embedded files'),
    );
  });
});

describe('CLI command test targets', () => {
  test('every source/compiled command suite uses the shared phase selector', async () => {
    const directory = fileURLToPath(new URL('../tests/', import.meta.url));
    const suites: string[] = [];
    for await (const file of new Bun.Glob('*.test.ts').scan(directory)) {
      if (file === 'smoke.test.ts') continue;
      const contents = await readFile(resolve(directory, file), 'utf8');
      expect(contents, file).not.toContain('src/index.ts');
      if (!contents.includes('process.env.TALE_BINARY')) continue;
      expect(contents, file).toContain("from './fixtures/command-targets'");
      expect(contents, file).toContain(
        'commandTargets(process.env.TALE_BINARY)',
      );
      suites.push(file);
    }
    expect(suites.toSorted()).toEqual([
      'client-export.test.ts',
      'config-releases.test.ts',
      'deployment.test.ts',
      'doctor.test.ts',
      'hash-password.test.ts',
      'platform-configuration.test.ts',
      'provision.test.ts',
    ]);
  });

  test.each([undefined, ''])(
    'an absent binary selects source commands only (%p)',
    (binary) => {
      expect(commandTargets(binary)).toEqual([
        [
          'source',
          [
            process.execPath,
            fileURLToPath(new URL('../src/index.ts', import.meta.url)),
          ],
        ],
      ]);
    },
  );

  test('an explicit executable runs alone from a different command fixture directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-command-target '));
    try {
      const targets = commandTargets(relative(process.cwd(), process.execPath));
      expect(targets).toHaveLength(1);
      const [mode, executable] = targets[0]!;
      expect(mode).toBe('compiled');
      // The real Bun executable stands in for a selected artifact. Accidentally
      // selecting the CLI source instead would interpret -e as a CLI flag.
      const run = Bun.spawnSync(
        [...executable, '-e', 'process.stdout.write("selected artifact")'],
        { cwd: directory, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(run.stdout.toString()).toBe('selected artifact');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('a missing selected binary fails instead of quietly testing source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-command-missing '));
    try {
      const targets = commandTargets(join(directory, 'missing-cli'));
      expect(targets).toHaveLength(1);
      const [mode, executable] = targets[0]!;
      expect(mode).toBe('compiled');
      let exitCode: number | undefined;
      try {
        exitCode = Bun.spawnSync([...executable, '--version'], {
          cwd: directory,
          stdout: 'pipe',
          stderr: 'pipe',
        }).exitCode;
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
      expect(exitCode).not.toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
