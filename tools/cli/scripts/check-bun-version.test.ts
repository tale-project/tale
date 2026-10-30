import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  bunVersionWarning,
  pinnedBunVersion,
} from '../../../scripts/check-bun-version';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(repository, 'scripts/check-bun-version.ts');
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/** Run the guard's own bytes in a checkout whose root manifest is `manifest`,
 * the way `bun run bun:check` runs it: next to the `package.json` it reads. */
async function runGuard(manifest: string) {
  const root = await mkdtemp(join(tmpdir(), 'tale-bun-check-'));
  directories.push(root);
  await mkdir(join(root, 'scripts'));
  await copyFile(script, join(root, 'scripts/check-bun-version.ts'));
  await writeFile(join(root, 'package.json'), manifest);
  return spawnSync(
    process.execPath,
    [join(root, 'scripts/check-bun-version.ts')],
    { cwd: root, encoding: 'utf8' },
  );
}

describe('the local Bun version guard', () => {
  test('stays silent on the pinned Bun, a prerelease or corepack hash included', () => {
    for (const [running, packageManager] of [
      ['1.4.2', 'bun@1.4.2'],
      ['1.4.2', 'bun@1.4.2+sha512.0a1b2c'],
      ['1.5.0-canary.3', 'bun@1.5.0-canary.3'],
    ])
      expect(
        bunVersionWarning(running, { packageManager }, 'linux'),
        packageManager,
      ).toBeNull();
  });

  test.each(['1.3.10', '1.4.3'])(
    'warns on Bun %s and names both versions and the pinned installer',
    (running) => {
      const warning = bunVersionWarning(
        running,
        { packageManager: 'bun@1.4.2' },
        'linux',
      );
      expect(warning).toContain(
        `WARNING: Bun ${running} is running, but package.json pins Bun 1.4.2.`,
      );
      expect(warning).toContain(
        'curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"',
      );
    },
  );

  test('gives the PowerShell installer on Windows', () => {
    expect(
      bunVersionWarning('1.3.10', { packageManager: 'bun@1.4.2' }, 'win32'),
    ).toContain('iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.2"');
  });

  test.each([
    ['no packageManager', {}],
    ['a number', { packageManager: 142 }],
    ['another package manager', { packageManager: 'npm@10.9.0' }],
    ['no exact version', { packageManager: 'bun@latest' }],
    ['an empty version', { packageManager: 'bun@' }],
    ['no manifest object', null],
    ['an array', ['bun@1.4.2']],
  ])('notes a manifest with %s instead of throwing', (_label, manifest) => {
    expect(pinnedBunVersion(manifest)).toBeNull();
    expect(bunVersionWarning('1.4.2', manifest, 'linux')).toBe(
      'Bun version not checked: package.json pins no Bun ("packageManager": "bun@<version>").',
    );
  });

  test('the script warns on stderr and still exits 0', async () => {
    const child = await runGuard(
      JSON.stringify({ packageManager: 'bun@0.0.1' }),
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('');
    expect(child.stderr).toContain(
      `Bun ${Bun.version} is running, but package.json pins Bun 0.0.1.`,
    );
  });

  test('the script prints nothing on the pinned Bun', async () => {
    const child = await runGuard(
      JSON.stringify({ packageManager: `bun@${Bun.version}` }),
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe('');
    expect(child.stderr).toBe('');
  });

  test('the script exits 0 on a manifest that does not parse', async () => {
    const child = await runGuard('{ "packageManager": ');
    expect(child.status, child.stderr).toBe(0);
    // Bun itself also reports the broken manifest it sits beside; the order
    // of the two reports is Bun's, so look for the guard's anywhere.
    expect(child.stderr).toContain(
      'Bun version not checked: cannot read package.json (',
    );
  });

  test('the gate and every root test script check the Bun version first', () => {
    const { scripts } = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(
        JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')),
      );
    expect(scripts['bun:check']).toBe('bun scripts/check-bun-version.ts');
    const entries = Object.entries(scripts).filter(
      ([name]) =>
        name === 'check' || name === 'test' || name.startsWith('test:'),
    );
    expect(entries.map(([name]) => name)).toEqual(
      expect.arrayContaining(['check', 'test', 'test:ui']),
    );
    for (const [name, command] of entries)
      expect(command, name).toStartWith('bun run bun:check && ');
  });
});
