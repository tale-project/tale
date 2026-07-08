'use node';

/**
 * Bundle install lifecycle — the aggregated twin of `install_actions.ts`'s
 * single-automation install. A BUNDLE is an ordinary automation.json declaring
 * `bundle.members` (see `automations.ts#automationManifestSchema`); it is never a second
 * install pipeline. `previewBundleInstall`/`installBundle` resolve the
 * member list, assert the bundle's shape (`bundle_validation.ts`), then run
 * the EXISTING single-automation install core (`prepareInstallAs` /
 * `assertOverridesConfirmed` / `ensureOrgResources` / `syncAutomationSchedules`,
 * all exported from `install_actions.ts`) once per member, in the bundle's
 * declared order. Not transactional across members: a member that fails
 * install is reported by slug while its siblings still install — a bundle
 * install is "install everything you can, tell me what didn't" rather than
 * all-or-nothing (there is no cross-member rollback to perform: each
 * member's own install is already atomic-ish via its own ledger).
 */
import { ConvexError, v } from 'convex/values';

import { validateBundleShape } from '../../lib/shared/platform/bundle_validation';
import {
  type AutomationManifest,
  type AutomationScope,
  automationScope,
  type BundleManifest,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import {
  assertOverridesConfirmed,
  ensureOrgResources,
  preflightEntryValidator,
  prepareInstallAs,
  syncAutomationSchedules,
} from './install_actions';
import { readAutomationBundleManifest, readBundleManifest } from './install_fs';
import {
  diffAutomationInstall,
  type PreflightEntry,
  preflightKey,
} from './install_preflight';

interface ResolvedBundle {
  bundle: BundleManifest;
  scope: AutomationScope;
  /** Member slugs, in the manifest's declared install order. */
  members: string[];
  /** Every member's parsed manifest, keyed by slug (validated non-null). */
  memberManifests: Map<string, AutomationManifest>;
}

/**
 * Read the bundle manifest + every member's manifest and assert the bundle's
 * shape (`validateBundleShape`) — the SAME rule set the `builtin_apps.test.ts`
 * gate enforces on the catalog, so a bundle that ships passes here too.
 * Throws `ConvexError({ code: 'INVALID_BUNDLE' })` (naming every violation)
 * before anything is installed.
 */
async function resolveBundle(
  orgSlug: string,
  bundleSlug: string,
): Promise<ResolvedBundle> {
  if (!isValidAutomationSlug(bundleSlug)) {
    throw new Error(`Invalid automation slug: ${bundleSlug}`);
  }
  const bundle = await readBundleManifest(orgSlug, bundleSlug);
  if (!bundle) {
    throw new ConvexError({
      code: 'NOT_A_BUNDLE',
      message: `"${bundleSlug}" is not a bundle (no bundle.json / bundle.members declared).`,
    });
  }

  const members = new Map<string, AutomationManifest | null>();
  for (const memberSlug of bundle.bundle.members) {
    const manifest = await readAutomationBundleManifest(
      orgSlug,
      memberSlug,
    ).catch(() => null);
    members.set(memberSlug, manifest);
  }

  const errors = validateBundleShape(bundleSlug, bundle, members);
  if (errors.length > 0) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Bundle "${bundleSlug}" failed validation: ${errors
        .map((e) => e.message)
        .join('; ')}`,
      errors: errors.map((e) => ({ code: e.code, message: e.message })),
    });
  }

  // Validation passed, so every declared member resolved to a manifest.
  const memberManifests = new Map<string, AutomationManifest>();
  for (const [slug, manifest] of members) {
    if (manifest) memberManifests.set(slug, manifest);
  }

  return {
    bundle,
    scope: automationScope(bundle),
    members: [...bundle.bundle.members],
    memberManifests,
  };
}

/**
 * Preview what installing a bundle would do: one entry per member, each the
 * SAME preflight `diffAutomationInstall` computes for a standalone `installAutomation` —
 * the wizard groups these by member (`ReviewOverridesStep` per `automationSlug`).
 * Also carries each member's display `automationName` and `requiredIntegrations` —
 * a bundle's members are HIDDEN, so they never appear in `listAutomations`/
 * `listCatalogAutomations`; this is the wizard's only pre-install read of them (it
 * feeds the deduped-union `requires.integrations` step and per-member
 * labels). Read-only; gated on the same `developerSettings` capability as
 * `previewAutomationInstall`.
 */
export const previewBundleInstall = action({
  args: { organizationId: v.string(), bundleSlug: v.string() },
  returns: v.array(
    v.object({
      automationSlug: v.string(),
      automationName: v.string(),
      requiredIntegrations: v.array(v.string()),
      entries: v.array(preflightEntryValidator),
      overrides: v.array(v.string()),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      automationSlug: string;
      automationName: string;
      requiredIntegrations: string[];
      entries: PreflightEntry[];
      overrides: string[];
    }>
  > => {
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const { members, memberManifests } = await resolveBundle(
      orgSlug,
      args.bundleSlug,
    );

    const out: Array<{
      automationSlug: string;
      automationName: string;
      requiredIntegrations: string[];
      entries: PreflightEntry[];
      overrides: string[];
    }> = [];
    for (const memberSlug of members) {
      const entries = await diffAutomationInstall(orgSlug, memberSlug);
      const manifest = memberManifests.get(memberSlug);
      out.push({
        automationSlug: memberSlug,
        automationName: manifest?.name ?? memberSlug,
        requiredIntegrations: manifest?.requires?.integrations ?? [],
        entries,
        overrides: entries
          .filter((e) => e.status === 'override')
          .map(preflightKey),
      });
    }
    return out;
  },
});

const memberResultValidator = v.object({
  automationSlug: v.string(),
  ok: v.boolean(),
  workflows: v.optional(v.number()),
  agents: v.optional(v.number()),
  resources: v.optional(v.number()),
  error: v.optional(v.string()),
});

/**
 * Install every member of a bundle through the bundle's ONE aggregated
 * wizard. Asserts the bundle's shape, then reuses the exact single-automation
 * install core (`prepareInstallAs` → `assertOverridesConfirmed` →
 * `ensureOrgResources`, + `syncAutomationSchedules`/bind for a project-scoped
 * bundle) once per member, in declared order.
 *
 * `confirmedOverridesByAutomation` is keyed by member slug — the SAME contract
 * `installAutomation`'s `confirmedOverrides` carries, just namespaced per member so
 * one member's confirmed override never silently confirms another's.
 *
 * NOT transactional across members: a member's failure is caught and
 * reported in its own result row (`ok: false, error`) while the loop
 * continues to the next member — the operator sees exactly which member(s)
 * failed rather than losing every sibling's progress to one bad member.
 */
export const installBundle = action({
  args: {
    organizationId: v.string(),
    bundleSlug: v.string(),
    /** Required for a `scope: 'project'` bundle; rejected for `scope: 'org'`. */
    projectId: v.optional(v.id('projects')),
    /** Member automationSlug -> its confirmed override keys (see `installAutomation`). */
    confirmedOverridesByAutomation: v.optional(
      v.record(v.string(), v.array(v.string())),
    ),
  },
  returns: v.object({
    ok: v.boolean(),
    members: v.array(memberResultValidator),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    members: Array<{
      automationSlug: string;
      ok: boolean;
      workflows?: number;
      agents?: number;
      resources?: number;
      error?: string;
    }>;
  }> => {
    const { orgSlug, userId, email } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const installedBy = email ? email : userId;
    const { scope, members } = await resolveBundle(orgSlug, args.bundleSlug);

    if (scope === 'project') {
      if (!args.projectId) {
        throw new Error(
          `Bundle "${args.bundleSlug}" is project-scoped; a target project is required to install it.`,
        );
      }
    } else if (args.projectId) {
      throw new Error(
        `Bundle "${args.bundleSlug}" is org-scoped and cannot be bound to a project.`,
      );
    }

    const results: Array<{
      automationSlug: string;
      ok: boolean;
      workflows?: number;
      agents?: number;
      resources?: number;
      error?: string;
    }> = [];

    for (const memberSlug of members) {
      try {
        const install = await prepareInstallAs(
          orgSlug,
          memberSlug,
          installedBy,
        );
        await assertOverridesConfirmed(
          orgSlug,
          memberSlug,
          args.confirmedOverridesByAutomation?.[memberSlug],
        );
        const counts = await ensureOrgResources(
          ctx,
          args.organizationId,
          memberSlug,
          install,
        );

        if (scope === 'project' && args.projectId) {
          await ctx.runMutation(
            internal.automations.install_mutations.bindAutomationToProject,
            {
              organizationId: args.organizationId,
              automationSlug: memberSlug,
              projectId: args.projectId,
              boundBy: installedBy,
            },
          );
          await syncAutomationSchedules(
            ctx,
            args.organizationId,
            memberSlug,
            install.manifest,
          );
        }

        results.push({ automationSlug: memberSlug, ok: true, ...counts });
      } catch (err) {
        console.error(
          `[installBundle] member "${memberSlug}" of bundle "${args.bundleSlug}" failed:`,
          err,
        );
        results.push({
          automationSlug: memberSlug,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ok: results.every((r) => r.ok), members: results };
  },
});

/**
 * Uninstall a whole bundle: for each member (reverse install order) drop its
 * project bindings (schedules first, same as "Remove from this project"),
 * then run the full member uninstall. Not transactional across members —
 * mirrors `installBundle`'s "do everything you can, report what didn't"
 * posture. Members with no installation row are skipped, so a partially
 * installed bundle uninstalls cleanly.
 */
export const uninstallBundle = action({
  args: { organizationId: v.string(), bundleSlug: v.string() },
  returns: v.object({
    ok: v.boolean(),
    members: v.array(
      v.object({
        automationSlug: v.string(),
        ok: v.boolean(),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    if (!isValidAutomationSlug(args.bundleSlug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid bundle slug: ${args.bundleSlug}`,
      });
    }
    // Same gate as the per-member uninstall this fans out to.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const bundle = await readBundleManifest(orgSlug, args.bundleSlug);
    if (!bundle) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `"${args.bundleSlug}" is not a bundle`,
      });
    }

    const installedRaw: string[] = await ctx.runQuery(
      internal.automations.install_queries.listInstalledAutomationSlugs,
      { organizationId: args.organizationId },
    );
    const installed = new Set(installedRaw);

    const results: Array<{
      automationSlug: string;
      ok: boolean;
      error?: string;
    }> = [];
    for (const memberSlug of bundle.bundle.members.toReversed()) {
      if (!installed.has(memberSlug)) continue;
      try {
        const bindings = await ctx.runQuery(
          internal.automations.install_queries.listAutomationBindingsInternal,
          {
            organizationId: args.organizationId,
            automationSlug: memberSlug,
          },
        );
        for (const binding of bindings) {
          await ctx.runMutation(
            internal.automations.install_mutations.deleteProjectSchedules,
            {
              organizationId: args.organizationId,
              automationSlug: memberSlug,
              projectId: binding.projectId,
            },
          );
          await ctx.runMutation(
            internal.automations.install_mutations.unbindAutomationFromProject,
            {
              organizationId: args.organizationId,
              automationSlug: memberSlug,
              projectId: binding.projectId,
            },
          );
        }
        await ctx.runAction(
          internal.automations.install_actions.uninstallAutomationInternal,
          {
            organizationId: args.organizationId,
            automationSlug: memberSlug,
          },
        );
        results.push({ automationSlug: memberSlug, ok: true });
      } catch (err) {
        console.error(
          `[uninstallBundle] member "${memberSlug}" of bundle "${args.bundleSlug}" failed:`,
          err,
        );
        results.push({
          automationSlug: memberSlug,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ok: results.every((r) => r.ok), members: results };
  },
});
