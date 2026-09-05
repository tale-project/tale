/**
 * The pii data loader's root contract — the one packaging fact a shipped
 * image depends on. In a container there is no repo checkout to walk up
 * to; `TALE_CONFIG_SYSTEM_DIR` is the deployment contract the Dockerfile
 * sets, and the loader must read it like every other system-catalog reader.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadPiiData } from '../../lib/pii';
import { resolvePiiDataRoot } from '../../lib/pii/data/loader';
import { findRepoSystemConfigRoot } from '../../lib/shared/config/system-root';

const CHECKOUT_SYSTEM_ROOT = findRepoSystemConfigRoot(process.cwd());
if (CHECKOUT_SYSTEM_ROOT === null) {
  throw new Error('tests run inside the checkout; system tree expected');
}

const scratch: string[] = [];
const savedEnv = process.env.TALE_CONFIG_SYSTEM_DIR;

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pii-loader-'));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env.TALE_CONFIG_SYSTEM_DIR;
  } else {
    process.env.TALE_CONFIG_SYSTEM_DIR = savedEnv;
  }
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadPiiData root resolution', () => {
  it('reads the tree under TALE_CONFIG_SYSTEM_DIR — the shipped-image layout', () => {
    // A copy of the shipped tree with one locale removed: proof the env root
    // was read, not the checkout the test happens to run inside.
    const baked = path.join(tempDir(), 'system');
    cpSync(path.join(CHECKOUT_SYSTEM_ROOT, 'pii'), path.join(baked, 'pii'), {
      recursive: true,
    });
    rmSync(path.join(baked, 'pii', 'locales', 'de.yml'));
    const shipped = loadPiiData();

    process.env.TALE_CONFIG_SYSTEM_DIR = baked;
    expect(resolvePiiDataRoot()).toBe(path.join(baked, 'pii'));
    const fromEnv = loadPiiData();
    expect(fromEnv.patterns).toHaveLength(shipped.patterns.length);
    expect(fromEnv.locales).toHaveLength(shipped.locales.length - 1);
    expect(fromEnv.locales.map((l) => l.locale)).not.toContain('de');
  });

  it('names the env var and the path when the tree is not where the env says', () => {
    process.env.TALE_CONFIG_SYSTEM_DIR = tempDir();
    expect(() => loadPiiData()).toThrow(/TALE_CONFIG_SYSTEM_DIR/);
    expect(() => loadPiiData()).toThrow(/\/pii/);
  });

  it('ignores a relative TALE_CONFIG_SYSTEM_DIR and falls back to the checkout', () => {
    process.env.TALE_CONFIG_SYSTEM_DIR = 'system';
    expect(resolvePiiDataRoot()).toBe(path.join(CHECKOUT_SYSTEM_ROOT, 'pii'));
  });

  it('lets an explicit root win over the environment', () => {
    process.env.TALE_CONFIG_SYSTEM_DIR = '/nowhere';
    expect(resolvePiiDataRoot('/baked/pii')).toBe('/baked/pii');
  });
});
