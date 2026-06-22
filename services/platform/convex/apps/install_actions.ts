'use node';

/**
 * App install lifecycle (the Node half). `installApp` COPIES an app's bundle
 * resources from the template catalog into the org config dir and registers its
 * workflows + triggers — composing the same primitives the scaffold and the
 * default-workflow provisioner already use. `uninstallApp` reverses it exactly
 * (by the copied-file ledger). `verifyAppIntegrity` re-checks that the copied
 * files still exist (a user may have deleted one) and flips the install status
 * — the source of the "reinstall" prompt. Secrets are never touched: the GitHub
 * token etc. live in `integrationCredentials`, collected by the readiness wizard.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { appScope, isValidAppSlug } from '../../lib/shared/schemas/apps';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { api, internal } from '../_generated/api';
import { type ActionCtx, action } from '../_generated/server';
import {
  parseAgentJson,
  resolveAgentFilePath,
  validateAgentName,
} from '../agents/file_utils';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sha256 } from '../lib/file_io';
import {
  resolveWorkflowFilePath,
  resolveWorkflowsDir,
  validateWorkflowSlug,
} from '../workflows/file_utils';
import {
  findMissingResources,
  installAppFiles,
  readAppBundleManifest,
  uninstallAppFiles,
} from './install_fs';

/**
 * Register one copied app workflow: install record + its declared schedules.
 *
 * App workflows are deliberately NOT given org-global event subscriptions. An app
 * is an internally-scoped scenario, so its workflow must run only from within the
 * app's own scope (its view actions / its per-workflow webhook) — never off an
 * org-wide `task.*`/`*.*` event that other apps and channels also emit, which
 * would cross-fire this app's workflow on unrelated tasks. (Schedules are
 * time-based and per-workflow, not org-global fan-out, so they remain.) A declared
 * event trigger is therefore a misconfiguration we ignore loudly rather than leak.
 */
async function registerWorkflow(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  workflowSlug: string,
  appSlug: string,
  installedBy: string,
): Promise<void> {
  if (!validateWorkflowSlug(workflowSlug)) return;
  const content = await readFile(
    resolveWorkflowFilePath(orgSlug, workflowSlug),
    'utf-8',
  );
  const parsed = workflowJsonSchema.safeParse(JSON.parse(content));
  if (!parsed.success) return;

  await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
    organizationId,
    workflowSlug,
    installedBy,
    contentHash: sha256(content),
    appSlug,
  });
  const declaredEvents = parsed.data.triggers?.events ?? [];
  if (declaredEvents.length > 0) {
    console.warn(
      `[app-install] ignoring ${declaredEvents.length} org-global event trigger(s) declared by app workflow "${workflowSlug}": app workflows are scoped and must not subscribe to org-global events`,
    );
  }
  for (const schedule of parsed.data.triggers?.schedules ?? []) {
    await ctx.runMutation(
      internal.workflows.provision_defaults_mutations.ensureSchedule,
      {
        organizationId,
        workflowSlug,
        cronExpression: schedule.cron,
        timezone: schedule.timezone,
        variables: schedule.variables,
        isActive: true,
      },
    );
  }
}

/**
 * Register one app agent: an ENABLED install row stamped with the owning app.
 *
 * App agents get NO row from the default-agent provisioner (it walks only the
 * GLOBAL agents tree), so without this an app agent would be REFUSED at run
 * admission in a fully-provisioned org — `isAgentLiveInternal` admits only
 * agents with an enabled row once the org has any install rows. The row's slug
 * is the composite `<app>/<name>` the liveness gate keys on; `appSlug` records
 * the owner (the global app marker + delete/disable guards read it). Never set
 * `bundledBy` — that is the integration-cascade key, orthogonal to app ownership.
 */
async function registerAgent(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  agentSlug: string,
  appSlug: string,
  installedBy: string,
): Promise<void> {
  if (!validateAgentName(agentSlug)) return;
  const content = await readFile(
    resolveAgentFilePath(orgSlug, agentSlug),
    'utf-8',
  );
  try {
    parseAgentJson(content);
  } catch (error) {
    console.warn(
      `[app-install] skipping malformed app agent "${agentSlug}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  await ctx.runMutation(internal.agents.installations.upsertInstallation, {
    organizationId,
    agentSlug,
    installedBy,
    contentHash: sha256(content),
    enabled: true,
    appSlug,
  });
}

export const installApp = action({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    /**
     * Target project for a `scope: 'project'` app — required for those, rejected
     * for org-scoped apps. The install binds to it (one project per install);
     * re-installing with a different project re-binds.
     */
    projectId: v.optional(v.id('projects')),
  },
  returns: v.object({
    ok: v.boolean(),
    workflows: v.number(),
    agents: v.number(),
    resources: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    workflows: number;
    agents: number;
    resources: number;
  }> => {
    const { orgSlug, userId, email } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    if (!isValidAppSlug(args.appSlug)) {
      throw new Error(`Invalid app slug: ${args.appSlug}`);
    }
    // An app slug must not collide with an existing GLOBAL workflow folder of the
    // same name: the workflow resolver prefers the app dir, so a collision would
    // silently shadow those global workflows. Refuse the install instead — this
    // keeps the app-vs-global workflow dispatch unambiguous.
    const globalFolder = path.join(resolveWorkflowsDir(orgSlug), args.appSlug);
    const shadowsGlobal = await stat(globalFolder)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (shadowsGlobal) {
      throw new Error(
        `Cannot install app "${args.appSlug}": a global workflow folder of the same name exists and would be shadowed.`,
      );
    }
    const installedBy = email !== '' ? email : userId;

    // Idempotent on a reinstall: re-copies the latest template files and upserts
    // the install rows. It deliberately never touches `agentEnv` (env/secrets) —
    // reinstalling re-syncs files but keeps an org's per-agent env/secrets. Only
    // `uninstallApp` tears those down.
    const manifest = await readAppBundleManifest(args.appSlug);

    // Resolve install scope from the manifest and validate the target project
    // before copying any files, so a bad scope/project fails fast and clean.
    const scope = appScope(manifest);
    if (scope === 'project') {
      if (!args.projectId) {
        throw new Error(
          `App "${args.appSlug}" is project-scoped; a target project is required to install it.`,
        );
      }
      const project = await ctx.runQuery(api.projects.queries.getProject, {
        projectId: args.projectId,
      });
      if (!project || project.organizationId !== args.organizationId) {
        throw new Error(
          `Cannot install app "${args.appSlug}": target project not found in this organization.`,
        );
      }
    } else if (args.projectId) {
      throw new Error(
        `App "${args.appSlug}" is org-scoped and cannot be bound to a project.`,
      );
    }
    const boundProjectId = scope === 'project' ? args.projectId : undefined;

    const { resources } = await installAppFiles(orgSlug, args.appSlug);

    const workflows = manifest.workflows ?? [];
    for (const slug of workflows) {
      await registerWorkflow(
        ctx,
        args.organizationId,
        orgSlug,
        slug,
        args.appSlug,
        installedBy,
      );
    }

    // App agents (bare names in the manifest) get an enabled, app-stamped
    // install row so they're admitted to run in a fully-provisioned org. The
    // row identity is the composite `<app>/<name>` (the liveness gate keys on it).
    const agents = manifest.agents ?? [];
    for (const name of agents) {
      await registerAgent(
        ctx,
        args.organizationId,
        orgSlug,
        `${args.appSlug}/${name}`,
        args.appSlug,
        installedBy,
      );
    }

    await ctx.runMutation(
      internal.apps.install_mutations.upsertAppInstallation,
      {
        organizationId: args.organizationId,
        appSlug: args.appSlug,
        projectId: boundProjectId,
        appName: manifest.name,
        installedBy,
        status: 'active',
        resources,
        requiredIntegrations: manifest.requires?.integrations ?? [],
      },
    );

    return {
      ok: true,
      workflows: workflows.length,
      agents: agents.length,
      resources: resources.length,
    };
  },
});

export const uninstallApp = action({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    if (!isValidAppSlug(args.appSlug)) {
      throw new Error(`Invalid app slug: ${args.appSlug}`);
    }

    const record = await ctx.runQuery(
      internal.apps.install_mutations.getAppInstallationInternal,
      { organizationId: args.organizationId, appSlug: args.appSlug },
    );
    if (!record) return { ok: true };

    // Deregister workflows (read the manifest to know which; tolerate a missing
    // bundle by falling back to nothing — the file removal still proceeds).
    const manifest = await readAppBundleManifest(args.appSlug).catch(
      () => null,
    );
    for (const slug of manifest?.workflows ?? []) {
      await ctx.runMutation(
        internal.apps.install_mutations.deregisterWorkflow,
        { organizationId: args.organizationId, workflowSlug: slug },
      );
    }

    // Mirror for app agents (composite slug `<app>/<name>`) — drop the manifest
    // agents' install rows + knowledge bindings so they stop being live once the
    // app is gone.
    for (const name of manifest?.agents ?? []) {
      const agentSlug = `${args.appSlug}/${name}`;
      await ctx.runMutation(internal.agents.installations.deleteInstallation, {
        organizationId: args.organizationId,
        agentSlug,
      });
      await ctx.runMutation(internal.agents.mutations.cleanupAgentBinding, {
        organizationId: args.organizationId,
        agentSlug,
      });
    }

    // Env/secrets are the destructive path's whole point: sweep the ENTIRE
    // `<app>/` agent namespace, not just the manifest's current agents. A prior
    // app version may have installed an agent since renamed/removed, whose
    // secrets (keyed by the old composite slug) must not survive uninstall and
    // silently reattach on a later reinstall. (Reinstall keeps env/secrets — it
    // re-runs `installApp`, which never touches `agentEnv`.) Runs even when the
    // bundle manifest is gone, since it keys off the slug namespace, not files.
    await ctx.runMutation(internal.agents.agent_env.deleteAppAgentEnvInternal, {
      organizationId: args.organizationId,
      appSlug: args.appSlug,
    });

    // Same sweep for the app's WORKFLOW env/secrets (keyed by the `<app>/`
    // workflow-slug namespace) — they're deployment-local and must not outlive
    // the uninstall or silently reattach on a later reinstall.
    await ctx.runMutation(
      internal.workflows.workflow_env.deleteAppWorkflowEnvInternal,
      {
        organizationId: args.organizationId,
        appSlug: args.appSlug,
      },
    );

    await uninstallAppFiles(orgSlug, args.appSlug, record.resources);
    await ctx.runMutation(
      internal.apps.install_mutations.deleteAppInstallation,
      {
        organizationId: args.organizationId,
        appSlug: args.appSlug,
      },
    );
    return { ok: true };
  },
});

/**
 * Re-check that an installed app's copied files still exist; flip the status to
 * 'broken' (or back to 'active') accordingly. Drives the "reinstall" prompt —
 * a missing resource is a hard, surfaced error, never a silent fallback.
 */
export const verifyAppIntegrity = action({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.object({
    status: v.union(v.literal('active'), v.literal('broken')),
  }),
  handler: async (ctx, args): Promise<{ status: 'active' | 'broken' }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const record = await ctx.runQuery(
      internal.apps.install_mutations.getAppInstallationInternal,
      { organizationId: args.organizationId, appSlug: args.appSlug },
    );
    if (!record) return { status: 'active' };

    const missing = await findMissingResources(orgSlug, record.resources);
    // Agents/workflows are no longer in the ledger (they live under the app dir,
    // removed by the shell rm) — check their existence from the manifest so a
    // user deleting one still surfaces a 'broken' install + reinstall prompt.
    const manifest = await readAppBundleManifest(args.appSlug).catch(
      () => null,
    );
    let appResourceMissing = false;
    if (manifest) {
      const checks: Array<Promise<boolean>> = [];
      for (const name of manifest.agents ?? []) {
        const slug = `${args.appSlug}/${name}`;
        checks.push(
          stat(resolveAgentFilePath(orgSlug, slug))
            .then(() => false)
            .catch(() => true),
        );
      }
      for (const slug of manifest.workflows ?? []) {
        checks.push(
          stat(resolveWorkflowFilePath(orgSlug, slug))
            .then(() => false)
            .catch(() => true),
        );
      }
      appResourceMissing = (await Promise.all(checks)).some(Boolean);
    }
    const status =
      missing.length > 0 || appResourceMissing ? 'broken' : 'active';
    await ctx.runMutation(internal.apps.install_mutations.setAppInstallStatus, {
      organizationId: args.organizationId,
      appSlug: args.appSlug,
      status,
    });
    return { status };
  },
});
