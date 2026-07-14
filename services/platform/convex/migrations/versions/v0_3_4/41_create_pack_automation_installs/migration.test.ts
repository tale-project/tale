// @vitest-environment node

import { expect, vi } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';
import { MIGRATION_INSTALLED_BY } from '../33_workflows_become_automations/mapping';

vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_3_4/41_create_pack_automation_installs';

const EPOCH = 1_717_000_000_000;

// Harness ritual: idempotent up (existing rows are never touched), down
// deleting exactly the marker rows — the seeded human install must
// round-trip untouched.
defineMigrationTest({
  id: '0.3.4/41_create_pack_automation_installs',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }],

  async seed(ctx, orgs) {
    // A remapped pack workflow (36's output shape) with NO automation row —
    // 41 must create the marker row for it.
    await ctx.db.insert('wfInstallations', {
      organizationId: orgs[0].id,
      workflowSlug: 'run-assigned-task',
      installedAt: EPOCH,
      installedBy: 'system',
      contentHash: 'hash-runner',
      automationSlug: 'run-assigned-task',
    });
    // A remapped email fold whose automation row ALREADY exists (0.3.4/02) —
    // 41 must leave it alone.
    await ctx.db.insert('wfInstallations', {
      organizationId: orgs[0].id,
      workflowSlug: 'reply-imap-emails',
      installedAt: EPOCH,
      installedBy: 'integration:imap_smtp',
      contentHash: 'hash-imap',
      automationSlug: 'reply-imap-emails',
    });
    await ctx.db.insert('automationInstallations', {
      organizationId: orgs[0].id,
      automationSlug: 'reply-imap-emails',
      automationName: 'Reply to emails via SMTP/IMAP',
      installedAt: EPOCH,
      installedBy: 'user_1',
      status: 'active',
      resources: [],
      requiredIntegrations: ['imap_smtp'],
    });
  },

  async expectUp(world) {
    const rows = await world.run(
      async (ctx) =>
        (await ctx.db.query('automationInstallations').collect()) as Array<
          Record<string, unknown>
        >,
    );
    expect(rows).toHaveLength(2);
    const bySlug = new Map(rows.map((r) => [r.automationSlug, r]));
    expect(bySlug.get('run-assigned-task')?.installedBy).toBe(
      MIGRATION_INSTALLED_BY,
    );
    expect(bySlug.get('run-assigned-task')?.status).toBe('active');
    // The pre-existing human/migration-02 install is untouched.
    expect(bySlug.get('reply-imap-emails')?.installedBy).toBe('user_1');
    // No row invented for a mapped automation whose workflow was never live.
    expect(bySlug.has('sync-shopify-products')).toBe(false);
  },
});
