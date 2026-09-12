import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureAligned, type AlignDeps } from '../src/lib/version/align';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const modes: [string, string[]][] = [
  ['source', [process.execPath, source]],
  ...(process.env.TALE_BINARY
    ? [['compiled', [resolve(process.env.TALE_BINARY)]] as [string, string[]]]
    : []),
];
const roots: string[] = [];
afterEach(async () => {
  for (const directory of roots.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'tale-export-command-'));
  roots.push(value);
  await mkdir(join(value, 'private'), { mode: 0o700 });
  await writeFile(
    join(value, 'tale.json'),
    JSON.stringify({ cliVersion: '0.0.1', id: 'unrelated-workspace' }),
  );
  return value;
}
async function run(
  executable: string[],
  cwd: string,
  args: string[],
  stdin = '',
) {
  const child = Bun.spawn([...executable, ...args], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: process.env.PATH, HOME: cwd, CI: 'true', NO_COLOR: '1' },
  });
  child.stdin.write(stdin);
  await child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
for (const [mode, executable] of modes)
  describe.skipIf(process.platform === 'win32')(
    `credential export commands (${mode})`,
    () => {
      test('public help documents exact selection and consumer prefix; internal transport is hidden', async () => {
        const cwd = await root();
        const help = await run(executable, cwd, [
          'deploy',
          'export-client',
          '--help',
        ]);
        expect(help.code).toBe(0);
        for (const flag of [
          '--client',
          '--output',
          '--env-prefix',
          '--bundle',
          '--cli-ref',
          '--deployment-ref',
        ])
          expect(help.stdout).toContain(flag);
        const deploy = await run(executable, cwd, ['deploy', '--help']);
        expect(deploy.stdout).toContain('export-client');
        expect(deploy.stdout).not.toContain('export-client-native');
      });
      test('unsupported flags and malformed keys refuse in one safe JSON envelope without destination or version changes', async () => {
        const cwd = await root();
        const output = join(cwd, 'private/output');
        for (const args of [
          [
            'deploy',
            'export-client',
            '--bundle',
            join(cwd, 'bundle'),
            '--client',
            'portal',
            '--output',
            output,
            '--dry-run',
          ],
          [
            'deploy',
            '--bundle',
            join(cwd, 'bundle'),
            'export-client',
            '--client',
            'portal',
            '--output',
            output,
            '--skip-backup',
          ],
          [
            'deploy',
            'export-client',
            '--bundle',
            join(cwd, 'bundle'),
            '--client',
            'portal\n',
            '--output',
            output,
          ],
          [
            'deploy',
            'export-client',
            '--bundle',
            join(cwd, 'bundle'),
            '--client',
            'portal',
            '--output',
            output,
            '--env-prefix',
            'BAD=INPUT',
          ],
        ]) {
          const actual = await run(executable, cwd, [...args, '--json']);
          expect(actual.code).toBeGreaterThan(0);
          expect(actual.stderr).toBe('');
          expect(actual.stdout.trim().split('\n')).toHaveLength(1);
          expect(JSON.parse(actual.stdout).ok).toBe(false);
          expect(await readdir(join(cwd, 'private'))).toEqual([]);
        }
      });
      test('native transport rejects malformed, extra or oversized stdin without echoing secret-shaped input', async () => {
        const cwd = await root();
        const secret = 'synthetic-do-not-print-credential';
        for (const input of [
          secret,
          JSON.stringify({ clientSecret: secret }),
          secret.repeat(3000),
        ]) {
          const actual = await run(
            executable,
            cwd,
            [
              'deploy',
              'export-client-native',
              '--bundle',
              join(cwd, 'bundle'),
              '--output',
              join(cwd, 'private/out'),
              '--json',
            ],
            input,
          );
          expect(actual.code).toBe(2);
          expect(actual.stderr).toBe('');
          expect(actual.stdout).not.toContain(secret);
          expect(JSON.parse(actual.stdout).ok).toBe(false);
          expect(await readdir(join(cwd, 'private'))).toEqual([]);
        }
      });
    },
  );
test('export commands never align to or download a different nearby workspace CLI', async () => {
  const forbidden = () => {
    throw Error('Export touched workspace alignment');
  };
  const deps: AlignDeps = {
    currentVersion: '0.9.0',
    isDevBuild: () => false,
    findProject: forbidden,
    readWorkspaceVersion: forbidden,
    resolveRelease: forbidden,
    installBinary: forbidden,
    commitInstall: forbidden,
    reExec: forbidden,
  };
  await ensureAligned('deploy export-client', deps);
  await ensureAligned('deploy export-client-native', deps);
  expect(true).toBe(true);
});
