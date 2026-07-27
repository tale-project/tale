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

import { DAY_MS, dailyKeys, utcDateKey } from '../../lib/shared/metrics-window';
import { isRecord } from '../../lib/utils/type-utils';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { readCheckpoints } from './checkpoints';
import {
  automationReadStore,
  bindingsOf,
  deploymentRow,
  listAutomationsFor,
  triggerRow,
  versionRow,
  versionsOf,
} from './store';

/** Cap on a listing page — a run log grows without bound. */
const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;

/** Cap on the metrics scan — beyond it the figures report `capped: true`. */
const METRICS_MAX_SCAN = 5000;
const METRICS_TOP_N = 10;

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

function toVersionSummary(row: Doc<'automations'>) {
  return {
    version: row.version,
    ...(row.message !== undefined && { message: row.message }),
    ...(row.testsPassed !== undefined && { testsPassed: row.testsPassed }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

const runSummaryValidator = v.object({
  id: v.id('automationRuns'),
  name: v.string(),
  version: v.number(),
  status: v.string(),
  mode: v.string(),
  startedBy: v.string(),
  detail: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

function toRunSummary(row: Doc<'automationRuns'>) {
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

function toTriggerView(row: Doc<'automationTriggers'>) {
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
  args: {
    organizationId: v.string(),
    /** One project's automations (the names bound to it); absent = the
     * org-level ones. */
    projectId: v.optional(v.id('projects')),
    /** Org page only: ALSO list project-bound automations (each row carries
     * its `projectIds`) — the org Automations page is the single admin
     * surface now that project navigation has no Automations tab. */
    includeProjectBound: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      name: v.string(),
      latest: v.number(),
      /** The projects the automation is bound to; empty = org-level. */
      projectIds: v.array(v.id('projects')),
      deployedVersion: v.optional(v.number()),
      /** The DEPLOYED version's task-surface contract, when it carries one —
       * what the task board's choreography and badges consume. */
      taskContract: v.optional(v.any()),
      /** The DEPLOYED version's settings declaration, when it carries one —
       * what the settings forms render and the create-task gate checks. */
      settings: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const automations = await listAutomationsFor(
      ctx,
      args.organizationId,
      args.projectId ?? (args.includeProjectBound === true ? undefined : null),
    );
    const deployments = await ctx.db
      .query('automationDeployments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    const live = new Map(deployments.map((row) => [row.name, row.version]));
    const out = [];
    for (const entry of automations) {
      const deployedVersion = live.get(entry.name);
      if (deployedVersion === undefined) {
        out.push(entry);
        continue;
      }
      const row = await versionRow(
        ctx,
        args.organizationId,
        entry.name,
        deployedVersion,
      );
      out.push({
        ...entry,
        deployedVersion,
        ...(row?.taskContract !== undefined
          ? { taskContract: row.taskContract }
          : {}),
        ...(row?.settings !== undefined ? { settings: row.settings } : {}),
      });
    }
    return out;
  },
});

/** The projects one automation is bound to — the detail page's Projects
 * panel reads this; empty means org-level. */
export const listAutomationProjects = query({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.array(v.id('projects')),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const bindings = await bindingsOf(ctx, args.organizationId, args.name);
    return bindings.map((row) => row.projectId);
  },
});

/** Newest project runs scanned when resolving a task's live run — live rows
 * sit at the head of the by-project ordering. */
const LIVE_RUN_SCAN_CAP = 100;

/**
 * The LIVE run currently operating one task, if any — what the task board's
 * status choreography consults before it cancels or refuses a duplicate
 * start. Scans the project's newest runs for a non-terminal one carrying the
 * task as its subject.
 */
export const getLiveRunForTask = query({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    taskId: v.id('tasks'),
  },
  returns: v.union(
    v.null(),
    v.object({
      runId: v.id('automationRuns'),
      name: v.string(),
      status: v.string(),
      version: v.number(),
      /** e.g. `approval:<id>` while parked on a write approval — the task
       * modal renders the decision inline from this. */
      detail: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    let scanned = 0;
    for await (const run of ctx.db
      .query('automationRuns')
      .withIndex('by_org_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('projectId', args.projectId),
      )
      .order('desc')) {
      if (++scanned > LIVE_RUN_SCAN_CAP) break;
      if (
        run.status !== 'queued' &&
        run.status !== 'running' &&
        run.status !== 'waiting'
      ) {
        continue;
      }
      const input = run.input;
      const rawTaskId =
        isRecord(input) && isRecord(input.task) ? input.task.id : undefined;
      if (rawTaskId !== String(args.taskId)) continue;
      return {
        runId: run._id,
        name: run.name,
        status: run.status,
        version: run.version,
        ...(run.detail !== undefined ? { detail: run.detail } : {}),
      };
    }
    return null;
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
    /** A project's run log; absent = no project filter. Runs carry the
     * project context they OPERATE in (a task's project, or the automation's
     * sole binding), so one automation's runs may span projects — with
     * `name` set the name path is scanned and this narrows it to the runs
     * that served the named project. */
    projectId: v.optional(v.id('projects')),
  },
  returns: v.array(runSummaryValidator),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);
    const limit = Math.min(
      Math.max(1, args.limit ?? DEFAULT_RUN_LIMIT),
      MAX_RUN_LIMIT,
    );
    const name = args.name;
    let rows;
    if (name !== undefined) {
      rows = await ctx.db
        .query('automationRuns')
        .withIndex('by_org_name', (q) =>
          q.eq('organizationId', args.organizationId).eq('name', name),
        )
        .order('desc')
        .take(limit);
      if (args.projectId !== undefined) {
        rows = rows.filter((row) => row.projectId === args.projectId);
      }
    } else if (args.projectId !== undefined) {
      rows = await ctx.db
        .query('automationRuns')
        .withIndex('by_org_project', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('projectId', args.projectId),
        )
        .order('desc')
        .take(limit);
    } else {
      rows = await ctx.db
        .query('automationRuns')
        .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
        .order('desc')
        .take(limit);
    }
    return rows.map(toRunSummary);
  },
});

/** One run in full — the trace and per-node checkpoints the canvas overlays. */
export const getRun = query({
  args: { organizationId: v.string(), runId: v.id('automationRuns') },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('automationRuns'),
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
      .query('automationTriggers')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toTriggerView);
  },
});

const orgAutomationMetricsValidator = v.object({
  summary: v.object({
    total: v.number(),
    success: v.number(),
    failed: v.number(),
    running: v.number(),
    waiting: v.number(),
    queued: v.number(),
    cancelled: v.number(),
    successRate: v.number(),
    avgDurationSeconds: v.number(),
    lastRun: v.union(v.number(), v.null()),
    capped: v.boolean(),
  }),
  /** Prior equal-length window totals — drives the summary-card deltas. */
  previousSummary: v.object({
    total: v.number(),
    success: v.number(),
    failed: v.number(),
    successRate: v.number(),
    avgDurationSeconds: v.number(),
  }),
  series: v.array(
    v.object({
      dateKey: v.string(),
      success: v.number(),
      failed: v.number(),
      running: v.number(),
    }),
  ),
  topAutomations: v.array(
    v.object({
      name: v.string(),
      total: v.number(),
      success: v.number(),
      failed: v.number(),
      successRate: v.number(),
      avgDurationSeconds: v.number(),
      lastRun: v.union(v.number(), v.null()),
    }),
  ),
});

interface AutomationMetricsBucket {
  name: string;
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  durationSumMs: number;
  durationCount: number;
  lastRun: number;
}

/** Success over TERMINAL runs (success + failed + cancelled), in percent —
 * a window full of still-running runs reads as "no rate yet" (0), not as a
 * false failure rate. */
function successRatePct(
  success: number,
  failed: number,
  cancelled: number,
): number {
  const terminal = success + failed + cancelled;
  return terminal > 0 ? (success / terminal) * 100 : 0;
}

/**
 * Org-wide run KPIs for the automation metrics page: window summary,
 * prior-window totals for deltas, a per-day series, and the top automations by
 * run count. One bounded newest-first walk over `automationRuns` serves all four.
 */
export const getOrgAutomationMetrics = query({
  args: {
    organizationId: v.string(),
    periodDays: v.union(v.literal(7), v.literal(30), v.literal(90)),
    /** Which runs to count — defaults to `live` so mock runs never skew KPIs. */
    mode: v.optional(v.union(v.literal('live'), v.literal('mock'))),
  },
  returns: orgAutomationMetricsValidator,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.organizationId);

    const mode = args.mode ?? 'live';
    const now = Date.now();
    const windowStart = now - args.periodDays * DAY_MS;
    // Immediately-preceding equal-length window, for period-over-period deltas.
    const prevWindowStart = now - args.periodDays * 2 * DAY_MS;

    let total = 0;
    let success = 0;
    let failed = 0;
    let running = 0;
    let waiting = 0;
    let queued = 0;
    let cancelled = 0;
    let durationSumMs = 0;
    let durationCount = 0;
    let lastRun: number | null = null;

    // Prior-window accumulators (totals only — no series/buckets needed).
    let prevTotal = 0;
    let prevSuccess = 0;
    let prevFailed = 0;
    let prevCancelled = 0;
    let prevDurationSumMs = 0;
    let prevDurationCount = 0;

    const seriesMap = new Map(
      dailyKeys(args.periodDays, now).map((dateKey) => [
        dateKey,
        { dateKey, success: 0, failed: 0, running: 0 },
      ]),
    );

    const buckets = new Map<string, AutomationMetricsBucket>();

    let scanned = 0;
    let capped = false;
    for await (const run of ctx.db
      .query('automationRuns')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .order('desc')) {
      // The `by_org` index is walked newest-first and `startedAt` is set to
      // `Date.now()` at insert, so it decreases monotonically along this walk.
      // Once we reach a row older than the prior comparison window, every
      // remaining row is also out of scope, so we can stop. This bounds the
      // scan to in-window + prior-window rows and keeps `capped` meaning only
      // "in-scope data was truncated" rather than firing on out-of-window
      // historical volume.
      if (run.startedAt < prevWindowStart) break;
      scanned++;
      if (scanned > METRICS_MAX_SCAN) {
        capped = true;
        break;
      }
      if (run.mode !== mode) continue;

      // Duration only exists for settled runs — a run still in flight has no
      // `finishedAt` and must not drag the average toward zero.
      const durationMs =
        run.finishedAt !== undefined ? run.finishedAt - run.startedAt : null;

      if (run.startedAt < windowStart) {
        // Prior window — accumulate totals only.
        prevTotal++;
        if (run.status === 'success') prevSuccess++;
        else if (run.status === 'failed') prevFailed++;
        else if (run.status === 'cancelled') prevCancelled++;
        if (
          durationMs !== null &&
          (run.status === 'success' ||
            run.status === 'failed' ||
            run.status === 'cancelled')
        ) {
          prevDurationSumMs += durationMs;
          prevDurationCount++;
        }
        continue;
      }

      total++;
      if (lastRun === null || run.startedAt > lastRun) {
        lastRun = run.startedAt;
      }

      const seriesPoint = seriesMap.get(utcDateKey(run.startedAt));

      let bucket = buckets.get(run.name);
      if (!bucket) {
        bucket = {
          name: run.name,
          total: 0,
          success: 0,
          failed: 0,
          cancelled: 0,
          durationSumMs: 0,
          durationCount: 0,
          lastRun: 0,
        };
        buckets.set(run.name, bucket);
      }
      bucket.total++;
      if (run.startedAt > bucket.lastRun) {
        bucket.lastRun = run.startedAt;
      }

      switch (run.status) {
        case 'success':
          success++;
          bucket.success++;
          if (seriesPoint) seriesPoint.success++;
          break;
        case 'failed':
          failed++;
          bucket.failed++;
          if (seriesPoint) seriesPoint.failed++;
          break;
        case 'cancelled':
          cancelled++;
          bucket.cancelled++;
          break;
        case 'running':
          running++;
          if (seriesPoint) seriesPoint.running++;
          break;
        case 'waiting':
          waiting++;
          break;
        case 'queued':
          queued++;
          break;
      }

      if (
        durationMs !== null &&
        (run.status === 'success' ||
          run.status === 'failed' ||
          run.status === 'cancelled')
      ) {
        durationSumMs += durationMs;
        durationCount++;
        bucket.durationSumMs += durationMs;
        bucket.durationCount++;
      }
    }

    const topAutomations = [...buckets.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, METRICS_TOP_N)
      .map((b) => ({
        name: b.name,
        total: b.total,
        success: b.success,
        failed: b.failed,
        successRate: successRatePct(b.success, b.failed, b.cancelled),
        avgDurationSeconds:
          b.durationCount > 0
            ? Math.round(b.durationSumMs / b.durationCount / 1000)
            : 0,
        lastRun: b.lastRun || null,
      }));

    return {
      summary: {
        total,
        success,
        failed,
        running,
        waiting,
        queued,
        cancelled,
        successRate: successRatePct(success, failed, cancelled),
        avgDurationSeconds:
          durationCount > 0
            ? Math.round(durationSumMs / durationCount / 1000)
            : 0,
        lastRun,
        capped,
      },
      previousSummary: {
        total: prevTotal,
        success: prevSuccess,
        failed: prevFailed,
        successRate: successRatePct(prevSuccess, prevFailed, prevCancelled),
        avgDurationSeconds:
          prevDurationCount > 0
            ? Math.round(prevDurationSumMs / prevDurationCount / 1000)
            : 0,
      },
      series: [...seriesMap.values()],
      topAutomations,
    };
  },
});

// ---------------------------------------------------------------- internal

/**
 * The project context a run operates in, or `null` when it has none. Skill
 * staging derives the run's viewer scope from this: a run attributed to a
 * project reads team skills as that project, one without reads as the org.
 */
export const getRunProjectId = internalQuery({
  args: { organizationId: v.string(), runId: v.id('automationRuns') },
  returns: v.union(v.id('projects'), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) return null;
    return row.projectId ?? null;
  },
});

/**
 * The run row the stepper is executing, with the document of the exact version
 * it started against — resolved together so a redeploy mid-run cannot swap the
 * document under a running execution.
 */
export const loadRunForStep = internalQuery({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
  },
  returns: v.union(
    v.null(),
    v.object({
      run: v.object({
        id: v.id('automationRuns'),
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
 * `subautomation` node. Returns the deployed version when none is named, matching
 * the executor's own resolution rule.
 */
export const loadAutomationDocument = internalQuery({
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
// `dispatch()` runs in an action (it executes automations, which needs the code
// sandbox), and an action has no database handle. These three reads are the
// action-side half of `StoreAdapter`; `store.ts` composes them, and the write
// half lives in `mutations.ts`, so the semantics stay in exactly one place.

/** The organization's automations and their latest version. */
export const storeList = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ name: v.string(), latest: v.number() })),
  handler: async (ctx, args) =>
    await automationReadStore(ctx, args.organizationId).list(),
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
      automation: v.any(),
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
      ? { meta: { version: row.version }, automation: row.document }
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

// The management half of the action-side store: run history, version history,
// and trigger listing. They answer the same data the public queries above serve
// — through the same helpers — but keyed the way the engine's `DispatchStore`
// addresses things: a run is a plain string handle (`runId`), because the engine
// never learns what a host's identifier is made of.

/** The engine's field name for a run handle; the public queries call it `id`. */
const storeRunFields = {
  runId: v.id('automationRuns'),
  name: v.string(),
  version: v.number(),
  status: v.string(),
  mode: v.string(),
  startedBy: v.string(),
  detail: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
};

function toStoreRunSummary(row: Doc<'automationRuns'>) {
  const { id, ...rest } = toRunSummary(row);
  return { runId: id, ...rest };
}

/** Recent runs, newest first — of one automation, or of the whole org. */
export const storeListRuns = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object(storeRunFields)),
  handler: async (ctx, args) => {
    const limit = Math.min(
      Math.max(1, args.limit ?? DEFAULT_RUN_LIMIT),
      MAX_RUN_LIMIT,
    );
    const name = args.name;
    const rows =
      name !== undefined
        ? await ctx.db
            .query('automationRuns')
            .withIndex('by_org_name', (q) =>
              q.eq('organizationId', args.organizationId).eq('name', name),
            )
            .order('desc')
            .take(limit)
        : await ctx.db
            .query('automationRuns')
            .withIndex('by_org', (q) =>
              q.eq('organizationId', args.organizationId),
            )
            .order('desc')
            .take(limit);
    return rows.map(toStoreRunSummary);
  },
});

/**
 * One run in full. The handle arrives as a plain string, so an id that is not
 * even shaped like one reads as "no such run" instead of raising — a caller
 * that mistyped a handle gets an answer it can act on, and learns nothing about
 * whether the row exists in another organization.
 */
export const storeGetRun = internalQuery({
  args: { organizationId: v.string(), runId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...storeRunFields,
      input: v.optional(v.any()),
      output: v.optional(v.any()),
      trace: v.optional(v.any()),
      effects: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('automationRuns', args.runId);
    if (!runId) return null;
    const row = await ctx.db.get(runId);
    if (!row || row.organizationId !== args.organizationId) return null;
    return {
      ...toStoreRunSummary(row),
      input: row.input,
      ...(row.output !== undefined && { output: row.output }),
      ...(row.trace !== undefined && { trace: row.trace }),
      ...(row.effects !== undefined && { effects: row.effects }),
    };
  },
});

/** The immutable version history of one automation, oldest first. */
export const storeListVersions = internalQuery({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.array(versionSummaryValidator),
  handler: async (ctx, args) => {
    const rows = await versionsOf(ctx, args.organizationId, args.name);
    return rows.map(toVersionSummary);
  },
});

/** What starts the organization's automations — never the token verifier. */
export const storeListTriggers = internalQuery({
  args: { organizationId: v.string(), name: v.optional(v.string()) },
  returns: v.array(triggerViewValidator),
  handler: async (ctx, args) => {
    const name = args.name;
    if (name !== undefined) {
      const row = await triggerRow(ctx, args.organizationId, name);
      return row ? [toTriggerView(row)] : [];
    }
    const rows = await ctx.db
      .query('automationTriggers')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name)).map(toTriggerView);
  },
});

/**
 * The parked run's cursor, for the agent host: the drive chain's orphan check
 * and the stepper's fresh poll both read it. Returns `null` for a missing or
 * foreign-org run — the caller treats that as "turn is an orphan".
 */
export const readAgentCursor = internalQuery({
  args: { organizationId: v.string(), runId: v.id('automationRuns') },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      detail: v.optional(v.string()),
      cursor: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) return null;
    const checkpoints = readCheckpoints(row.checkpoints);
    return {
      status: row.status,
      ...(row.detail !== undefined ? { detail: row.detail } : {}),
      ...(checkpoints.cursor !== undefined
        ? { cursor: checkpoints.cursor }
        : {}),
    };
  },
});
