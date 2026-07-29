// @vitest-environment node

/**
 * Version-checkpoint suite: holds the migration chain against the REAL
 * schemas every release shipped (git-tag ground truth in
 * `testing/versions/`, via checkpoints.testkit).
 *
 *   1. boundary walk — after the last migration of each version X, the world
 *      must be a valid release-X deployment: no rows in tables X does not
 *      declare, every row valid under X's actual schema. A migration homed
 *      in the wrong version folder fails HERE with the exact release and
 *      table named — instead of corrupting a real upgrade.
 *   2. init-at-version — for each version X: a fresh project migrated
 *      `up --to X` validates as a release-X deployment, migrating on to the
 *      newest and back `down --to X` restores the exact at-X world
 *      (byte-level digest), and it still validates as X.
 *   3. the scaffold store materializes each era's initialized project files.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import { BASELINE_VERSION } from '../framework/baseline';
import { ALL_META } from '../framework/registry.gen';
import { compareSemver } from '../framework/semver';
import { buildModules } from '../framework/test_helpers';
import { isRunnableKind } from '../framework/types';
import {
  checkpointVersions,
  hasCheckpoint,
  tablesEverDeclaredThrough,
  loadScaffold,
  materializeScaffold,
  readBlob,
  validateConfigTreeAtVersion,
  validateWorldAtVersion,
} from './checkpoints.testkit';
import { digestWorld, diffWorldDigests } from './digest.testkit';
import {
  buildSeededWorld,
  collectVia,
  worldTables,
  type SeededWorld,
} from './world/build.testkit';
import { WORLD_INJECTIONS } from './world/injections.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';

/** The version whose deployments the baseline corpus models. */
const BASELINE = BASELINE_VERSION;

/** Seed the injections born while release `version` was current (the walk
 *  crosses the boundary, then the rows/files appear — as on a real
 *  deployment). */
async function injectAfter(
  world: SeededWorld,
  version: string,
  configRoot: string,
): Promise<void> {
  for (const injection of WORLD_INJECTIONS) {
    if (injection.afterVersion !== version) continue;
    await world.t.run((ctx) => injection.seed(ctx as never, world.orgs));
    await injection.seedFs?.(configRoot, world.orgs);
  }
}

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

/** Versions that actually change the world: distinct semvers of runnable
 *  migrations, in chain order. Reference-only versions are no-ops. */
const RUNNABLE_VERSIONS = [
  ...new Set(
    ALL_META.filter((m) => isRunnableKind(m.kind)).map((m) => m.semver),
  ),
];

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-verchk-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
  vi.stubEnv('ENCRYPTION_SECRET_HEX', WORLD_ENCRYPTION_SECRET_HEX);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** Cumulative declared-table sets (dropped-table residue tolerance). */
const everDeclaredCache = new Map<string, ReadonlySet<string>>();
function everDeclaredAt(version: string): ReadonlySet<string> {
  let cached = everDeclaredCache.get(version);
  if (!cached) {
    cached = tablesEverDeclaredThrough(version);
    everDeclaredCache.set(version, cached);
  }
  return cached;
}

const seedWorld = (): Promise<SeededWorld> =>
  buildSeededWorld(root, modules, authModules);

describe('version checkpoints (real per-release schemas)', () => {
  it('every migration version has a checkpoint fixture', () => {
    for (const version of RUNNABLE_VERSIONS) {
      expect(
        hasCheckpoint(version),
        `no checkpoint for ${version} — run bun scripts/dump-version-schemas.ts`,
      ).toBe(true);
    }
  });

  it(
    'boundary walk: after every version, the world is a valid deployment of that release',
    { timeout: 300_000 },
    async () => {
      const world = await seedWorld();
      const collect = collectVia(world.t);
      const violations: string[] = [];

      // The seed corpus itself must be a valid deployment of the baseline
      // release — anachronistic seeds fail here before any migration runs.
      // Config files count too: every file the fixtures lay down must match
      // the shape the baseline release's Zod schemas declared.
      const baselineErrors = [
        ...(await validateWorldAtVersion(
          BASELINE,
          worldTables(),
          collect,
          everDeclaredAt(BASELINE),
        )),
        ...validateConfigTreeAtVersion(BASELINE, root),
      ];
      violations.push(...baselineErrors.map((e) => `  at baseline: ${e}`));

      for (const version of RUNNABLE_VERSIONS) {
        await world.t.action(
          internal.migrations.framework.entrypoints.applyUp,
          { to: version, allowDestructive: true },
        );
        const errors = [
          ...(await validateWorldAtVersion(
            version,
            worldTables(),
            collect,
            everDeclaredAt(version),
          )),
          ...validateConfigTreeAtVersion(version, root),
        ];
        violations.push(...errors.map((e) => `  after ≤${version}: ${e}`));
        await injectAfter(world, version, root);
      }

      expect(
        violations,
        `migrations are homed in versions whose releases cannot hold their output:\n${violations.join('\n')}`,
      ).toEqual([]);
    },
  );

  it(
    'init at version: up --to X validates as X, and down --to X restores the at-X world',
    { timeout: 600_000 },
    async () => {
      for (const version of RUNNABLE_VERSIONS) {
        const versionRoot = await mkdtemp(
          path.join(tmpdir(), 'tale-verchk-at-'),
        );
        vi.stubEnv('TALE_CONFIG_DIR', versionRoot);
        try {
          const world = await buildSeededWorld(
            versionRoot,
            modules,
            authModules,
          );
          const collect = collectVia(world.t);

          // Walk up stepwise so rows born at earlier boundaries exist, as on
          // a real deployment that lived through those releases. Injections
          // PAST the target version stay out — the round trip below must
          // return to exactly this at-version world — and dev-cycle-only rows
          // are skipped when the target IS their boundary (a release-V
          // deployment never holds them).
          for (const step of RUNNABLE_VERSIONS) {
            if (compareSemver(step, version) > 0) break;
            await world.t.action(
              internal.migrations.framework.entrypoints.applyUp,
              { to: step, allowDestructive: true },
            );
            for (const injection of WORLD_INJECTIONS) {
              if (injection.afterVersion !== step) continue;
              if (injection.devCycleOnly && compareSemver(step, version) >= 0) {
                continue;
              }
              await world.t.run((ctx) =>
                injection.seed(ctx as never, world.orgs),
              );
              await injection.seedFs?.(versionRoot, world.orgs);
            }
          }
          const atVersion = await digestWorld(
            worldTables(),
            collect,
            versionRoot,
          );
          expect(
            await validateWorldAtVersion(
              version,
              worldTables(),
              collect,
              everDeclaredAt(version),
            ),
            `fresh project at ${version} is not a valid ${version} deployment`,
          ).toEqual([]);

          await world.t.action(
            internal.migrations.framework.entrypoints.applyUp,
            { allowDestructive: true },
          );
          await world.t.action(
            internal.migrations.framework.entrypoints.applyDown,
            { to: version },
          );

          const backAtVersion = await digestWorld(
            worldTables(),
            collect,
            versionRoot,
          );
          const diff = diffWorldDigests(atVersion, backAtVersion);
          expect(
            diff,
            `down --to ${version} did not restore the at-${version} world:\n${diff.join('\n')}`,
          ).toEqual([]);
          expect(
            await validateWorldAtVersion(
              version,
              worldTables(),
              collect,
              everDeclaredAt(version),
            ),
            `world after down --to ${version} is not a valid ${version} deployment`,
          ).toEqual([]);
        } finally {
          vi.stubEnv('TALE_CONFIG_DIR', root);
          await rm(versionRoot, { recursive: true, force: true });
        }
      }
    },
  );

  it('the scaffold store materializes an initialized project of every era', async () => {
    // One full materialization proves the write path (the baseline is the
    // oldest — and today the only — era in the post-reset store).
    const dir = await mkdtemp(path.join(tmpdir(), 'tale-scaffold-'));
    try {
      const count = materializeScaffold(BASELINE, dir);
      expect(count).toBeGreaterThan(0);
      const entries = await readdir(dir);
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // …and every version's scaffold blobs must be readable. Releases before
    // builtin-configs/ existed have legitimately empty manifests; once a
    // version ships files, no later version may regress to empty.
    let scaffoldsBegan: string | null = null;
    for (const version of checkpointVersions()) {
      const manifest = loadScaffold(version);
      const count = Object.keys(manifest.files).length;
      if (count > 0 && scaffoldsBegan === null) scaffoldsBegan = version;
      if (scaffoldsBegan !== null) {
        expect(
          count,
          `scaffold manifest for ${version} is empty although scaffolds began at ${scaffoldsBegan}`,
        ).toBeGreaterThan(0);
      }
      for (const blobKey of Object.values(manifest.files)) {
        readBlob(blobKey); // throws on a missing/corrupt blob
      }
    }
    expect(scaffoldsBegan, 'no version ships any scaffold').not.toBeNull();
  });
});
