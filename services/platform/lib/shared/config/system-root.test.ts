import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findRepoSystemConfigRoot,
  resolveSystemConfigRoot,
  systemConfigRootFromEnv,
} from './system-root';

const scratch: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'system-root-'));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveSystemConfigRoot', () => {
  it('prefers an explicit root over the environment and the walk-up', () => {
    expect(
      resolveSystemConfigRoot({
        root: '/baked/system',
        env: { TALE_CONFIG_SYSTEM_DIR: '/elsewhere' },
        cwd: process.cwd(),
      }),
    ).toBe('/baked/system');
  });

  it('honours TALE_CONFIG_SYSTEM_DIR when it is absolute — the container contract', () => {
    // The cwd is an empty directory with no checkout above it to walk up
    // to: what a shipped image looks like from inside.
    const cwd = tempDir();
    expect(
      resolveSystemConfigRoot({
        env: { TALE_CONFIG_SYSTEM_DIR: '/app/system' },
        cwd,
      }),
    ).toBe('/app/system');
  });

  it('ignores a relative TALE_CONFIG_SYSTEM_DIR instead of guessing it against the cwd', () => {
    const cwd = tempDir();
    expect(systemConfigRootFromEnv({ TALE_CONFIG_SYSTEM_DIR: 'system' })).toBe(
      undefined,
    );
    expect(
      resolveSystemConfigRoot({
        env: { TALE_CONFIG_SYSTEM_DIR: 'system' },
        cwd,
      }),
    ).toBeNull();
  });

  it('walks up from the cwd to a checkout tree when nothing else is set', () => {
    const checkout = tempDir();
    const tree = path.join(checkout, 'configs', 'platform', 'system');
    mkdirSync(tree, { recursive: true });
    const nested = path.join(checkout, 'services', 'platform', 'backend');
    mkdirSync(nested, { recursive: true });
    expect(findRepoSystemConfigRoot(nested)).toBe(tree);
    expect(resolveSystemConfigRoot({ env: {}, cwd: nested })).toBe(tree);
  });

  it('resolves to null when no source yields a tree', () => {
    expect(resolveSystemConfigRoot({ env: {}, cwd: tempDir() })).toBeNull();
  });
});
