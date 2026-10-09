import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureAligned, type AlignDeps } from '../src/lib/version/align';
import { commandTargets } from './fixtures/command-targets';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
for (const [mode, executable] of commandTargets(process.env.TALE_BINARY)) {
  test(`observation CLI refuses inherited writes and private malformed input without effects (${mode})`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'tale-observation-command-'));
    roots.push(cwd);
    const run = async (args: string[], stdin = '') => {
      const child = Bun.spawn([...executable, ...args], {
        cwd,
        stdin: new Blob([stdin]),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { PATH: process.env.PATH, HOME: cwd, CI: 'true', NO_COLOR: '1' },
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };
    const help = await run(['deploy', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('observe');
    expect(help.stdout).not.toContain('observe-native');
    // Source-mode Bun may create its own transpiler cache at startup; capture
    // that baseline before the refused commands, which create no Tale state.
    const startup = await readdir(cwd);
    const flags = [
      '--spec',
      join(cwd, 'absent.json'),
      '--cli-ref',
      'a'.repeat(40),
      '--deployment-ref',
      'b'.repeat(40),
      '--machine-id-sha256',
      'c'.repeat(64),
    ];
    for (const flag of [
      '--dry-run',
      '--stop',
      '--override-all',
      '--configuration-only',
      '--skip-backup',
    ]) {
      const result = await run(
        ['--json', 'deploy', 'observe', ...flags, flag],
        '{}',
      );
      expect(result.code).toBe(process.platform === 'win32' ? 3 : 2);
      expect(result.stdout).toContain('not supported');
      expect(result.stderr).toBe('');
    }
    for (const command of [['observe', ...flags], ['observe-native']]) {
      const result = await run(
        ['--json', 'deploy', ...command],
        '{"synthetic-secret":',
      );
      expect(result.code).toBe(3);
      expect(result.stdout).not.toContain('synthetic-secret');
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).ok).toBe(false);
    }
    expect(await readdir(cwd)).toEqual(startup);
  }, 30_000);
}
test('observation never aligns to or replaces its pinned executable', async () => {
  const forbidden = () => {
    throw Error('Observation touched workspace alignment');
  };
  const dependencies: AlignDeps = {
    currentVersion: '0.9.0',
    isDevBuild: () => false,
    findProject: forbidden,
    readWorkspaceVersion: forbidden,
    resolveRelease: forbidden,
    installBinary: forbidden,
    commitInstall: forbidden,
    reExec: forbidden,
  };
  await ensureAligned('deploy observe', dependencies);
  await ensureAligned('deploy observe-native', dependencies);
  expect(true).toBe(true);
});

test('partial JSON evidence survives stdout with exit3 while complete evidence exits0', async () => {
  const module = fileURLToPath(
    new URL('../src/commands/deploy/observe.ts', import.meta.url),
  );
  for (const complete of [false, true]) {
    const child = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `import { writeObservationResult } from ${JSON.stringify(module)}; writeObservationResult('deploy observe', {complete:${complete}}, ${complete});`,
      ],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(complete ? 0 : 3);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      ok: complete,
      command: 'deploy observe',
      data: { complete },
    });
  }
});
