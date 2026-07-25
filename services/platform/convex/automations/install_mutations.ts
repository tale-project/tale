import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';
import { automationWorkflowSlugs } from './automation_workflow_slugs';
import { mergeScheduleVariables } from './schedule_variables';

const resourceValidator = v.object({
  domain: v.string(),
  path: v.string(),
  contentHash: v.string(),
  /** File existed before the automation claimed it — uninstall leaves it (see schema). */
  adopted: v.optional(v.boolean()),
});

const statusValidator = v.union(v.literal('active'), v.literal('broken'));

/**
 * Ensure the ORG-LEVEL install record + copied-file ledger (idempotent on
 * reinstall / add-to-project). Read-then-insert/patch in one mutation → at most
 * one row per (org, automationSlug). Project membership is NOT stored here — it lives in
 * `automationProjectBindings` (see `bindAutomationToProject`).
 */
export const upsertAutomationInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    /** Denormalized automation display name (from the manifest) for the in-project tab. */
    automationName: v.optional(v.string()),
    installedBy: v.string(),
    status: statusValidator,
    resources: v.array(resourceValidator),
    requiredIntegrations: v.array(v.string()),
    /** Override for versioned migrations, which must stamp a DETERMINISTIC
     *  moment so the chain's re-up convergence holds; absent ⇒ now. */
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
      // A reinstall lands here; clear any stale teardown lock so the row is live.
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

/**
 * Bind a `scope: 'project'` automation to a project — idempotent, single-transaction
 * (the OCC serialization unit), enforcing every cross-row guarantee here rather
 * than in the calling action:
 *  - I8: the project exists and belongs to the org;
 *  - I7: the org install row exists and is not mid-uninstall;
 *  - I6: one row per (org, automationSlug, project) — a re-add is a no-op.
 */
export const bindAutomationToProject = internalMutation({
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

/**
 * Remove a single project binding — the "Remove from this project" verb. Deletes
 * ONLY this junction row; never inspects the remaining count and never tears down
 * shared org resources (I3). Idempotent.
 */
export const unbindAutomationFromProject = internalMutation({
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

/**
 * List a `scope: 'project'` automation's bound project ids for the org. Drives
 * `syncAutomationSchedules`: one schedule per bound project.
 */
export const listAutomationBindingsInternal = internalQuery({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.array(v.object({ projectId: v.id('projects') })),
  handler: async (ctx, args) => {
    const out: { projectId: Doc<'automationProjectBindings'>['projectId'] }[] =
      [];
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

/**
 * Guard + lock for full uninstall (I1/I7). Refuses with `AUTOMATION_HAS_BOUND_PROJECTS`
 * (naming the projects) while any binding remains — the mirror of the
 * project-delete guard — so a project still using the automation never has its shared
 * resources removed. At 0 bindings it sets the `uninstalling` lock so a racing
 * `bindAutomationToProject` is refused, then the action runs the filesystem teardown and
 * finally deletes the row (clearing the lock).
 */
export const beginUninstall = internalMutation({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), notInstalled: v.literal(true) }),
  ),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .first();
    if (!org) return { ok: false as const, notInstalled: true as const };
    const boundProjectNames: string[] = [];
    for await (const binding of ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )) {
      const project = await ctx.db.get(binding.projectId);
      boundProjectNames.push(project?.name ?? String(binding.projectId));
    }
    if (boundProjectNames.length > 0) {
      throw new ConvexError({
        code: 'AUTOMATION_HAS_BOUND_PROJECTS',
        projects: boundProjectNames,
      });
    }
    await ctx.db.patch(org._id, { uninstalling: true });
    return { ok: true as const };
  },
});

/**
 * Slugs of every automation installed in the org — drives the builtin-sync
 * re-install pass (`organizations/builtin_sync.ts`), which re-runs the
 * reinstall pipeline for installed automations whose builtin bundle changed.
 */
export const listAutomationInstallationsInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const out: string[] = [];
    for await (const row of ctx.db
      .query('automationInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      out.push(row.automationSlug);
    }
    return out;
  },
});

/**
 * Automation slugs whose install row lists `integrationSlug` in its
 * `requiredIntegrations` — the automations BOUND to a given integration in this
 * org. Drives "Duplicate integration": each bound automation is cloned + rebound
 * to the duplicate's new slug. Single `by_org` scan + in-memory filter (the set
 * per org is small); `requiredIntegrations` is already denormalized on the row.
 */
export const listInstallationsRequiringIntegrationInternal = internalQuery({
  args: { organizationId: v.string(), integrationSlug: v.string() },
  returns: v.array(v.object({ automationSlug: v.string() })),
  handler: async (ctx, args): Promise<Array<{ automationSlug: string }>> => {
    const out: Array<{ automationSlug: string }> = [];
    for await (const row of ctx.db
      .query('automationInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.requiredIntegrations.includes(args.integrationSlug)) {
        out.push({ automationSlug: row.automationSlug });
      }
    }
    return out;
  },
});

export const getAutomationInstallationInternal = internalQuery({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (
    ctx,
    args,
  ): Promise<Doc<'automationInstallations'> | null> => {
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

export const setAutomationInstallStatus = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    status: statusValidator,
  },
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
    if (row && row.status !== args.status) {
      await ctx.db.patch(row._id, { status: args.status });
    }
    return null;
  },
});

export const deleteAutomationInstallation = internalMutation({
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

/**
 * Delete a project's per-project schedules for an automation (the unbind path). A
 * `scope: 'project'` automation gets ONE schedule per bound project; removing the
 * binding must remove exactly that project's schedules and no other's. Workflow
 * slugs come from the authoritative `wfInstallations` ownership ledger (NOT the
 * `appInstallations.resources` file ledger — that never lists workflows, so it
 * would delete nothing), and the delete is keyed by (org, workflowSlug,
 * projectId) so a sibling project's identical schedule is untouched. No-op when
 * the automation owns no workflows.
 */
export const deleteProjectSchedules = internalMutation({
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

/**
 * Reconcile an automation's scheduled workflows to the DESIRED set — an idempotent
 * "make it so" that turns a plain reinstall/bind into the recovery path (no
 * manual data surgery to fix drifted or orphaned schedules).
 *
 * `desired` is (every current binding × each workflow's schedule specs), built
 * by the install action. The identity of a schedule is (workflowSlug,
 * cronExpression, projectId).
 *
 *  - EXISTS + desired → CONVERGE: merge the file's declared `variables` as
 *    defaults UNDER the row's existing values (operator edits win) and keep the
 *    row's `timezone`, so a repo owner/name — or timezone — set via the
 *    workflow's Triggers tab survives a reinstall/rebind while a genuinely new
 *    file-declared default still lands. This is also what heals a schedule that
 *    drifted from the workflow file's declared spec (the reason a reinstall
 *    previously couldn't fix it — `ensureSchedule` skipped existing rows).
 *    `isActive` is left untouched, so a schedule the operator disabled stays
 *    disabled (opt-out sticks). The installed workflow and its schedule config
 *    are org-owned — the workflow-update-exempt rule. (A cron change made via
 *    Triggers moves the row out of this key, so it reconciles as prune+create.)
 *  - desired, not existing → CREATE (active).
 *  - EXISTS + NOT desired → PRUNE: an org-level leftover from a pre-project-scope
 *    era, or a schedule for a since-unbound project. Scoped strictly to THIS automation's
 *    own workflow slugs (the `wfInstallations` ownership ledger), so no other
 *    automation's or a global workflow's schedule is ever touched.
 */
export const reconcileAutomationSchedules = internalMutation({
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
        // Converge the FIRST row for a desired key; prune anything else — a row
        // for no-longer-desired scope OR a duplicate of a key already converged
        // (so an accidental duplicate schedule collapses to exactly one).
        if (want && !seen.has(key)) {
          seen.add(key);
          await ctx.db.patch(sched._id, {
            // Operator-FILLED values win over the file's declared defaults, so
            // a repo owner/name (or any variable, or the timezone) entered via
            // the workflow's Triggers tab survives a reinstall/rebind — the
            // installed workflow and its schedule config are org-owned (the
            // workflow-update-exempt rule). A genuinely new file-declared
            // default (a variable key the row lacks) still lands, and a BLANK
            // placeholder (`""`/`null` from the schedule dialog's skeleton)
            // never shadows a real default — that's how the install-seeded
            // `projectId` reaches an already-created row (#2607).
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

/**
 * Reverse a workflow's registration: delete its install record + every event
 * subscription + schedule for (org, slug). wfInstallations has no cascade, so
 * the trigger rows must be removed explicitly (mirrors the install loop). The
 * schedule sweep keys on (org, slug) only, so it also clears every project's
 * per-project schedule for the workflow — correct for a full uninstall.
 */
export const deregisterWorkflow = internalMutation({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const install = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (install) await ctx.db.delete(install._id);

    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sub.organizationId === args.organizationId)
        await ctx.db.delete(sub._id);
    }
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sched.organizationId === args.organizationId) {
        await ctx.db.delete(sched._id);
      }
    }
    return null;
  },
});

/**
 * Refresh the denormalized `automationName` cache after a manifest identity
 * edit (`file_actions.updateAutomationIdentity`) — the manifest stays the
 * source of truth; this only keeps the nav-label cache in step.
 */
export const patchAutomationName = internalMutation({
  args: {
    organizationId: v.string(),
    automationSlug: v.string(),
    automationName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('automationInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { automationName: args.automationName });
    }
    return null;
  },
});
