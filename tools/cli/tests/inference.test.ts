import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inferenceFixture } from '../src/lib/inference/tests/fixture';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const modes: [string, string[]][] = [
  ['source', [process.execPath, source]],
  ...(process.env.TALE_BINARY
    ? [['compiled', [resolve(process.env.TALE_BINARY)]] as [string, string[]]]
    : []),
];
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-inference-command-'));
  roots.push(root);
  const repo = join(root, 'client');
  await mkdir(join(repo, 'tale/inference'), { recursive: true });
  await writeFile(
    join(repo, 'tale/inference/spec.json'),
    JSON.stringify(inferenceFixture()),
  );
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString('utf8')
      .trim();
  git('init');
  git('config', 'user.email', 'synthetic@example.invalid');
  git('config', 'user.name', 'Synthetic CLI');
  git('add', 'tale/inference/spec.json');
  git(
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'test: retain synthetic model pins',
  );
  const ref = git('rev-parse', 'HEAD');
  const repository = 'https://github.com/example/inference-client';
  const sources = join(root, 'sources.json');
  await writeFile(sources, JSON.stringify({ [`${repository}@${ref}`]: repo }));
  return { root, repo, ref, repository, sources, output: join(root, 'bundle') };
}
async function run(executable: string[], args: string[], cwd: string) {
  const child = Bun.spawn([...executable, ...args, '--json'], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TALE_ALIGNED: '', TALE_SOURCE_SSH_KEY: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
function success(result: Awaited<ReturnType<typeof run>>) {
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  const output = JSON.parse(result.stdout);
  expect(output.ok).toBe(true);
  return output.data;
}
for (const [label, executable] of modes)
  describe(`${label} inference commands without a model or target`, () => {
    test('prepares exact committed metadata, validates it, and reports unobserved hardware honestly', async () => {
      const f = await fixture();
      await writeFile(join(f.repo, 'tale/inference/spec.json'), '{}');
      const prepared = success(
        await run(
          executable,
          [
            'inference',
            'prepare',
            '--repository',
            f.repository,
            '--source-ref',
            f.ref,
            '--sources',
            f.sources,
            '--spec',
            'tale/inference/spec.json',
            '--output',
            f.output,
          ],
          f.root,
        ),
      );
      expect(prepared.modelWeightsDownloaded).toBe(false);
      expect(prepared.source.revision).toBe(f.ref);
      const selection = [
        '--bundle',
        f.output,
        '--bundle-sha',
        prepared.bundleSha256,
      ];
      expect(
        success(
          await run(
            executable,
            ['inference', 'validate', ...selection],
            f.root,
          ),
        ).verified,
      ).toBe(true);
      const plan = success(
        await run(executable, ['inference', 'plan', ...selection], f.root),
      );
      expect(plan.nodes[0].ready).toBe(false);
      expect(plan.nodes[0].reasons).toContain(
        'Destination hardware has not been observed.',
      );
      expect(
        (
          await run(
            executable,
            [
              'inference',
              'validate',
              '--bundle',
              f.output,
              '--bundle-sha',
              'f'.repeat(64),
            ],
            f.root,
          )
        ).code,
      ).toBe(3);
      expect(
        await readFile(join(f.repo, 'tale/inference/spec.json'), 'utf8'),
      ).toBe('{}');
    }, 60_000);
    test.each([
      { args: ['--repository', 'https://github.com/example/client'] },
      { args: ['--source-ref', 'a'.repeat(40)] },
      { args: ['--sources', 'not-read.json'] },
    ])(
      'refuses incomplete committed source flags %j before source or output work',
      async ({ args }) => {
        const f = await fixture();
        const result = await run(
          executable,
          [
            'inference',
            'prepare',
            '--spec',
            'not-read.json',
            '--output',
            f.output,
            ...args,
          ],
          f.root,
        );
        expect(result.code).toBe(2);
      },
      30_000,
    );
    test.skipIf(process.platform === 'darwin' && process.arch === 'arm64')(
      'refuses target-only activation on another platform before reading target input',
      async () => {
        const f = await fixture();
        for (const command of ['apply', 'status', 'benchmark', 'rollback']) {
          const result = await run(
            executable,
            [
              'inference',
              command,
              '--bundle',
              'not-read',
              '--bundle-sha',
              'a'.repeat(64),
              '--node',
              'studio-one',
              ...(command === 'status' ? [] : ['--yes']),
              ...(command === 'rollback' ? ['--release', 'b'.repeat(64)] : []),
            ],
            f.root,
          );
          expect(result.code).toBe(3);
          expect(result.stdout).toContain('macOS Apple Silicon');
        }
      },
      30_000,
    );
    test.each([
      {
        args: ['--bundle', 'not-read', '--dry-run'],
        code: 2,
        message: '--dry-run',
      },
      { args: ['--bundle', ''], code: 2, message: '--bundle' },
      {
        args: ['--bundle', 'not-read', '--cli-ref', 'invalid'],
        code: 3,
        message: 'full commit',
      },
      {
        args: ['--bundle', 'not-read', '--deployment-ref', ''],
        code: 3,
        message: 'full commit',
      },
    ])(
      'refuses unsafe managed namespace observation arguments %j',
      async ({ args, code, message }) => {
        const f = await fixture();
        const result = await run(
          executable,
          ['deploy', 'inference-status', ...args],
          f.root,
        );
        expect(result.code).toBe(process.platform === 'win32' ? 3 : code);
        expect(result.stdout).toContain(
          process.platform === 'win32' ? 'not supported on Windows' : message,
        );
        expect(result.stderr).toBe('');
      },
      30000,
    );
  });
