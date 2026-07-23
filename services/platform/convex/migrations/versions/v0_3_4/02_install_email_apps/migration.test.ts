// @vitest-environment node

/**
 * The real `installAutomationInternal`/`uninstallAutomationInternal` engines
 * are catalog- and filesystem-bound (they copy bundle files from
 * TALE_CONFIG_BUILTIN_DIR) and were retired with the rest of the old
 * automations domain. `testing/retired_runtime.testkit
 * .ts` replaces them for every migration test world with row-effect
 * equivalents (upsert/delete of the install row through the REAL mutations),
 * injected automatically by `defineMigrationTest`'s `makeWorld` — this file
 * needs no `vi.mock` of its own. Everything else — org fleet loop, credential
 * read, the already-installed guard, the installedBy marker, and the
 * marker-targeted down — runs the real production path.
 */

import { expect, vi } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import { retiredAutomationInstallControl } from '../../../testing/retired_runtime.testkit';
import {
  emailAppInstallTargets,
  MIGRATION_INSTALLED_BY,
  type CredentialLike,
} from './migration';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_90/03_install_email_apps';

const EPOCH = 1_717_000_000_000;

function active(slug: string): CredentialLike {
  return { slug, isActive: true, status: 'active' };
}

async function insertCredential(
  // oxlint-disable-next-line typescript/no-explicit-any -- structural seed ctx
  db: any,
  organizationId: string,
  cred: CredentialLike,
): Promise<void> {
  await db.insert('integrationCredentials', {
    organizationId,
    slug: cred.slug,
    status: cred.status,
    isActive: cred.isActive,
    authMethod: 'oauth2',
  });
}

// Main ritual: the INACTIVE-credential no-op path (the corpus profile) —
// up must install nothing, and down over the no-op world must change nothing.
defineMigrationTest({
  id: '0.3.4/02_install_email_apps',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    // INACTIVE credential: the active-filter is exercised, no install runs.
    await insertCredential(ctx.db, orgs[0].id, {
      slug: 'outlook',
      isActive: false,
      status: 'inactive',
    });
    // org2 has no credentials at all.
  },

  async expectUp(world) {
    const installs = await world.run<Array<Record<string, unknown>>>((ctx) =>
      ctx.db.query('automationInstallations').collect(),
    );
    expect(installs).toEqual([]);
  },

  cases: {
    'up installs the mapped app for an ACTIVE credential, stamped with the marker, and skips an already-installed app':
      async (world) => {
        const orgId = world.orgs[0].id;
        await world.run(async (ctx) => {
          await insertCredential(ctx.db, orgId, active('outlook'));
          await insertCredential(ctx.db, orgId, active('gmail'));
          // A human install of the gmail app predates the migration.
          await ctx.db.insert('automationInstallations', {
            organizationId: orgId,
            automationSlug: 'gmail/sync-emails',
            installedAt: EPOCH,
            installedBy: 'admin@acme.com',
            status: 'active',
            resources: [],
            requiredIntegrations: [],
          });
        });

        await world.applyUpOnly();

        const installs = await world.run<Array<Record<string, unknown>>>(
          (ctx) => ctx.db.query('automationInstallations').collect(),
        );
        const bySlug = new Map(
          installs.map((row: Record<string, unknown>) => [
            row.automationSlug,
            row,
          ]),
        );
        expect(bySlug.get('outlook/sync-emails')).toMatchObject({
          installedBy: MIGRATION_INSTALLED_BY,
          status: 'active',
        });
        // The human install row was never overwritten.
        expect(bySlug.get('gmail/sync-emails')).toMatchObject({
          installedBy: 'admin@acme.com',
        });
        expect(installs).toHaveLength(2);
      },

    'up logs and continues past a failed install instead of aborting the org':
      async (world) => {
        const warn = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);
        retiredAutomationInstallControl.failInstallSlugs = new Set([
          'outlook/sync-emails',
        ]);
        try {
          const orgId = world.orgs[0].id;
          await world.run(async (ctx) => {
            await insertCredential(ctx.db, orgId, active('outlook'));
            await insertCredential(ctx.db, orgId, active('gmail'));
          });

          await world.applyUpOnly();

          const slugs = await world.run(async (ctx) => {
            const rows = await ctx.db
              .query('automationInstallations')
              .collect();
            return rows.map(
              (row: Record<string, unknown>) => row.automationSlug,
            );
          });
          // gmail/sync-emails still installed despite outlook failing first.
          expect(slugs).toEqual(['gmail/sync-emails']);
          expect(warn).toHaveBeenCalled();
        } finally {
          retiredAutomationInstallControl.failInstallSlugs = new Set();
          warn.mockRestore();
        }
      },

    'down uninstalls ONLY marker-stamped rows and is idempotent': async (
      world,
    ) => {
      const orgId = world.orgs[0].id;
      await world.run(async (ctx) => {
        await insertCredential(ctx.db, orgId, active('outlook'));
      });
      await world.applyUpOnly();

      // A human install appears between up and down.
      await world.run(async (ctx) => {
        await ctx.db.insert('automationInstallations', {
          organizationId: orgId,
          automationSlug: 'gmail/sync-emails',
          installedAt: EPOCH,
          installedBy: 'admin@acme.com',
          status: 'active',
          resources: [],
          requiredIntegrations: [],
        });
      });

      await world.applyDownOnly();

      const installs = await world.run<Array<Record<string, unknown>>>((ctx) =>
        ctx.db.query('automationInstallations').collect(),
      );
      // The marker-stamped outlook row is gone; the human gmail row survives.
      expect(
        installs.map((row: Record<string, unknown>) => row.automationSlug),
      ).toEqual(['gmail/sync-emails']);
    },
  },

  unit: {
    'emailAppInstallTargets keeps only ACTIVE credentials of mapped integrations':
      () => {
        const targets = emailAppInstallTargets([
          active('outlook'),
          { slug: 'gmail', isActive: false, status: 'active' }, // disabled
          { slug: 'imap_smtp', isActive: true, status: 'error' }, // unhealthy
          active('slack'), // active but not an email integration
        ]);
        expect(targets).toEqual(['outlook/sync-emails']);
      },
  },
});
