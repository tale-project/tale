import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { fixtureGit } from '../src/lib/config/releases/tests/fixture-git';
import { commandTargets } from '../tests/fixtures/command-targets';

type Platform = {
  os: string;
  platform: string;
  build_script: string;
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

const repository = resolve(import.meta.dir, '../../..');
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function buildJob() {
  const source = await readFile(
    new URL('../../../.github/workflows/cli.yml', import.meta.url),
    'utf8',
  );
  return (parse(source) as Workflow).jobs.build;
}

type WindowsSource =
  | 'current'
  | 'legacy'
  | 'missing-modern-helper'
  | 'empty-legacy'
  | 'invalid-helper';

async function buildFixture(sourceLayout: WindowsSource = 'current') {
  const directory = await mkdtemp(join(tmpdir(), 'tale-cli-provenance-'));
  directories.push(directory);
  const write = async (file: string, source: string) => {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  };
  for (const file of [
    'tools/cli/package.json',
    'tools/cli/scripts/generate-embedded.ts',
    'tools/cli/scripts/embedded-key.ts',
    'tools/cli/scripts/check-bundle.ts',
    'tools/cli/src/lib/deployment/build.ts',
    'tools/cli/src/lib/config/releases/model.ts',
    'tools/cli/src/utils/fail.ts',
    'tools/cli/src/utils/output-mode.ts',
  ])
    await write(file, await readFile(join(repository, file), 'utf8'));
  const manifest = JSON.parse(
    await readFile(join(directory, 'tools/cli/package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const compileScript = manifest.scripts['build:windows:compile'];
  if (!compileScript) throw new Error('Current Windows compile script missing');
  if (sourceLayout === 'legacy') {
    manifest.scripts['build:windows'] = `bun run generate && ${compileScript}`;
    delete manifest.scripts['build:windows:compile'];
  }
  if (sourceLayout === 'missing-modern-helper')
    delete manifest.scripts['build:windows:compile'];
  if (sourceLayout === 'empty-legacy') {
    manifest.scripts['build:windows'] = 'bun run generate &&  \t';
    delete manifest.scripts['build:windows:compile'];
  }
  if (sourceLayout === 'invalid-helper')
    manifest.scripts['build:windows:compile'] = ' \t';
  const publicWindowsScript = manifest.scripts['build:windows'];
  await write(
    'tools/cli/package.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await write('AGENTS.md', 'Synthetic CLI build checkout.\n');
  await write(
    '.gitignore',
    'node_modules/\ntools/cli/src/generated/\ntools/cli/dist/\n',
  );
  await write(
    'configs/platform/system/connectors/mock/connector.yml',
    'command: MOCK_SCRIPT_RUN[fixture]\n',
  );
  await write(
    'tools/cli/src/index.ts',
    `import { EMBEDDED_CLI_BUILD, EMBEDDED_CONNECTORS } from './generated/embedded-files';
import { deploymentBuild } from './lib/deployment/build';
import { version } from '../package.json';
declare const TALE_COMPILED: boolean;
let deployment;
try {
  deployment = deploymentBuild();
} catch (error) {
  deployment = { error: error.message, code: error.info?.code };
}
console.log(JSON.stringify({
  identity: EMBEDDED_CLI_BUILD, version, compiled: TALE_COMPILED, deployment,
  connectors: EMBEDDED_CONNECTORS,
  markers: ['BEGIN EXCLUSIVE', 'Bearer $TALE_CONTROL_TOKEN', '--data-binary @-'],
}));
`,
  );
  // Exercise the package's real script chain and bundle checker. Only replace
  // the PE compiler boundary with a portable Bun bundle, avoiding a Windows
  // runtime download in every native source-test job.
  await write(
    'compiler.ts',
    `const flags = process.argv.slice(2);
const expected = ['build', '--compile', '--define', 'TALE_COMPILED=true', '--target=bun-windows-x64', '--outfile=dist/tale.exe', 'src/index.ts'];
if (JSON.stringify(flags) !== JSON.stringify(expected)) throw new Error('Windows compiler flags changed');
await Bun.write('dist/compiler-call.json', JSON.stringify(flags));
if (process.env.TEST_COMPILER_FAILURE === 'true') process.exit(17);
const result = Bun.spawnSync([process.execPath, 'build', '--define', 'TALE_COMPILED=true', '--target=bun', '--outfile=dist/tale.exe', 'src/index.ts'], { stdout: 'inherit', stderr: 'inherit' });
if (result.exitCode === 0 && process.env.TEST_BUNDLE_FAILURE === 'true') {
  const bundle = await Bun.file('dist/tale.exe').text();
  await Bun.write('dist/tale.exe', bundle.replace('BEGIN EXCLUSIVE', 'BEGIN REMOVED'));
}
process.exit(result.exitCode);
`,
  );
  await write(
    'bin/bun',
    '#!/usr/bin/env bash\nif [ "$1" = build ]; then\n  exec "$REAL_BUN" "$BUN_COMPILER_FIXTURE" "$@"\nfi\nexec "$REAL_BUN" "$@"\n',
  );
  await chmod(join(directory, 'bin/bun'), 0o755);
  await write(
    'bin/bun.cmd',
    '@echo off\r\nif "%~1"=="build" (\r\n  "%REAL_BUN%" "%BUN_COMPILER_FIXTURE%" %*\r\n) else (\r\n  "%REAL_BUN%" %*\r\n)\r\n',
  );
  await symlink(
    join(repository, 'node_modules'),
    join(directory, 'node_modules'),
    'junction',
  );
  const git = fixtureGit(directory, {
    command: [
      'git',
      '-c',
      'core.hooksPath=',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=CLI fixture',
      '-c',
      'user.email=fixture@example.invalid',
    ],
  });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'clean CLI source');
  const revision = git('rev-parse', 'HEAD');
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
  const env = {
    ...process.env,
    PATH: `${join(directory, 'bin')}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
    REAL_BUN: process.execPath,
    BUN_COMPILER_FIXTURE: join(directory, 'compiler.ts'),
  };
  const execute = async (
    script: string,
    cwd = 'tools/cli',
    options: { env?: Record<string, string>; expectedExit?: number } = {},
  ) => {
    const child = Bun.spawn(['bash', '-euo', 'pipefail', '-c', script], {
      cwd: join(directory, cwd),
      env: { ...env, ...options.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stdout + stderr).toBe(options.expectedExit ?? 0);
    return { code, stdout, stderr };
  };
  const inspect = async () => {
    const bundle = await readFile(
      join(directory, 'tools/cli/dist/tale.exe'),
      'utf8',
    );
    const child = Bun.spawn([process.execPath, '--eval', bundle], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stdout + stderr).toBe(0);
    return JSON.parse(stdout) as {
      identity: { revision: string; clean: boolean };
      version: string;
      compiled: boolean;
      deployment: { revision?: string; error?: string; code?: number };
    };
  };
  return {
    directory,
    revision,
    git,
    execute,
    inspect,
    compileScript,
    publicWindowsScript,
  };
}

async function executeWindowsCI(
  fixture: Awaited<ReturnType<typeof buildFixture>>,
  options: { env?: Record<string, string>; expectedExit?: number } = {},
) {
  const job = await buildJob();
  const windows = job.strategy.matrix.include.find(
    (entry) => entry.platform === 'windows',
  );
  if (!windows) throw new Error('Windows build target missing');
  expect(windows.cross).toBeUndefined();
  const sequence = [
    'Generate embedded files',
    'Inject version into package.json',
    'Build binary',
  ];
  const steps = sequence.map((name) => {
    const step = job.steps.find((entry) => entry.name === name);
    if (!step?.run) throw new Error(`Missing CLI build step: ${name}`);
    return step;
  });
  expect(steps.map((step) => job.steps.indexOf(step))).toEqual(
    steps.map((step) => job.steps.indexOf(step)).toSorted((a, b) => a - b),
  );
  const resolveExpressions = (text: string) =>
    text
      .replaceAll('${{ needs.prepare.outputs.version }}', '1.2.3-ci')
      .replaceAll('${{ matrix.build_script }}', windows.build_script)
      .replaceAll('${{ matrix.platform }}', windows.platform);
  for (const step of steps) {
    const isBuild = step.name === 'Build binary';
    const result = await fixture.execute(
      resolveExpressions(step.run!),
      step['working-directory'],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(step.env ?? {}).map(([key, value]) => [
              key,
              resolveExpressions(value),
            ]),
          ),
          ...(isBuild ? options.env : {}),
        },
        expectedExit: isBuild ? (options.expectedExit ?? 0) : 0,
      },
    );
    if (step.name === 'Inject version into package.json')
      expect(fixture.git('status', '--porcelain')).toContain(
        'M tools/cli/package.json',
      );
    if (isBuild) {
      if ((options.expectedExit ?? 0) === 0)
        expect(result.stdout).toContain('check-bundle: OK');
      return result;
    }
  }
  throw new Error('Windows compile step did not run');
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

  test.each(['current', 'legacy'] as const)(
    'Windows CI retains clean %s source identity through version injection',
    async (source) => {
      // A historical source manifest is committed before generation. The actual
      // current workflow runs against it, with no compiler helper in that source.
      const fixture = await buildFixture(source);
      await executeWindowsCI(fixture);
      const binary = await fixture.inspect();
      expect(binary.identity).toEqual({
        revision: fixture.revision,
        clean: true,
      });
      expect(binary.version).toBe('1.2.3-ci');
      expect(binary.compiled).toBe(true);
      expect(binary.deployment.revision).toBe(fixture.revision);
      expect(binary.deployment.error).toBeUndefined();
      const manifest = JSON.parse(
        await readFile(
          join(fixture.directory, 'tools/cli/package.json'),
          'utf8',
        ),
      ) as { scripts: Record<string, string> };
      expect(manifest.scripts['build:windows:compile']).toBe(
        fixture.compileScript,
      );
      expect(manifest.scripts['build:windows']).toBe(
        fixture.publicWindowsScript,
      );
    },
  );

  test.each([
    ['missing-modern-helper', 'no supported Windows compile entry'],
    ['empty-legacy', 'no supported Windows compile entry'],
    ['invalid-helper', 'invalid Windows compile helper'],
  ] as const)(
    'Windows CI rejects %s before invoking the compiler',
    async (source, message) => {
      const fixture = await buildFixture(source);
      const result = await executeWindowsCI(fixture, { expectedExit: 1 });
      expect(result.stderr).toContain(message);
      expect(
        await Bun.file(
          join(fixture.directory, 'tools/cli/dist/compiler-call.json'),
        ).exists(),
      ).toBe(false);
    },
  );

  test.each(['compiler', 'bundle'] as const)(
    'Windows CI propagates the selected source %s failure',
    async (failure) => {
      const fixture = await buildFixture('legacy');
      const result = await executeWindowsCI(fixture, {
        expectedExit: failure === 'compiler' ? 17 : 1,
        env: {
          TEST_COMPILER_FAILURE: String(failure === 'compiler'),
          TEST_BUNDLE_FAILURE: String(failure === 'bundle'),
        },
      });
      if (failure === 'bundle') {
        expect(result.stderr).toContain('check-bundle: FAILED');
        expect(result.stderr).toContain('BEGIN EXCLUSIVE');
      }
      expect(result.stdout).not.toContain('check-bundle: OK');
    },
  );

  test('standalone Windows builds regenerate identity and reject dirty deployment source', async () => {
    const fixture = await buildFixture();
    // No generated module exists: the public local entry must generate it.
    expect((await fixture.execute('bun run build:windows')).stdout).toContain(
      'check-bundle: OK',
    );
    expect((await fixture.inspect()).identity).toEqual({
      revision: fixture.revision,
      clean: true,
    });
    await writeFile(join(fixture.directory, 'AGENTS.md'), 'Changed source.\n');
    expect(fixture.git('status', '--porcelain')).toContain('M AGENTS.md');
    // The old generated module says clean:true. Regeneration must replace that
    // identity, and the actual deployment boundary must reject the new one.
    await fixture.execute('bun run build:windows');
    const dirty = await fixture.inspect();
    expect(dirty.identity).toEqual({
      revision: fixture.revision,
      clean: false,
    });
    expect(dirty.deployment.revision).toBeUndefined();
    expect(dirty.deployment.error).toBe(
      'Deployment preparation requires a CLI built from a clean, committed Tale checkout.',
    );
    expect(dirty.deployment.code).toBe(3);
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
