// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import { migrationLedgerTable, migrationSnapshotsTable } from './schema';
import { buildModules } from './test_helpers';
import type {
  MigrationMeta,
  MigrationOrg,
  NodeMigration,
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from './types';

const h = vi.hoisted(() => {
  const state = {
    upCalls: 0,
    downCalls: 0,
    /** What readFileSafe returned right after atomicWrite inside `up`. */
    roundTrip: null as string | null,
  };
  const reset = () => {
    state.upCalls = 0;
    state.downCalls = 0;
    state.roundTrip = null;
  };
  const PROBE_ID = '9.9.9/01_fs_probe';
  const probeFile = (orgSlug: string) =>
    `${process.env.TALE_CONFIG_DIR}/${orgSlug}/probe/probe.json`;

  const meta: MigrationMeta = {
    id: PROBE_ID,
    semver: '9.9.9',
    numericId: 1,
    slug: 'fs_probe',
    title: 'Synthetic fs probe',
    description:
      'Synthetic node migration that writes and removes one file through the runner-provided helpers.',
    kind: 'node',
    reversible: true,
    destructive: false,
    snapshot: 'none',
  };

  const nodeMigrations: Record<string, NodeMigration> = {
    [PROBE_ID]: {
      meta,
      up: async (
        _ctx: NodeMigrationCtx,
        org: MigrationOrg,
        helpers: NodeMigrationHelpers,
      ): Promise<void> => {
        state.upCalls += 1;
        const file = probeFile(org.slug);
        await helpers.atomicWrite(file, '{"probe":true}');
        state.roundTrip = await helpers.readFileSafe(file);
      },
      down: async (
        _ctx: NodeMigrationCtx,
        org: MigrationOrg,
        helpers: NodeMigrationHelpers,
      ): Promise<void> => {
        state.downCalls += 1;
        await helpers.removeFileSafe(probeFile(org.slug));
      },
    },
  };

  return { state, reset, PROBE_ID, probeFile, nodeMigrations };
});

vi.mock('./registry.node.gen', () => ({ NODE_MIGRATIONS: h.nodeMigrations }));

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/framework',
);

const fixtureSchema = defineSchema({
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
});

let root: string;

beforeEach(async () => {
  h.reset();
  root = await mkdtemp(path.join(tmpdir(), 'tale-mig-noderunner-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('node_runner.applyNodeForOrg', () => {
  it('dispatches up (writes) and down (removes) with functional fs helpers', async () => {
    const t = convexTest(fixtureSchema, modules);
    const file = path.join(root, 'org1', 'probe', 'probe.json');

    const upResult = await t.action(
      internal.migrations.framework.node_runner.applyNodeForOrg,
      {
        migrationId: h.PROBE_ID,
        orgId: 'org_id_1',
        orgSlug: 'org1',
        direction: 'up',
      },
    );
    expect(upResult).toBeNull();
    expect(h.state.upCalls).toBe(1);
    expect(h.state.downCalls).toBe(0);
    // The handler observed its own write through readFileSafe — the provided
    // helpers round-trip through the real org dir.
    expect(h.state.roundTrip).toBe('{"probe":true}');
    expect(await readFile(file, 'utf-8')).toBe('{"probe":true}');

    await t.action(internal.migrations.framework.node_runner.applyNodeForOrg, {
      migrationId: h.PROBE_ID,
      orgId: 'org_id_1',
      orgSlug: 'org1',
      direction: 'down',
    });
    expect(h.state.downCalls).toBe(1);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an unknown migration id', async () => {
    const t = convexTest(fixtureSchema, modules);
    await expect(
      t.action(internal.migrations.framework.node_runner.applyNodeForOrg, {
        migrationId: '0.0.0/99_nope',
        orgId: 'org_id_1',
        orgSlug: 'org1',
        direction: 'up',
      }),
    ).rejects.toThrow(/Unknown node migration: 0\.0\.0\/99_nope/);
    expect(h.state.upCalls).toBe(0);
  });
});
