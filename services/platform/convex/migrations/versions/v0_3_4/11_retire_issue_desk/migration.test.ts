// @vitest-environment node

/**
 * Runs the REAL retire path end to end: the world carries the modern
 * `automationInstallations` row (the migration's lookup) plus the legacy
 * `<org>/apps/issue-desk/` tree, and `up` drives the real unbind/uninstall
 * core. Two environment notes:
 *
 *  - TALE_CONFIG_BUILTIN_DIR is stubbed to a nonexistent root so the retired
 *    bundle deterministically resolves as catalog-missing (production truth:
 *    issue-desk left the builtin catalog) — the uninstall core then skips the
 *    manifest-driven deregistration and only removes rows/files it can prove.
 *  - the schema extends the world schema with `workflowEnv`: the uninstall
 *    core's env sweep queries it by index, and convex-test refuses index
 *    queries on undeclared tables.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { defineSchema } from 'convex/server';
import { beforeEach, expect, vi } from 'vitest';

import { workflowEnvTable } from '../../../../legacy/schema';
import { readFileSafe, sha256 } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';
import { worldSchema } from '../../../testing/world_schema.testkit';
import { APP_SLUG, RETIRE_MARKER } from './migration';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_92/01_retire_issue_desk';

const EPOCH = 1_717_000_000_000;
const PROJECT_NAME = 'Engineering';

const APP_JSON = JSON.stringify({
  name: 'Resolve GitHub issues',
  scope: 'project',
  workflows: ['issue-desk/desk-process', 'issue-desk/reconcile'],
  agents: ['desk-implementer', 'desk-reviewer'],
  requires: { integrations: ['github'] },
});
const DESK_PROCESS_JSON = JSON.stringify({ name: 'desk-process', steps: [] });
const RECONCILE_JSON = JSON.stringify({
  name: 'reconcile',
  triggers: { schedules: [{ cron: '*/15 * * * *', timezone: 'UTC' }] },
  steps: [],
});
const DESK_IMPLEMENTER_JSON = JSON.stringify({
  displayName: 'Desk Implementer',
});
const DESK_REVIEWER_JSON = JSON.stringify({ displayName: 'Desk Reviewer' });

// The retired bundle is gone from the builtin catalog by design; point the
// catalog root somewhere empty so a developer-shell value can't resurrect it.
beforeEach(() => {
  vi.stubEnv(
    'TALE_CONFIG_BUILTIN_DIR',
    path.join(path.sep, 'nonexistent', 'tale-builtin-catalog'),
  );
});

function appDir(world: WorldHandle): string {
  return path.join(world.configRoot, world.orgs[0].slug, 'apps', APP_SLUG);
}

defineMigrationTest({
  id: '0.3.4/11_retire_issue_desk',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // The uninstall core sweeps `workflowEnv` (see the file header).
  schema: defineSchema({
    ...worldSchema.tables,
    workflowEnv: workflowEnvTable,
  }),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    const orgId = orgs[0].id;
    const projectId = await ctx.db.insert('projects', {
      organizationId: orgId,
      name: PROJECT_NAME,
      createdBy: 'user_admin',
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
    await ctx.db.insert('automationInstallations', {
      organizationId: orgId,
      automationSlug: APP_SLUG,
      automationName: 'Resolve GitHub issues',
      installedAt: EPOCH,
      installedBy: 'user_admin',
      status: 'active',
      resources: [],
      requiredIntegrations: ['github'],
    });
    await ctx.db.insert('automationProjectBindings', {
      organizationId: orgId,
      automationSlug: APP_SLUG,
      projectId,
      boundAt: EPOCH,
      boundBy: 'user_admin',
    });
    // The ownership ledger rows deleteProjectSchedules resolves slugs from.
    // contentHash = sha256(bundle file bytes): down re-hashes the restored
    // files, so the seeded hash must be the true one for the round-trip.
    await ctx.db.insert('wfInstallations', {
      organizationId: orgId,
      workflowSlug: `${APP_SLUG}/desk-process`,
      installedAt: EPOCH,
      installedBy: 'user_admin',
      contentHash: sha256(DESK_PROCESS_JSON),
      automationSlug: APP_SLUG,
    });
    await ctx.db.insert('wfInstallations', {
      organizationId: orgId,
      workflowSlug: `${APP_SLUG}/reconcile`,
      installedAt: EPOCH,
      installedBy: 'user_admin',
      contentHash: sha256(RECONCILE_JSON),
      automationSlug: APP_SLUG,
    });
    await ctx.db.insert('wfSchedules', {
      organizationId: orgId,
      projectId,
      workflowSlug: `${APP_SLUG}/reconcile`,
      cronExpression: '*/15 * * * *',
      timezone: 'UTC',
      isActive: true,
      createdAt: EPOCH,
      createdBy: 'system',
      // No operator overrides: down's reconcile deliberately restores {}.
      variables: {},
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: orgId,
      agentSlug: `${APP_SLUG}/desk-implementer`,
      installedAt: EPOCH,
      installedBy: 'user_admin',
      contentHash: sha256(DESK_IMPLEMENTER_JSON),
      enabled: true,
      automationSlug: APP_SLUG,
    });
    await ctx.db.insert('agentInstallations', {
      organizationId: orgId,
      agentSlug: `${APP_SLUG}/desk-reviewer`,
      installedAt: EPOCH,
      installedBy: 'user_admin',
      contentHash: sha256(DESK_REVIEWER_JSON),
      enabled: true,
      automationSlug: APP_SLUG,
    });
    // org2 has neither the install row nor the tree: the per-org no-op path
    // for up AND for down (restoreFsTree finds no snapshot).
  },

  async seedFs(root, orgs) {
    const dir = path.join(root, orgs[0].slug, 'apps', APP_SLUG);
    await mkdir(path.join(dir, 'agents'), { recursive: true });
    await mkdir(path.join(dir, 'workflows', APP_SLUG), { recursive: true });
    await writeFile(path.join(dir, 'app.json'), APP_JSON, 'utf8');
    await writeFile(path.join(dir, 'icon.svg'), '<svg/>', 'utf8');
    await writeFile(
      path.join(dir, 'agents', 'desk-implementer.json'),
      DESK_IMPLEMENTER_JSON,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'agents', 'desk-reviewer.json'),
      DESK_REVIEWER_JSON,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'workflows', APP_SLUG, 'desk-process.json'),
      DESK_PROCESS_JSON,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'workflows', APP_SLUG, 'reconcile.json'),
      RECONCILE_JSON,
      'utf8',
    );
  },

  // down re-registers rows through the shared upsert/bind/reconcile mutations,
  // which stamp wall-clock times and the RETIRE_MARKER actor by design (the
  // meta documents both); the data content itself must round-trip exactly.
  equality: {
    dropFields: {
      automationInstallations: ['installedAt', 'installedBy'],
      automationProjectBindings: ['boundAt', 'boundBy'],
      wfInstallations: ['installedAt', 'installedBy'],
      agentInstallations: ['installedAt', 'installedBy'],
      wfSchedules: ['createdAt'],
    },
  },

  async expectUp(world) {
    const rows = await world.run(async (ctx) => ({
      installs: await ctx.db.query('automationInstallations').collect(),
      bindings: await ctx.db.query('automationProjectBindings').collect(),
      schedules: await ctx.db.query('wfSchedules').collect(),
      workflows: await ctx.db.query('wfInstallations').collect(),
      agents: await ctx.db.query('agentInstallations').collect(),
    }));
    // Unbound, schedule deleted, install row gone.
    expect(rows.installs).toEqual([]);
    expect(rows.bindings).toEqual([]);
    expect(rows.schedules).toEqual([]);
    // The retired bundle is absent from the catalog, so the uninstall core
    // cannot read a manifest — the workflow/agent registration rows survive
    // (today's real behaviour) and are re-stamped by down's upserts.
    expect(rows.workflows).toHaveLength(2);
    expect(rows.agents).toHaveLength(2);

    // The bound-project sidecar rode into the snapshot and stays on disk
    // (the modern uninstall removes automations/, never the legacy apps/).
    const sidecar = await readFileSafe(
      path.join(appDir(world), '.migration-v0_2_92-bindings.json'),
    );
    expect(sidecar).not.toBeNull();
    expect(JSON.parse(sidecar ?? '')).toMatchObject({
      boundProjects: [expect.objectContaining({ name: PROJECT_NAME })],
    });
    expect(await readFileSafe(path.join(appDir(world), 'app.json'))).toBe(
      APP_JSON,
    );

    // org2 was skipped entirely.
    expect(
      await readFileSafe(
        path.join(
          world.configRoot,
          world.orgs[1].slug,
          'apps',
          APP_SLUG,
          'app.json',
        ),
      ),
    ).toBeNull();
  },

  async expectDown(world) {
    // The bookkeeping sidecar never survives into the restored bundle.
    expect(
      await readFileSafe(
        path.join(appDir(world), '.migration-v0_2_92-bindings.json'),
      ),
    ).toBeNull();

    const rows = await world.run(async (ctx) => ({
      installs: await ctx.db.query('automationInstallations').collect(),
      bindings: await ctx.db.query('automationProjectBindings').collect(),
      schedules: await ctx.db.query('wfSchedules').collect(),
    }));
    expect(rows.installs).toEqual([
      expect.objectContaining({
        automationSlug: APP_SLUG,
        automationName: 'Resolve GitHub issues',
        installedBy: RETIRE_MARKER,
        status: 'active',
        resources: [],
        requiredIntegrations: ['github'],
      }),
    ]);
    expect(rows.bindings).toEqual([
      expect.objectContaining({
        automationSlug: APP_SLUG,
        boundBy: RETIRE_MARKER,
      }),
    ]);
    // The reconcile schedule is rebuilt from the restored file's declared
    // spec; operator variable overrides are NOT restored (meta-documented).
    expect(rows.schedules).toEqual([
      expect.objectContaining({
        workflowSlug: `${APP_SLUG}/reconcile`,
        cronExpression: '*/15 * * * *',
        timezone: 'UTC',
        isActive: true,
        variables: {},
      }),
    ]);
  },
});
