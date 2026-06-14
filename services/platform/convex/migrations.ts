import { Migrations } from '@convex-dev/migrations';

import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction } from './_generated/server';

/**
 * Registry for one-time, run-once data migrations. Define future migrations
 * here with `migrations.define(...)` and run them via `migrations.runner(...)`;
 * the component tracks which have applied so each runs exactly once across
 * deploys. There are none today — the product ships greenfield — but the
 * machinery is kept so future schema changes have a first-class home.
 */
export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * Deploy-time runner: idempotent provisioning that re-seeds the built-in
 * default content into every org. Runs on every deploy
 * (services/platform/docker-entrypoint.sh) and on demand via `tale migrate`.
 *
 * New orgs receive this content from the org-creation hook; this runner is the
 * forward upgrade path that delivers newly-shipped default packs to orgs that
 * already exist. Every step is idempotent — re-runs are safe and never
 * override an org's own edits/opt-outs.
 */
export const runAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // The default task-ops workflow pack comes PREINSTALLED: provision every
    // existing org. Idempotent — per-workflow provision rows make re-runs
    // no-ops, and org opt-outs (uninstalled workflows, deactivated triggers)
    // are never overridden.
    await ctx.runAction(
      internal.migrations.provision_task_ops_pack.provisionTaskOpsPackAllOrgs,
      {},
    );
    // The default prompt-library catalog comes PREINSTALLED: seed every
    // existing org. Idempotent — per-prompt provision rows make re-runs
    // no-ops, and org edits/deletes of a seeded prompt are never overridden.
    await ctx.runAction(
      internal.migrations.provision_default_prompts
        .provisionDefaultPromptsAllOrgs,
      {},
    );
  },
});
