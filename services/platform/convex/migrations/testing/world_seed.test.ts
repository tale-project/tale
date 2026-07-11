// @vitest-environment node

/**
 * Corpus smoke test: proves the baseline world seeds cleanly under the union
 * `worldSchema` (every insert schema-validated by convex-test), that the
 * fixture config trees land on disk, that the edge rows the chain relies on
 * exist, and that seeding is deterministic (two fresh worlds digest equal).
 * The chain harness builds on exactly this construction.
 */

import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildModules } from '../framework/test_helpers';
import { digestDb, digestFs } from './digest.testkit';
import {
  buildSeededWorld,
  collectVia,
  type SeededWorld,
} from './world/build.testkit';
import { WORLD_INJECTIONS } from './world/injections.testkit';
import {
  WORLD_ORGS,
  baselineDomains,
  baselineTables,
} from './world/manifest.testkit';
import {
  WORLD_ENCRYPTION_SECRET_HEX,
  WORLD_WORKFORCE_AGENT_SLUGS,
} from './world/seed_db.testkit';

const modules = buildModules(
  import.meta.glob('../../**/*.*s'),
  'migrations/testing',
);
const authModules = import.meta.glob('../../betterAuth/**/*.*s');

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

/** Apply every version-boundary injection (validity per boundary is the
 *  versions suite's job; here they only need to insert/patch cleanly). */
async function applyInjections(
  world: SeededWorld,
  configRoot: string,
): Promise<void> {
  for (const injection of WORLD_INJECTIONS) {
    await world.t.run((ctx) => injection.seed(ctx as never, world.orgs));
    await injection.seedFs?.(configRoot, world.orgs);
  }
}

describe('baseline world corpus', () => {
  it('seeds every baseline table and the edge rows the chain relies on', async () => {
    const { t, orgs } = await seedFullWorld(root);
    const collect = collectVia(t);

    for (const table of baselineTables) {
      const rows = await collect(table);
      expect(rows.length, `baseline table ${table} is empty`).toBeGreaterThan(
        0,
      );
    }

    // Governance: the staged-DSAR row 0.2.85/02 splits out, plus a non-file
    // policy type for the export skip path.
    const governance = await collect('governancePolicies');
    expect(
      governance.some(
        (r) =>
          r.policyType === 'dsar_governance' &&
          Object.keys(r).some((k) => k.startsWith('pending')),
      ),
    ).toBe(true);
    expect(governance.some((r) => r.policyType === 'personalization')).toBe(
      true,
    );

    // 0.2.96/03: relative thread-file paths backed by real storage blobs.
    const threadFiles = await collect('threadFiles');
    expect(threadFiles.length).toBeGreaterThan(0);
    for (const file of threadFiles) {
      expect(String(file.path).startsWith('/')).toBe(false);
      expect(typeof file.storageId).toBe('string');
    }

    // 0.3.4/02: the seeded credential is INACTIVE (chain no-op by design).
    const credentials = await collect('integrationCredentials');
    expect(credentials.length).toBeGreaterThan(0);
    expect(
      credentials.every((r) => !(r.isActive && r.status === 'active')),
    ).toBe(true);

    // 0.3.4/22–25: merge-edge rows (a vendor/customer without email).
    const vendors = await collect('vendors');
    expect(vendors.some((r) => r.email === undefined)).toBe(true);

    // Orgs resolve to distinct component ids.
    expect(new Set([orgs.alpha.id, orgs.beta.id, orgs.empty.id]).size).toBe(3);
  });

  it('version-boundary injections seed cleanly and carry the edge rows', async () => {
    const world = await seedFullWorld(root);
    const collect = collectVia(world.t);
    await applyInjections(world, root);

    // Bindings are deliberately configless (manifest profile
    // appConfigSeeded:false — the 0.2.96/01 ↔ 0.3.4/09 config pair is not
    // chain-composable; the copy/fold paths live in those migrations' tests).
    const bindings = await collect('appProjectBindings');
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every((r) => r.config === undefined)).toBe(true);

    // 0.3.4/05: both retired workforce personas + one survivor.
    const installs = await collect('agentInstallations');
    for (const slug of WORLD_WORKFORCE_AGENT_SLUGS) {
      expect(installs.some((r) => r.agentSlug === slug)).toBe(true);
    }
    expect(
      installs.some(
        (r) => !WORLD_WORKFORCE_AGENT_SLUGS.includes(r.agentSlug as never),
      ),
    ).toBe(true);

    // 0.3.4/07: workforce_digest rows + the baseline task_assigned survivor.
    const notifications = await collect('userNotifications');
    expect(notifications.some((r) => r.type === 'workforce_digest')).toBe(true);
    expect(notifications.some((r) => r.type !== 'workforce_digest')).toBe(true);

    // 0.3.4/25: the customer-backed case's FK resolves; the requester-only
    // case is the skip path.
    const cases = await collect('supportCases');
    const customers = await collect('customers');
    const customerIds = new Set(customers.map((r) => r._id));
    expect(cases.some((r) => customerIds.has(r.customerId as string))).toBe(
      true,
    );
    expect(cases.some((r) => r.customerId === undefined)).toBe(true);

    // 0.3.4/15+/20: two app-era rows (rename + kind rewrite) and the
    // kind-bearing chat survivor.
    const threads = await collect('threadMetadata');
    expect(threads.filter((r) => r.kind === 'app_discussion').length).toBe(2);
    expect(threads.some((r) => r.kind === 'chat')).toBe(true);
  });

  it('lands the three fixture config trees with the 0.2.84 shapes', async () => {
    await seedFullWorld(root);

    const branding = JSON.parse(
      await readFile(
        path.join(root, WORLD_ORGS.alpha.slug, 'branding', 'branding.json'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(branding.brandColor).toBeDefined();

    // Legacy apps/ bundle layout (0.3.4/11-era) and workforce personas
    // (0.3.4/04) exist for alpha.
    await access(
      path.join(root, WORLD_ORGS.alpha.slug, 'apps', 'issue-desk', 'app.json'),
    );
    await access(path.join(root, WORLD_ORGS.alpha.slug, 'agents', 'workforce'));

    // The empty org mirrors the 0.2.84 domain set, all empty.
    for (const domain of baselineDomains) {
      await access(path.join(root, WORLD_ORGS.empty.slug, domain));
    }
    // Beta deliberately has NO branding dir (missing-dir no-op path).
    await expect(
      access(path.join(root, WORLD_ORGS.beta.slug, 'branding')),
    ).rejects.toThrow();
  });

  it('seeds deterministically — two fresh worlds digest identically', async () => {
    const rootB = await mkdtemp(path.join(tmpdir(), 'tale-world-seed-b-'));
    try {
      const a = await seedFullWorld(root);
      const b = await seedFullWorld(rootB);
      await applyInjections(a, root);
      await applyInjections(b, rootB);

      // storageId values are world-local (opaque); exclude the tables that
      // embed them (threadFiles at baseline, appUploadIntents injected), then
      // require byte-identical digests. FK ids (customerId, projectId) are
      // insertion-ordered in convex-test and thus reproducible.
      const tables = [
        ...new Set([
          ...baselineTables,
          ...WORLD_INJECTIONS.flatMap((i) => i.tables),
        ]),
      ].filter((t) => t !== 'threadFiles' && t !== 'appUploadIntents');
      expect(await digestDb(tables, collectVia(a.t))).toEqual(
        await digestDb(tables, collectVia(b.t)),
      );
      expect(await digestFs(root)).toEqual(await digestFs(rootB));
    } finally {
      await rm(rootB, { recursive: true, force: true });
    }
  });
});
