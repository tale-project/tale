// @vitest-environment node

/**
 * THE full-chain data-integrity proof: seed the baseline world corpus (a
 * fresh deployment at the migration baseline, `framework/baseline.ts`), run
 * EVERY runnable migration up through the real entrypoints (no `only`, no
 * `to` — the true production path incl. destructive interleaving and the org
 * fleet loop), validate the migrated world against the CURRENT schema, roll
 * everything back down to the baseline, and require byte-level digest
 * equality with the seed.
 *
 *   chain A — single-shot up → validate → single-shot down → deep-equal
 *   chain B — stepped walk with a frontier digest per step: down(i) must
 *             restore the digest before up(i), localizing the first
 *             corrupting step and catching corruption an endpoint-only
 *             comparison cancels out
 *   chain C — up → down → up converges (down leaves a re-migratable world)
 *
 * Since the 0.4 baseline reset the registry starts EMPTY, so all three
 * chains degenerate to "the seeded corpus is a valid current-schema world
 * and survives a no-op round trip" — the harness the first 0.4.x migration
 * lands into, at which point every proof above reactivates unchanged.
 * Corpus content and its deliberate properties live in
 * `world/manifest.testkit.ts` (`profile`).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import currentSchema from '../../schema';
import { BASELINE_VERSION } from '../framework/baseline';
import { ALL_META } from '../framework/registry.gen';
import { computeFingerprint } from '../framework/schema_fingerprint';
import { buildModules } from '../framework/test_helpers';
import { isRunnableKind } from '../framework/types';
import {
  digestWorld,
  diffWorldDigests,
  type WorldDigest,
} from './digest.testkit';
import { validateDoc } from './schema_validate.testkit';
import {
  buildSeededWorld,
  collectVia,
  worldTables,
  type SeededWorld,
} from './world/build.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

const BASELINE = BASELINE_VERSION;

/** Every runnable migration id, in canonical (semver, numericId) order. */
const RUNNABLE_IDS = ALL_META.filter((m) => isRunnableKind(m.kind)).map(
  (m) => m.id,
);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-chain-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
  vi.stubEnv('ENCRYPTION_SECRET_HEX', WORLD_ENCRYPTION_SECRET_HEX);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const seedWorld = (): Promise<SeededWorld> =>
  buildSeededWorld(root, modules, authModules);

function worldDigest(world: SeededWorld): Promise<WorldDigest> {
  return digestWorld(worldTables(), collectVia(world.t), root);
}

function expectEqualDigests(
  before: WorldDigest,
  after: WorldDigest,
  label: string,
): void {
  const diff = diffWorldDigests(before, after);
  expect(diff, `${label}:\n${diff.join('\n')}`).toEqual([]);
}

async function ledgerRows(
  world: SeededWorld,
): Promise<Array<Record<string, unknown>>> {
  return collectVia(world.t)('migrationLedger');
}

/** The migrated world must be a valid CURRENT-version deployment. */
async function assertPostUp(world: SeededWorld): Promise<void> {
  // 1. Every runnable migration is applied, with drained cursors.
  const ledger = await ledgerRows(world);
  const byId = new Map(ledger.map((r) => [r.migrationId, r]));
  for (const id of RUNNABLE_IDS) {
    const row = byId.get(id);
    expect(row?.status, `${id} ledger status`).toBe('applied');
    expect(row?.cursor ?? null, `${id} batch cursor drained`).toBeNull();
  }

  // 2. Every row of every table validates against the CURRENT validators —
  //    undeclared leftover fields and half-transformed rows fail here with a
  //    precise path. At the empty-registry baseline this is the load-bearing
  //    assertion: the corpus itself must be a valid current-schema world.
  const exportFn = Reflect.get(currentSchema, 'export');
  const fingerprint = computeFingerprint(
    String((exportFn as () => unknown).call(currentSchema)),
  );
  const collect = collectVia(world.t);
  for (const [table, shape] of Object.entries(fingerprint.tables)) {
    for (const doc of await collect(table)) {
      const err = validateDoc(doc, shape, table);
      expect(
        err,
        `post-up ${table} row fails current schema: ${err}`,
      ).toBeNull();
    }
  }
}

async function assertFullyRolledBack(world: SeededWorld): Promise<void> {
  const ledger = await ledgerRows(world);
  const byId = new Map(ledger.map((r) => [r.migrationId, r]));
  for (const id of RUNNABLE_IDS) {
    const row = byId.get(id);
    expect(row?.status, `${id} ledger status after down`).toBe('rolledBack');
    expect(row?.direction, `${id} direction after down`).toBe('down');
    expect(row?.cursor ?? null).toBeNull();
  }
  // Every rollback snapshot was consumed — nothing left to leak.
  expect(await collectVia(world.t)('migrationSnapshots')).toEqual([]);
}

describe(`migration chain (baseline ${BASELINE})`, () => {
  it(
    'chain A: single-shot up validates as current, single-shot down restores the seed',
    { timeout: 240_000 },
    async () => {
      const world = await seedWorld();
      const seedDigest = await worldDigest(world);

      const up = await world.t.action(
        internal.migrations.framework.entrypoints.applyUp,
        { allowDestructive: true },
      );
      expect(up.completed).toEqual(RUNNABLE_IDS);
      expect(up.skipped).toEqual([]);

      await assertPostUp(world);

      // The chain is a planner no-op when re-applied.
      const again = await world.t.action(
        internal.migrations.framework.entrypoints.applyUp,
        { allowDestructive: true },
      );
      expect(again.completed).toEqual([]);

      const down = await world.t.action(
        internal.migrations.framework.entrypoints.applyDown,
        { to: BASELINE },
      );
      expect(down.completed).toEqual(RUNNABLE_IDS.toReversed());

      await assertFullyRolledBack(world);
      expectEqualDigests(
        seedDigest,
        await worldDigest(world),
        'full down did not restore the seeded world',
      );
    },
  );

  it(
    'chain B: every frontier digest is restored by its down step',
    { timeout: 300_000 },
    async () => {
      const world = await seedWorld();
      const frontiers: WorldDigest[] = [await worldDigest(world)];

      for (const id of RUNNABLE_IDS) {
        const res = await world.t.action(
          internal.migrations.framework.entrypoints.applyUp,
          { only: [id], allowDestructive: true },
        );
        expect(res.completed, `up(${id})`).toEqual([id]);
        frontiers.push(await worldDigest(world));
      }

      await assertPostUp(world);

      for (let i = RUNNABLE_IDS.length; i > 0; i--) {
        const id = RUNNABLE_IDS[i - 1];
        const res = await world.t.action(
          internal.migrations.framework.entrypoints.applyDown,
          { to: BASELINE, only: [id] },
        );
        expect(res.completed, `down(${id})`).toEqual([id]);
        expectEqualDigests(
          frontiers[i - 1],
          await worldDigest(world),
          `down(${id}) did not restore the pre-up frontier`,
        );
      }
    },
  );

  it(
    'chain C: re-up after a full down converges on the same migrated world',
    { timeout: 240_000 },
    async () => {
      const world = await seedWorld();

      // Values a re-run REMINTS by design go here as exemptions, each
      // justified by the migration that mints them. Empty at the baseline:
      // no migrations, nothing remints.
      const convergenceDigest = (): Promise<WorldDigest> =>
        digestWorld(worldTables(), collectVia(world.t), root);

      await world.t.action(internal.migrations.framework.entrypoints.applyUp, {
        allowDestructive: true,
      });
      const firstUp = await convergenceDigest();

      await world.t.action(
        internal.migrations.framework.entrypoints.applyDown,
        { to: BASELINE },
      );
      const reUp = await world.t.action(
        internal.migrations.framework.entrypoints.applyUp,
        { allowDestructive: true },
      );
      expect(reUp.completed).toEqual(RUNNABLE_IDS);

      expectEqualDigests(
        firstUp,
        await convergenceDigest(),
        'down left a world the chain cannot re-migrate to the same state',
      );
    },
  );
});
