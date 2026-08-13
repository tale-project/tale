/**
 * Automations REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/automations                        — List automations (paginated)
 *   GET    /api/v1/automations/:name                  — One automation's document
 *   GET    /api/v1/automations/:name/versions         — Version history
 *   GET    /api/v1/automations/:name/runs             — Run log (paginated)
 *   POST   /api/v1/automations/:name/runs             — Start a run (202); body {input?, mode?, version?, projectId?}
 *   GET    /api/v1/automations/:name/triggers         — The automation's trigger
 *   PUT    /api/v1/automations/:name/triggers         — Bind the trigger
 *   DELETE /api/v1/automations/:name/triggers         — Unbind the trigger
 *   GET    /api/v1/runs/:runId                        — One run in full
 *   POST   /api/v1/runs/:runId/cancel                 — Stop a run
 *
 * ## Why this module carries its own reads and writes
 *
 * The public functions in `queries.ts` and `mutations.ts` resolve the caller
 * from `ctx.auth` — a Convex identity a session has and an API key does not.
 * A REST request is authenticated by an organization API key, so the identity
 * arrives as an explicit `(organizationId, userId)` pair instead. The internal
 * functions at the bottom are that pair's half of the same store: they take the
 * organization explicitly and read/write through the SAME `store.ts` helpers and
 * the SAME `beginRun` lifecycle, so a REST-started run is the identical durable
 * object a UI-started one is. This is the pattern every `/api/v1` resource
 * follows (see `documents/internal_queries.ts`).
 *
 * ## Authorization
 *
 * Membership is proven by org resolution before a handler runs. Beyond that,
 * this surface applies exactly the capability rules the session surface does:
 * authoring a trigger, cancelling a run, and starting a LIVE run need the
 * developer capability (`requireRestDeveloper`, the same coded refusal
 * `requireOrgAdminOrDeveloper` raises), while a `mock` run and every read need
 * only membership. Starting a run needs NO trigger row — the API key IS the
 * entitlement, which is what makes the programmatic surface symmetric with MCP.
 */

import { ConvexError, v } from 'convex/values';

import { paramToAutomationSlug } from '../../lib/automations/slug';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';
import {
  BadRequestError,
  extractPathParts,
  jsonAccepted,
  jsonError,
  jsonNoContent,
  jsonOk,
  optionalBoolean,
  optionalEnum,
  optionalString,
  parsePageLimit,
  readJsonObject,
  readJsonObjectOrEmpty,
  requireRestDeveloper,
  withRestAuth,
} from '../lib/rest/helpers';
import { beginRun } from './mutations';
import {
  assertRunProjectAllowed,
  automationStore,
  deploymentRow,
  listAutomationsFor,
  triggerRow,
  versionRow,
  versionsOf,
} from './store';
import { hashWebhookToken, mintWebhookToken } from './webhook_token';

const PREFIX = '/api/v1/automations/';
const RUNS_PREFIX = '/api/v1/runs/';

/** Page sizes for the two paginated listings here. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Longest path segment we will even try to decode as a name — the store's own
 * ceiling, so an oversized segment is refused before it reaches a query. */
const NAME_MAX = 200;

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/**
 * The automation name a `/api/v1/automations/...` request addressed, decoded,
 * or an error response when the segment cannot be one.
 */
function nameFromPath(
  url: URL,
): { name: string; subPath: string | null } | Response {
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing automation name', 400);
  if (id.length > NAME_MAX) {
    return jsonError('Automation name is too long', 400);
  }
  return { name: paramToAutomationSlug(id), subPath };
}

export const listAutomations = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parsePageLimit(url, DEFAULT_LIMIT, MAX_LIMIT);
  const projectId = url.searchParams.get('projectId') ?? undefined;

  const result = await rc.ctx.runQuery(
    internal.automations.rest_api.restListAutomations,
    {
      organizationId: rc.org.organizationId,
      ...(projectId !== undefined && { projectId }),
      cursor,
      limit,
    },
  );
  return jsonOk(result);
});

/** Every read that hangs off one automation. */
export const automationReads = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const parsed = nameFromPath(url);
  if (parsed instanceof Response) return parsed;
  const { name, subPath } = parsed;

  if (subPath === null) {
    const versionParam = url.searchParams.get('version');
    let version: number | undefined;
    if (versionParam !== null) {
      const parsedVersion = Number(versionParam);
      if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
        return jsonError('"version" must be a positive integer', 400);
      }
      version = parsedVersion;
    }
    const automation = await rc.ctx.runQuery(
      internal.automations.rest_api.restGetAutomation,
      {
        organizationId: rc.org.organizationId,
        name,
        ...(version !== undefined && { version }),
      },
    );
    if (!automation) return jsonError('Automation not found', 404);
    return jsonOk(automation);
  }

  if (subPath === 'versions') {
    const versions = await rc.ctx.runQuery(
      internal.automations.rest_api.restListVersions,
      { organizationId: rc.org.organizationId, name },
    );
    return jsonOk({ name, versions });
  }

  if (subPath === 'runs') {
    const result = await rc.ctx.runQuery(
      internal.automations.rest_api.restListRuns,
      {
        organizationId: rc.org.organizationId,
        name,
        cursor: url.searchParams.get('cursor') ?? null,
        limit: parsePageLimit(url, DEFAULT_LIMIT, MAX_LIMIT),
      },
    );
    return jsonOk(result);
  }

  if (subPath === 'triggers') {
    const triggers = await rc.ctx.runQuery(
      internal.automations.rest_api.restListTriggers,
      { organizationId: rc.org.organizationId, name },
    );
    return jsonOk({ name, triggers });
  }

  return jsonError(`Unknown sub-resource: ${subPath}`, 404);
});

/**
 * Start a run of the deployed version (or of a named one).
 *
 * Answers 202 with the run's identity rather than its result: a run is durable
 * and may take minutes, so the caller polls `GET /api/v1/runs/:runId`.
 */
export const automationPostActions = withRestAuth(
  'rest:execute',
  async (rc, request) => {
    const url = new URL(request.url);
    const parsed = nameFromPath(url);
    if (parsed instanceof Response) return parsed;
    const { name, subPath } = parsed;

    if (subPath !== 'runs') {
      return jsonError(`Unknown action: ${subPath ?? ''}`, 404);
    }

    const body = await readJsonObjectOrEmpty(request);
    const mode =
      optionalEnum(body, 'mode', ['mock', 'live'] as const) ?? 'live';
    const version = readVersionField(body);
    // The project the run operates in. Omit it and the run is org-wide (or,
    // for a singly-bound automation, that one project) — the same default a
    // trigger firing takes.
    const projectId = optionalString(body, 'projectId', 200);

    // A live run may act on the organization's behalf (send mail, call a
    // vendor), so it needs the same developer capability the session surface
    // asks for; a mock run reaches nothing outside the process.
    if (mode === 'live') await requireRestDeveloper(rc);

    const started = await rc.ctx.runMutation(
      internal.automations.rest_api.restStartRun,
      {
        organizationId: rc.org.organizationId,
        name,
        input: body.input ?? {},
        mode,
        ...(version !== undefined && { version }),
        ...(projectId !== undefined && { projectId }),
        startedBy: `api-key:${rc.user.userId}`,
      },
    );
    return jsonAccepted({ ...started, name, mode });
  },
);

/** Bind what starts the automation. */
export const automationPutActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const parsed = nameFromPath(url);
    if (parsed instanceof Response) return parsed;
    const { name, subPath } = parsed;

    if (subPath !== 'triggers') {
      return jsonError(`Unknown sub-resource: ${subPath ?? ''}`, 404);
    }

    const body = await readJsonObject(request);
    const kind = optionalEnum(body, 'kind', [
      'schedule',
      'webhook',
      'event',
    ] as const);
    if (kind === undefined) {
      return jsonError('"kind" must be one of: schedule, webhook, event', 400);
    }
    const cron = optionalString(body, 'cron', 200);
    const timezone = optionalString(body, 'timezone', 100);
    const event = optionalString(body, 'event', 200);
    const enabled = optionalBoolean(body, 'enabled');
    const rotateToken = optionalBoolean(body, 'rotateToken');

    await requireRestDeveloper(rc);

    const result = await rc.ctx.runMutation(
      internal.automations.rest_api.restSetTrigger,
      {
        organizationId: rc.org.organizationId,
        actor: rc.user.userId,
        name,
        trigger: {
          kind,
          ...(cron !== undefined && { cron }),
          ...(timezone !== undefined && { timezone }),
          ...(event !== undefined && { event }),
          ...(enabled !== undefined && { enabled }),
        },
        ...(rotateToken !== undefined && { rotateToken }),
      },
    );
    // `token` is present exactly once per minted webhook secret — the row keeps
    // only its hash, so this response is the only place it ever exists.
    return jsonOk({ name, ...result });
  },
);

/** Unbind the automation's trigger. The versions and run history stay. */
export const automationDeleteActions = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const parsed = nameFromPath(url);
    if (parsed instanceof Response) return parsed;
    const { name, subPath } = parsed;

    // The store keys a trigger by the automation name alone (one trigger per
    // automation), so the name IS the trigger's identifier — there is no
    // further path segment to address.
    if (subPath !== 'triggers') {
      return jsonError(`Unknown sub-resource: ${subPath ?? ''}`, 404);
    }

    await requireRestDeveloper(rc);
    await rc.ctx.runMutation(internal.automations.rest_api.restDeleteTrigger, {
      organizationId: rc.org.organizationId,
      name,
    });
    return jsonNoContent();
  },
);

export const getAutomationRun = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, RUNS_PREFIX);
    if (!id) return jsonError('Missing run ID', 400);
    if (subPath !== null) {
      return jsonError(`Unknown sub-resource: ${subPath}`, 404);
    }
    const run = await rc.ctx.runQuery(
      internal.automations.rest_api.restGetRun,
      { organizationId: rc.org.organizationId, runId: id },
    );
    if (!run) return jsonError('Run not found', 404);
    return jsonOk(run);
  },
);

/** `POST /api/v1/runs/:runId/cancel` — stop a run that is still in flight. */
export const runPostActions = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, RUNS_PREFIX);
  if (!id) return jsonError('Missing run ID', 400);
  if (subPath !== 'cancel') {
    return jsonError(`Unknown action: ${subPath ?? ''}`, 404);
  }
  await requireRestDeveloper(rc);
  const result = await rc.ctx.runMutation(
    internal.automations.rest_api.restCancelRun,
    { organizationId: rc.org.organizationId, runId: id },
  );
  return jsonOk(result);
});

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** An explicit `version` on a run request — a positive integer or nothing. */
function readVersionField(body: Record<string, unknown>): number | undefined {
  const value = body.version;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BadRequestError('"version" must be a positive integer');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Internal reads — the API key's half of the store
// ---------------------------------------------------------------------------

const versionSummaryValidator = v.object({
  version: v.number(),
  message: v.optional(v.string()),
  testsPassed: v.optional(v.boolean()),
  createdBy: v.string(),
  createdAt: v.number(),
});

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

/** The trigger as a client may see it — the token verifier stays server-side,
 * exactly as the session read surface has it. */
const triggerViewValidator = v.object({
  name: v.string(),
  kind: v.string(),
  cron: v.optional(v.string()),
  timezone: v.optional(v.string()),
  event: v.optional(v.string()),
  hasToken: v.boolean(),
  enabled: v.boolean(),
  lastFiredAt: v.optional(v.number()),
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

/**
 * The organization's automations, one page at a time.
 *
 * The listing is derived (one entry per NAME, folded from the version rows), so
 * the cursor is the last name of the previous page rather than a row cursor:
 * the list is sorted by name, so resuming after a name is stable even when
 * versions are appended between pages.
 */
export const restListAutomations = internalQuery({
  args: {
    organizationId: v.string(),
    /** A project's automations; absent = the org surface (project-less only). */
    projectId: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        name: v.string(),
        latest: v.number(),
        deployedVersion: v.optional(v.number()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    let projectId: Id<'projects'> | null = null;
    if (args.projectId !== undefined) {
      const normalized = ctx.db.normalizeId('projects', args.projectId);
      if (normalized === null) {
        throw new ConvexError({
          code: 'PROJECT_NOT_FOUND',
          message: `No such project: ${args.projectId}`,
        });
      }
      projectId = normalized;
    }
    const automations = await listAutomationsFor(
      ctx,
      args.organizationId,
      projectId,
    );
    const deployments = await ctx.db
      .query('automationDeployments')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    const live = new Map(deployments.map((row) => [row.name, row.version]));

    // Resume AFTER the name the previous page ended on. A cursor naming an
    // automation that has since been deleted still resumes correctly: the
    // comparison is ordinal, not an identity lookup.
    const cursor = args.cursor;
    let start = 0;
    if (cursor !== null && cursor !== '') {
      const next = automations.findIndex((entry) => entry.name > cursor);
      start = next === -1 ? automations.length : next;
    }
    const slice = automations.slice(start, start + args.limit);
    const isDone = start + slice.length >= automations.length;
    return {
      page: slice.map((entry) => {
        const deployedVersion = live.get(entry.name);
        // Name + latest only: project membership stays a dashboard concern
        // until the REST shape grows a documented field for it.
        return {
          name: entry.name,
          latest: entry.latest,
          ...(deployedVersion !== undefined && { deployedVersion }),
        };
      }),
      isDone,
      continueCursor: isDone ? '' : (slice[slice.length - 1]?.name ?? ''),
    };
  },
});

/** One version's document — the latest when `version` is omitted. */
export const restGetAutomation = internalQuery({
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
export const restListVersions = internalQuery({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.array(versionSummaryValidator),
  handler: async (ctx, args) => {
    const rows = await versionsOf(ctx, args.organizationId, args.name);
    return rows.map(toVersionSummary);
  },
});

/** One automation's runs, newest first, cursor-paginated. */
export const restListRuns = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    page: v.array(runSummaryValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('automationRuns')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .order('desc')
      .paginate({ numItems: args.limit, cursor: args.cursor });
    return {
      page: result.page.map(toRunSummary),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** One run in full, or null when it is not this organization's. */
export const restGetRun = internalQuery({
  args: { organizationId: v.string(), runId: v.string() },
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
    const runId = ctx.db.normalizeId('automationRuns', args.runId);
    if (runId === null) return null;
    const row = await ctx.db.get(runId);
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

/** What starts one automation — an empty list when nothing does. */
export const restListTriggers = internalQuery({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.array(triggerViewValidator),
  handler: async (ctx, args) => {
    const row = await triggerRow(ctx, args.organizationId, args.name);
    return row ? [toTriggerView(row)] : [];
  },
});

// ---------------------------------------------------------------------------
// Internal writes
// ---------------------------------------------------------------------------

/**
 * Start a run for an API-key caller. The capability check happens at the HTTP
 * boundary (the identity lives there), so this records the run and hands it to
 * the durable stepper through the SAME `beginRun` every trigger uses.
 */
export const restStartRun = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    input: v.optional(v.any()),
    mode: v.union(v.literal('mock'), v.literal('live')),
    version: v.optional(v.number()),
    projectId: v.optional(v.string()),
    startedBy: v.string(),
  },
  returns: v.object({ runId: v.id('automationRuns'), version: v.number() }),
  handler: async (ctx, args) => {
    let projectId: Id<'projects'> | undefined;
    if (args.projectId !== undefined) {
      const normalized = ctx.db.normalizeId('projects', args.projectId);
      if (normalized === null) {
        throw new ConvexError({
          code: 'PROJECT_NOT_FOUND',
          message: `No such project: ${args.projectId}`,
        });
      }
      // The automation's bindings decide whether it may run there at all.
      await assertRunProjectAllowed(
        ctx,
        args.organizationId,
        args.name,
        normalized,
      );
      projectId = normalized;
    }
    const started = await beginRun(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      ...(args.version !== undefined && { version: args.version }),
      ...(projectId !== undefined && { projectId }),
      input: args.input ?? {},
      mode: args.mode,
      startedBy: args.startedBy,
    });
    if (!started) {
      throw new ConvexError({
        code: 'AUTOMATION_NOT_DEPLOYED',
        message: `"${args.name}" has no version to run — save a version and deploy it first.`,
      });
    }
    return started;
  },
});

/**
 * Bind the automation's trigger for an API-key caller.
 *
 * The token rule is the one the settings surface applies: a `webhook` trigger
 * mints its secret HERE and returns the plaintext exactly once, and re-binding
 * an existing webhook KEEPS the previous token unless `rotateToken` asks for a
 * new one — so editing a schedule never breaks a URL a vendor already holds.
 */
export const restSetTrigger = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
    trigger: v.object({
      kind: v.union(
        v.literal('schedule'),
        v.literal('webhook'),
        v.literal('event'),
      ),
      cron: v.optional(v.string()),
      timezone: v.optional(v.string()),
      event: v.optional(v.string()),
      enabled: v.optional(v.boolean()),
    }),
    rotateToken: v.optional(v.boolean()),
  },
  returns: v.object({ token: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const existing = await triggerRow(ctx, args.organizationId, args.name);
    let token: string | undefined;
    let tokenHash: string | undefined;
    if (args.trigger.kind === 'webhook') {
      const keepExisting =
        existing?.tokenHash !== undefined && args.rotateToken !== true;
      if (!keepExisting) {
        token = mintWebhookToken();
        tokenHash = await hashWebhookToken(token);
      }
    }
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
    });
    try {
      await store.setTrigger(args.name, {
        ...args.trigger,
        ...(tokenHash !== undefined && { tokenHash }),
      });
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({
        code: 'AUTOMATION_TRIGGER_REJECTED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { ...(token !== undefined && { token }) };
  },
});

/** Unbind the automation's trigger; the versions and run history stay. */
export const restDeleteTrigger = internalMutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await triggerRow(ctx, args.organizationId, args.name);
    if (!row) return { deleted: false };
    await ctx.db.delete(row._id);
    return { deleted: true };
  },
});

/**
 * Stop a run. A cancelled run is terminal: the stepper checks the status on
 * every re-entry, so it stops scheduling instead of starting the next node.
 * Work already performed is not undone — it cannot be.
 */
export const restCancelRun = internalMutation({
  args: { organizationId: v.string(), runId: v.string() },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('automationRuns', args.runId);
    const row = runId === null ? null : await ctx.db.get(runId);
    if (!runId || !row || row.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'AUTOMATION_RUN_NOT_FOUND',
        message: 'No such run for this organization.',
      });
    }
    if (
      row.status === 'success' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
    ) {
      return { cancelled: false };
    }
    await ctx.db.patch(runId, {
      status: 'cancelled',
      detail: 'cancelled by an operator',
      finishedAt: Date.now(),
    });
    return { cancelled: true };
  },
});
