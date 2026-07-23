/**
 * Frozen stand-ins for retired runtime modules the historical migrations
 * still invoke via `ctx.runQuery`/`runMutation`/`runAction`.
 *
 * `internal.<module>.<fn>` resolves through `anyApi` (`_generated/api.js`),
 * a runtime proxy that builds a path string regardless of whether the target
 * module still exists on disk — that's why the migrations still typecheck
 * (`api.d.ts` is a stale but harmless snapshot; see its imports of
 * `../agents/installations.js` etc., which `skipLibCheck` never verifies).
 * At RUNTIME, `convex-test` resolves that path against the `modules` map
 * passed to `convexTest(schema, modules)` — built from
 * `import.meta.glob('.../convex/**\/*.*s')` in every test world. Now that
 * `integrations/`, `workflows/`, `agents/`, and `automations/` are retired,
 * that glob can't find them and every world throws
 * `Could not find module for: "<path>"` the moment a historical
 * migration (v0_3_4/02, /06, /11, /41) calls into one.
 *
 * This module is the fix: one map of module-path → stub module, injected
 * into every migration test world's `modules` record by
 * `withRetiredRuntimeStubs` (called from `testing/harness.testkit.ts`'s
 * `makeWorld` and `testing/world/build.testkit.ts`'s `buildSeededWorld` — the
 * two shared choke points every per-migration test, the chain harness, and
 * the version-checkpoint walk build their world through). No individual
 * `migration.test.ts` needs to know this module exists.
 *
 * Each stub is registered with the SAME `internalQuery`/`internalMutation`/
 * `internalAction` builders a real module would use, and freezes the
 * ORIGINAL retired implementation's observable behaviour for exactly the
 * historical call sites still reaching it (never evolved; deleted when
 * pre-rewrite upgrade support ends — same lifetime rule as
 * `convex/legacy/**`). Where the original pulled in another retired helper
 * module (`automations/automation_workflow_slugs.ts`,
 * `automations/schedule_variables.ts`, `workflows/file_utils.ts`'s
 * `workflowSlugFromRelativePath`), that helper's logic is inlined here
 * (named at each site) rather than imported — retired code is never
 * imported by live code, checked or not.
 *
 * `automations/install_actions`'s two actions are the one deliberate
 * DEPARTURE from "freeze the original": the real
 * `installAutomationInternal`/`uninstallAutomationInternal` are catalog- and
 * filesystem-bound (they copy bundle files from `TALE_CONFIG_BUILTIN_DIR`,
 * parse agent files, sweep env/secrets tables that are themselves retired).
 * `v0_3_4/02_install_email_apps/migration.test.ts` already established the
 * precedent (before the ripout) of `vi.mock`-replacing exactly these two
 * actions with row-effect equivalents — upsert/delete the install row via
 * the real mutations, nothing else — while running every other step (org
 * fleet loop, credential read, the already-installed guard, the marker) for
 * real. This module promotes that same row-effect double to the shared
 * layer so `v0_3_4/11_retire_issue_desk` (which also calls
 * `uninstallAutomationInternal`) gets equivalent, contract-matching
 * behaviour: the install row is removed; workflow/agent registration rows
 * and copied files are untouched (matching production: with no catalog on
 * disk for the retired bundle, the real engine's manifest read fails first
 * and skips exactly those steps too).
 *
 * Two-dot basename keeps this out of the Convex push bundle — verified by
 * `testing/testkit.test.ts`'s isolate-closure guard, which walks every
 * bundled entry's REAL import graph and fails if a two-dot file is ever
 * reached from one; this module is reachable only from other test/testkit
 * files, never from a bundled `.ts` entry.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../../_generated/server';
import { retired } from '../../legacy/frozen/retired_refs';
import { workflowJsonSchema } from '../../legacy/frozen/schemas_workflows';
import { resolveWorkflowsDir } from '../../legacy/frozen/workflows_file_utils';
import { readFileSafe, sha256 } from '../../lib/file_io';
import { jsonRecordValidator } from '../../lib/validators/json';

// -----------------------------------------------------------------------------
// integrations/credential_queries (retired module)
// Called by: v0_3_4/02_install_email_apps (up: `listInternal`).
// -----------------------------------------------------------------------------

const credentialQueriesListInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const credentials: Array<Record<string, unknown>> = [];
    // The original read `by_organizationId`. That index belonged to the
    // retired table shape; `integrationCredentials` now keys on `by_org` /
    // `by_org_connector`, and the live backend serves no index a table no
    // longer declares — so this replays the same read as a filtered scan
    // (the corpus holds a handful of rows). Observable behaviour, which is
    // what a frozen stub owes its callers, is unchanged.
    for await (const cred of ctx.db.query('integrationCredentials')) {
      if (cred.organizationId === args.organizationId) credentials.push(cred);
    }
    return credentials;
  },
});

// -----------------------------------------------------------------------------
// workflows/provision_defaults_mutations (retired module)
// Called by: v0_3_4/06_remove_retired_task_workflows (up: directly;
// down: transitively via `provision_defaults.syncDefaultWorkflowInstallations`
// below, which also calls `getProvision`/`provisionDeclaredWorkflowTriggers`/
// `recordProvision`).
// -----------------------------------------------------------------------------

const pdmGetProvision = internalQuery({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.union(v.null(), v.object({ contentHash: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('wfDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    return row ? { contentHash: row.contentHash } : null;
  },
});

const pdmRecordProvision = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    contentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('wfDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contentHash: args.contentHash,
        provisionedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.insert('wfDefaultProvisions', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      contentHash: args.contentHash,
      provisionedAt: Date.now(),
    });
    return null;
  },
});

const declaredEventValidator = v.object({
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
});

const declaredScheduleValidator = v.object({
  cron: v.string(),
  timezone: v.optional(v.string()),
  variables: v.optional(jsonRecordValidator),
});

const pdmProvisionDeclaredWorkflowTriggers = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    events: v.optional(v.array(declaredEventValidator)),
    schedules: v.optional(v.array(declaredScheduleValidator)),
    activate: v.optional(v.boolean()),
  },
  returns: v.object({
    eventsCreated: v.number(),
    schedulesCreated: v.number(),
    activated: v.object({ events: v.number(), schedules: v.number() }),
  }),
  handler: async (ctx, args) => {
    let eventsCreated = 0;
    let schedulesCreated = 0;

    for (const event of args.events ?? []) {
      let exists = false;
      for await (const sub of ctx.db
        .query('wfEventSubscriptions')
        .withIndex('by_org_eventType', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('eventType', event.eventType),
        )) {
        if (sub.workflowSlug === args.workflowSlug) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      await ctx.db.insert('wfEventSubscriptions', {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        eventType: event.eventType,
        eventFilter: event.eventFilter,
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system',
      });
      eventsCreated += 1;
    }

    for (const schedule of args.schedules ?? []) {
      let exists = false;
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) =>
          q.eq('workflowSlug', args.workflowSlug),
        )) {
        if (
          sched.organizationId === args.organizationId &&
          sched.cronExpression === schedule.cron &&
          sched.projectId === undefined
        ) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      await ctx.db.insert('wfSchedules', {
        organizationId: args.organizationId,
        workflowSlug: args.workflowSlug,
        cronExpression: schedule.cron,
        timezone: schedule.timezone ?? 'UTC',
        variables: schedule.variables,
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system',
      });
      schedulesCreated += 1;
    }

    let activated = { events: 0, schedules: 0 };
    if (args.activate) {
      let events = 0;
      let schedules = 0;
      for await (const sub of ctx.db
        .query('wfEventSubscriptions')
        .withIndex('by_org', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        if (sub.workflowSlug !== args.workflowSlug) continue;
        if (!sub.isActive) {
          await ctx.db.patch(sub._id, { isActive: true });
          events += 1;
        }
      }
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_org', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        if (sched.workflowSlug !== args.workflowSlug) continue;
        if (!sched.isActive) {
          await ctx.db.patch(sched._id, { isActive: true });
          schedules += 1;
        }
      }
      activated = { events, schedules };
    }

    return { eventsCreated, schedulesCreated, activated };
  },
});

const pdmRemoveDefaultProvisioning = internalMutation({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.object({
    events: v.number(),
    schedules: v.number(),
    installations: v.number(),
    provisions: v.number(),
  }),
  handler: async (ctx, args) => {
    let events = 0;
    let schedules = 0;
    let installations = 0;
    let provisions = 0;
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (sub.workflowSlug !== args.workflowSlug) continue;
      await ctx.db.delete(sub._id);
      events += 1;
    }
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sched.organizationId !== args.organizationId) continue;
      await ctx.db.delete(sched._id);
      schedules += 1;
    }
    const installation = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (installation) {
      await ctx.db.delete(installation._id);
      installations += 1;
    }
    const provision = await ctx.db
      .query('wfDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (provision) {
      await ctx.db.delete(provision._id);
      provisions += 1;
    }
    return { events, schedules, installations, provisions };
  },
});

// -----------------------------------------------------------------------------
// workflows/provision_defaults (retired module)
// Called by: v0_3_4/06_remove_retired_task_workflows (down:
// `syncDefaultWorkflowInstallations`).
//
// The original enumerated the org's workflows dir via
// `listCatalogArea('workflows', orgSlug, {recursive:true})`
// (`lib/config_store/catalog.ts`), which resolves the domain dir through
// `lib/config_store/resolvers.ts`'s `DOMAIN_DIR_RESOLVERS`. That registry is
// now Phase-0-minimal (`governance`/`sso`/`prompts` only — see the file's own
// header) and throws `No directory resolver registered for config domain:
// workflows` for ANY org, live or test. `listOrgWorkflowFiles` below
// reproduces `listCatalogArea`'s exact file-walk (skip dotfiles/`.secrets.
// json`, `.json`-only) directly against `resolveWorkflowsDir` (the frozen
// legacy path helper `v0_3_4/06`'s own migration.ts already uses), sidestepping
// the live domain registry entirely rather than editing it back in — editing
// `resolvers.ts` would resurrect production automations/workflows scaffolding
// support, which is out of this replay's scope.
//
// Simplification from the original: the retired action self-retried via
// `ctx.scheduler.runAfter` when the workflows dir didn't exist yet (the org
// scaffold still copying the catalog). Every migration-test world either
// seeds the workflows dir up front or accepts the resulting no-op (see
// `world/manifest.testkit.ts`'s `baselineDomains` comment on `workflows/`), so
// there is nothing to retry here — a missing dir just returns zero counts.
// -----------------------------------------------------------------------------

/** Frozen from the retired `workflows/file_utils.ts`. */
const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)*$/;

function validateWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug) && slug.length <= 128;
}

/** Frozen from the retired `workflows/file_utils.ts`. */
function workflowSlugFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.json$/, '').replace(/\\/g, '/');
}

/** Reproduces `lib/config_store/catalog.ts`'s `listCatalogArea` file-walk,
 *  scoped directly to the org's workflows dir (see the section header). */
async function listOrgWorkflowFiles(
  orgSlug: string,
): Promise<Array<{ relativePath: string; content: string }>> {
  const dir = resolveWorkflowsDir(orgSlug);
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  const files: Array<{ relativePath: string; content: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.secrets.json')) continue;
    const parentPath = entry.parentPath ?? dir;
    const relativePath = path
      .relative(dir, path.join(parentPath, entry.name))
      .split(path.sep)
      .join('/');
    if (relativePath.split('/').some((segment) => segment.startsWith('.'))) {
      continue;
    }
    const content = await readFileSafe(path.join(parentPath, entry.name));
    if (content === null) continue;
    files.push({ relativePath, content });
  }
  return files;
}

const wfProvisionDefaultsSyncDefaultWorkflowInstallations = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    attempt: v.optional(v.number()),
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
    let files: Array<{ relativePath: string; content: string }>;
    try {
      files = await listOrgWorkflowFiles(args.orgSlug);
    } catch {
      console.warn(
        '[retired_runtime] workflows/provision_defaults: workflows dir missing',
        { orgSlug: args.orgSlug },
      );
      return { provisioned: 0, skipped: 0, failed: 0 };
    }

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const { relativePath, content } of files) {
      const workflowSlug = workflowSlugFromRelativePath(relativePath);
      if (!workflowSlug || !validateWorkflowSlug(workflowSlug)) continue;

      try {
        const parsed = workflowJsonSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          console.warn(
            '[retired_runtime] workflows/provision_defaults: invalid workflow JSON; skipping',
            { workflowSlug },
          );
          failed += 1;
          continue;
        }
        const workflow = parsed.data;
        if (workflow.metadata?.autoInstall !== true) continue;

        const existing = await ctx.runQuery(
          retired.workflows.provision_defaults_mutations.getProvision,
          { organizationId: args.organizationId, workflowSlug },
        );
        if (existing) {
          skipped += 1;
          continue;
        }

        const contentHash = sha256(content);
        await ctx.runMutation(
          retired.workflows.installations.upsertInstallation,
          {
            organizationId: args.organizationId,
            workflowSlug,
            installedBy: 'system',
            contentHash,
          },
        );
        await ctx.runMutation(
          retired.workflows.provision_defaults_mutations
            .provisionDeclaredWorkflowTriggers,
          {
            organizationId: args.organizationId,
            workflowSlug,
            events: workflow.triggers?.events,
            schedules: workflow.triggers?.schedules,
            activate: true,
          },
        );
        await ctx.runMutation(
          retired.workflows.provision_defaults_mutations.recordProvision,
          { organizationId: args.organizationId, workflowSlug, contentHash },
        );
        provisioned += 1;
      } catch (error) {
        failed += 1;
        console.error(
          '[retired_runtime] workflows/provision_defaults: failed for workflow',
          {
            workflowSlug,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return { provisioned, skipped, failed };
  },
});

// -----------------------------------------------------------------------------
// workflows/installations (retired module)
// Called by: v0_3_4/41_create_pack_automation_installs (up:
// `getInstallationInternal`); v0_3_4/11_retire_issue_desk (down:
// `upsertInstallation`); v0_3_4/06 (down, transitively, via
// `provision_defaults` above).
// -----------------------------------------------------------------------------

const wfInstallationsGetInstallationInternal = internalQuery({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.union(
    v.object({
      _id: v.id('wfInstallations'),
      _creationTime: v.number(),
      organizationId: v.string(),
      workflowSlug: v.string(),
      installedAt: v.number(),
      installedBy: v.string(),
      contentHash: v.string(),
      automationSlug: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
  },
});

async function wfInstallationsUpsertImpl(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    workflowSlug: string;
    installedBy: string;
    contentHash: string;
    automationSlug?: string;
  },
) {
  const existing = await ctx.db
    .query('wfInstallations')
    .withIndex('by_org_slug', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('workflowSlug', args.workflowSlug),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      installedAt: Date.now(),
      installedBy: args.installedBy,
      contentHash: args.contentHash,
      ...(args.automationSlug !== undefined
        ? { automationSlug: args.automationSlug }
        : {}),
    });
    return existing._id;
  }
  return await ctx.db.insert('wfInstallations', {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    installedAt: Date.now(),
    installedBy: args.installedBy,
    contentHash: args.contentHash,
    ...(args.automationSlug !== undefined
      ? { automationSlug: args.automationSlug }
      : {}),
  });
}

const wfInstallationsUpsertInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    installedBy: v.string(),
    contentHash: v.string(),
    automationSlug: v.optional(v.string()),
  },
  returns: v.id('wfInstallations'),
  handler: async (ctx, args) => wfInstallationsUpsertImpl(ctx, args),
});

// -----------------------------------------------------------------------------
// agents/installations (retired module)
// Called by: v0_3_4/11_retire_issue_desk (down: `upsertInstallation`).
// -----------------------------------------------------------------------------

function findAgentInstallation(
  ctx: QueryCtx,
  organizationId: string,
  agentSlug: string,
) {
  return ctx.db
    .query('agentInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('agentSlug', agentSlug),
    )
    .first();
}

const agentsInstallationsUpsertInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    installedBy: v.string(),
    contentHash: v.string(),
    enabled: v.optional(v.boolean()),
    bundledBy: v.optional(v.string()),
    automationSlug: v.optional(v.string()),
  },
  returns: v.id('agentInstallations'),
  handler: async (ctx, args) => {
    const existing = await findAgentInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
    if (existing) {
      await ctx.db.patch(existing._id, {
        installedAt: Date.now(),
        installedBy: args.installedBy,
        contentHash: args.contentHash,
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.bundledBy !== undefined ? { bundledBy: args.bundledBy } : {}),
        ...(args.automationSlug !== undefined
          ? { automationSlug: args.automationSlug }
          : {}),
      });
      return existing._id;
    }
    return await ctx.db.insert('agentInstallations', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      installedAt: Date.now(),
      installedBy: args.installedBy,
      contentHash: args.contentHash,
      enabled: args.enabled ?? true,
      ...(args.bundledBy !== undefined ? { bundledBy: args.bundledBy } : {}),
      ...(args.automationSlug !== undefined
        ? { automationSlug: args.automationSlug }
        : {}),
    });
  },
});

// -----------------------------------------------------------------------------
// automations/install_mutations (retired module)
// Called by: v0_3_4/11_retire_issue_desk (up: `getAutomationInstallationInternal`,
// `listAutomationBindingsInternal`, `deleteProjectSchedules`,
// `unbindAutomationFromProject`; down: `upsertAutomationInstallation`,
// `bindAutomationToProject`, `reconcileAutomationSchedules`);
// v0_3_4/41_create_pack_automation_installs (up:
// `getAutomationInstallationInternal`, `upsertAutomationInstallation`; down:
// `getAutomationInstallationInternal`, `deleteAutomationInstallation`);
// v0_3_4/02_install_email_apps (up/down, transitively, via
// `automations/install_actions`'s row-effect stub below).
// -----------------------------------------------------------------------------

/** Frozen from the retired `automations/automation_workflow_slugs.ts`. */
async function automationWorkflowSlugs(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  automationSlug: string,
): Promise<string[]> {
  const slugs: string[] = [];
  for await (const row of ctx.db
    .query('wfInstallations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))) {
    if (row.automationSlug === automationSlug) slugs.push(row.workflowSlug);
  }
  return slugs;
}

/** Frozen from the retired `automations/schedule_variables.ts`. */
function isUnconfiguredScheduleValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Frozen from the retired `automations/schedule_variables.ts`. */
function mergeScheduleVariables(
  defaults: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(existing ?? {})) {
    const fallback = merged[key];
    if (
      isUnconfiguredScheduleValue(value) &&
      !isUnconfiguredScheduleValue(fallback)
    ) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

const installMutGetAutomationInstallationInternal = internalQuery({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .first();
  },
});

const installMutListAutomationBindingsInternal = internalQuery({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.array(v.object({ projectId: v.id('projects') })),
  handler: async (ctx, args) => {
    const out: Array<{
      projectId: Doc<'automationProjectBindings'>['projectId'];
    }> = [];
    for await (const b of ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )) {
      out.push({ projectId: b.projectId });
    }
    return out;
  },
});

const installMutUpsertAutomationInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    automationName: v.optional(v.string()),
    installedBy: v.string(),
    status: v.union(v.literal('active'), v.literal('broken')),
    resources: v.array(
      v.object({
        domain: v.string(),
        path: v.string(),
        contentHash: v.string(),
        adopted: v.optional(v.boolean()),
      }),
    ),
    requiredIntegrations: v.array(v.string()),
    installedAt: v.optional(v.number()),
  },
  returns: v.id('automationInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .first();
    const fields = {
      automationName: args.automationName,
      installedAt: args.installedAt ?? Date.now(),
      installedBy: args.installedBy,
      status: args.status,
      resources: args.resources,
      requiredIntegrations: args.requiredIntegrations,
      uninstalling: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert('automationInstallations', {
      organizationId: args.organizationId,
      automationSlug: args.automationSlug,
      ...fields,
    });
  },
});

const installMutBindAutomationToProject = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    projectId: v.id('projects'),
    boundBy: v.string(),
  },
  returns: v.id('automationProjectBindings'),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) {
      throw new Error(
        `Cannot bind automation "${args.automationSlug}": target project not found in this organization.`,
      );
    }
    const org = await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .first();
    if (!org) {
      throw new Error(
        `Cannot bind automation "${args.automationSlug}": it is not installed in this organization.`,
      );
    }
    if (org.uninstalling === true) {
      throw new Error(
        `Cannot bind automation "${args.automationSlug}": it is being uninstalled.`,
      );
    }
    const existing = await ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug)
          .eq('projectId', args.projectId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert('automationProjectBindings', {
      organizationId: args.organizationId,
      automationSlug: args.automationSlug,
      projectId: args.projectId,
      boundAt: Date.now(),
      boundBy: args.boundBy,
    });
  },
});

const installMutUnbindAutomationFromProject = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    projectId: v.id('projects'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug)
          .eq('projectId', args.projectId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

const installMutDeleteAutomationInstallation = internalMutation({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

const installMutDeleteProjectSchedules = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    projectId: v.id('projects'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const workflowSlugs = await automationWorkflowSlugs(
      ctx,
      args.organizationId,
      args.automationSlug,
    );
    for (const workflowSlug of workflowSlugs) {
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) =>
          q.eq('workflowSlug', workflowSlug),
        )) {
        if (
          sched.organizationId === args.organizationId &&
          sched.projectId === args.projectId
        ) {
          await ctx.db.delete(sched._id);
        }
      }
    }
    return null;
  },
});

const desiredScheduleValidator = v.object({
  workflowSlug: v.string(),
  cronExpression: v.string(),
  timezone: v.optional(v.string()),
  projectId: v.optional(v.id('projects')),
  variables: v.optional(jsonRecordValidator),
});

const installMutReconcileAutomationSchedules = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    desired: v.array(desiredScheduleValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    pruned: v.number(),
  }),
  handler: async (ctx, args) => {
    const keyOf = (
      workflowSlug: string,
      cronExpression: string,
      projectId: string | undefined,
    ): string => `${workflowSlug}\x00${cronExpression}\x00${projectId ?? ''}`;

    const desiredByKey = new Map(
      args.desired.map((d) => [
        keyOf(d.workflowSlug, d.cronExpression, d.projectId),
        d,
      ]),
    );
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    let pruned = 0;

    const slugs = await automationWorkflowSlugs(
      ctx,
      args.organizationId,
      args.automationSlug,
    );
    for (const workflowSlug of slugs) {
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) =>
          q.eq('workflowSlug', workflowSlug),
        )) {
        if (sched.organizationId !== args.organizationId) continue;
        const key = keyOf(workflowSlug, sched.cronExpression, sched.projectId);
        const want = desiredByKey.get(key);
        if (want && !seen.has(key)) {
          seen.add(key);
          await ctx.db.patch(sched._id, {
            variables: mergeScheduleVariables(want.variables, sched.variables),
            timezone: sched.timezone ?? want.timezone ?? 'UTC',
          });
          updated++;
        } else {
          await ctx.db.delete(sched._id);
          pruned++;
        }
      }
    }

    for (const [key, d] of desiredByKey) {
      if (seen.has(key)) continue;
      await ctx.db.insert('wfSchedules', {
        organizationId: args.organizationId,
        projectId: d.projectId,
        workflowSlug: d.workflowSlug,
        cronExpression: d.cronExpression,
        timezone: d.timezone ?? 'UTC',
        variables: d.variables,
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'system',
      });
      created++;
    }

    return { created, updated, pruned };
  },
});

// -----------------------------------------------------------------------------
// automations/install_actions (retired module), SIMPLIFIED —
// see the module header's "deliberate departure" note.
// Called by: v0_3_4/02_install_email_apps (up: `installAutomationInternal`;
// down: `uninstallAutomationInternal`); v0_3_4/11_retire_issue_desk (up:
// `uninstallAutomationInternal`).
// -----------------------------------------------------------------------------

/** Test-only failure injection for `installAutomationInternal`, mirroring
 *  the retired `v0_3_4/02_install_email_apps/migration.test.ts`'s
 *  `mockControl.failInstalls` (a catalog-missing simulation). Callers MUST
 *  restore this to empty in a `finally` block — it is shared, process-wide
 *  mutable state across every test file that imports this module. */
export const retiredAutomationInstallControl: {
  failInstallSlugs: Set<string>;
} = {
  failInstallSlugs: new Set<string>(),
};

const installActionsInstallAutomationInternal = internalAction({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    installedBy: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    workflows: v.number(),
    agents: v.number(),
    resources: v.number(),
  }),
  handler: async (ctx, args) => {
    if (
      retiredAutomationInstallControl.failInstallSlugs.has(args.automationSlug)
    ) {
      throw new Error(
        `Automation "${args.automationSlug}" not found in the catalog`,
      );
    }
    await ctx.runMutation(
      retired.automations.install_mutations.upsertAutomationInstallation,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
        automationName: args.automationSlug,
        installedBy: args.installedBy,
        status: 'active',
        resources: [],
        requiredIntegrations: [],
      },
    );
    return { ok: true, workflows: 0, agents: 0, resources: 0 };
  },
});

const installActionsUninstallAutomationInternal = internalAction({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      retired.automations.install_mutations.deleteAutomationInstallation,
      {
        organizationId: args.organizationId,
        automationSlug: args.automationSlug,
      },
    );
    return { ok: true };
  },
});

// -----------------------------------------------------------------------------
// The module map every migration test world injects. Keys are the exact
// `internal.<key>` path convex-test resolves against; values load an object
// exposing exactly the named exports the historical callers invoke.
// -----------------------------------------------------------------------------

export const RETIRED_RUNTIME_MODULES: Record<string, () => Promise<unknown>> = {
  'integrations/credential_queries': () =>
    Promise.resolve({ listInternal: credentialQueriesListInternal }),
  'workflows/provision_defaults_mutations': () =>
    Promise.resolve({
      getProvision: pdmGetProvision,
      recordProvision: pdmRecordProvision,
      provisionDeclaredWorkflowTriggers: pdmProvisionDeclaredWorkflowTriggers,
      removeDefaultProvisioning: pdmRemoveDefaultProvisioning,
    }),
  'workflows/provision_defaults': () =>
    Promise.resolve({
      syncDefaultWorkflowInstallations:
        wfProvisionDefaultsSyncDefaultWorkflowInstallations,
    }),
  'workflows/installations': () =>
    Promise.resolve({
      getInstallationInternal: wfInstallationsGetInstallationInternal,
      upsertInstallation: wfInstallationsUpsertInstallation,
    }),
  'agents/installations': () =>
    Promise.resolve({
      upsertInstallation: agentsInstallationsUpsertInstallation,
    }),
  'automations/install_mutations': () =>
    Promise.resolve({
      getAutomationInstallationInternal:
        installMutGetAutomationInstallationInternal,
      listAutomationBindingsInternal: installMutListAutomationBindingsInternal,
      upsertAutomationInstallation: installMutUpsertAutomationInstallation,
      bindAutomationToProject: installMutBindAutomationToProject,
      unbindAutomationFromProject: installMutUnbindAutomationFromProject,
      deleteAutomationInstallation: installMutDeleteAutomationInstallation,
      deleteProjectSchedules: installMutDeleteProjectSchedules,
      reconcileAutomationSchedules: installMutReconcileAutomationSchedules,
    }),
  'automations/install_actions': () =>
    Promise.resolve({
      installAutomationInternal: installActionsInstallAutomationInternal,
      uninstallAutomationInternal: installActionsUninstallAutomationInternal,
    }),
};

/**
 * Merge the retired-runtime stubs into a test world's module map. The stubs
 * win on a key collision — `agents/installations` is the one path where this
 * matters: `convex/agents/installations.ts` still exists live, REWRITTEN to a
 * Phase-6 marker exporting only the plain (unregistered) helper
 * `assertAgentAssigneeLive` for `tasks/mutations.ts`'s human-assignee path.
 * That export is never dispatched through `internal.<path>.<fn>` (it's a
 * direct ES import, resolved by Vitest's normal module graph — completely
 * separate from convex-test's own `modules` map), so overriding this key here
 * only changes what `ctx.runQuery/runMutation/runAction` resolve to INSIDE
 * convex-test's sandboxed dispatch during a migration replay; the real file
 * on disk, and every normal import of it, are untouched.
 */
export function withRetiredRuntimeStubs(
  modules: Record<string, () => Promise<unknown>>,
): Record<string, () => Promise<unknown>> {
  return { ...modules, ...RETIRED_RUNTIME_MODULES };
}
