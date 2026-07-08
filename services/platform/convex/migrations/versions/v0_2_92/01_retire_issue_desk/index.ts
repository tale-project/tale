'use node';

/**
 * Node migration: retire the `issue-desk` builtin app, org by org. See
 * {@link meta}.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { internal } from '../../../../_generated/api';
import {
  getConfigRoot,
  sha256,
  validateOrgSlug,
} from '../../../../lib/file_io';
import type {
  NodeMigration,
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import { meta } from './meta';

export const APP_SLUG = 'issue-desk';

/** `<basename>` (no `.json`) of the app's two bundled workflows. */
const WORKFLOW_NAMES = ['desk-process', 'reconcile'] as const;

/** `<basename>` (no `.json`) of the app's two bundled agents. */
const AGENT_NAMES = ['desk-implementer', 'desk-reviewer'] as const;

/**
 * Bookkeeping sidecar written INTO the app directory before it is
 * snapshotted, so restoring the snapshot in `down` also restores the bound
 * project list — there is no other durable place to carry it between a
 * migration's `up` and a much-later `down` (the DB rows it describes are
 * gone by the time `down` runs). Removed from the restored directory once
 * `down` has read it — it was never a real bundle file.
 */
const BINDINGS_SIDECAR = '.migration-v0_2_92-bindings.json';

/** Migration-stamped marker for every row `down` recreates. */
export const RETIRE_MARKER = 'migration:v0_2_92_retire_issue_desk';

interface BoundProject {
  projectId: string;
  name: string;
}

/**
 * The pre-rename layout this migration retires: `<config>/<org>/apps/<slug>`.
 * `resolveAutomationDir` points at the renamed `automations/` domain and must
 * NOT be used here — the legacy `apps/` tree is exactly what `up` snapshots
 * away and `down` restores.
 */
function legacyAppDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('apps'), orgSlug, 'apps', APP_SLUG);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonSafe(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch (err) {
    console.warn(`[${meta.id}] could not read/parse ${filePath}:`, err);
    return null;
  }
}

export const migration: NodeMigration = {
  meta,

  async up(
    ctx: NodeMigrationCtx,
    org: { id: string; slug: string },
    helpers: NodeMigrationHelpers,
  ) {
    const install: unknown = await ctx.runQuery(
      internal.automations.install_mutations.getAutomationInstallationInternal,
      { organizationId: org.id, automationSlug: APP_SLUG },
    );
    if (!install) {
      console.log(
        `[${meta.id}] ${org.slug}: issue-desk not installed, skipping`,
      );
      return;
    }

    const dir = legacyAppDir(org.slug);

    const bindings: Array<{ projectId: string }> = await ctx.runQuery(
      internal.automations.install_mutations.listAutomationBindingsInternal,
      { organizationId: org.id, automationSlug: APP_SLUG },
    );

    const boundProjects: BoundProject[] = [];
    for (const binding of bindings) {
      const projectId = binding.projectId;
      const project: unknown = await ctx.runQuery(
        internal.projects.internal_queries.getProjectForInjection,
        { projectId: binding.projectId },
      );
      const name =
        isRecord(project) && typeof project.name === 'string'
          ? project.name
          : projectId;
      boundProjects.push({ projectId, name });
    }

    // Written BEFORE the snapshot so restoring the snapshot in `down` also
    // restores this bookkeeping — one fs-tree call covers both.
    await helpers.atomicWrite(
      path.join(dir, BINDINGS_SIDECAR),
      JSON.stringify({ boundProjects }),
    );
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

    for (const binding of bindings) {
      await ctx.runMutation(
        internal.automations.install_mutations.deleteProjectSchedules,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          projectId: binding.projectId,
        },
      );
      await ctx.runMutation(
        internal.automations.install_mutations.unbindAutomationFromProject,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          projectId: binding.projectId,
        },
      );
    }

    console.log(
      `[${meta.id}] ${org.slug}: retiring issue-desk (bound projects: ` +
        `${boundProjects.length > 0 ? boundProjects.map((p) => p.name).join(', ') : 'none'})`,
    );

    await ctx.runAction(
      internal.automations.install_actions.uninstallAutomationInternal,
      {
        organizationId: org.id,
        automationSlug: APP_SLUG,
      },
    );
  },

  async down(
    ctx: NodeMigrationCtx,
    org: { id: string; slug: string },
    helpers: NodeMigrationHelpers,
  ) {
    const dir = legacyAppDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);

    const sidecarPath = path.join(dir, BINDINGS_SIDECAR);
    const raw = await helpers.readFileSafe(sidecarPath);
    if (raw === null) {
      // Nothing was snapshotted for this org (it never had issue-desk
      // installed, or a prior `down` already ran) — restoreFsTree already
      // no-op'd; there is nothing further to recreate.
      return;
    }
    await helpers.removeFileSafe(sidecarPath);

    const parsed: unknown = JSON.parse(raw);
    const boundProjects: BoundProject[] =
      isRecord(parsed) && Array.isArray(parsed.boundProjects)
        ? (parsed.boundProjects as BoundProject[])
        : [];

    const manifest =
      (await readJsonSafe(path.join(dir, 'automation.json'))) ??
      (await readJsonSafe(path.join(dir, 'app.json')));
    const appName =
      isRecord(manifest) && typeof manifest.name === 'string'
        ? manifest.name
        : 'Resolve GitHub issues';
    const requiredIntegrations =
      isRecord(manifest) &&
      isRecord(manifest.requires) &&
      Array.isArray(manifest.requires.integrations)
        ? (manifest.requires.integrations as string[])
        : ['github'];

    for (const name of WORKFLOW_NAMES) {
      const filePath = path.join(dir, 'workflows', APP_SLUG, `${name}.json`);
      const content = await readFile(filePath, 'utf-8').catch(() => null);
      if (content === null) continue;
      await ctx.runMutation(
        internal.workflows.installations.upsertInstallation,
        {
          organizationId: org.id,
          workflowSlug: `${APP_SLUG}/${name}`,
          installedBy: RETIRE_MARKER,
          contentHash: sha256(content),
          automationSlug: APP_SLUG,
        },
      );
    }

    for (const name of AGENT_NAMES) {
      const filePath = path.join(dir, 'agents', `${name}.json`);
      const content = await readFile(filePath, 'utf-8').catch(() => null);
      if (content === null) continue;
      await ctx.runMutation(internal.agents.installations.upsertInstallation, {
        organizationId: org.id,
        agentSlug: `${APP_SLUG}/${name}`,
        installedBy: RETIRE_MARKER,
        contentHash: sha256(content),
        enabled: true,
        automationSlug: APP_SLUG,
      });
    }

    await ctx.runMutation(
      internal.automations.install_mutations.upsertAutomationInstallation,
      {
        organizationId: org.id,
        automationSlug: APP_SLUG,
        automationName: appName,
        installedBy: RETIRE_MARKER,
        status: 'active',
        resources: [],
        requiredIntegrations,
      },
    );

    for (const { projectId } of boundProjects) {
      await ctx.runMutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          projectId,
          boundBy: RETIRE_MARKER,
        },
      );
    }

    if (boundProjects.length > 0) {
      const reconcileSchedule = await readJsonSafe(
        path.join(dir, 'workflows', APP_SLUG, 'reconcile.json'),
      );
      const firstSchedule =
        isRecord(reconcileSchedule) &&
        isRecord(reconcileSchedule.triggers) &&
        Array.isArray(reconcileSchedule.triggers.schedules)
          ? reconcileSchedule.triggers.schedules[0]
          : undefined;
      const cronExpression =
        isRecord(firstSchedule) && typeof firstSchedule.cron === 'string'
          ? firstSchedule.cron
          : '*/15 * * * *';
      const timezone =
        isRecord(firstSchedule) && typeof firstSchedule.timezone === 'string'
          ? firstSchedule.timezone
          : 'UTC';

      await ctx.runMutation(
        internal.automations.install_mutations.reconcileAutomationSchedules,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          desired: boundProjects.map(({ projectId }) => ({
            workflowSlug: `${APP_SLUG}/reconcile`,
            cronExpression,
            timezone,
            projectId,
            variables: {},
          })),
        },
      );
    }

    console.log(
      `[${meta.id}] ${org.slug}: restored issue-desk (bound projects: ` +
        `${boundProjects.length > 0 ? boundProjects.map((p) => p.name).join(', ') : 'none'}) — ` +
        'per-schedule operator variables (owner/repo/testCommand/repoNotes) were not restored.',
    );
  },
};
