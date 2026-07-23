/**
 * Read surface of the automation store.
 *
 * Every public read takes the organization explicitly, proves the caller is a
 * member of it, and then reads through an org-scoped index — a row belonging to
 * another organization is not filtered out downstream, it is never selected.
 *
 * Two things deliberately never cross this boundary: a trigger's `tokenHash`
 * (the verifier for a webhook secret; the plaintext is shown once at creation
 * and the hash is of no use to a client) and any row not scoped to the caller's
 * organization.
 *
 * The internal reads at the bottom serve the durable stepper, which runs as an
 * action and therefore cannot touch the database directly. They still carry the
 * organization: an internal function is unreachable from a client, but passing
 * the scope means a caller that mixes up two runs is refused rather than served
 * another tenant's document.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  deploymentRow,
  listAutomationsFor,
  triggerRow,
  versionRow,
  versionsOf,
} from './store';

/** Cap on a listing page — a run log grows without bound. */
const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;

async function requireMember(
  ctx: QueryCtx,
  organizationId: string,
): Promise<void> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  }
  await getOrganizationMember(ctx, organizationId, authUser);
}

const versionSummaryValidator = v.object({
  version: v.number(),
  message: v.optional(v.string()),
  testsPassed: v.optional(v.boolean()),
  createdBy: v.string(),
  createdAt: v.number(),
});

function toVersionSummary(row: Doc<'workflows'>) {
  return {
    version: row.version,
    ...(row.message !== undefined && { message: row.message }),
    ...(row.testsPassed !== undefined && { testsPassed: row.testsPassed }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

const runSummaryValidator = v.object({
  id: v.id('workflowRuns'),
  name: v.string(),
  version: v.number(),
  status: v.string(),
  mode: v.string(),
  startedBy: v.string(),
  detail: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

function toRunSummary(row: Doc<'workflowRuns'>) {
  return {
    id: row._id,
    name: row.name,
    version: row.version,
    status: row.status,
    mode: row.mode,
    startedBy: row.startedBy,
    ...(row.detail !== undefined && { detail: row.detail }),
    startedAt: row.startedAt,
    ...(row.finishedAt !== undefined && { finishedAt: row.finishedAt }),
  };
}

/** The trigger as a client may see it — the token verifier stays server-side. */
const triggerViewValidator = v.object({
  name: v.string(),
  kind: v.string(),
  cron: v.optional(v.string()),
  timezone: v.optional(v.string()),
  event: v.optional(v.string()),
  /** Whether a webhook token has ever been minted, WITHOUT revealing it. */
  hasToken: v.boolean(),
  enabled: v.boolean(),
  lastFiredAt: v.optional(v.number()),
});

function toTriggerView(row: Doc<'workflowTriggers'>) {
  return {
    name: row.name,
    kind: row.kind,
    ...(row.cron !== undefined && { cron: row.cron }),
    ...(row.timezone !== undefined && { timezone: row.timezone }),
    ...(row.event !== undefined && { event: row.event }),
    hasToken: row.tokenHash !== undefined && row.tokenHash !== '',
    enabled: row.enabled,
    ...(row.lastFiredAt !== undefined && { lastFiredAt: row.lastFiredAt }),
  };
}

// ------------------------------------------------------------------ public

/** The organization's automations: latest version, and which one is live. */
export const listAutomations = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      latest: v.number(),
      deployedVersion: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const automations = await listAutomationsFor(ctx, args.organizationId);
    const deployments = await ctx.db
      .query('workflowDeployments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    const live = new Map(deployments.map((row) => [row.name, row.version]));
    const out = [];
    for (const entry of automations) {
      const deployedVersion = live.get(entry.name);
      out.push(
        deployedVersion === undefined ? entry : { ...entry, deployedVersion },
      );
    }
    return out;
  },
});

/** One version's document — the latest when `version` is omitted. */
export const getAutomation = query({
  args: {
    organizationId: v.string(),
    name: v.string(),
    version: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      version: v.number(),
      document: v.any(),
      message: v.optional(v.string()),
      testsPassed: v.optional(v.boolean()),
      deployedVersion: v.optional(v.number()),
      createdBy: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const row = await versionRow(
      ctx,
      args.organizationId,
      args.name,
      args.version,
    );
    if (!row) return null;
    const deployment = await deploymentRow(ctx, args.organizationId, args.name);
    return {
      name: row.name,
      version: row.version,
      document: row.document,
      ...(row.message !== undefined && { message: row.message }),
      ...(row.testsPassed !== undefined && { testsPassed: row.testsPassed }),
      ...(deployment !== null && { deployedVersion: deployment.version }),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  },
});

/** The immutable version history of one automation, oldest first. */
export const listVersions = query({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.array(versionSummaryValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const rows = await versionsOf(ctx, args.organizationId, args.name);
    return rows.map(toVersionSummary);
  },
});

/** Recent runs, newest first — of one automation, or of the whole org. */
export const listRuns = query({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(runSummaryValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const limit = Math.min(
      Math.max(1, args.limit ?? DEFAULT_RUN_LIMIT),
      MAX_RUN_LIMIT,
    );
    const name = args.name;
    const rows =
      name === undefined
        ? await ctx.db
            .query('workflowRuns')
            .withIndex('by_org', (q) =>
              q.eq('organizationId', args.organizationId),
            )
            .order('desc')
            .take(limit)
        : await ctx.db
            .query('workflowRuns')
            .withIndex('by_org_name', (q) =>
              q.eq('organizationId', args.organizationId).eq('name', name),
            )
            .order('desc')
            .take(limit);
    return rows.map(toRunSummary);
  },
});

/** One run in full — the trace and per-node checkpoints the canvas overlays. */
export const getRun = query({
  args: { organizationId: v.string(), runId: v.id('workflowRuns') },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('workflowRuns'),
      name: v.string(),
      version: v.number(),
      status: v.string(),
      mode: v.string(),
      startedBy: v.string(),
      input: v.any(),
      output: v.optional(v.any()),
      checkpoints: v.optional(v.any()),
      trace: v.optional(v.any()),
      effects: v.optional(v.any()),
      detail: v.optional(v.string()),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const row = await ctx.db.get(args.runId);
    // A run id from another organization reads as "not found": the caller
    // learns nothing about whether it exists elsewhere.
    if (!row || row.organizationId !== args.organizationId) return null;
    return {
      id: row._id,
      name: row.name,
      version: row.version,
      status: row.status,
      mode: row.mode,
      startedBy: row.startedBy,
      input: row.input,
      ...(row.output !== undefined && { output: row.output }),
      ...(row.checkpoints !== undefined && { checkpoints: row.checkpoints }),
      ...(row.trace !== undefined && { trace: row.trace }),
      ...(row.effects !== undefined && { effects: row.effects }),
      ...(row.detail !== undefined && { detail: row.detail }),
      startedAt: row.startedAt,
      ...(row.finishedAt !== undefined && { finishedAt: row.finishedAt }),
    };
  },
});

/** What starts the organization's automations. */
export const listTriggers = query({
  args: { organizationId: v.string(), name: v.optional(v.string()) },
  returns: v.array(triggerViewValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const name = args.name;
    if (name !== undefined) {
      const row = await triggerRow(ctx, args.organizationId, name);
      return row ? [toTriggerView(row)] : [];
    }
    const rows = await ctx.db
      .query('workflowTriggers')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toTriggerView);
  },
});

// ---------------------------------------------------------------- internal

/**
 * The run row the stepper is executing, with the document of the exact version
 * it started against — resolved together so a redeploy mid-run cannot swap the
 * document under a running execution.
 */
export const loadRunForStep = internalQuery({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      run: v.object({
        id: v.id('workflowRuns'),
        organizationId: v.string(),
        name: v.string(),
        version: v.number(),
        status: v.string(),
        mode: v.union(v.literal('mock'), v.literal('live')),
        startedBy: v.string(),
        input: v.any(),
        checkpoints: v.optional(v.any()),
        startedAt: v.number(),
      }),
      document: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) return null;
    const version = await versionRow(
      ctx,
      row.organizationId,
      row.name,
      row.version,
    );
    if (!version) return null;
    return {
      run: {
        id: row._id,
        organizationId: row.organizationId,
        name: row.name,
        version: row.version,
        status: row.status,
        mode: row.mode,
        startedBy: row.startedBy,
        input: row.input,
        ...(row.checkpoints !== undefined && { checkpoints: row.checkpoints }),
        startedAt: row.startedAt,
      },
      document: version.document,
    };
  },
});

/**
 * One saved version's document, org-scoped — how the stepper resolves a
 * `subworkflow` node. Returns the deployed version when none is named, matching
 * the executor's own resolution rule.
 */
export const loadWorkflowDocument = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
    version: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({ version: v.number(), document: v.any() }),
  ),
  handler: async (ctx, args) => {
    const version =
      args.version ??
      (await deploymentRow(ctx, args.organizationId, args.name))?.version;
    const row = await versionRow(ctx, args.organizationId, args.name, version);
    return row ? { version: row.version, document: row.document } : null;
  },
});

// --------------------------------------------------- the store, from an action
//
// `dispatch()` runs in an action (it executes workflows, which needs the code
// sandbox), and an action has no database handle. These three reads are the
// action-side half of `StoreAdapter`; `store.ts` composes them, and the write
// half lives in `mutations.ts`, so the semantics stay in exactly one place.

/** The organization's automations and their latest version. */
export const storeList = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ name: v.string(), latest: v.number() })),
  handler: async (ctx, args) =>
    await listAutomationsFor(ctx, args.organizationId),
});

/** One version's document — the LATEST when none is named, which is the
 * adapter's rule (the deployed version is asked for by name). */
export const storeGet = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
    version: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      meta: v.object({ version: v.number() }),
      workflow: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await versionRow(
      ctx,
      args.organizationId,
      args.name,
      args.version,
    );
    return row
      ? { meta: { version: row.version }, workflow: row.document }
      : null;
  },
});

/** The version triggers run, or null when the automation is drafts only. */
export const storeDeployedVersion = internalQuery({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args) => {
    const row = await deploymentRow(ctx, args.organizationId, args.name);
    return row?.version ?? null;
  },
});
