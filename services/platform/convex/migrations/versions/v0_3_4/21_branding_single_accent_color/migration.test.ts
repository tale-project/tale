// @vitest-environment node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/01_branding_single_accent_color';

function brandingPath(world: WorldHandle, slug: string): string {
  return path.join(world.configRoot, slug, 'branding', 'branding.json');
}

async function writeBranding(
  world: WorldHandle,
  config: string,
): Promise<string> {
  const filePath = brandingPath(world, world.orgs[0].slug);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, config, 'utf-8');
  return filePath;
}

// Harness ritual: real fleet up, destructive gating, handler idempotency over
// migrated state (a rewritten file has no brandColor key), down restoring the
// two-field file byte-for-byte from the fs-tree snapshot.
defineMigrationTest({
  id: '0.3.4/21_branding_single_accent_color',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    const dir = path.join(root, orgs[0].slug, 'branding');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'branding.json'),
      JSON.stringify({ brandColor: '#FF0055', logoFilename: 'logo.png' }),
      'utf-8',
    );
    // org2 gets no branding file: the per-org no-op path.
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    // A lone brandColor maps onto accentColor and the key is dropped.
    expect(
      JSON.parse(await readFile(brandingPath(world, org1.slug), 'utf-8')),
    ).toEqual({ accentColor: '#FF0055', logoFilename: 'logo.png' });
    // No branding file → nothing appears.
    expect(await readFileSafe(brandingPath(world, org2.slug))).toBeNull();
  },

  cases: {
    'keeps an explicitly-set accentColor when both fields are set': async (
      world,
    ) => {
      const filePath = await writeBranding(
        world,
        JSON.stringify({ brandColor: '#FF0055', accentColor: '#00AA66' }),
      );
      await world.applyUpOnly();
      expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
        accentColor: '#00AA66',
      });
    },

    'treats an empty-string accentColor as unset': async (world) => {
      const filePath = await writeBranding(
        world,
        JSON.stringify({ brandColor: '#FF0055', accentColor: '' }),
      );
      await world.applyUpOnly();
      expect(JSON.parse(await readFile(filePath, 'utf-8'))).toEqual({
        accentColor: '#FF0055',
      });
    },

    'leaves an unparseable branding.json untouched': async (world) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const filePath = await writeBranding(world, 'not json');
        await world.applyUpOnly();
        expect(await readFile(filePath, 'utf-8')).toBe('not json');
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    },
  },
});
