// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_85/01_governance_db_to_json';

// The harness runs the standard ritual automatically: up through the real org
// fleet loop (both orgs, real configCache sync), handler idempotency over
// migrated state, down restoring the seeded world digest (files AND rows),
// and the ledger/processedOrgs transitions.
defineMigrationTest({
  id: '0.2.85/01_governance_db_to_json',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    await ctx.db.insert('governancePolicies', {
      organizationId: orgs[0].id,
      policyType: 'password_policy',
      config: { minLength: 16 },
      enabled: true,
    });
    // Legacy non-file policy type — the export must skip it.
    await ctx.db.insert('governancePolicies', {
      organizationId: orgs[0].id,
      policyType: 'personalization',
      config: { enabled: true },
      enabled: true,
    });
    // org2 seeds nothing: the per-org no-op path.
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;
    const govDir = (slug: string) =>
      path.join(world.configRoot, slug, 'governance');

    // The policy landed in its kebab-case file with schema defaults applied.
    const written = JSON.parse(
      await readFile(
        path.join(govDir(org1.slug), 'password-policy.json'),
        'utf-8',
      ),
    );
    expect(written).toMatchObject({ minLength: 16, requireUpper: true });

    // Non-file policy types are not exported.
    expect(
      await readFileSafe(path.join(govDir(org1.slug), 'personalization.json')),
    ).toBeNull();

    // The real file→cache sync mirrored exactly the exported policy.
    const cache = await world.run<Array<Record<string, unknown>>>((ctx) =>
      ctx.db.query('configCache').collect(),
    );
    const keysFor = (orgId: string) =>
      cache
        .filter(
          (row: Record<string, unknown>) =>
            row.organizationId === orgId && row.domain === 'governance',
        )
        .map((row: Record<string, unknown>) => row.key);
    expect(keysFor(org1.id)).toEqual(['password_policy']);
    expect(keysFor(org2.id)).toEqual([]);

    // org2 had no legacy rows — no file appears.
    expect(
      await readFileSafe(path.join(govDir(org2.slug), 'password-policy.json')),
    ).toBeNull();
  },
});
