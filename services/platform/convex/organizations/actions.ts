'use node';

/**
 * Org provisioning status + repair.
 *
 * `org.create` succeeds first; the filesystem scaffold and the default
 * provisioners run afterwards from `auth.afterCreateOrganization`. When those
 * post-create steps die (node executor down, crash mid-copy), the org exists
 * with a missing/partial `$TALE_CONFIG_DIR/<slug>/` tree and nothing records
 * it. Rather than persisting a status row (schema change + migration), the
 * status is DERIVED by probing the config dir against the builtin catalog
 * (`listMissingScaffoldDomains`) — it can't drift and self-heals the moment
 * the files land.
 *
 * `retryProvisioning` re-runs the full org-create pipeline idempotently:
 * every scaffolded domain in the current current minimal registry (just `governance`)
 * plus the config-cache sync, the prompts provisioner, and starter content.
 * The automations/agents default-install provisioners retired along with
 * their domains (see the `the automation-engine rebuild`/`the chat rebuild` markers below)
 * and will re-provision here once those phases land. It then RE-PROBES: `ok`
 * is earned only when the post-repair probe lists nothing missing — a repair
 * that couldn't land the files must not toast success while the banner
 * persists (#2676). Gated on developer-settings access like the catalog
 * sync, since it (re)writes capability-bearing config files.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireDeveloperSettingsAccessById } from './auth';
import { listMissingScaffoldDomains, scaffoldOrgFromCatalog } from './scaffold';

export const getProvisioningStatus = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    provisioned: v.boolean(),
    missingDomains: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: boolean; missingDomains: string[] }> => {
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const missing = await listMissingScaffoldDomains(orgSlug);
    // `null` = the probe can't run (config env unset). Report provisioned so
    // a misconfigured deploy doesn't show an unrepairable banner on every org.
    if (missing === null) return { provisioned: true, missingDomains: [] };
    return { provisioned: missing.length === 0, missingDomains: missing };
  },
});

export const retryProvisioning = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    failedDomains: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; failedDomains: string[] }> => {
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    // Idempotent fill: `override:false` seeds only domains that are still
    // empty; NO `cleanFirst` — unlike org-create, the org may already carry
    // user-authored config that must survive the repair.
    const result = await scaffoldOrgFromCatalog({
      orgSlug,
      override: false,
      cleanFirst: false,
    });

    // Re-run the same post-scaffold provisioning `afterCreateOrganization`
    // schedules, so restored files become live (config caches for V8 readers,
    // default prompt installs, starter content). All are idempotent; the
    // scaffold ran inline above, so no head-start delay is needed.
    await ctx.scheduler.runAfter(
      0,
      internal.lib.config_cache.sync_org.syncOrgConfigCaches,
      { organizationId: args.organizationId },
    );
    // Default automation installs re-provision here.
    // Locale intentionally omitted: the prompt provisioner resolves the org's
    // `defaultLocale` metadata itself when the arg is absent.
    await ctx.scheduler.runAfter(
      0,
      internal.prompts.provision_defaults.syncDefaultPromptInstallations,
      { organizationId: args.organizationId, orgSlug },
    );
    // Default agent installs re-provision here.
    // Delay kept at 10s (not 0) so this still runs after the agent installs
    // once the chat rebuild re-adds them at delay 0 — seed_starter needs the
    // @mentioned assistant to exist; idempotent regardless (skips when the
    // org already has any project).
    await ctx.scheduler.runAfter(
      10_000,
      internal.provisioning.seed_starter.seedStarterContent,
      { organizationId: args.organizationId },
    );

    // Honesty check: the status is file-derived, so re-derive it. A domain
    // can stay missing even when every per-domain seed reported ok (the copy
    // found nothing it would seed — e.g. a catalog/scaffold disagreement).
    // Reporting ok here would toast success while the banner persists
    // (#2676). `null` (probe can't run: env unset) folds to [] — that same
    // misconfig already made the scaffold return `skipped:true` above.
    const stillMissing = (await listMissingScaffoldDomains(orgSlug)) ?? [];

    const failedDomains = [
      ...new Set([
        ...result.results.filter((r) => !r.ok).map((r) => r.domain),
        ...stillMissing,
      ]),
    ];
    return {
      ok: result.ok && !result.skipped && stillMissing.length === 0,
      failedDomains,
    };
  },
});
