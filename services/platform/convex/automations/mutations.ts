/**
 * Write surface of the automation store.
 *
 * The rules that must hold TRANSACTIONALLY live in `store.ts` — versions
 * append, deploy names an existing version and passes the test gate — so every
 * caller here goes through it rather than touching the tables directly.
 *
 * What this module adds is authorization and the run lifecycle:
 *
 *  - authoring an automation (save, deploy, trigger) is a developer capability,
 *    matching the settings surface that fronts it;
 *  - starting a LIVE run is too — a live run may send mail on the organization's
 *    behalf — while a `mock` run performs no IO and is open to any member, which
 *    is what makes the authoring loop fast;
 *  - a run is created BEFORE the first node executes, so the stepper always has
 *    a durable row to record checkpoints into; the internal mutations at the
 *    bottom are that recording surface and are unreachable from a client.
 *
 * Every function takes the organization explicitly and scopes to it — including
 * the internal ones, which additionally verify that the run they were handed
 * belongs to the organization the caller named.
 */

import { ConvexError, v } from 'convex/values';

import type { RunResult, Workflow } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type { NodeCheckpoint, NodeCursor } from './checkpoints';
import { readCheckpoints } from './checkpoints';
import type { StoredTrigger } from './store';
import {
  automationStore,
  deploymentRow,
  triggerRow,
  versionRow,
} from './store';
import { hashWebhookToken, mintWebhookToken } from './webhook_token';

/** How a run is addressed once it exists. */
export type RunId = Id<'workflowRuns'>;

const runModeValidator = v.union(v.literal('mock'), v.literal('live'));

const triggerInputValidator = v.object({
  kind: v.union(
    v.literal('schedule'),
    v.literal('webhook'),
    v.literal('event'),
    v.literal('api-key'),
  ),
  cron: v.optional(v.string()),
  timezone: v.optional(v.string()),
  event: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
});

/** Convert a thrown store-rule violation into a coded client error. */
function asStoreError(error: unknown, code: string): never {
  if (error instanceof ConvexError) throw error;
  throw new ConvexError({
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

// ------------------------------------------------------------------ public

/**
 * Append a version. The document is stored exactly as authored; validation
 * belongs to the dispatch layer (it needs the sandbox to check expressions),
 * and `testsPassed` records what that layer observed so the deploy gate can
 * read a fact instead of re-running the tests.
 */
export const saveWorkflow = mutation({
  args: {
    organizationId: v.string(),
    workflow: v.any(),
    message: v.optional(v.string()),
    testsPassed: v.optional(v.boolean()),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: auth.userId,
    });
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the document grammar; the store only records it
      return await store.save(args.workflow as Workflow, args.message, {
        ...(args.testsPassed !== undefined && {
          testsPassed: args.testsPassed,
        }),
      });
    } catch (error) {
      return asStoreError(error, 'AUTOMATION_SAVE_REJECTED');
    }
  },
});

/** Promote one version to the single live version of the automation. */
export const deployWorkflow = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    version: v.number(),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: auth.userId,
    });
    try {
      return await store.deploy(args.name, args.version);
    } catch (error) {
      return asStoreError(error, 'AUTOMATION_DEPLOY_REJECTED');
    }
  },
});

/**
 * Bind what starts the automation. A `webhook` trigger mints its token HERE and
 * returns the plaintext exactly once — the row keeps only the hash, so this
 * response is the only chance to copy it. Re-binding an existing webhook keeps
 * the previous token unless `rotateToken` asks for a new one, so editing a
 * schedule does not break a URL a vendor already holds.
 */
export const setTrigger = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    trigger: triggerInputValidator,
    rotateToken: v.optional(v.boolean()),
  },
  returns: v.object({ token: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
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
      actor: auth.userId,
    });
    try {
      await store.setTrigger(args.name, {
        ...args.trigger,
        ...(tokenHash !== undefined && { tokenHash }),
      });
    } catch (error) {
      return asStoreError(error, 'AUTOMATION_TRIGGER_REJECTED');
    }
    return { ...(token !== undefined && { token }) };
  },
});

/** Unbind the automation's trigger; the versions and run history stay. */
export const deleteTrigger = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const row = await triggerRow(ctx, args.organizationId, args.name);
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Start a run of the deployed version (or of a named version) and hand it to
 * the durable stepper.
 *
 * `live` needs the developer capability; `mock` needs only membership, because
 * a mock run reaches nothing outside the process.
 */
export const startRun = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    input: v.optional(v.any()),
    mode: v.optional(runModeValidator),
    version: v.optional(v.number()),
  },
  returns: v.object({ runId: v.id('workflowRuns'), version: v.number() }),
  handler: async (ctx, args) => {
    const mode = args.mode ?? 'mock';
    let actor: string;
    if (mode === 'live') {
      const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
      actor = auth.userId;
    } else {
      const authUser = await getAuthUserIdentity(ctx);
      if (!authUser) {
        throw new ConvexError({
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
        });
      }
      await getOrganizationMember(ctx, args.organizationId, authUser);
      actor = authUser.userId;
    }
    const started = await beginRun(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      ...(args.version !== undefined && { version: args.version }),
      input: args.input ?? {},
      mode,
      startedBy: `user:${actor}`,
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
 * Stop a run. A cancelled run is terminal: the stepper checks the status on
 * every re-entry and at every node boundary, so it stops scheduling instead of
 * starting the next node. Work already performed is not undone — it cannot be.
 */
export const cancelRun = mutation({
  args: { organizationId: v.string(), runId: v.id('workflowRuns') },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) {
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
    await ctx.db.patch(args.runId, {
      status: 'cancelled',
      detail: 'cancelled by an operator',
      finishedAt: Date.now(),
    });
    return { cancelled: true };
  },
});

// ------------------------------------------------------------- run lifecycle

export interface BeginRunArgs {
  organizationId: string;
  name: string;
  version?: number;
  input: unknown;
  mode: 'mock' | 'live';
  /** What started it: a trigger row id, or `user:<id>` for a manual run. */
  startedBy: string;
}

/**
 * Create the run row and schedule the first step. Shared by the public
 * `startRun` and by every trigger, so a scheduled run and a hand-started one
 * are the same object with the same lifecycle.
 *
 * Returns `null` when the automation has nothing to run — no deployment and no
 * named version — which callers report in their own terms (a trigger logs and
 * moves on; the mutation above refuses).
 */
export async function beginRun(
  ctx: MutationCtx,
  args: BeginRunArgs,
): Promise<{ runId: RunId; version: number } | null> {
  const version =
    args.version ??
    (await deploymentRow(ctx, args.organizationId, args.name))?.version;
  if (version === undefined) return null;
  const row = await versionRow(ctx, args.organizationId, args.name, version);
  if (!row) return null;

  const runId = await ctx.db.insert('workflowRuns', {
    organizationId: args.organizationId,
    name: args.name,
    version,
    status: 'queued',
    mode: args.mode,
    startedBy: args.startedBy,
    input: args.input,
    checkpoints: { nodes: {}, executions: 0 },
    startedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.automations.stepper.stepRun, {
    organizationId: args.organizationId,
    runId,
  });
  return { runId, version };
}

// -------------------------------------------------- the store, from an action
//
// `dispatch()` runs in an action and has no database handle, so the authoring
// loop reaches the store through these. They are INTERNAL: authorization is the
// caller's job (a builder session proves the developer capability when it
// starts, not once per tool call), and they are unreachable from a client.
// Every one of them still takes — and scopes to — the organization.

/** Append a version on behalf of an action-side caller. */
export const storeSave = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    workflow: v.any(),
    message: v.optional(v.string()),
    testsPassed: v.optional(v.boolean()),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) => {
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the document grammar; the store only records it
    return await store.save(args.workflow as Workflow, args.message, {
      ...(args.testsPassed !== undefined && { testsPassed: args.testsPassed }),
    });
  },
});

/** Promote a version on behalf of an action-side caller. The store applies the
 * deploy gate, so this is not a way around it. */
export const storeDeploy = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
    version: v.number(),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) =>
    await automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
    }).deploy(args.name, args.version),
});

/**
 * Record a trigger on behalf of an action-side caller. A webhook token is NOT
 * minted here: the plaintext can only be shown once, and an agent tool call is
 * not a surface that can show it to a person, so the token is minted by the
 * `setTrigger` mutation the settings UI calls.
 */
export const storeSetTrigger = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
    trigger: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store validates the kind and its required fields
    await store.setTrigger(args.name, args.trigger as StoredTrigger);
    return null;
  },
});

/** Record a run the caller executed in one piece (`run_deployed`). Durable runs
 * are written by the stepper instead. */
export const storeRecordRun = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
    version: v.number(),
    result: v.any(),
    mode: runModeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the result shape
    const result = args.result as RunResult;
    await store.recordRun(args.name, args.version, result, args.mode);
    return null;
  },
});

// ---------------------------------------------------------------- internal

/** The run row, as the stepper's bookkeeping sees it. */
async function requireRun(
  ctx: MutationCtx,
  organizationId: string,
  runId: RunId,
) {
  const row = await ctx.db.get(runId);
  if (!row || row.organizationId !== organizationId) {
    throw new ConvexError({
      code: 'AUTOMATION_RUN_NOT_FOUND',
      message: 'No such run for this organization.',
    });
  }
  return row;
}

/**
 * Take a run for execution. Returns false when it is not runnable — already
 * finished, or cancelled while its continuation sat in the scheduler — which is
 * how cancellation actually stops work.
 */
export const claimRun = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
  },
  returns: v.object({ claimed: v.boolean(), status: v.string() }),
  handler: async (ctx, args) => {
    const row = await requireRun(ctx, args.organizationId, args.runId);
    if (
      row.status !== 'queued' &&
      row.status !== 'running' &&
      row.status !== 'waiting'
    ) {
      return { claimed: false, status: row.status };
    }
    if (row.status !== 'running') {
      await ctx.db.patch(args.runId, { status: 'running' });
    }
    return { claimed: true, status: 'running' };
  },
});

/**
 * Record how far the run has got: a finished node, the cursor inside a node
 * that is still in progress, or both.
 *
 * Writing a node's checkpoint is what makes its work "already done" — the next
 * turn steps over any node that has an entry, which is precisely why a
 * completed effectful node cannot run a second time. The cursor is written
 * WITHOUT a checkpoint while a `forEach` is mid-array, so the items already
 * sent are never re-sent; omitting it clears it, which is what finishing a node
 * does.
 */
export const recordProgress = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
    nodeId: v.optional(v.string()),
    checkpoint: v.optional(v.any()),
    cursor: v.optional(v.any()),
    executions: v.number(),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    const row = await requireRun(ctx, args.organizationId, args.runId);
    const checkpoints = readCheckpoints(row.checkpoints);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns the checkpoint shape; the row stores it as JSON
    const checkpoint = args.checkpoint as NodeCheckpoint | undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same
    const cursor = args.cursor as NodeCursor | undefined;
    const nodes =
      args.nodeId !== undefined && checkpoint !== undefined
        ? { ...checkpoints.nodes, [args.nodeId]: checkpoint }
        : checkpoints.nodes;
    await ctx.db.patch(args.runId, {
      checkpoints: {
        nodes,
        ...(cursor !== undefined && cursor !== null && { cursor }),
        executions: args.executions,
      },
    });
    return { status: row.status };
  },
});

/**
 * Park the run: a `repeatUntil` whose condition is not met yet, or a node
 * waiting on a human decision. The cursor keeps the in-node position, so the
 * resumed turn continues the same item and pass rather than starting the node
 * over.
 */
export const suspendRun = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
    detail: v.string(),
    cursor: v.optional(v.any()),
    executions: v.number(),
    resumeInMs: v.number(),
  },
  returns: v.object({ suspended: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await requireRun(ctx, args.organizationId, args.runId);
    if (row.status === 'cancelled') return { suspended: false };
    const checkpoints = readCheckpoints(row.checkpoints);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns the cursor shape
    const cursor = args.cursor as NodeCursor | undefined;
    await ctx.db.patch(args.runId, {
      status: 'waiting',
      detail: args.detail,
      checkpoints: {
        nodes: checkpoints.nodes,
        ...(cursor !== undefined && cursor !== null && { cursor }),
        executions: args.executions,
      },
    });
    await ctx.scheduler.runAfter(
      args.resumeInMs,
      internal.automations.stepper.stepRun,
      { organizationId: args.organizationId, runId: args.runId },
    );
    return { suspended: true };
  },
});

/** Hand the run back to the scheduler because this turn ran out of time. */
export const continueRun = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
    resumeInMs: v.number(),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await requireRun(ctx, args.organizationId, args.runId);
    if (row.status === 'cancelled') return { scheduled: false };
    await ctx.scheduler.runAfter(
      args.resumeInMs,
      internal.automations.stepper.stepRun,
      { organizationId: args.organizationId, runId: args.runId },
    );
    return { scheduled: true };
  },
});

/**
 * Close the run. A cancelled run stays cancelled — a result arriving after an
 * operator stopped it must not resurrect it as a success.
 */
export const finishRun = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('workflowRuns'),
    status: v.union(v.literal('success'), v.literal('failed')),
    output: v.optional(v.any()),
    trace: v.any(),
    effects: v.any(),
    detail: v.optional(v.string()),
    executions: v.number(),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    const row = await requireRun(ctx, args.organizationId, args.runId);
    if (row.status === 'cancelled') return { status: row.status };
    const checkpoints = readCheckpoints(row.checkpoints);
    await ctx.db.patch(args.runId, {
      status: args.status,
      ...(args.output !== undefined && { output: args.output }),
      trace: args.trace,
      effects: args.effects,
      ...(args.detail !== undefined && { detail: args.detail }),
      checkpoints: { nodes: checkpoints.nodes, executions: args.executions },
      finishedAt: Date.now(),
    });
    return { status: args.status };
  },
});
