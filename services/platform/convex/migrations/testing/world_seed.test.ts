// @vitest-environment node

/**
 * Corpus smoke test: proves the baseline world seeds cleanly under the
 * production schema (every insert schema-validated by convex-test), that the
 * config trees land on disk in the shipped-catalog layout, that the
 * deliberate corpus properties hold (deferred-drop tables stay empty, the
 * empty org stays empty), and that seeding is deterministic (two fresh
 * worlds digest equal). The chain harness builds on exactly this
 * construction.
 */

import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import currentSchema from '../../schema';
import { buildModules } from '../framework/test_helpers';
import { digestDb, digestFs } from './digest.testkit';
import { buildSeededWorld, collectVia } from './world/build.testkit';
import {
  WORLD_ORGS,
  baselineDomains,
  baselineTables,
} from './world/manifest.testkit';
import { WORLD_ENCRYPTION_SECRET_HEX } from './world/seed_db.testkit';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

/** Deferred drops (convex/legacy/schema.ts): listed in baselineTables for
 *  corpus-coverage accounting but NEVER seeded — 0.4+ deployments cannot
 *  hold rows there (manifest profile `deferredDropsEmpty`). */
const DEFERRED_DROP_TABLES = new Set(['taskAgentRuns', 'wfExecutions']);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tale-world-seed-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
  vi.stubEnv('ENCRYPTION_SECRET_HEX', WORLD_ENCRYPTION_SECRET_HEX);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const seedFullWorld = (configRoot: string) =>
  buildSeededWorld(configRoot, modules, authModules);

describe('baseline world corpus', () => {
  it('seeds every baseline table (and keeps the deferred drops empty)', async () => {
    const { t, orgs } = await seedFullWorld(root);
    const collect = collectVia(t);

    for (const table of baselineTables) {
      const rows = await collect(table);
      if (DEFERRED_DROP_TABLES.has(table)) {
        expect(rows, `deferred drop ${table} must stay EMPTY`).toEqual([]);
      } else {
        expect(rows.length, `baseline table ${table} is empty`).toBeGreaterThan(
          0,
        );
      }
    }

    // Orgs resolve to distinct component ids; the empty org owns no rows.
    expect(new Set([orgs.alpha.id, orgs.beta.id, orgs.empty.id]).size).toBe(3);
    for (const table of baselineTables) {
      const rows = await collect(table);
      expect(
        rows.filter((r) => r.organizationId === orgs.empty.id),
        `empty org must own no ${table} rows`,
      ).toEqual([]);
    }
  });

  it('lands the shipped-catalog config trees per org', async () => {
    await seedFullWorld(root);

    // Alpha carries the full shipped catalog.
    await access(
      path.join(root, WORLD_ORGS.alpha.slug, 'governance', 'retention.yml'),
    );
    for (const domain of baselineDomains) {
      await access(path.join(root, WORLD_ORGS.alpha.slug, domain));
    }

    // Beta carries governance only — no agents dir (missing-dir no-op path).
    await access(
      path.join(root, WORLD_ORGS.beta.slug, 'governance', 'retention.yml'),
    );
    await expect(
      access(path.join(root, WORLD_ORGS.beta.slug, 'agents')),
    ).rejects.toThrow();

    // The empty org mirrors the domain set, all empty.
    for (const domain of baselineDomains) {
      await access(path.join(root, WORLD_ORGS.empty.slug, domain));
    }
  });

  it('baseline seed is admitted by the CURRENT production schema', async () => {
    // The world schema IS the production schema since the baseline reset,
    // but this posture lock stays explicit: the container e2e injects this
    // same baseline into a LIVE deployment (support:seedWorld), where every
    // row is validated at push time — a corpus row drifting from the real
    // schema must fail HERE, not minutes into the container e2e.
    await expect(
      buildSeededWorld(root, modules, authModules, currentSchema),
    ).resolves.toBeDefined();
  });

  it('seeds deterministically — two fresh worlds digest identically', async () => {
    const rootB = await mkdtemp(path.join(tmpdir(), 'tale-world-seed-b-'));
    try {
      const a = await seedFullWorld(root);
      const b = await seedFullWorld(rootB);

      // storageId values are world-local (opaque); exclude the one table
      // that embeds them (fileMetadata), then require byte-identical
      // digests. FK ids (projectId, taskId, contactId…) are
      // insertion-ordered in convex-test and thus reproducible.
      const tables = baselineTables.filter((t) => t !== 'fileMetadata');
      expect(await digestDb(tables, collectVia(a.t))).toEqual(
        await digestDb(tables, collectVia(b.t)),
      );
      expect(await digestFs(root)).toEqual(await digestFs(rootB));
    } finally {
      await rm(rootB, { recursive: true, force: true });
    }
  });
});
