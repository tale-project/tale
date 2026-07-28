'use node';

/**
 * Provision the shipped automation packs to EXISTING organizations (new orgs
 * get them from the org-creation hook). A pack directory under the builtin
 * catalog's `automations/` (read by `lib/automations/packs.ts`) seeds one
 * automation into the org-scoped store: version 1 of its workflow document
 * plus the trigger binding its manifest declares — as a DRAFT. Nothing is
 * deployed: live runs stay behind the deploy gate a person clicks.
 *
 * Idempotent — the store's own history is the provision marker: a name with
 * any existing version is never touched again, so an organization's edits,
 * its trigger changes, and its refusal to deploy all win over re-runs (see
 * `automations/mutations.ts:seedDefaultPacks`, the write half).
 *
 * Two entry points (mirrors `provision_default_prompts.ts`):
 *  - `provisionDefaultAutomationsAllOrgs` — registered in
 *    `provisioning.ts:provisionAll`, which the deploy entrypoint executes:
 *    packs reach every existing org on every deploy, no rollout step.
 *  - `provisionDefaultAutomations` — single-org ops tool:
 *    bunx convex run provisioning/provision_default_automations:provisionDefaultAutomations \
 *      '{ "organizationId": "<org-id>", "orgSlug": "<org-slug>" }'
 */

import { v } from 'convex/values';

import {
  loadAutomationPacks,
  type AutomationTrigger,
  type LoadPacksOptions,
} from '../../lib/automations/packs';
import type { Automation } from '../../lib/engine/core/types';
import { isValidOrgSlug } from '../../lib/shared/constants/org-slug';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { resolveBuiltinCatalogRoot } from '../lib/config_store/builtin_catalog';

/** What one pack contributes to the seed batch. */
export interface SeedablePack {
  document: Automation;
  trigger?: AutomationTrigger;
  /** The manifest's `subjects.task` block, when declared. */
  taskContract?: unknown;
  /** The manifest's `settings` block, when declared. */
  settings?: unknown;
  /** The manifest's display half — the name every surface shows. */
  presentation?: unknown;
}

/**
 * The packs a provisioning run may seed: org-scope only (a project-scope pack
 * has no target project at provision time, so it is skipped with a log line
 * rather than guessed at), `hidden` packs excluded, first declared trigger
 * only — the store binds one trigger per automation.
 *
 * `null` means the catalog itself could not be read — a misconfiguration to
 * surface as a failure, unlike an absent catalog root, which degrades to an
 * empty batch the same graceful way the org scaffold treats a not-yet-rebuilt
 * catalog.
 */
export function loadSeedablePacks(
  options: LoadPacksOptions = {},
): SeedablePack[] | null {
  const root = options.root ?? resolveBuiltinCatalogRoot();
  if (root === null) {
    console.warn(
      '[AutomationProvision] no builtin catalog root (TALE_CONFIG_BUILTIN_DIR unset, no repo checkout) — nothing to seed',
    );
    return [];
  }
  let packs;
  try {
    packs = loadAutomationPacks({ root });
  } catch (error) {
    console.error(
      '[AutomationProvision] failed to read the pack catalog',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
  const seedable: SeedablePack[] = [];
  for (const pack of packs) {
    if (pack.manifest.scope === 'project') {
      console.log(
        `[AutomationProvision] pack "${pack.slug}" is project-scoped — not an org default, skipping`,
      );
      continue;
    }
    if (pack.manifest.hidden === true) continue;
    const triggers = pack.manifest.triggers ?? [];
    if (triggers.length > 1) {
      console.warn(
        `[AutomationProvision] pack "${pack.slug}" declares ${triggers.length} triggers — the store binds one per automation, seeding the first`,
      );
    }
    seedable.push({
      document: pack.automation,
      ...(triggers[0] !== undefined && { trigger: triggers[0] }),
      ...(pack.manifest.subjects?.task !== undefined && {
        taskContract: pack.manifest.subjects.task,
      }),
      ...(pack.manifest.settings !== undefined && {
        settings: pack.manifest.settings,
      }),
      presentation: {
        name: pack.manifest.name,
        ...(pack.manifest.description !== undefined && {
          description: pack.manifest.description,
        }),
        ...(pack.manifest.icon !== undefined && { icon: pack.manifest.icon }),
        ...(pack.manifest.labels !== undefined && {
          labels: pack.manifest.labels,
        }),
        ...(pack.manifest.i18n !== undefined && { i18n: pack.manifest.i18n }),
      },
    });
  }
  return seedable;
}

export const provisionDefaultAutomations = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
  },
  returns: v.object({
    provisioned: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: number; skipped: number; failed: number }> => {
    const packs = loadSeedablePacks();
    if (packs === null) return { provisioned: 0, skipped: 0, failed: 1 };
    if (packs.length === 0) return { provisioned: 0, skipped: 0, failed: 0 };
    const result = await ctx.runMutation(
      internal.automations.mutations.seedDefaultPacks,
      { organizationId: args.organizationId, packs },
    );
    if (result.provisioned.length > 0) {
      console.log('[AutomationProvision] seeded', {
        orgSlug: args.orgSlug,
        provisioned: result.provisioned,
        skipped: result.skipped.length,
      });
    }
    return {
      provisioned: result.provisioned.length,
      skipped: result.skipped.length,
      failed: 0,
    };
  },
});

export const provisionDefaultAutomationsAllOrgs = internalAction({
  args: {},
  returns: v.object({
    orgs: v.number(),
    provisioned: v.number(),
    failedOrgs: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ orgs: number; provisioned: number; failedOrgs: number }> => {
    // Enumerate Better Auth organizations (cursor-paginated; same defensive
    // bounds as reseed_all_orgs).
    const orgs: Array<{ id: string; slug: string }> = [];
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    const MAX_PAGES = 1000;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        throw new Error(
          `provisionDefaultAutomationsAllOrgs: pagination did not terminate within ${MAX_PAGES} pages`,
        );
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        throw new Error(
          'provisionDefaultAutomationsAllOrgs: pagination cursor did not advance',
        );
      }
      prevCursor = cursor;
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];
      for (const raw of page) {
        if (!isRecord(raw)) continue;
        const id = getString(raw, '_id') ?? getString(raw, 'id');
        const slug = getString(raw, 'slug');
        if (!id || !slug || !isValidOrgSlug(slug)) continue;
        orgs.push({ id, slug });
      }
      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }

    let provisioned = 0;
    let failedOrgs = 0;
    for (const org of orgs.sort((a, b) => a.slug.localeCompare(b.slug))) {
      try {
        const result = await ctx.runAction(
          internal.provisioning.provision_default_automations
            .provisionDefaultAutomations,
          { organizationId: org.id, orgSlug: org.slug },
        );
        provisioned += result.provisioned;
        if (result.failed > 0) failedOrgs += 1;
      } catch (error) {
        // One broken org must not block the fleet; the next deploy retries.
        failedOrgs += 1;
        console.error('[AutomationProvision] org provisioning failed', {
          orgSlug: org.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[AutomationProvision] all-orgs run', {
      orgs: orgs.length,
      provisioned,
      failedOrgs,
    });
    return { orgs: orgs.length, provisioned, failedOrgs };
  },
});
