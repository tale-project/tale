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
import { readFile } from 'node:fs/promises';

import { v } from 'convex/values';

import { isValidAppSlug } from '../../lib/shared/schemas/apps';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { type ActionCtx, action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sha256 } from '../lib/file_io';
import {
  resolveWorkflowFilePath,
  validateWorkflowSlug,
} from '../workflows/file_utils';
import {
  findMissingResources,
  installAppFiles,
  readAppBundleManifest,
  uninstallAppFiles,
} from './install_fs';

/** Register one copied workflow: install record + its declared triggers. */
async function registerWorkflow(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  workflowSlug: string,
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
  });
  for (const event of parsed.data.triggers?.events ?? []) {
    await ctx.runMutation(
      internal.workflows.provision_defaults_mutations.ensureEventSubscription,
      {
        organizationId,
        workflowSlug,
        eventType: event.eventType,
        eventFilter: event.eventFilter,
        isActive: true,
      },
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

export const installApp = action({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.object({
    ok: v.boolean(),
    workflows: v.number(),
    resources: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; workflows: number; resources: number }> => {
    const { orgSlug, userId, email } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    if (!isValidAppSlug(args.appSlug)) {
      throw new Error(`Invalid app slug: ${args.appSlug}`);
    }
    const installedBy = email !== '' ? email : userId;

    const manifest = await readAppBundleManifest(args.appSlug);
    const { resources } = await installAppFiles(orgSlug, args.appSlug);

    const workflows = manifest.workflows ?? [];
    for (const slug of workflows) {
      await registerWorkflow(
        ctx,
        args.organizationId,
        orgSlug,
        slug,
        installedBy,
      );
    }

    await ctx.runMutation(
      internal.apps.install_mutations.upsertAppInstallation,
      {
        organizationId: args.organizationId,
        appSlug: args.appSlug,
        installedBy,
        status: 'active',
        resources,
        requiredIntegrations: manifest.requires?.integrations ?? [],
      },
    );

    return {
      ok: true,
      workflows: workflows.length,
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
    const status = missing.length > 0 ? 'broken' : 'active';
    await ctx.runMutation(internal.apps.install_mutations.setAppInstallStatus, {
      organizationId: args.organizationId,
      appSlug: args.appSlug,
      status,
    });
    return { status };
  },
});
