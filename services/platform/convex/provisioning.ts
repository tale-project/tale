import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * Deploy-time PROVISIONING runner — idempotent re-seeding of the built-in
 * default content (prompt library, task-ops workflow pack) into every org.
 *
 * This is deliberately SEPARATE from data migrations (`migrations.ts:runAll`).
 * Provisioning is not a migration: it has no ledger, no up/down, no schema
 * coupling, and is safe to run on every deploy. New orgs receive this content
 * from the org-creation hook; this all-orgs runner is the forward upgrade path
 * that delivers newly-shipped default packs to orgs that already exist.
 *
 * Every step is idempotent — per-item provision rows make re-runs no-ops, and
 * an org's own edits/opt-outs (uninstalled workflows, deactivated triggers,
 * deleted prompts) are never overridden.
 *
 * Invoked separately from the migration runner by the deploy entrypoint
 * (services/platform/docker-entrypoint.sh) and on demand via `tale migrate`.
 */
export const provisionAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // The out-of-the-box automations (autoInstall manifests: task ops,
    // mention dispatch, OneDrive sync) come PREINSTALLED: provision every
    // existing org. Idempotent — per-automation provision rows make re-runs
    // no-ops, and org opt-outs are never overridden.
    await ctx.runAction(
      internal.provisioning.provision_default_automations
        .provisionDefaultAutomationsAllOrgs,
      {},
    );
    // The default agent roster (metadata.autoInstall) comes PREINSTALLED:
    // create enabled `agentInstallations` rows for every existing org so the
    // roster gate treats them as live. Idempotent — per-agent provision rows
    // make re-runs no-ops; org disables/uninstalls are never overridden.
    await ctx.runAction(
      internal.provisioning.provision_default_agents
        .provisionDefaultAgentsAllOrgs,
      {},
    );
  },
});
