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

import type { Automation, RunResult } from '../../lib/engine/core/types';
import { defineAbilityFor } from '../../lib/permissions/ability';
import { isRecord } from '../../lib/utils/type-utils';
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
  assertAutomationName,
  automationStore,
  deploymentRow,
  triggerRow,
  versionRow,
  versionsOf,
} from './store';
import { hashWebhookToken, mintWebhookToken } from './webhook_token';

/** How a run is addressed once it exists. */
export type RunId = Id<'automationRuns'>;

const runModeValidator = v.union(v.literal('mock'), v.literal('live'));

/**
 * What a caller may bind. `api-key` is deliberately NOT accepted: the kind
 * carried no behavior of its own — a programmatic start is what the API is for —
 * so it is refused at every write path. The stored union still allows the value
 * (see the schema) so rows written before it was retired stay readable.
 */
const triggerInputValidator = v.object({
  kind: v.union(
    v.literal('schedule'),
    v.literal('webhook'),
    v.literal('event'),
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
export const saveAutomation = mutation({
  args: {
    organizationId: v.string(),
    automation: v.any(),
    message: v.optional(v.string()),
    testsPassed: v.optional(v.boolean()),
    /** Owning project for a NEW automation; an existing name keeps its
     * owner and refuses a mismatch (see the store's save). */
    projectId: v.optional(v.id('projects')),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: auth.userId,
      ...(args.projectId !== undefined && { projectId: args.projectId }),
    });
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the document grammar; the store only records it
      return await store.save(args.automation as Automation, args.message, {
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
export const deployAutomation = mutation({
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
  returns: v.object({ runId: v.id('automationRuns'), version: v.number() }),
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
  args: { organizationId: v.string(), runId: v.id('automationRuns') },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    return await cancelRunRow(ctx, args.organizationId, args.runId);
  },
});

/**
 * Mark a run cancelled. The rule lives here rather than in the mutation above
 * because two authorized callers need it — a person on the runs page and an API
 * client at the MCP endpoint — and "already settled means nothing to cancel"
 * must read the same way to both.
 */
async function cancelRunRow(
  ctx: MutationCtx,
  organizationId: string,
  runId: RunId,
): Promise<{ cancelled: boolean }> {
  const row = await ctx.db.get(runId);
  if (!row || row.organizationId !== organizationId) {
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
}

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

  const runId = await ctx.db.insert('automationRuns', {
    organizationId: args.organizationId,
    name: args.name,
    version,
    // Denormalized from the version row's owner: the run belongs to whatever
    // surface the automation lives on, regardless of who started it.
    ...(row.projectId !== undefined && { projectId: row.projectId }),
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
// loop reaches the store through these. They are INTERNAL: for the AUTHORING
// writes, authorization is the caller's job (a builder session proves the
// developer capability when it starts, not once per tool call), and they are
// unreachable from a client. The RUN-CONTROL ones are different and authorize
// themselves — they are the path an org API key takes through the MCP endpoint,
// where no session has vouched for the caller yet. Every one of them still
// takes — and scopes to — the organization.

/** Append a version on behalf of an action-side caller. */
export const storeSave = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    automation: v.any(),
    message: v.optional(v.string()),
    testsPassed: v.optional(v.boolean()),
    /** Owning project for a NEW automation; an existing name keeps its
     * owner and refuses a mismatch (see the store's save). */
    projectId: v.optional(v.id('projects')),
  },
  returns: v.object({ name: v.string(), version: v.number() }),
  handler: async (ctx, args) => {
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: args.actor,
      ...(args.projectId !== undefined && { projectId: args.projectId }),
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the document grammar; the store only records it
    return await store.save(args.automation as Automation, args.message, {
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

/**
 * The user an action-side actor string names. A write is attributed as
 * `api-key:<userId>` at the MCP endpoint and as a bare user id inside a builder
 * session, so the prefix — when there is one — is stripped to get back to the
 * person whose role decides what the call may do.
 */
function actorUserId(actor: string): string {
  const separator = actor.indexOf(':');
  return separator === -1 ? actor : actor.slice(separator + 1);
}

/**
 * Authorize an action-side actor for a run-control call.
 *
 * The public `startRun`/`cancelRun` above read the caller's role from the Convex
 * auth identity. An API key has no identity to read — it is verified by the REST
 * gateway, which then hands the actor string down — so the role is resolved from
 * the (organization, user) pair explicitly and the SAME capability is applied:
 * `read developerSettings`, exactly as `requireOrgAdminOrDeveloper` does. This
 * is the pattern the OAuth callback handler uses for the same reason.
 *
 * `mock` needs membership only — a mock run reaches nothing outside the process,
 * which is the rule the public mutation states as well.
 */
async function authorizeActorRun(
  ctx: MutationCtx,
  organizationId: string,
  actor: string,
  need: 'membership' | 'developer',
): Promise<void> {
  const userId = actorUserId(actor);
  if (userId === '') {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'The caller could not be identified.',
    });
  }
  let role: string;
  try {
    const member = await getOrganizationMember(ctx, organizationId, { userId });
    role = member.role;
  } catch (error) {
    // The reason is logged but not returned: "no such organization" and "not
    // your organization" must read identically to a caller probing org ids,
    // while an infrastructure failure still has to be diagnosable here.
    console.warn(
      '[automations] run control refused — membership could not be resolved',
      error instanceof Error ? error.message : error,
    );
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: 'The caller is not a member of this organization.',
    });
  }
  if (
    need === 'developer' &&
    defineAbilityFor(role).cannot('read', 'developerSettings')
  ) {
    throw new ConvexError({
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
      message: `Role "${role}" lacks the developer-settings capability required to perform this action.`,
    });
  }
}

/**
 * Start a durable run on behalf of an action-side caller.
 *
 * Unlike the other `store*` mutations, this one authorizes: the rest are reached
 * only after a session has already proved the developer capability, while this
 * is the path an org API key takes through the MCP endpoint, where the role
 * check has not happened yet. Starting a LIVE run may send mail on the
 * organization's behalf, so it is gated exactly as the public `startRun` is.
 */
export const storeStartRun = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
    input: v.optional(v.any()),
    mode: runModeValidator,
    version: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({ runId: v.id('automationRuns'), version: v.number() }),
  ),
  handler: async (ctx, args) => {
    await authorizeActorRun(
      ctx,
      args.organizationId,
      args.actor,
      args.mode === 'live' ? 'developer' : 'membership',
    );
    return await beginRun(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      ...(args.version !== undefined && { version: args.version }),
      input: args.input ?? {},
      mode: args.mode,
      startedBy: args.actor,
    });
  },
});

/** Stop a run on behalf of an action-side caller. Cancelling live work is an
 * operator act, so it needs the developer capability the public mutation needs.
 * An unusable handle reads as "no such run" rather than raising. */
export const storeCancelRun = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    runId: v.string(),
  },
  returns: v.union(v.null(), v.object({ cancelled: v.boolean() })),
  handler: async (ctx, args) => {
    await authorizeActorRun(ctx, args.organizationId, args.actor, 'developer');
    const runId = ctx.db.normalizeId('automationRuns', args.runId);
    if (!runId) return null;
    return await cancelRunRow(ctx, args.organizationId, runId);
  },
});

/** Unbind a trigger on behalf of an action-side caller. Binding and unbinding
 * are the same authoring capability, so this is gated like the public
 * `deleteTrigger`. */
export const storeDeleteTrigger = internalMutation({
  args: {
    organizationId: v.string(),
    actor: v.string(),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeActorRun(ctx, args.organizationId, args.actor, 'developer');
    const row = await triggerRow(ctx, args.organizationId, args.name);
    if (row) await ctx.db.delete(row._id);
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

// ------------------------------------------------------------- provisioning

/** One shipped pack as the provisioner hands it over: the workflow document
 * plus the trigger binding its manifest declares. */
const seedPackValidator = v.object({
  document: v.any(),
  trigger: v.optional(v.any()),
});

/**
 * Seed the shipped default packs into this organization's store — the write
 * half of `provisioning/provision_default_automations.ts`.
 *
 * Create-if-absent, atomic for the whole batch: an automation whose name
 * already has ANY version is skipped outright (the organization's own history
 * wins — a shipped change to a pack is a new-org default, never an in-place
 * rewrite), and a trigger is bound only when the name carries none, so an
 * organization that deleted or re-bound a seeded trigger is never re-armed
 * behind its back. Nothing is deployed: a seeded pack is a draft behind the
 * same deploy gate as any authored version.
 */
export const seedDefaultPacks = internalMutation({
  args: {
    organizationId: v.string(),
    packs: v.array(seedPackValidator),
  },
  returns: v.object({
    provisioned: v.array(v.string()),
    skipped: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const store = automationStore(ctx, {
      organizationId: args.organizationId,
      actor: 'system:provisioning',
    });
    const provisioned: string[] = [];
    const skipped: string[] = [];
    for (const pack of args.packs) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the engine owns the document grammar; the pack suite validates every shipped document
      const document = pack.document as Automation;
      const name = assertAutomationName(document.name ?? '');
      const existing = await versionsOf(ctx, args.organizationId, name);
      if (existing.length > 0) {
        skipped.push(name);
        continue;
      }
      await store.save(document, 'Shipped default pack');
      const boundTrigger = await triggerRow(ctx, args.organizationId, name);
      if (pack.trigger !== undefined && boundTrigger === null) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store validates the kind and its required fields
        await store.setTrigger(name, pack.trigger as StoredTrigger);
      }
      provisioned.push(name);
    }
    return { provisioned, skipped };
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
    runId: v.id('automationRuns'),
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
    runId: v.id('automationRuns'),
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
    runId: v.id('automationRuns'),
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
    runId: v.id('automationRuns'),
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
    runId: v.id('automationRuns'),
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

/**
 * The agent host's settle: write a finished agent turn's result into the
 * parked run's cursor and poke the stepper to consume it.
 *
 * Deliberately tolerant where the stepper's own mutations throw: the turn may
 * have been orphaned (run cancelled, node failed by its deadline, a newer
 * exec kicked) — a stale settle then changes nothing and schedules nothing.
 * The exactly-once guarantees live upstream (`claimSessionOpFinalize`); this
 * mutation only refuses to resurrect state that moved on.
 */
export const recordAgentTurnSettled = internalMutation({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
    nodeId: v.string(),
    execId: v.string(),
    result: v.any(),
  },
  returns: v.object({ recorded: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.runId);
    if (!row || row.organizationId !== args.organizationId) {
      return { recorded: false };
    }
    if (
      row.status !== 'waiting' &&
      row.status !== 'running' &&
      row.status !== 'queued'
    ) {
      return { recorded: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const cursor = checkpoints.cursor;
    if (
      cursor === undefined ||
      cursor.node !== args.nodeId ||
      cursor.agent === undefined ||
      cursor.agent.execId !== args.execId ||
      cursor.agent.result !== undefined
    ) {
      return { recorded: false };
    }
    await ctx.db.patch(args.runId, {
      checkpoints: {
        nodes: checkpoints.nodes,
        cursor: {
          ...cursor,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the agent host owns the result shape; the row stores it as JSON
          agent: { ...cursor.agent, result: args.result as never },
        },
        executions: checkpoints.executions,
      },
    });
    await ctx.scheduler.runAfter(0, internal.automations.stepper.stepRun, {
      organizationId: args.organizationId,
      runId: args.runId,
    });
    return { recorded: true };
  },
});

/**
 * Start the deployed automation a task's Start action names, as a live run
 * carrying the task as its input — the task-surface entry the retired engine
 * used to serve. Authorization is the CALLER's: the public task action has
 * already verified org membership, and the deploy gate (admin/dev) was the
 * privileged act; running a deployed task workflow is a member act, exactly
 * as it was on the old desk.
 *
 * Refuses a duplicate: one live run per (automation, task) at a time.
 */
export const startTaskWorkflowRun = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    taskId: v.string(),
    input: v.any(),
    startedBy: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      runId: v.id('automationRuns'),
      alreadyRunning: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    // One live run per (automation, task): scan this automation's recent runs
    // for a non-terminal one carrying the same task.
    const recent = await ctx.db
      .query('automationRuns')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .order('desc')
      .take(25);
    const live = recent.find(
      (row) =>
        (row.status === 'queued' ||
          row.status === 'running' ||
          row.status === 'waiting') &&
        isRecord(row.input) &&
        isRecord(row.input.task) &&
        row.input.task.id === args.taskId,
    );
    if (live !== undefined) {
      return { runId: live._id, alreadyRunning: true };
    }
    const started = await beginRun(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      input: args.input,
      mode: 'live',
      startedBy: args.startedBy,
    });
    if (!started) return null;
    return { runId: started.runId };
  },
});
