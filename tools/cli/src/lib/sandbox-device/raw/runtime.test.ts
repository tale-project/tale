import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claudeSettingsFor, layOutRawRuntime, runtimeDirName } from './runtime';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

describe('the raw device runtime', () => {
  test("points Claude Code's hooks at the device's helpers", () => {
    expect(
      claudeSettingsFor(
        '{"command":"/usr/local/bin/tale-plan-gate"}',
        '/r/lib/x/bin',
      ),
    ).toBe('{"command":"/r/lib/x/bin/tale-plan-gate"}');
  });

  test('lays out the bundles and helpers once per build, runnable by every account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tale-raw-runtime-'));
    dirs.push(root);
    const runtime = await layOutRawRuntime(root, '0.5.200');
    expect(runtime.dir).toBe(join(root, 'lib', runtimeDirName('0.5.200')));
    expect(existsSync(runtime.spawner)).toBe(true);
    expect(existsSync(runtime.runnerd)).toBe(true);
    expect(
      (await stat(join(runtime.bin, 'tale-git-credential'))).mode & 0o777,
    ).toBe(0o755);
    expect((await stat(runtime.runnerd)).mode & 0o777).toBe(0o644);
    const settings = await readFile(runtime.claudeSettings, 'utf8');
    expect(settings).toContain(`${runtime.bin}/tale-plan-gate`);
    expect(settings).not.toContain('/usr/local/bin/tale-');
    const before = (await stat(runtime.spawner)).mtimeMs;
    await layOutRawRuntime(root, '0.5.200');
    expect((await stat(runtime.spawner)).mtimeMs).toBe(before);
  });

  test('names a development build as such', () => {
    expect(runtimeDirName('not a version!')).toMatch(/^dev-[0-9a-f]{12}$/);
  });
});
