'use node';

/**
 * Automation install lifecycle (the Node half). `installAutomation` COPIES an automation's bundle
 * resources from the template catalog into the org config dir and registers its
 * workflows + triggers — composing the same primitives the scaffold and the
 * default-workflow provisioner already use. `uninstallAutomation` reverses it exactly
 * (by the copied-file ledger). `verifyAutomationIntegrity` re-checks that the copied
 * files still exist (a user may have deleted one) and flips the install status
 * — the source of the "reinstall" prompt. Secrets are never touched: the GitHub
 * token etc. live in `integrationCredentials`, collected by the readiness wizard.
 */
import { readFile, stat } from 'node:fs/promises';

import { ConvexError, v } from 'convex/values';

import {
  type AutomationManifest,
  automationScope,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { type ActionCtx, action, internalAction } from '../_generated/server';
import {
  parseAgentJson,
  resolveAgentFilePath,
  validateAgentName,
} from '../agents/file_utils';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { sha256 } from '../lib/file_io';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import { serializeWorkflowJson } from '../workflows/file_utils';
import {
  findMissingResources,
  installAutomationFiles,
  readAutomationBundleManifest,
  uninstallAutomationFiles,
} from './install_fs';
import {
  diffAutomationInstall,
  type PreflightEntry,
  preflightKey,
} from './install_preflight';
import { startInputSchemaOf } from './schedule_variables';

/**
 * Register an automation's single INLINE workflow: the install record, plus —
 * for an ORG-scoped automation — its declared event subscriptions.
 *
 * The workflow lives in the automation's `automation.json` `workflow` field —
 * its slug IS the automation slug — so there is no file to read: the parsed
 * manifest already carries it.
 *
 * Event triggers are scope-gated. An org-scoped automation (the task-ops /
 * mention-dispatch packs, inbound-message notify) exists precisely to react to
 * org-wide events, so its declared `triggers.events` are provisioned
 * CREATE-IF-ABSENT — an org's later edit or deactivation always wins, and
 * `processEvent`'s ownership arbitration (`isSubscriptionAllowedForTask`)
 * keeps it off other automations' tasks. A PROJECT-scoped automation is an
 * internally-scoped scenario: its workflow runs from its own surface (view
 * actions, schedules, its per-workflow webhook), never off an org-wide event
 * that would cross-fire it on unrelated projects — a declared event trigger
 * there is a misconfiguration we ignore loudly rather than leak. (Schedules
 * are per-workflow either way — reconciled by `syncAutomationSchedules` once
 * the bindings are known.)
 */
async function registerInlineWorkflow(
  ctx: ActionCtx,
  organizationId: string,
  automationSlug: string,
  workflow: WorkflowJsonConfig,
  installedBy: string,
  scope: 'org' | 'project',
): Promise<void> {
  const content = serializeWorkflowJson(workflow);
  await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
    organizationId,
    workflowSlug: automationSlug,
    installedBy,
    contentHash: sha256(content),
    automationSlug,
  });
  const declaredEvents = workflow.triggers?.events ?? [];
  if (declaredEvents.length === 0) return;
  if (scope === 'project') {
    console.warn(
      `[automation-install] ignoring ${declaredEvents.length} org-global event trigger(s) declared by project-scoped automation "${automationSlug}"'s workflow: project automations must not subscribe to org-global events`,
    );
    return;
  }
  await ctx.runMutation(
    internal.workflows.provision_defaults_mutations
      .provisionDeclaredWorkflowTriggers,
    {
      organizationId,
      workflowSlug: automationSlug,
      events: declaredEvents,
      activate: true,
    },
  );
}

/**
 * Reconcile an automation's workflow schedules to the desired set — scope-aware and
 * idempotent. This is the single source of the automation's schedule state on install,
 * reinstall, and each bind:
 *  - org-scoped automation → one schedule per declared trigger (no projectId);
 *  - project-scoped automation → one schedule per (declared trigger × bound project),
 *    so two projects each get their own independent reconcile run and never
 *    share a single org-wide schedule.
 *
 * `variables` seeds from the inline workflow's OWN declared schedule spec —
 * there is no install-time automation config to fold in any more; an operator-set
 * value (e.g. a GitHub repo) is edited directly on the schedule via the
 * workflow's Triggers tab. One exception: when the workflow's start schema
 * declares a `projectId` input, each per-project schedule seeds
 * `variables.projectId` from its binding — the project the operator already
 * chose at install time must reach `{{input.projectId}}` without being
 * re-typed on the Triggers tab (#2607). Reconcile keeps operator-FILLED values
 * over this seed; only blank placeholders are converged.
 *
 * It hands the fully-computed desired set to `reconcileAutomationSchedules`, which
 * CONVERGES an existing schedule's `variables` to the desired value (so a plain
 * reinstall HEALS a schedule that drifted from the workflow definition) and PRUNES
 * this automation's schedules that are no longer desired (an org-level or
 * unbound-project leftover). Reinstall is therefore the recovery path.
 */
export async function syncAutomationSchedules(
  ctx: ActionCtx,
  organizationId: string,
  automationSlug: string,
  manifest: AutomationManifest,
): Promise<void> {
  const workflow = manifest.workflow;
  if (!workflow) return;
  // The inline workflow's slug collapses to the automation slug.
  const workflowSlug = automationSlug;
  const schedules = workflow.triggers?.schedules ?? [];

  const desired: {
    workflowSlug: string;
    cronExpression: string;
    timezone?: string;
    projectId?: Id<'projects'>;
    variables?: Record<string, unknown>;
  }[] = [];

  if (automationScope(manifest) === 'org') {
    for (const schedule of schedules) {
      desired.push({
        workflowSlug,
        cronExpression: schedule.cron,
        timezone: schedule.timezone,
        variables: schedule.variables,
      });
    }
  } else {
    // Seed `variables.projectId` from the binding only when the workflow's
    // start schema actually declares that input — never invent a variable the
    // workflow doesn't read.
    const startSchema = startInputSchemaOf(workflow);
    const seedsProjectId =
      startSchema !== undefined && 'projectId' in startSchema.properties;
    const bindings = await ctx.runQuery(
      internal.automations.install_mutations.listAutomationBindingsInternal,
      { organizationId, automationSlug },
    );
    for (const binding of bindings) {
      for (const schedule of schedules) {
        desired.push({
          workflowSlug,
          cronExpression: schedule.cron,
          timezone: schedule.timezone,
          projectId: binding.projectId,
          variables: seedsProjectId
            ? { ...schedule.variables, projectId: binding.projectId }
            : schedule.variables,
        });
      }
    }
  }

  await ctx.runMutation(
    internal.automations.install_mutations.reconcileAutomationSchedules,
    {
      organizationId,
      automationSlug,
      desired,
    },
  );
}

/**
 * Register one automation agent: an ENABLED install row stamped with the owning automation.
 *
 * Automation agents get NO row from the default-agent provisioner (it walks only the
 * GLOBAL agents tree), so without this an automation agent would be REFUSED at run
 * admission in a fully-provisioned org — `isAgentLiveInternal` admits only
 * agents with an enabled row once the org has any install rows. The row's slug
 * is the composite `<automation>/<name>` the liveness gate keys on; `automationSlug` records
 * the owner (the global automation marker + delete/disable guards read it). Never set
 * `bundledBy` — that is the integration-cascade key, orthogonal to automation ownership.
 */
async function registerAgent(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  agentSlug: string,
  automationSlug: string,
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
      `[automation-install] skipping malformed automation agent "${agentSlug}": ${
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
    automationSlug,
  });
}

export interface InstallContext {
  orgSlug: string;
  installedBy: string;
  manifest: Awaited<ReturnType<typeof readAutomationBundleManifest>>;
}

/**
 * Auth-free install preamble shared by the public and server-only install
 * paths: slug validation and the manifest read. Throws on any failure so a
 * bad install fails fast before any file is copied. Callers own authorization
 * — `prepareInstall` gates on the `developerSettings` capability;
 * `installAutomationInternal` is reachable only from trusted server code;
 * `installBundle` (`install_bundle_actions.ts`) gates ONCE for the whole
 * bundle, then calls this per member.
 */
export async function prepareInstallAs(
  orgSlug: string,
  automationSlug: string,
  installedBy: string,
): Promise<InstallContext> {
  if (!isValidAutomationSlug(automationSlug)) {
    throw new Error(`Invalid automation slug: ${automationSlug}`);
  }
  const manifest = await readAutomationBundleManifest(orgSlug, automationSlug);
  return { orgSlug, installedBy, manifest };
}

/**
 * Shared install/reinstall preamble: membership + slug validation and the
 * manifest read. Throws on any failure so a bad install fails fast before any
 * file is copied.
 *
 * Exported (with `ensureOrgResources`) for the builtin-sync action, which
 * re-runs the reinstall pipeline for installed automations whose bundle changed.
 */
export async function prepareInstall(
  ctx: ActionCtx,
  organizationId: string,
  automationSlug: string,
): Promise<InstallContext> {
  // Install/reinstall (re)register an automation's agents, workflows and triggers —
  // capability-bearing surfaces that, elsewhere, only `developerSettings` roles
  // may create or edit. A plain `member` is hidden from the install UI by
  // `cannot('read','developerSettings')` but could previously drive this lifecycle
  // directly via the Convex client. Gate it on the same capability.
  const { orgSlug, userId, email } = await requireDeveloperSettingsAccessById(
    ctx,
    organizationId,
  );
  // `requireDeveloperSettingsAccessById` types `email` as optional, so treat an
  // empty OR absent email as "no email" and fall back to the user id.
  return prepareInstallAs(orgSlug, automationSlug, email ? email : userId);
}

/**
 * Copy the automation's bundle files into the org, (re)register its org-singleton
 * agents/workflows, and upsert the ORG-LEVEL install row. Idempotent — safe to
 * re-run on reinstall and on every add-to-project; it deliberately never touches
 * `agentEnv` (env/secrets) or project bindings.
 *
 * DELIBERATELY not override-gated: trusted server callers (versioned data
 * migrations via `installAutomationInternal`, and `builtin_sync`'s automation-domain
 * refresh) run this without the `confirmedOverrides` preflight the public
 * `installAutomation`/`reinstallAutomation` enforce — a migration/sync has no user to
 * confirm. Public actions must gate BEFORE calling this.
 *
 * It reads the EXISTING install row first and threads its `resources` ledger
 * into `installAutomationFiles` — that thread is what carries each fan-out file's
 * `adopted` flag across reinstalls. Dropping it would silently convert every
 * adopted (pre-existing, uninstall-safe) file into an automation-owned one that the
 * next uninstall deletes.
 */
export async function ensureOrgResources(
  ctx: ActionCtx,
  organizationId: string,
  automationSlug: string,
  install: InstallContext,
  /**
   * Skip schedule provisioning. For an automation installed against an
   * integration that is not connected yet (a fresh duplicate's blank
   * credential), a cron created now would fire a doomed run on every tick until
   * an operator fills the login in. The integration's reconnect cascade
   * (`integrations/cascade.ts`) reconciles the schedule the moment it first
   * connects, so skipping here defers the cron rather than dropping it.
   */
  skipSchedules = false,
): Promise<{ workflows: number; agents: number; resources: number }> {
  const { orgSlug, installedBy, manifest } = install;
  const record: {
    resources?: {
      domain: string;
      path: string;
      contentHash: string;
      adopted?: boolean;
    }[];
  } | null = await ctx.runQuery(
    internal.automations.install_mutations.getAutomationInstallationInternal,
    { organizationId, automationSlug },
  );
  const { resources } = await installAutomationFiles(
    orgSlug,
    automationSlug,
    record?.resources,
  );

  // A non-bundle automation owns AT MOST ONE workflow, authored inline in the
  // manifest (slug = automation slug). Register it from the parsed manifest —
  // no file read.
  const workflow = manifest.workflow;
  if (workflow) {
    await registerInlineWorkflow(
      ctx,
      organizationId,
      automationSlug,
      workflow,
      installedBy,
      automationScope(manifest),
    );
  }

  // Automation agents (bare names in the manifest) get an enabled, automation-stamped install
  // row so they're admitted to run in a fully-provisioned org. The row identity
  // is the composite `<automation>/<name>` (the liveness gate keys on it).
  const agents = manifest.agents ?? [];
  for (const name of agents) {
    await registerAgent(
      ctx,
      organizationId,
      orgSlug,
      `${automationSlug}/${name}`,
      automationSlug,
      installedBy,
    );
  }

  await ctx.runMutation(
    internal.automations.install_mutations.upsertAutomationInstallation,
    {
      organizationId,
      automationSlug,
      automationName: manifest.name,
      installedBy,
      status: 'active',
      resources,
      requiredIntegrations: manifest.requires?.integrations ?? [],
    },
  );

  // Provision schedules scope-aware: org-level for an org automation, one-per-bound-
  // project for a project automation (re-seeding each existing binding's schedules on
  // reinstall). A newly added binding's schedules are created by `installAutomation`
  // after the bind, when the binding is visible.
  if (!skipSchedules) {
    await syncAutomationSchedules(
      ctx,
      organizationId,
      automationSlug,
      manifest,
    );
  }

  return {
    workflows: workflow ? 1 : 0,
    agents: agents.length,
    resources: resources.length,
  };
}

// Exported (with `prepareInstallAs`, `assertOverridesConfirmed`,
// `syncAutomationSchedules`, `ensureOrgResources`) so `install_bundle_actions.ts` can
// run the SAME per-member install core `installAutomation` runs for a single automation —
// a bundle is never a second install pipeline, just this one run once per
// declared member.
export const preflightEntryValidator = v.object({
  domain: v.string(),
  path: v.string(),
  kind: v.string(),
  slug: v.optional(v.string()),
  status: v.string(),
});

/**
 * Gate a write-path install/reinstall on override confirmation: recompute the
 * preflight diff (never trust a client-supplied one) and throw
 * `AUTOMATION_INSTALL_OVERRIDES` when any file the install would OVERRIDE isn't in
 * `confirmedOverrides`. A superset of confirmations is fine; a stale set (a
 * file changed since the preview) rejects, so the operator re-reviews. Runs
 * BEFORE any file is written.
 */
export async function assertOverridesConfirmed(
  orgSlug: string,
  automationSlug: string,
  confirmedOverrides: string[] | undefined,
): Promise<void> {
  const entries = await diffAutomationInstall(orgSlug, automationSlug);
  const overrides = entries.filter((e) => e.status === 'override');
  if (overrides.length === 0) return;
  const confirmed = new Set(confirmedOverrides ?? []);
  const unconfirmed = overrides.filter((e) => !confirmed.has(preflightKey(e)));
  if (unconfirmed.length === 0) return;
  throw new ConvexError({
    code: 'AUTOMATION_INSTALL_OVERRIDES',
    message: `Installing "${automationSlug}" would overwrite ${overrides.length} existing file(s); confirm the overrides to proceed.`,
    overrides: overrides.map((e) => preflightKey(e)),
    // Rebuilt as anonymous object literals: ConvexError payloads must be
    // plain `Value`s (interfaces lack the implicit index signature).
    entries: overrides.map((e) => ({
      domain: e.domain,
      path: e.path,
      kind: e.kind,
      slug: e.slug,
      status: e.status,
    })),
  });
}

/**
 * Preview what installing/reinstalling an automation would do to the org's files —
 * one entry per planned file (`create` / `identical` / `override`) plus the
 * override keys the client must pass back as `confirmedOverrides`. Read-only;
 * gated on the same `developerSettings` capability as `installAutomation` (it
 * reveals org-dir file state).
 *
 * `entries` carries every planned file; the returned `overrides` — the keys a
 * client-side review step would ask to confirm — are the `override`-status
 * entries, same as `assertOverridesConfirmed`.
 */
export const previewAutomationInstall = action({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({
    entries: v.array(preflightEntryValidator),
    overrides: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ entries: PreflightEntry[]; overrides: string[] }> => {
    const install = await prepareInstall(
      ctx,
      args.organizationId,
      args.automationSlug,
    );
    const entries = await diffAutomationInstall(
      install.orgSlug,
      args.automationSlug,
    );
    return {
      entries,
      overrides: entries
        .filter((e) => e.status === 'override')
        .map((e) => preflightKey(e)),
    };
  },
});

/**
 * Install an automation, or add an already-installed project-scoped automation to another
 * project. Ensures the org-level resources once (shared across every bound
 * project), then for a `scope: 'project'` automation adds the project binding
 * (idempotent; the project is validated in-transaction by `bindAutomationToProject`).
 */
export const installAutomation = action({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    /**
     * Target project for a `scope: 'project'` automation — required for those, rejected
     * for org-scoped automations. Adds a project binding (idempotent); installing the
     * same automation into another project ADDS a binding rather than re-binding.
     */
    projectId: v.optional(v.id('projects')),
    /**
     * Preflight keys (`domain:path`, from `previewAutomationInstall`) of the existing
     * files the operator confirmed the install may overwrite. Any current
     * override NOT in this list rejects with `AUTOMATION_INSTALL_OVERRIDES` before a
     * single file is written; a superset is fine.
     */
    confirmedOverrides: v.optional(v.array(v.string())),
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
    const install = await prepareInstall(
      ctx,
      args.organizationId,
      args.automationSlug,
    );
    const scope = automationScope(install.manifest);
    if (scope === 'project') {
      if (!args.projectId) {
        throw new Error(
          `Automation "${args.automationSlug}" is project-scoped; a target project is required to install it.`,
        );
      }
    } else if (args.projectId) {
      throw new Error(
        `Automation "${args.automationSlug}" is org-scoped and cannot be bound to a project.`,
      );
    }

    // Recompute the diff server-side and refuse unconfirmed overrides BEFORE
    // any file is written — the preview is advisory, this is the gate.
    await assertOverridesConfirmed(
      install.orgSlug,
      args.automationSlug,
      args.confirmedOverrides,
    );

    const counts = await ensureOrgResources(
      ctx,
      args.organizationId,
      args.automationSlug,
      install,
    );

    if (scope === 'project' && args.projectId) {
      await ctx.runMutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: args.organizationId,
          automationSlug: args.automationSlug,
          projectId: args.projectId,
          boundBy: install.installedBy,
        },
      );
      // The binding now exists; materialize its per-project schedules (this
      // project's own reconcile run). Idempotent on a re-add.
      await syncAutomationSchedules(
        ctx,
        args.organizationId,
        args.automationSlug,
        install.manifest,
      );
    }

    return { ok: true, ...counts };
  },
});

/**
 * Server-only install for trusted callers (versioned data migrations): the
 * same org-level install as `installAutomation` minus the `developerSettings` gate,
 * which needs an authenticated user and so can never pass inside a migration
 * run. Every other guard is kept via the shared `prepareInstallAs` +
 * `ensureOrgResources` core — slug validation, manifest validation, and the
 * idempotent resource upsert. Org-scoped
 * automations only: a project-scoped automation needs a target project (a human decision),
 * so it is refused here. `installedBy` is recorded verbatim on the install
 * row — a migration passes a `migration:<id>` marker so its `down` can target
 * exactly the rows it created.
 *
 * DELIBERATELY not override-gated (no `confirmedOverrides` preflight): a
 * migration run has no user to confirm an overwrite, and it targets orgs it
 * already owns the data model of. Only the public `installAutomation`/`reinstallAutomation`
 * carry the confirmation gate.
 */
export const installAutomationInternal = internalAction({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    installedBy: v.string(),
    /**
     * Install without provisioning the automation's cron triggers. Set by the
     * "Duplicate integration" rebind: the duplicate's credential is blank until
     * an operator fills it in, and a schedule created now would fire a failing
     * run every tick in the meantime. The integration's reconnect cascade
     * provisions it on first successful connect.
     */
    skipSchedules: v.optional(v.boolean()),
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
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const install = await prepareInstallAs(
      orgSlug,
      args.automationSlug,
      args.installedBy,
    );
    if (automationScope(install.manifest) === 'project') {
      throw new Error(
        `Automation "${args.automationSlug}" is project-scoped; installAutomationInternal installs org-scoped automations only.`,
      );
    }
    const counts = await ensureOrgResources(
      ctx,
      args.organizationId,
      args.automationSlug,
      install,
      args.skipSchedules ?? false,
    );
    return { ok: true, ...counts };
  },
});

/**
 * Re-sync an installed automation's org resources from the latest template — the
 * "reinstall" verb. Project-agnostic (never takes or touches a project binding)
 * and non-destructive to env/secrets; only `uninstallAutomation` tears those down.
 */
export const reinstallAutomation = action({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    /** Confirmed override keys — same contract as `installAutomation`. */
    confirmedOverrides: v.optional(v.array(v.string())),
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
    const install = await prepareInstall(
      ctx,
      args.organizationId,
      args.automationSlug,
    );
    // Same override gate as `installAutomation` — recomputed here, before any write.
    await assertOverridesConfirmed(
      install.orgSlug,
      args.automationSlug,
      args.confirmedOverrides,
    );
    const counts = await ensureOrgResources(
      ctx,
      args.organizationId,
      args.automationSlug,
      install,
    );
    return { ok: true, ...counts };
  },
});

/**
 * The uninstall engine shared by the public action and the server-only
 * variant: binding guard + teardown lock, workflow/agent deregistration, the
 * env/secret sweeps, the ledger-driven file removal, and the install-row
 * delete. Callers own authorization — `uninstallAutomation` gates on the
 * `developerSettings` capability; `uninstallAutomationInternal` is reachable only
 * from trusted server code.
 */
async function uninstallAutomationCore(
  ctx: ActionCtx,
  orgSlug: string,
  organizationId: string,
  automationSlug: string,
): Promise<{ ok: boolean }> {
  if (!isValidAutomationSlug(automationSlug)) {
    throw new Error(`Invalid automation slug: ${automationSlug}`);
  }

  const record = await ctx.runQuery(
    internal.automations.install_mutations.getAutomationInstallationInternal,
    { organizationId, automationSlug },
  );
  if (!record) return { ok: true };

  // Guard + lock (I1/I7): refuse with AUTOMATION_HAS_BOUND_PROJECTS (naming the
  // projects) while any project still has the automation — a project still using it
  // must never have its shared resources torn out. At 0 bindings this sets the
  // `uninstalling` lock so a racing add-to-project is refused, and the
  // filesystem teardown below proceeds.
  const begin = await ctx.runMutation(
    internal.automations.install_mutations.beginUninstall,
    { organizationId, automationSlug },
  );
  if (!begin.ok) return { ok: true };

  // Deregister the automation's inline workflow (its slug IS the automation
  // slug; tolerate a missing bundle by falling back to nothing — the file
  // removal still proceeds).
  const manifest = await readAutomationBundleManifest(
    orgSlug,
    automationSlug,
  ).catch(() => null);
  if (manifest?.workflow) {
    await ctx.runMutation(
      internal.automations.install_mutations.deregisterWorkflow,
      {
        organizationId,
        workflowSlug: automationSlug,
      },
    );
  }

  // Mirror for automation agents (composite slug `<automation>/<name>`) — drop the manifest
  // agents' install rows + knowledge bindings so they stop being live once the
  // automation is gone.
  for (const name of manifest?.agents ?? []) {
    const agentSlug = `${automationSlug}/${name}`;
    await ctx.runMutation(internal.agents.installations.deleteInstallation, {
      organizationId,
      agentSlug,
    });
    await ctx.runMutation(internal.agents.mutations.cleanupAgentBinding, {
      organizationId,
      agentSlug,
    });
  }

  // Env/secrets are the destructive path's whole point: sweep the ENTIRE
  // `<automation>/` agent namespace, not just the manifest's current agents. A prior
  // automation version may have installed an agent since renamed/removed, whose
  // secrets (keyed by the old composite slug) must not survive uninstall and
  // silently reattach on a later reinstall. (Reinstall keeps env/secrets — it
  // re-runs `installAutomation`, which never touches `agentEnv`.) Runs even when the
  // bundle manifest is gone, since it keys off the slug namespace, not files.
  await ctx.runMutation(
    internal.agents.agent_env.deleteAutomationAgentEnvInternal,
    {
      organizationId,
      automationSlug,
    },
  );

  // Same sweep for the automation's WORKFLOW env/secrets (keyed by the `<automation>/`
  // workflow-slug namespace) — they're deployment-local and must not outlive
  // the uninstall or silently reattach on a later reinstall.
  await ctx.runMutation(
    internal.workflows.workflow_env.deleteAutomationWorkflowEnvInternal,
    {
      organizationId,
      automationSlug,
    },
  );

  await uninstallAutomationFiles(orgSlug, automationSlug, record.resources);
  await ctx.runMutation(
    internal.automations.install_mutations.deleteAutomationInstallation,
    {
      organizationId,
      automationSlug,
    },
  );
  return { ok: true };
}

export const uninstallAutomation = action({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    // Uninstall is the most destructive automation path: it tears down the automation's
    // agents, their workflows, and ALL of their env/secrets. A member blocked
    // from disabling a single automation-owned agent could otherwise wipe the whole
    // automation by uninstalling it, so this must carry at least the same
    // `developerSettings` gate as the per-agent capability edits it bypasses.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    return uninstallAutomationCore(
      ctx,
      orgSlug,
      args.organizationId,
      args.automationSlug,
    );
  },
});

/**
 * Server-only uninstall for trusted callers (versioned data migrations): the
 * same teardown as `uninstallAutomation` minus the `developerSettings` gate, which
 * needs an authenticated user and so can never pass inside a migration run.
 * Callers must confirm the install row is theirs to remove (e.g. the
 * `installedBy` migration marker) BEFORE invoking — this action performs the
 * full env/secret sweep and file removal for the automation.
 */
export const uninstallAutomationInternal = internalAction({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    return uninstallAutomationCore(
      ctx,
      orgSlug,
      args.organizationId,
      args.automationSlug,
    );
  },
});

/**
 * "Remove from this project" — drop a single project binding. A
 * project-membership action, distinct from `uninstallAutomation`: it deletes ONLY the
 * one binding and never touches the shared org resources (I3). Org-scoped automations
 * have no bindings, so this is a no-op for them.
 */
export const removeAutomationFromProject = action({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    projectId: v.id('projects'),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireOrgMembershipById(ctx, args.organizationId);
    if (!isValidAutomationSlug(args.automationSlug)) {
      throw new Error(`Invalid automation slug: ${args.automationSlug}`);
    }
    // Remove this project's per-project schedules before dropping the binding —
    // a sibling project bound to the same automation keeps its own (keyed by projectId).
    await ctx.runMutation(
      internal.automations.install_mutations.deleteProjectSchedules,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
        projectId: args.projectId,
      },
    );
    await ctx.runMutation(
      internal.automations.install_mutations.unbindAutomationFromProject,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
        projectId: args.projectId,
      },
    );
    return { ok: true };
  },
});

/**
 * Re-check that an installed automation's copied files still exist; flip the status to
 * 'broken' (or back to 'active') accordingly. Drives the "reinstall" prompt —
 * a missing resource is a hard, surfaced error, never a silent fallback.
 */
export const verifyAutomationIntegrity = action({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({
    status: v.union(v.literal('active'), v.literal('broken')),
  }),
  handler: async (ctx, args): Promise<{ status: 'active' | 'broken' }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const record = await ctx.runQuery(
      internal.automations.install_mutations.getAutomationInstallationInternal,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
      },
    );
    if (!record) return { status: 'active' };

    const missing = await findMissingResources(orgSlug, record.resources);
    // Agents are no longer in the ledger (they live under the automation dir,
    // removed by the shell rm) — check their existence from the manifest so a
    // user deleting one still surfaces a 'broken' install + reinstall prompt.
    // The single workflow lives INLINE in `automation.json`, so it has no
    // separate file to go missing — a deleted/corrupt manifest surfaces via the
    // `.catch(() => null)` below (nothing to re-check).
    const manifest = await readAutomationBundleManifest(
      orgSlug,
      args.automationSlug,
    ).catch(() => null);
    let automationResourceMissing = false;
    if (manifest) {
      const checks: Array<Promise<boolean>> = [];
      for (const name of manifest.agents ?? []) {
        const slug = `${args.automationSlug}/${name}`;
        checks.push(
          stat(resolveAgentFilePath(orgSlug, slug))
            .then(() => false)
            .catch(() => true),
        );
      }
      automationResourceMissing = (await Promise.all(checks)).some(Boolean);
    }
    const status =
      missing.length > 0 || automationResourceMissing ? 'broken' : 'active';
    await ctx.runMutation(
      internal.automations.install_mutations.setAutomationInstallStatus,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
        status,
      },
    );
    return { status };
  },
});
