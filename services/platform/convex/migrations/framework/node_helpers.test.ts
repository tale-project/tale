// @vitest-environment node

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeNodeHelpers } from './node_helpers';

const MIGRATION_ID = '9.9.9/01_branding_probe';
const ORG = 'org1';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-mig-helpers-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('makeNodeHelpers', () => {
  it('binds the sidecar snapshot round-trip to (migrationId, orgSlug)', async () => {
    const helpers = makeNodeHelpers(MIGRATION_ID, ORG);
    expect(helpers.migrationId).toBe(MIGRATION_ID);
    expect(helpers.orgSlug).toBe(ORG);

    const brandingDir = path.join(root, ORG, 'branding');
    const file = path.join(brandingDir, 'branding.json');
    await mkdir(brandingDir, { recursive: true });
    await writeFile(file, JSON.stringify({ brandColor: '#FF0055' }));

    // Snapshot lands under the id/slug-derived sidecar without hand-threading.
    const ref = await helpers.snapshotFsTree(brandingDir);
    const safeSegment = MIGRATION_ID.replace(/[^a-zA-Z0-9_-]/g, '_');
    expect(ref).toContain(path.join('.migration-snapshots', safeSegment, ORG));
    await stat(ref); // exists

    await helpers.atomicWrite(file, JSON.stringify({ accentColor: '#FF0055' }));
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({
      accentColor: '#FF0055',
    });

    await helpers.restoreFsTree(brandingDir);
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({
      brandColor: '#FF0055',
    });
  });

  it('exposes the safe file primitives', async () => {
    const helpers = makeNodeHelpers(MIGRATION_ID, ORG);
    const dir = path.join(root, ORG, 'agents');
    const file = path.join(dir, 'a.json');
    await mkdir(dir, { recursive: true });

    expect(await helpers.readFileSafe(file)).toBeNull();
    await helpers.atomicWrite(file, '{}');
    expect(await helpers.readFileSafe(file)).toBe('{}');
    expect(await helpers.removeFileSafe(file)).toBe(true);
    expect(await helpers.removeFileSafe(file)).toBe(false);
    expect(await helpers.removeDirSafe(dir)).toBe(true);
    expect(await helpers.removeDirSafe(dir)).toBe(false);
  });
});
