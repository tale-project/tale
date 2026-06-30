import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appExistsInBuiltinCatalog,
  resolveAppBundleSourceDir,
} from './install_fs';

const ORG = 'testorg';
const MANIFEST = JSON.stringify({ name: 'X' });

let configDir: string;
let builtinDir: string;
let prevConfig: string | undefined;
let prevBuiltin: string | undefined;

beforeEach(async () => {
  prevConfig = process.env.TALE_CONFIG_DIR;
  prevBuiltin = process.env.TALE_CONFIG_BUILTIN_DIR;
  configDir = await mkdtemp(path.join(os.tmpdir(), 'tale-cfg-'));
  builtinDir = await mkdtemp(path.join(os.tmpdir(), 'tale-builtin-'));
  process.env.TALE_CONFIG_DIR = configDir;
  process.env.TALE_CONFIG_BUILTIN_DIR = builtinDir;
});

afterEach(async () => {
  process.env.TALE_CONFIG_DIR = prevConfig;
  process.env.TALE_CONFIG_BUILTIN_DIR = prevBuiltin;
  await rm(configDir, { recursive: true, force: true });
  await rm(builtinDir, { recursive: true, force: true });
});

async function seedBuiltin(slug: string): Promise<string> {
  const dir = path.join(builtinDir, 'apps', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'app.json'), MANIFEST);
  return dir;
}

async function seedOrg(slug: string): Promise<string> {
  const dir = path.join(configDir, ORG, 'apps', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'app.json'), MANIFEST);
  return dir;
}

describe('resolveAppBundleSourceDir', () => {
  it('resolves a first-party app to the built-in catalog', async () => {
    const builtin = await seedBuiltin('desk');
    expect(await resolveAppBundleSourceDir(ORG, 'desk')).toBe(builtin);
    expect(await appExistsInBuiltinCatalog('desk')).toBe(true);
  });

  it('falls back to the org apps dir for a privately-uploaded app', async () => {
    const org = await seedOrg('private-app');
    expect(await resolveAppBundleSourceDir(ORG, 'private-app')).toBe(org);
    expect(await appExistsInBuiltinCatalog('private-app')).toBe(false);
  });

  it('prefers the built-in catalog when both exist (no org-dir shadowing)', async () => {
    const builtin = await seedBuiltin('both');
    await seedOrg('both');
    expect(await resolveAppBundleSourceDir(ORG, 'both')).toBe(builtin);
  });

  it('throws when the app is in neither source', async () => {
    await expect(resolveAppBundleSourceDir(ORG, 'ghost')).rejects.toThrow(
      /not found in the catalog/,
    );
  });
});
