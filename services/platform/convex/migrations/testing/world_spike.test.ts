// @vitest-environment node

/**
 * Foundation spike for the migration test world: proves that under
 * convex-test we can (1) register the REAL local betterAuth component,
 * (2) seed organizations through the shipped `testing/support.seedAuthOrgs`,
 * and (3) drive a REAL node migration through the production path —
 * entrypoints.applyUp → org enumeration (org_source) → node_runner →
 * fs-tree snapshot/restore — with zero stubs. Every layer of the chain
 * harness builds on exactly this construction.
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import betterAuthSchema from '../../betterAuth/schema';
import { buildModules, historicalSchema } from '../framework/test_helpers';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

const BRANDING_ID = '0.3.4/01_branding_single_accent_color';

function newWorld() {
  const t = convexTest(historicalSchema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-mig-world-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function seedBranding(slug: string, config: unknown): Promise<string> {
  const dir = path.join(root, slug, 'branding');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'branding.json');
  await writeFile(file, JSON.stringify(config, null, 2));
  return file;
}

describe('migration test world (spike)', () => {
  it('seeds orgs in the real component and enumerates them via org_source', async () => {
    const t = newWorld();
    const orgs = await t.mutation(
      internal.migrations.testing.support.seedAuthOrgs,
      {
        orgs: [
          { slug: 'org1', name: 'Org One' },
          { slug: 'org2', name: 'Org Two' },
        ],
      },
    );
    expect(orgs).toHaveLength(2);
    expect(orgs[0].id).not.toBe('');

    // Idempotent on slug — a re-seed returns the same ids.
    const again = await t.mutation(
      internal.migrations.testing.support.seedAuthOrgs,
      { orgs: [{ slug: 'org1', name: 'Org One' }] },
    );
    expect(again[0].id).toBe(orgs[0].id);

    const page = await t.query(
      internal.migrations.framework.org_source.listOrgsPage,
      { cursor: null, numItems: 200 },
    );
    expect(page.isDone).toBe(true);
    expect(page.page.map((o) => o.slug).sort()).toEqual(['org1', 'org2']);
  });

  it('runs a real node migration up and down through the production path', async () => {
    const t = newWorld();
    const [org1] = await t.mutation(
      internal.migrations.testing.support.seedAuthOrgs,
      { orgs: [{ slug: 'org1', name: 'Org One' }] },
    );
    await t.mutation(internal.migrations.testing.support.seedAuthOrgs, {
      orgs: [{ slug: 'org2', name: 'Org Two' }],
    });

    const file1 = await seedBranding('org1', {
      brandColor: '#FF0055',
      logoFilename: 'logo.png',
    });
    // org2 has no branding dir at all — the per-org no-op path.

    const up = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [BRANDING_ID], allowDestructive: true },
    );
    expect(up.completed).toEqual([BRANDING_ID]);

    expect(JSON.parse(await readFile(file1, 'utf-8'))).toEqual({
      accentColor: '#FF0055',
      logoFilename: 'logo.png',
    });

    // Ledger: applied, with BOTH orgs recorded by the real fleet loop.
    const afterUp = await t.run(async (ctx) => {
      return await ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', BRANDING_ID))
        .unique();
    });
    expect(afterUp?.status).toBe('applied');
    expect(afterUp?.direction).toBe('up');
    expect(afterUp?.processedOrgs).toContain(org1.id);
    expect(afterUp?.processedOrgs).toHaveLength(2);

    // Second applyUp is a planner no-op.
    const upAgain = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [BRANDING_ID], allowDestructive: true },
    );
    expect(upAgain.completed).toEqual([]);

    const down = await t.action(
      internal.migrations.framework.entrypoints.applyDown,
      { to: '0.2.84', only: [BRANDING_ID] },
    );
    expect(down.completed).toEqual([BRANDING_ID]);

    // fs-tree restore brought the legacy file back byte-for-byte.
    expect(JSON.parse(await readFile(file1, 'utf-8'))).toEqual({
      brandColor: '#FF0055',
      logoFilename: 'logo.png',
    });

    const afterDown = await t.run(async (ctx) => {
      return await ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', BRANDING_ID))
        .unique();
    });
    expect(afterDown?.status).toBe('rolledBack');
  });
});
