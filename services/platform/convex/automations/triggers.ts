/**
 * What starts an automation, and the rules that decide whether it may.
 *
 * Three kinds, one lifecycle: each resolves to `beginRun`, so a scheduled run, a
 * webhook run and an event run are the same durable object with the same
 * history. What differs is only the proof that the caller is entitled to start
 * it:
 *
 *  - `schedule` — the platform's own minutely scan; the only cross-organization
 *    read in this module, and every run it starts is scoped to the trigger's
 *    own organization;
 *  - `webhook`  — a bearer token in the URL, verified against the stored SHA-256
 *    with a constant-time compare; the plaintext exists only in the response
 *    that minted it;
 *  - `event`    — a platform event, dispatched per organization.
 *
 * A PROGRAMMATIC run needs no trigger row at all. `POST
 * /api/v1/automations/:name/runs` (and the MCP run tools) authenticate an
 * organization API key and check the developer capability at the request
 * boundary, which is a stronger and more revocable proof than a stored row —
 * so nothing here has to be provisioned before an automation is callable.
 *
 * LOOP SAFETY. An automation's own writes must never re-enter the engine. Event
 * dispatch therefore takes the ORIGIN of the event and refuses to fire triggers
 * for anything a run itself produced: an automation that writes a record which
 * raises an event that starts the same automation is an unbounded loop that no
 * per-run guard can stop, because each iteration is a fresh, legitimate-looking
 * run. Refusing at the dispatch boundary is the only place the cycle can be cut
 * without guessing.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import {
  httpAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import { dueOccurrence } from './cron';
import {
  LIVENESS_GRACE_MS,
  LIVENESS_REARM_MS,
  LIVENESS_SWEEP_LIMIT,
} from './liveness';
import { beginRun } from './mutations';
import { assertRunProjectAllowed, bindingsOf } from './store';
import {
  hashWebhookToken,
  isPlausibleWebhookToken,
  tokenHashEquals,
} from './webhook_token';

/** Schedules examined per scan. A tick that cannot finish the fleet is a
 * capacity problem to see in the logs, not a reason to hold a transaction
 * open. */
const SCAN_LIMIT = 200;

/** Default zone for a schedule that names none. */
const DEFAULT_TIMEZONE = 'UTC';

/** Where an event came from. `automation` is refused — see the module note. */
export const eventOriginValidator = v.union(
  v.literal('platform'),
  v.literal('automation'),
);

// ----------------------------------------------------------------- schedule

/**
 * Fire every schedule that came due since it last ran. Reads across
 * organizations by design — this is the platform's scheduler — but each run it
 * starts is scoped to the organization on the trigger row, and no trigger can
 * name an automation outside its own organization because `beginRun` resolves
 * the version through the org-scoped store.
 */
export const scanScheduledTriggers = internalMutation({
  args: {},
  returns: v.object({ examined: v.number(), fired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const triggers = await ctx.db
      .query('automationTriggers')
      .withIndex('by_kind_enabled', (q) =>
        q.eq('kind', 'schedule').eq('enabled', true),
      )
      .take(SCAN_LIMIT);

    let fired = 0;
    for (const trigger of triggers) {
      const cron = trigger.cron;
      if (cron === undefined || cron === '') continue;
      const since = trigger.lastFiredAt ?? trigger.createdAt;
      let due: number | null;
      try {
        due = dueOccurrence(
          cron,
          trigger.timezone ?? DEFAULT_TIMEZONE,
          since,
          now,
        );
      } catch (error) {
        // A schedule the author wrote wrong must not stop the whole scan; it is
        // visible in the logs and in the trigger's stale `lastFiredAt`.
        console.warn(
          `[automations] trigger ${trigger.organizationId}/${trigger.name}: unusable schedule`,
          error instanceof Error ? error.message : error,
        );
        continue;
      }
      if (due === null) continue;

      // Stamp BEFORE starting: a run that throws must not leave the schedule
      // re-firing the same minute on every tick.
      await ctx.db.patch(trigger._id, { lastFiredAt: due });
      const started = await beginRun(ctx, {
        organizationId: trigger.organizationId,
        name: trigger.name,
        input: { trigger: 'schedule', firedAt: due },
        mode: 'live',
        startedBy: `trigger:${trigger._id}`,
      });
      if (started) fired++;
      else {
        console.warn(
          `[automations] trigger ${trigger.organizationId}/${trigger.name}: no deployed version to run`,
        );
      }
    }
    return { examined: triggers.length, fired };
  },
});

/**
 * Enforce the run liveness contract: re-poke every non-terminal run whose
 * `wakeAt` promise expired. The promise is written by whoever last moved the
 * run (claim, park, hand-off, settle) and renewed by the walker's heartbeat
 * while a node works, so a healthy run — however slow the model behind its
 * current node — never appears here; a run appears exactly when its scheduled
 * wake was lost (an action that failed to load mid-deploy, a restart killing
 * an in-flight job, a crashed walker). Scheduled actions are at-most-once, so
 * without this sweep such a run would sleep forever: parked `waiting` runs
 * have NO other wake source once their one-shot resume and settle poke are
 * gone, and even their deadlines are only evaluated inside the very steps
 * that stopped being scheduled.
 *
 * Detection is stateless — any tick recovers everything overdue at that
 * moment, so lost sweep ticks cost latency, never coverage. Rows missing
 * `wakeAt` (written before the field existed) sort before every number in
 * the index and are swept first rather than never. The poke itself re-arms
 * the promise, so consecutive ticks do not double-poke a run whose re-poked
 * step is still queued; the epoch fence in `claimRun` caps the blast of any
 * duplicate that slips through anyway.
 */
export const enforceRunLiveness = internalMutation({
  args: {},
  returns: v.object({ poked: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - LIVENESS_GRACE_MS;
    let poked = 0;
    for (const status of ['queued', 'running', 'waiting'] as const) {
      const rows = await ctx.db
        .query('automationRuns')
        .withIndex('by_status_wakeAt', (q) =>
          q.eq('status', status).lt('wakeAt', cutoff),
        )
        .take(LIVENESS_SWEEP_LIMIT);
      for (const row of rows) {
        await ctx.db.patch(row._id, { wakeAt: Date.now() + LIVENESS_REARM_MS });
        await ctx.scheduler.runAfter(0, internal.automations.stepper.stepRun, {
          organizationId: row.organizationId,
          runId: row._id,
        });
        poked++;
        // Every poke here is a real lost wake — keep it loud enough to see.
        console.warn(
          `[automations] liveness sweep re-poked run ${row._id} (${status}${row.detail ? `, ${row.detail}` : ''}) — its scheduled wake was lost`,
        );
      }
    }
    return { poked };
  },
});

// ------------------------------------------------------------------ webhook

/**
 * The trigger a webhook token addresses. Keyed by the token hash rather than by
 * organization because the token IS the caller's proof of which organization it
 * is acting for — the row decides the scope, and everything downstream is
 * scoped by what this returns.
 */
export const resolveWebhookTrigger = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      triggerId: v.id('automationTriggers'),
      organizationId: v.string(),
      name: v.string(),
      tokenHash: v.string(),
      enabled: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('automationTriggers')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', args.tokenHash))
      .take(2);
    const row: Doc<'automationTriggers'> | undefined = rows[0];
    if (!row || row.kind !== 'webhook' || row.tokenHash === undefined) {
      return null;
    }
    return {
      triggerId: row._id,
      organizationId: row.organizationId,
      name: row.name,
      tokenHash: row.tokenHash,
      enabled: row.enabled,
    };
  },
});

/** Start the run a verified webhook call asked for. `projectId`, from the
 * URL's query, scopes the run — the caller bakes it into the URL they give the
 * vendor. It is validated against the automation's bindings exactly as every
 * other start path is, so a public URL can never widen the run past what the
 * automation is bound to. */
export const fireWebhookTrigger = internalMutation({
  args: {
    organizationId: v.string(),
    triggerId: v.id('automationTriggers'),
    payload: v.any(),
    projectId: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.object({ runId: v.id('automationRuns') })),
  handler: async (ctx, args) => {
    const trigger = await ctx.db.get(args.triggerId);
    if (
      !trigger ||
      trigger.organizationId !== args.organizationId ||
      trigger.kind !== 'webhook' ||
      !trigger.enabled
    ) {
      return null;
    }
    let projectId: Id<'projects'> | undefined;
    if (args.projectId !== undefined) {
      const normalized = ctx.db.normalizeId('projects', args.projectId);
      if (normalized === null) {
        throw new ConvexError({
          code: 'PROJECT_NOT_FOUND',
          message: `No such project: ${args.projectId}`,
        });
      }
      await assertRunProjectAllowed(
        ctx,
        trigger.organizationId,
        trigger.name,
        normalized,
      );
      projectId = normalized;
    }
    await ctx.db.patch(trigger._id, { lastFiredAt: Date.now() });
    const started = await beginRun(ctx, {
      organizationId: trigger.organizationId,
      name: trigger.name,
      ...(projectId !== undefined && { projectId }),
      input: { trigger: 'webhook', payload: args.payload },
      mode: 'live',
      startedBy: `trigger:${trigger._id}`,
    });
    return started ? { runId: started.runId } : null;
  },
});

/** Body cap for an inbound webhook — a payload, not an upload. */
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * `POST /api/automations/webhook/<token>` — the URL an external system calls.
 *
 * Everything about the request that could distinguish "no such token" from
 * "token for a disabled trigger" is deliberately collapsed into one 404: a
 * caller holding a wrong token learns nothing about which tokens exist.
 */
export const automationWebhookHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const token = url.pathname.split('/').pop() ?? null;
  if (!isPlausibleWebhookToken(token)) {
    return new Response('Not found', { status: 404 });
  }

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) {
    return new Response('Payload too large', { status: 413 });
  }
  let payload: unknown = raw;
  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      // A non-JSON body is legitimate for some vendors; hand the text through
      // rather than refusing, and say so in the log for the operator chasing a
      // "why is my payload a string" question.
      console.warn(
        '[automations] webhook body is not JSON; delivering it as text',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const presented = await hashWebhookToken(token);
  const trigger = await ctx.runQuery(
    internal.automations.triggers.resolveWebhookTrigger,
    { tokenHash: presented },
  );
  // The index lookup already matched, so the compare below is belt-and-braces
  // — but it is the check that must never become a plain `===`: it is the one
  // comparison standing between a guessed token and a run.
  if (
    !trigger ||
    !tokenHashEquals(presented, trigger.tokenHash) ||
    !trigger.enabled
  ) {
    return new Response('Not found', { status: 404 });
  }

  // An optional `?projectId=` scopes the run to a project the automation is
  // bound to. The token proved the caller may start this automation, so a bad
  // project is a plain 400 with the reason — not the token-secrecy 404.
  const requestedProject = url.searchParams.get('projectId');
  let started: { runId: Id<'automationRuns'> } | null;
  try {
    started = await ctx.runMutation(
      internal.automations.triggers.fireWebhookTrigger,
      {
        organizationId: trigger.organizationId,
        triggerId: trigger.triggerId,
        payload,
        ...(requestedProject !== null &&
          requestedProject !== '' && { projectId: requestedProject }),
      },
    );
  } catch (error) {
    // The one thing `fireWebhookTrigger` raises (rather than returns) is a bad
    // `projectId` — `assertRunProjectAllowed`'s `ConvexError`; `beginRun`
    // signals "no deployed version" by returning null, handled below. So a
    // ConvexError here is a client projectId error → 400 with its message; any
    // other error is a genuine fault and propagates.
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      const message =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof data.message === 'string'
          ? data.message
          : 'Invalid projectId';
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }
  if (!started) {
    return new Response(
      JSON.stringify({ error: 'automation has no deployed version' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ runId: started.runId }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
});

// -------------------------------------------------------------------- event

/**
 * Start every automation of one organization listening for `event`.
 *
 * `origin: 'automation'` is refused — see the loop-safety note at the top of the
 * module. The refusal is deliberately not an error: the caller did nothing
 * wrong, the platform simply does not let a run's own writes start more runs.
 */
/** A non-empty string property of a value that may or may not be an object —
 * the workhorse for reading a project id out of an event's nested record. A
 * literal `in` per key so the narrowing holds without a cast. */
function stringProp(value: unknown, key: 'projectId' | '_id'): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (key === 'projectId') {
    return 'projectId' in value &&
      typeof value.projectId === 'string' &&
      value.projectId !== ''
      ? value.projectId
      : null;
  }
  return '_id' in value && typeof value._id === 'string' && value._id !== ''
    ? value._id
    : null;
}

/** The project an event payload carries, if any. Events nest the record they
 * are about, and each kind keeps its project in a different place: a `task.*`
 * event nests a task, a `comment.*` event a comment (both with `projectId`), a
 * `project.*` event the project itself (whose own `_id` IS the project). A bare
 * `payload.projectId` is the final fallback. */
function eventPayloadProjectId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  if ('task' in payload) {
    const fromTask = stringProp(payload.task, 'projectId');
    if (fromTask !== null) return fromTask;
  }
  if ('comment' in payload) {
    const fromComment = stringProp(payload.comment, 'projectId');
    if (fromComment !== null) return fromComment;
  }
  if ('project' in payload) {
    const project = payload.project;
    const fromProject =
      stringProp(project, '_id') ?? stringProp(project, 'projectId');
    if (fromProject !== null) return fromProject;
  }
  return stringProp(payload, 'projectId');
}

/** The run project for an event-triggered run: the event's project when the
 * fired automation may act there (an org project it is bound to, or any project
 * for an org-level automation), else `undefined` (fire org-wide). Never throws
 * — a mismatched event project must not abort the whole event fan-out. */
async function runProjectForEvent(
  ctx: MutationCtx,
  organizationId: string,
  name: string,
  candidateProjectId: string,
): Promise<Id<'projects'> | undefined> {
  const projectId = ctx.db.normalizeId('projects', candidateProjectId);
  if (projectId === null) return undefined;
  const project = await ctx.db.get(projectId);
  if (project === null || project.organizationId !== organizationId) {
    return undefined;
  }
  const bindings = await bindingsOf(ctx, organizationId, name);
  if (
    bindings.length > 0 &&
    !bindings.some((binding) => binding.projectId === projectId)
  ) {
    return undefined;
  }
  return projectId;
}

export const dispatchAutomationEvent = internalMutation({
  args: {
    organizationId: v.string(),
    event: v.string(),
    payload: v.optional(v.any()),
    origin: eventOriginValidator,
  },
  returns: v.object({
    started: v.array(v.id('automationRuns')),
    refused: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.origin === 'automation') {
      console.warn(
        `[automations] event "${args.event}" raised by an automation run does not fire triggers (loop safety)`,
      );
      return { started: [], refused: true };
    }
    // The event's own project (a task.* event's task lives in one) becomes the
    // run's operating context when the fired automation can act there —
    // resolved per trigger below, leniently (an event whose project the
    // automation is not bound to still fires the automation org-wide).
    const eventProjectId = eventPayloadProjectId(args.payload);
    const triggers = await ctx.db
      .query('automationTriggers')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    const started = [];
    for (const trigger of triggers) {
      if (
        trigger.kind !== 'event' ||
        !trigger.enabled ||
        trigger.event !== args.event
      ) {
        continue;
      }
      await ctx.db.patch(trigger._id, { lastFiredAt: Date.now() });
      const projectId =
        eventProjectId === null
          ? undefined
          : await runProjectForEvent(
              ctx,
              args.organizationId,
              trigger.name,
              eventProjectId,
            );
      const run = await beginRun(ctx, {
        organizationId: args.organizationId,
        name: trigger.name,
        ...(projectId !== undefined && { projectId }),
        input: { trigger: 'event', event: args.event, payload: args.payload },
        mode: 'live',
        startedBy: `trigger:${trigger._id}`,
      });
      if (run) started.push(run.runId);
    }
    return { started, refused: false };
  },
});
