// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_90/07_remove_retired_task_workflows';

const EPOCH = 1_717_000_000_000;
const SURVIVOR_SLUG = 'projects/tasks/triage-unassigned-tasks';
/** Fixed literal — the provisioner skips provisioned slugs BEFORE hashing. */
const SURVIVOR_HASH = 'testhash-triage-unassigned-tasks-v1';

/** Minimal valid workflow JSON (the 0.2.84-era pack shape). */
function workflowJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    metadata: { labels: ['Tasks'], ...(extra.metadata as object | undefined) },
    steps: [
      {
        config: {},
        name: 'Start',
        nextSteps: {},
        stepSlug: 'start',
        stepType: 'start',
      },
    ],
    ...extra,
  });
}

const RETIRED_FILES = [
  ['projects', 'tasks', 'send-daily-digest.json'],
  ['projects', 'tasks', 'reassign-paused-agent-work.json'],
  ['projects', 'discussions', 'triage-new-discussion.json'],
] as const;

// Harness ritual: real fleet up, destructive gating, handler idempotency over
// migrated state (files already gone; removeDefaultProvisioning is a no-op),
// and down restoring the seed digest — restoreFsTree brings the files back and
// the REAL provisioner then runs; the survivor's seeded provision marker makes
// it SKIP (no wall-clock rows), and the retired files carry no autoInstall, so
// the digest round-trips exactly.
defineMigrationTest({
  id: '0.3.4/06_remove_retired_task_workflows',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    // The SURVIVOR autoInstall workflow's rows (mirrors the world corpus):
    // the provision marker stops down's provisioner from re-inserting
    // wall-clock rows for it.
    await ctx.db.insert('wfInstallations', {
      organizationId: orgs[0].id,
      workflowSlug: SURVIVOR_SLUG,
      installedAt: EPOCH,
      installedBy: 'system',
      contentHash: SURVIVOR_HASH,
    });
    await ctx.db.insert('wfDefaultProvisions', {
      organizationId: orgs[0].id,
      workflowSlug: SURVIVOR_SLUG,
      contentHash: SURVIVOR_HASH,
      provisionedAt: EPOCH,
    });
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: orgs[0].id,
      workflowSlug: SURVIVOR_SLUG,
      eventType: 'task.created',
      isActive: true,
      createdAt: EPOCH,
      createdBy: 'system',
    });
  },

  async seedFs(root, orgs) {
    const wfDir = path.join(root, orgs[0].slug, 'workflows');
    await mkdir(path.join(wfDir, 'projects', 'tasks'), { recursive: true });
    await mkdir(path.join(wfDir, 'projects', 'discussions'), {
      recursive: true,
    });
    // The three retired files — deliberately WITHOUT metadata.autoInstall so
    // down's provisioner leaves them inert after the restore (the corpus
    // profile `retiredWorkflowAutoInstall`).
    for (const rel of RETIRED_FILES) {
      await writeFile(path.join(wfDir, ...rel), workflowJson(), 'utf8');
    }
    // Keeper files the sweep must never touch.
    await writeFile(
      path.join(wfDir, 'projects', 'tasks', 'run-assigned-task.json'),
      workflowJson(),
      'utf8',
    );
    await writeFile(
      path.join(
        wfDir,
        'projects',
        'discussions',
        'react-to-discussion-mention.json',
      ),
      workflowJson(),
      'utf8',
    );
    // The survivor autoInstall workflow (already provisioned via the seed).
    await writeFile(
      path.join(wfDir, 'projects', 'tasks', 'triage-unassigned-tasks.json'),
      workflowJson({
        metadata: { autoInstall: true, labels: ['Tasks'] },
        triggers: { events: [{ eventType: 'task.created' }] },
      }),
      'utf8',
    );
    // org2: an EMPTY workflows dir — down's provisioner must find the dir
    // (listCatalogArea ENOENTs into a scheduler retry otherwise).
    await mkdir(path.join(root, orgs[1].slug, 'workflows'), {
      recursive: true,
    });
  },

  async expectUp(world) {
    const [org1] = world.orgs;
    const wfDir = path.join(world.configRoot, org1.slug, 'workflows');

    for (const rel of RETIRED_FILES) {
      expect(await readFileSafe(path.join(wfDir, ...rel))).toBeNull();
    }
    // Keepers and the survivor are untouched.
    expect(
      await readFileSafe(
        path.join(wfDir, 'projects', 'tasks', 'run-assigned-task.json'),
      ),
    ).not.toBeNull();
    expect(
      await readFileSafe(
        path.join(
          wfDir,
          'projects',
          'discussions',
          'react-to-discussion-mention.json',
        ),
      ),
    ).not.toBeNull();
    expect(
      await readFileSafe(
        path.join(wfDir, 'projects', 'tasks', 'triage-unassigned-tasks.json'),
      ),
    ).not.toBeNull();

    // The survivor's provisioning rows are never touched by the sweep.
    const survivors = await world.run(async (ctx) => ({
      installations: await ctx.db.query('wfInstallations').collect(),
      provisions: await ctx.db.query('wfDefaultProvisions').collect(),
      events: await ctx.db.query('wfEventSubscriptions').collect(),
    }));
    expect(
      survivors.installations.map(
        (row: Record<string, unknown>) => row.workflowSlug,
      ),
    ).toEqual([SURVIVOR_SLUG]);
    expect(
      survivors.provisions.map(
        (row: Record<string, unknown>) => row.workflowSlug,
      ),
    ).toEqual([SURVIVOR_SLUG]);
    expect(
      survivors.events.map((row: Record<string, unknown>) => row.workflowSlug),
    ).toEqual([SURVIVOR_SLUG]);
  },

  cases: {
    'up purges the retired slugs’ provisioning rows even when seeded': async (
      world,
    ) => {
      const orgId = world.orgs[0].id;
      const retired = 'projects/tasks/send-daily-digest';
      await world.run(async (ctx) => {
        await ctx.db.insert('wfInstallations', {
          organizationId: orgId,
          workflowSlug: retired,
          installedAt: EPOCH,
          installedBy: 'system',
          contentHash: 'testhash-send-daily-digest-v1',
        });
        await ctx.db.insert('wfDefaultProvisions', {
          organizationId: orgId,
          workflowSlug: retired,
          contentHash: 'testhash-send-daily-digest-v1',
          provisionedAt: EPOCH,
        });
        await ctx.db.insert('wfEventSubscriptions', {
          organizationId: orgId,
          workflowSlug: retired,
          eventType: 'task.created',
          isActive: true,
          createdAt: EPOCH,
          createdBy: 'system',
        });
        await ctx.db.insert('wfSchedules', {
          organizationId: orgId,
          workflowSlug: retired,
          cronExpression: '0 6 * * *',
          timezone: 'UTC',
          isActive: true,
          createdAt: EPOCH,
          createdBy: 'system',
        });
      });

      await world.applyUpOnly();

      const rows = await world.run(async (ctx) => ({
        installations: await ctx.db.query('wfInstallations').collect(),
        provisions: await ctx.db.query('wfDefaultProvisions').collect(),
        events: await ctx.db.query('wfEventSubscriptions').collect(),
        schedules: await ctx.db.query('wfSchedules').collect(),
      }));
      const slugsOf = (list: Array<Record<string, unknown>>) =>
        list.map((row) => row.workflowSlug);
      // The retired slug's rows are gone; the survivor's remain.
      expect(slugsOf(rows.installations)).toEqual([SURVIVOR_SLUG]);
      expect(slugsOf(rows.provisions)).toEqual([SURVIVOR_SLUG]);
      expect(slugsOf(rows.events)).toEqual([SURVIVOR_SLUG]);
      expect(rows.schedules).toEqual([]);
    },
  },
});
