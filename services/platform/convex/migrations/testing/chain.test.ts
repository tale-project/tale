// @vitest-environment node

/**
 * THE full-chain data-integrity proof: seed the 0.2.84 baseline world corpus,
 * run EVERY runnable migration up through the real entrypoints (no `only`, no
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
 * Corpus content, deliberate gaps, and their reasons live in
 * `world/manifest.testkit.ts` (`profile`).
 */

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from '../../_generated/api';
import currentSchema from '../../schema';
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
import { WORLD_ORGS } from './world/manifest.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';

/** Fixture workflow files 0.3.4/06 removes / keeps (see manifest profile). */
const WORLD_RETIRED_WORKFLOW_FILE =
  'workflows/projects/tasks/send-daily-digest.json';
const WORLD_SURVIVOR_WORKFLOW_FILE =
  'workflows/projects/tasks/triage-unassigned-tasks.json';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

const BASELINE = '0.2.84';

/** Every runnable migration id, in canonical (semver, numericId) order. */
const RUNNABLE_IDS = ALL_META.filter((m) => isRunnableKind(m.kind)).map(
  (m) => m.id,
);

/** Tables the chain must leave EMPTY after up — the migrated-away worlds. */
const LEGACY_TABLES_EMPTY_AFTER_UP = [
  'governancePolicies',
  'orgPackagePolicy',
  'modelSyncSettings',
  'appInstallations',
  'appProjectBindings',
  'appUploadClaims',
  'appUploadIntents',
];

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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
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

  // 2. The migrated-away tables are empty.
  const collect = collectVia(world.t);
  for (const table of LEGACY_TABLES_EMPTY_AFTER_UP) {
    expect(
      await collect(table),
      `legacy table ${table} still has rows after the chain`,
    ).toEqual([]);
  }

  // 3. Every row of every current-schema table validates against the CURRENT
  //    validators — undeclared leftover fields and half-transformed rows fail
  //    here with a precise path.
  const exportFn = Reflect.get(currentSchema, 'export');
  const fingerprint = computeFingerprint(
    String((exportFn as () => unknown).call(currentSchema)),
  );
  const world_tables = new Set(worldTables());
  for (const [table, shape] of Object.entries(fingerprint.tables)) {
    if (!world_tables.has(table)) continue; // never seeded nor producible
    for (const doc of await collect(table)) {
      const err = validateDoc(doc, shape, table);
      expect(
        err,
        `post-up ${table} row fails current schema: ${err}`,
      ).toBeNull();
    }
  }

  // 4. Product postconditions on the config trees.
  const alpha = WORLD_ORGS.alpha.slug;
  const branding = JSON.parse(
    await readFile(
      path.join(root, alpha, 'branding', 'branding.json'),
      'utf-8',
    ),
  ) as Record<string, unknown>;
  expect(branding.brandColor).toBeUndefined();
  expect(branding.accentColor).toBeDefined();

  // 0.2.98/02 rewrote every opencode agent; 0.3.4/04 removed the personas.
  for (const org of [alpha, WORLD_ORGS.beta.slug]) {
    const chatDir = path.join(root, org, 'agents', 'chat');
    if (!(await exists(chatDir))) continue;
    for (const file of await readdir(chatDir)) {
      if (!file.endsWith('.json')) continue;
      const agent = JSON.parse(
        await readFile(path.join(chatDir, file), 'utf-8'),
      ) as Record<string, unknown>;
      expect(agent.agentKind, `${org}/agents/chat/${file} agentKind`).not.toBe(
        'opencode',
      );
    }
  }
  expect(await exists(path.join(root, alpha, 'agents', 'workforce'))).toBe(
    false,
  );

  // 0.3.4/03 dropped the workforce policy file; 0.2.85/01 exported the DB
  // policies into governance/; 0.2.87/01 wrote the unified SSO connection;
  // 0.4.0/01 then converted every known governance file to YAML, so at the
  // frontier the connection lives as `.yml` with no `.json` original — and
  // no converted-format `.json` policy file survives at all.
  expect(
    await exists(path.join(root, alpha, 'governance', 'agent-workforce.json')),
  ).toBe(false);
  const governanceFiles = await readdir(path.join(root, alpha, 'governance'));
  expect(governanceFiles.length).toBeGreaterThan(0);
  expect(
    governanceFiles.filter((f) => f.endsWith('.json')),
    'post-conversion governance dir still holds .json policy files',
  ).toEqual([]);
  expect(
    await exists(path.join(root, alpha, 'governance', 'sso', 'connection.yml')),
  ).toBe(true);
  expect(
    await exists(
      path.join(root, alpha, 'governance', 'sso', 'connection.json'),
    ),
  ).toBe(false);

  // 0.3.4/06 removed the retired workflow file; the survivor then LEFT the
  // workflows tree with the 0.3.4/33-43 cutover — at the frontier its
  // definition lives inline in the seeded automation and the whole
  // `workflows/` dir is gone (0.3.4/35).
  expect(
    await exists(path.join(root, alpha, WORLD_RETIRED_WORKFLOW_FILE)),
  ).toBe(false);
  expect(
    await exists(path.join(root, alpha, WORLD_SURVIVOR_WORKFLOW_FILE)),
  ).toBe(false);
  expect(await exists(path.join(root, alpha, 'workflows'))).toBe(false);
  // The survivor's automation manifest is NOT asserted here: the chain world
  // deliberately runs without TALE_CONFIG_BUILTIN_DIR, so 0.3.4/33's catalog
  // seed is a logged no-op (its own migration.test.ts proves the seeded
  // manifest with the env set). The DB half — remapped rows + the marker
  // automationInstallations — is pinned by the digest and 41's test.

  // The issue-desk bundle deliberately survives the chain untouched
  // (manifest profile issueDeskRetireChainNoop).
  expect(
    await exists(path.join(root, alpha, 'apps', 'issue-desk', 'app.json')),
  ).toBe(true);

  // 5. The derived config mirror was populated by the file→cache syncs.
  expect((await collect('configCache')).length).toBeGreaterThan(0);
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

describe('migration chain (0.2.84 → 0.3.4 → 0.2.84)', () => {
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

      // Values a re-run REMINTS by design — each justified, nothing else:
      //  - contacts get fresh _ids on the second up (down deleted the
      //    backfilled rows), so the contactId FKs embedded by 0.3.4/24+25
      //    differ per cycle. Resolution is asserted separately below.
      //  - 0.3.4/12 stamps Date.now() on the subscription row it creates.
      //  - 0.4.0/02 re-encrypts the file-sourced provider secrets on every
      //    up (AES-GCM mints a fresh nonce per encryption) and stamps
      //    Date.now(); the non-secret projection (name, method, env name,
      //    masked preview, default flag, marker) still digest-compares, and
      //    plaintext round-tripping is locked by the migration's own test.
      const remintExemptions = {
        conversations: ['contactId'],
        supportCases: ['contactId'],
        wfEventSubscriptions: ['createdAt'],
        providerCredentials: ['encryptedData', 'createdAt', 'updatedAt'],
      } as const;
      const convergenceDigest = (): Promise<WorldDigest> =>
        digestWorld(worldTables(), collectVia(world.t), root, {
          extraDropFields: remintExemptions,
        });

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

      // The exempted FKs must still RESOLVE: every backfilled contactId
      // points at an existing contacts row of the same org.
      const collect = collectVia(world.t);
      const contacts = await collect('contacts');
      const contactIds = new Set(
        contacts.map((c) => c._id).filter((id) => typeof id === 'string'),
      );
      for (const table of ['conversations', 'supportCases']) {
        for (const row of await collect(table)) {
          const { contactId } = row;
          if (contactId === undefined) continue;
          expect(
            typeof contactId === 'string' && contactIds.has(contactId),
            `${table} row's contactId does not resolve after re-up`,
          ).toBe(true);
        }
      }
    },
  );
});
