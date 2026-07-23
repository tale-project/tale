'use node';

/**
 * 0.3.4 / 11 — retire the `issue-desk` builtin app, org by org.
 *
 * `issue-desk` left the builtin catalog (`builtin-configs/apps/`), replaced by
 * the "Resolve GitHub issues" bundle (`resolve-github-issues`, four hidden
 * member automations: triage-github-issues, sync-github-issues,
 * create-github-pr, review-github-pr). Uninstall-only by design — this
 * migration does NOT install the new bundle; an admin re-installs it where
 * wanted.
 *
 * Per org that has `issue-desk` installed: snapshots its on-disk app
 * directory (`<org>/apps/issue-desk/` — the manifest, both agents, and both
 * workflows all live there; nothing fans out to a shared domain dir, so one
 * `fs-tree` snapshot covers the whole bundle), records which projects had it
 * bound (a small sidecar JSON written into that same directory before the
 * snapshot, so ONE snapshot call also preserves the binding list), then runs
 * the ordinary uninstall core: unbind every bound project (deleting each
 * project's `issue-desk/reconcile` schedule first, since `uninstallAutomation`
 * refuses while any binding remains), deregister the two workflows and two
 * agents, sweep their env/secrets, delete the copied files, and delete the
 * install row. `down` restores the snapshotted directory, recreates the
 * `wfInstallations` / `agentInstallations` / `appInstallations` rows by
 * re-hashing the restored files (the builtin catalog copy is GONE by design,
 * so the normal reinstall path — which copies FROM the catalog — cannot run
 * any more; this is why the fs-tree snapshot is retained rather than treated
 * as a disposable rollback aid), and rebinds every project the sidecar
 * recorded. Schedule variables an operator had customized (owner/repo/test
 * command/repo notes) are NOT restored by `down` — same as any fresh
 * install/bind, the operator re-enters them once.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { internal } from '../../../../_generated/api';
import { retired } from '../../../../legacy/frozen/retired_refs';
import {
  getConfigRoot,
  sha256,
  validateOrgSlug,
} from '../../../../lib/file_io';
import { defineNodeMigration } from '../../../framework/define';

export const APP_SLUG = 'issue-desk';

/** This migration's stable id, used as the log prefix. */
const MIGRATION_ID = '0.3.4/11_retire_issue_desk';

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
 *
 * Both constants below are FROZEN at the original (pre-re-home) folder name:
 * they persist on disk / in rows on deployments that already ran `up`, and a
 * rename would hide them from `down`.
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
    console.warn(`[${MIGRATION_ID}] could not read/parse ${filePath}:`, err);
    return null;
  }
}

export const migration = defineNodeMigration({
  title: 'Retire the issue-desk builtin app',
  description:
    'For every org with `issue-desk` installed: snapshots its app directory ' +
    '(fs-tree) plus the bound-project list, unbinds every project (deleting ' +
    "each project's issue-desk/reconcile schedule), then runs the ordinary " +
    'uninstall core (deregister workflows/agents, sweep env/secrets, delete ' +
    'files, delete the install row). Does NOT install the replacement ' +
    '"Resolve GitHub issues" bundle — an admin re-installs it. down restores ' +
    'the app directory and re-registers the workflows/agents/install row/' +
    'project bindings from the restored files; per-schedule operator ' +
    'variable overrides are not restored (re-enter them, as with any fresh ' +
    'install).',
  destructive: true,
  snapshot: 'fs-tree',
  formerIds: ['0.2.92/01_retire_issue_desk'],
  subjects: {
    tables: [
      'automationInstallations',
      'automationProjectBindings',
      'projects',
      'wfInstallations',
      'wfSchedules',
      'agentInstallations',
    ],
    domains: ['apps'],
  },

  async up(ctx, org, helpers) {
    const install: unknown = await ctx.runQuery(
      retired.automations.install_mutations.getAutomationInstallationInternal,
      { organizationId: org.id, automationSlug: APP_SLUG },
    );
    if (!install) {
      console.log(
        `[${MIGRATION_ID}] ${org.slug}: issue-desk not installed, skipping`,
      );
      return;
    }

    const dir = legacyAppDir(org.slug);

    const bindings: Array<{ projectId: string }> = await ctx.runQuery(
      retired.automations.install_mutations.listAutomationBindingsInternal,
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
    await helpers.snapshotFsTree(dir);

    for (const binding of bindings) {
      await ctx.runMutation(
        retired.automations.install_mutations.deleteProjectSchedules,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          projectId: binding.projectId,
        },
      );
      await ctx.runMutation(
        retired.automations.install_mutations.unbindAutomationFromProject,
        {
          organizationId: org.id,
          automationSlug: APP_SLUG,
          projectId: binding.projectId,
        },
      );
    }

    console.log(
      `[${MIGRATION_ID}] ${org.slug}: retiring issue-desk (bound projects: ` +
        `${boundProjects.length > 0 ? boundProjects.map((p) => p.name).join(', ') : 'none'})`,
    );

    await ctx.runAction(
      retired.automations.install_actions.uninstallAutomationInternal,
      {
        organizationId: org.id,
        automationSlug: APP_SLUG,
      },
    );
  },

  async down(ctx, org, helpers) {
    const dir = legacyAppDir(org.slug);
    await helpers.restoreFsTree(dir);

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
        retired.workflows.installations.upsertInstallation,
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
      await ctx.runMutation(retired.agents.installations.upsertInstallation, {
        organizationId: org.id,
        agentSlug: `${APP_SLUG}/${name}`,
        installedBy: RETIRE_MARKER,
        contentHash: sha256(content),
        enabled: true,
        automationSlug: APP_SLUG,
      });
    }

    await ctx.runMutation(
      retired.automations.install_mutations.upsertAutomationInstallation,
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
        retired.automations.install_mutations.bindAutomationToProject,
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
        retired.automations.install_mutations.reconcileAutomationSchedules,
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
      `[${MIGRATION_ID}] ${org.slug}: restored issue-desk (bound projects: ` +
        `${boundProjects.length > 0 ? boundProjects.map((p) => p.name).join(', ') : 'none'}) — ` +
        'per-schedule operator variables (owner/repo/testCommand/repoNotes) were not restored.',
    );
  },
});
