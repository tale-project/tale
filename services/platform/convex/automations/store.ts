/**
 * The Convex host behind the engine's `DispatchStore` — the same interface the
 * in-memory reference store implements (`lib/engine/store/memory.ts`), backed
 * by the four automation tables.
 *
 * Two rules the memory store establishes and this one MUST mirror, because the
 * builder selftest runs against one and production against the other:
 *
 *  - **versions are immutable and contiguous** — `save` only ever appends, so
 *    version N of an automation is byte-identical forever and `latest` is the
 *    row count;
 *  - **deploy is a separate, explicit act** — it names an existing version and
 *    replaces the single deployment row; it never touches history.
 *
 * The one thing this store adds is the boundary the reference store has no
 * concept of: EVERY read and write is scoped to one organization. The scope is
 * bound at construction and applied through the `by_org…` indexes, so no method
 * can be called in a way that reaches another organization's rows — including
 * `deploy`, whose version lookup is org-scoped too.
 *
 * The store is transactional (it takes a Convex query/mutation ctx), which is
 * what makes "the next version is latest + 1" safe under concurrency. An action
 * — where `dispatch()` and the authoring loop live — has no database handle, so
 * it uses {@link automationActionStore}: the same interface, forwarding to the
 * registered functions that wrap THIS store. The versioning and deploy rules
 * therefore exist in exactly one place whatever the caller.
 */

import type { DispatchStore, TriggerSpec } from '../../lib/engine/api/dispatch';
import type { StoreAdapter } from '../../lib/engine/core/slots';
import type { Automation, RunResult } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { boundRunTrace, truncateRunDetail } from './bound_run_payload';

/** Who a write is attributed to — a user id, or a system marker for a write
 * the platform performs on its own behalf. */
export type Actor = string;

export interface AutomationStoreScope {
  organizationId: string;
  actor: Actor;
  /**
   * Install target for a NEW automation this store creates: the first save
   * also binds the name to this project (a row in
   * `automationProjectBindings`), atomically with the version insert. Saves
   * of an EXISTING name ignore it — project membership is managed explicitly
   * (`setAutomationProjects`, the upload lane's install target), never moved
   * as a side effect of saving a version.
   */
  projectId?: Id<'projects'>;
}

/** Extra facts a save carries that the engine's `DispatchStore.save` signature
 * has no room for. `testsPassed` is the deploy gate's evidence: it records
 * whether the version's own acceptance tests passed at save time, so promotion
 * reads a fact instead of re-running them. */
export interface SaveOptions {
  testsPassed?: boolean;
  /** The version's task-surface contract (already zod-validated by the
   * caller); stored beside the document. */
  taskContract?: unknown;
  /** The version's settings declaration (already zod-validated by the
   * caller); stored beside the document. */
  settings?: unknown;
  /** How the version names itself to people (already zod-validated by the
   * caller) — the pack manifest's display half. */
  presentation?: unknown;
}

/** What `setTrigger` may persist. Mirrors the engine's `TriggerSpec` plus the
 * one field only the host can produce: the hash of a webhook token (the
 * plaintext is shown once at creation and never stored). */
export interface StoredTrigger extends TriggerSpec {
  cron?: string;
  timezone?: string;
  event?: string;
  tokenHash?: string;
  enabled?: boolean;
}

/**
 * The authoring contract both Convex-backed stores satisfy. The engine's
 * MANAGEMENT methods (`startRun`, `getRun`, `listTriggers`, …) stay optional as
 * the engine declares them: only {@link automationActionStore} fills them in,
 * because starting a durable run needs the scheduler and an authorization check
 * that belongs to a registered function rather than to the transactional core.
 */
export interface ConvexAutomationStore extends DispatchStore {
  save(
    automation: Automation,
    message?: string,
    options?: SaveOptions,
  ): Promise<{ name: string; version: number }>;
  setTrigger(name: string, trigger: StoredTrigger): Promise<void>;
  recordRun(
    name: string,
    version: number,
    result: RunResult,
    mode: 'mock' | 'live',
  ): Promise<void>;
}

/**
 * The kinds a write may bind. `api-key` is absent on purpose: a programmatic
 * start is what the REST and MCP surfaces are for, so the kind never had a
 * delivery path of its own and is refused here. The stored union in the schema
 * still ALLOWS the value, so a row written before it was retired stays readable.
 */
const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;
type TriggerKind = (typeof TRIGGER_KINDS)[number];

function isTriggerKind(value: unknown): value is TriggerKind {
  return (
    typeof value === 'string' &&
    (TRIGGER_KINDS as readonly string[]).includes(value)
  );
}

/** An automation name is a `/`-separated path, unique per organization. */
const NAME_RE =
  /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;
const NAME_MAX = 200;

export function assertAutomationName(name: string): string {
  const value = name.trim();
  if (value.length === 0 || value.length > NAME_MAX || !NAME_RE.test(value)) {
    throw new Error(
      `"${name}" is not a valid automation name — use lowercase slug segments separated by "/" (e.g. "billing/dunning-reminder")`,
    );
  }
  return value;
}

// ------------------------------------------------------------------- reads

/** Every version of one automation, oldest first. */
export async function versionsOf(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Array<Doc<'automations'>>> {
  const rows = await ctx.db
    .query('automations')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .collect();
  return rows.sort((a, b) => a.version - b.version);
}

/** One version, or the latest when `version` is omitted. */
export async function versionRow(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  version?: number,
): Promise<Doc<'automations'> | null> {
  if (version === undefined) {
    const rows = await versionsOf(ctx, organizationId, name);
    return rows.at(-1) ?? null;
  }
  return await ctx.db
    .query('automations')
    .withIndex('by_org_name_version', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('name', name)
        .eq('version', version),
    )
    .unique();
}

export async function deploymentRow(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Doc<'automationDeployments'> | null> {
  return await ctx.db
    .query('automationDeployments')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .unique();
}

export async function triggerRow(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Doc<'automationTriggers'> | null> {
  return await ctx.db
    .query('automationTriggers')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .unique();
}

/** One automation's project bindings. The binding set is the scope: empty
 * means org-level, non-empty means exactly those projects. */
export async function bindingsOf(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Array<Doc<'automationProjectBindings'>>> {
  return await ctx.db
    .query('automationProjectBindings')
    .withIndex('by_org_name_project', (q) =>
      q.eq('organizationId', organizationId).eq('automationName', name),
    )
    .collect();
}

/**
 * The single project an automation is bound to, when that is unambiguous —
 * what a run started WITHOUT a project context (a trigger firing, a manual
 * run) is attributed to. Multi-bound and org-level automations resolve to
 * nothing: their runs belong to no one project unless the caller says so.
 */
export async function soleBindingProject(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Id<'projects'> | undefined> {
  const bindings = await bindingsOf(ctx, organizationId, name);
  return bindings.length === 1 ? bindings[0]?.projectId : undefined;
}

/** The organization's automations with their latest version — `list()`'s data,
 * shared with the read surface so the two can never disagree. */
export async function listAutomationsFor(
  ctx: QueryCtx,
  organizationId: string,
  /**
   * Surface filter: an id lists ONE project's automations (the names bound to
   * it), `null` lists the org-level ones (no bindings), and `undefined` — the
   * engine's view — lists everything, so subautomation resolution and the
   * chat capability registry see project automations too.
   */
  projectId?: Id<'projects'> | null,
): Promise<
  Array<{ name: string; latest: number; projectIds: Array<Id<'projects'>> }>
> {
  const rows = await ctx.db
    .query('automations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .collect();
  const bindings = await ctx.db
    .query('automationProjectBindings')
    .withIndex('by_org_name_project', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();
  const bound = new Map<string, Array<Id<'projects'>>>();
  for (const binding of bindings) {
    const list = bound.get(binding.automationName) ?? [];
    list.push(binding.projectId);
    bound.set(binding.automationName, list);
  }
  const latest = new Map<string, number>();
  for (const row of rows) {
    latest.set(row.name, Math.max(latest.get(row.name) ?? 0, row.version));
  }
  return [...latest.entries()]
    .map(([name, latestVersion]) => ({
      name,
      latest: latestVersion,
      projectIds: bound.get(name) ?? [],
    }))
    .filter((entry) => {
      if (projectId === undefined) return true;
      if (projectId === null) return entry.projectIds.length === 0;
      return entry.projectIds.includes(projectId);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The read half of the store — everything the executor needs to resolve a
 * subautomation reference. Usable from a plain query, and org-scoped like the
 * full store.
 */
export function automationReadStore(
  ctx: QueryCtx,
  organizationId: string,
): StoreAdapter {
  return {
    // The adapter's contract is name+latest only — project membership is a
    // surface concern the engine has no business seeing.
    list: async () =>
      (await listAutomationsFor(ctx, organizationId)).map(
        ({ name, latest }) => ({ name, latest }),
      ),
    async get(name, version) {
      const row = await versionRow(ctx, organizationId, name, version);
      if (!row) return null;
      return { meta: { version: row.version }, automation: row.document };
    },
    async deployedVersion(name) {
      const row = await deploymentRow(ctx, organizationId, name);
      return row?.version ?? null;
    },
  };
}

// ------------------------------------------------------------------ writes

/**
 * Bind one automation name to one project — idempotent, and transactional
 * with whatever mutation hosts it (the first save's install intent, the
 * upload lane's target, the reconcile mutation). Refuses a project that does
 * not exist or lives in another organization, so a binding row is only ever
 * a true statement.
 */
export async function bindAutomationToProject(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    automationName: string;
    projectId: Id<'projects'>;
    actor: Actor;
  },
): Promise<{ bound: boolean }> {
  const project = await ctx.db.get(args.projectId);
  if (!project || project.organizationId !== args.organizationId) {
    throw new Error(
      `cannot bind "${args.automationName}" — the project does not exist in this organization`,
    );
  }
  const existing = await ctx.db
    .query('automationProjectBindings')
    .withIndex('by_org_name_project', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('automationName', args.automationName)
        .eq('projectId', args.projectId),
    )
    .unique();
  if (existing) return { bound: false };
  await ctx.db.insert('automationProjectBindings', {
    organizationId: args.organizationId,
    automationName: args.automationName,
    projectId: args.projectId,
    boundAt: Date.now(),
    boundBy: args.actor,
  });
  return { bound: true };
}

/**
 * Reconcile one automation's binding set to exactly `projectIds` — the
 * Projects panel saves the whole selection, so add and remove land in one
 * transaction and two concurrent saves converge on one of the two complete
 * selections rather than an interleaving. Empty = org-level. Refuses an
 * unknown name: a binding must always point at a real automation.
 */
export async function reconcileAutomationProjects(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    actor: Actor;
    name: string;
    projectIds: ReadonlyArray<Id<'projects'>>;
  },
): Promise<{ bound: number; unbound: number }> {
  const name = assertAutomationName(args.name);
  const versions = await versionsOf(ctx, args.organizationId, name);
  if (versions.length === 0) {
    throw new Error(`"${name}" has no versions in this organization`);
  }
  const desired = new Set(args.projectIds);
  const existing = await bindingsOf(ctx, args.organizationId, name);
  const current = new Set(existing.map((row) => row.projectId));
  let bound = 0;
  let unbound = 0;
  for (const row of existing) {
    if (desired.has(row.projectId)) continue;
    await ctx.db.delete(row._id);
    unbound++;
  }
  for (const projectId of desired) {
    if (current.has(projectId)) continue;
    await bindAutomationToProject(ctx, {
      organizationId: args.organizationId,
      automationName: name,
      projectId,
      actor: args.actor,
    });
    bound++;
  }
  return { bound, unbound };
}

/**
 * The full store for one organization. `ctx` must be a mutation context: the
 * write methods are what make this more than the read adapter above.
 */
export function automationStore(
  ctx: MutationCtx,
  scope: AutomationStoreScope,
): ConvexAutomationStore {
  const { organizationId, actor } = scope;
  const reads = automationReadStore(ctx, organizationId);

  return {
    // Arrow wrappers keep the read helpers bound to their own closure rather
    // than being passed as free references.
    list: () => reads.list(),
    get: (name: string, version?: number) => reads.get(name, version),
    deployedVersion: (name: string) => reads.deployedVersion(name),

    /**
     * Append a version. The next number is `latest + 1` computed inside this
     * transaction, so two concurrent saves cannot mint the same version: Convex
     * serializes conflicting transactions and the loser retries against the
     * row it did not see.
     */
    async save(automation, message, options) {
      const name = assertAutomationName(automation.name ?? '');
      const rows = await versionsOf(ctx, organizationId, name);
      const version = (rows.at(-1)?.version ?? 0) + 1;
      await ctx.db.insert('automations', {
        organizationId,
        name,
        version,
        document: automation,
        ...(message !== undefined && message !== '' && { message }),
        ...(options?.testsPassed !== undefined && {
          testsPassed: options.testsPassed,
        }),
        ...(options?.taskContract !== undefined && {
          taskContract: options.taskContract,
        }),
        ...(options?.settings !== undefined && {
          settings: options.settings,
        }),
        ...(options?.presentation !== undefined && {
          presentation: options.presentation,
        }),
        createdBy: actor,
        createdAt: Date.now(),
      });
      // A NEW automation saved from a project surface starts bound to it —
      // the install intent lands atomically with the first version. Later
      // saves never touch bindings: membership is managed explicitly, so
      // saving a version cannot move an automation between surfaces.
      if (rows.length === 0 && scope.projectId !== undefined) {
        await bindAutomationToProject(ctx, {
          organizationId,
          automationName: name,
          projectId: scope.projectId,
          actor,
        });
      }
      return { name, version };
    },

    /**
     * Promote one version. Refuses a version that does not exist in THIS
     * organization (same message as the reference store) and one whose own
     * tests failed at save time — the deploy gate, applied here as well as in
     * `dispatch()` so no caller can route around it.
     */
    async deploy(name, version) {
      const row = await versionRow(ctx, organizationId, name, version);
      if (!row) {
        throw new Error(`cannot deploy unknown version ${name}@${version}`);
      }
      if (row.testsPassed === false) {
        throw new Error(
          `deploy gate: ${name}@${version} was saved with failing tests — fix them and save a new version`,
        );
      }
      const existing = await deploymentRow(ctx, organizationId, name);
      const patch = {
        version,
        deployedBy: actor,
        deployedAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, patch);
      else
        await ctx.db.insert('automationDeployments', {
          organizationId,
          name,
          ...patch,
        });
      return { name, version };
    },

    /**
     * Bind what starts the automation. One trigger per automation name, so
     * re-recording replaces the binding in place and a webhook URL survives a
     * redeploy. A webhook token hash is never cleared by an update that does
     * not carry one — the URL a vendor already holds keeps working.
     */
    async setTrigger(name, trigger) {
      const automation = assertAutomationName(name);
      if (!isTriggerKind(trigger.kind)) {
        throw new Error(
          `unknown trigger kind "${String(trigger.kind)}" — one of ${TRIGGER_KINDS.join(', ')}`,
        );
      }
      const kind = trigger.kind;
      if (kind === 'schedule' && !trigger.cron) {
        throw new Error('a schedule trigger needs a cron expression');
      }
      if (kind === 'event' && !trigger.event) {
        throw new Error('an event trigger needs an event name');
      }
      const existing = await triggerRow(ctx, organizationId, automation);
      const now = Date.now();
      const fields = {
        kind,
        ...(trigger.cron !== undefined && { cron: trigger.cron }),
        ...(trigger.timezone !== undefined && { timezone: trigger.timezone }),
        ...(trigger.event !== undefined && { event: trigger.event }),
        ...(trigger.tokenHash !== undefined && {
          tokenHash: trigger.tokenHash,
        }),
        enabled: trigger.enabled ?? true,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, fields);
        return;
      }
      await ctx.db.insert('automationTriggers', {
        organizationId,
        name: automation,
        ...fields,
        createdBy: actor,
        createdAt: now,
      });
    },

    /**
     * Record a run the caller executed in one piece (the dispatch surface's
     * `run_deployed`). Durable runs are written by the stepper instead, which
     * needs the row to exist BEFORE the first node runs.
     */
    async recordRun(name, version, result, mode) {
      const now = Date.now();
      // A one-piece run has no caller project context, so it is attributed
      // to the automation's sole bound project when that is unambiguous —
      // the same rule `beginRun` applies to trigger-started runs.
      const soleProject = await soleBindingProject(ctx, organizationId, name);
      await ctx.db.insert('automationRuns', {
        organizationId,
        name,
        version,
        ...(soleProject !== undefined && { projectId: soleProject }),
        status: result.status === 'success' ? 'success' : 'failed',
        mode,
        startedBy: actor,
        input: null,
        ...(result.output !== undefined && { output: result.output }),
        // First (and only) write of this run's log — bound the diagnostics
        // here. `output` and `effects` are left whole: one is returned to the
        // caller, the other is the side-effect audit trail.
        trace: boundRunTrace(result.trace),
        effects: result.effects,
        ...(result.error?.message !== undefined && {
          detail: truncateRunDetail(result.error.message),
        }),
        startedAt: now,
        finishedAt: now,
      });
    },
  };
}

// ------------------------------------------------------------ from an action

/**
 * The same store, for a caller that has no database handle.
 *
 * `dispatch()` — the one method table behind every authoring surface — runs in
 * an action, because executing an automation needs the code sandbox. It is handed
 * one of these: every method forwards to the registered function that wraps the
 * transactional store above, so an agent editing an automation and a person
 * clicking Save go through identical rules, and the organization scope travels
 * with every call rather than being remembered somewhere.
 *
 * This is also the store that hosts DURABLE runs, which the transactional one
 * cannot: `startRun` hands the run to the stepper through the scheduler, and its
 * mutation authorizes the actor first — the MCP endpoint reaches this with an
 * org API key, so "who may start a live run" is decided here rather than assumed.
 */
export function automationActionStore(
  ctx: ActionCtx,
  scope: AutomationStoreScope,
): ConvexAutomationStore {
  const { organizationId, actor } = scope;
  return {
    list: () =>
      ctx.runQuery(internal.automations.queries.storeList, { organizationId }),
    get: (name, version) =>
      ctx.runQuery(internal.automations.queries.storeGet, {
        organizationId,
        name,
        ...(version !== undefined && { version }),
      }),
    deployedVersion: (name) =>
      ctx.runQuery(internal.automations.queries.storeDeployedVersion, {
        organizationId,
        name,
      }),
    save: (automation, message, options) =>
      ctx.runMutation(internal.automations.mutations.storeSave, {
        organizationId,
        actor,
        automation,
        // Ownership travels with the scope: an action-side save into a
        // project surface pins the project exactly as a transactional one.
        ...(scope.projectId !== undefined && { projectId: scope.projectId }),
        ...(message !== undefined && message !== '' && { message }),
        ...(options?.testsPassed !== undefined && {
          testsPassed: options.testsPassed,
        }),
      }),
    deploy: (name, version) =>
      ctx.runMutation(internal.automations.mutations.storeDeploy, {
        organizationId,
        actor,
        name,
        version,
      }),
    setTrigger: async (name, trigger) => {
      await ctx.runMutation(internal.automations.mutations.storeSetTrigger, {
        organizationId,
        actor,
        name,
        trigger,
      });
    },
    recordRun: async (name, version, result, mode) => {
      await ctx.runMutation(internal.automations.mutations.storeRecordRun, {
        organizationId,
        actor,
        name,
        version,
        result,
        mode,
      });
    },

    // The management half. Starting and cancelling go through mutations that
    // authorize the ACTOR — an org API key reaching this through the MCP
    // endpoint has proved who it is but not what its role may do, and a live
    // run may touch real systems.
    startRun: (name, input, mode, version) =>
      ctx.runMutation(internal.automations.mutations.storeStartRun, {
        organizationId,
        actor,
        name,
        input,
        mode,
        ...(version !== undefined && { version }),
      }),
    cancelRun: async (runId) => {
      const result = await ctx.runMutation(
        internal.automations.mutations.storeCancelRun,
        { organizationId, actor, runId },
      );
      // An unusable handle is reported as a miss, the same way `getRun` does.
      if (result === null) throw new Error(`no run "${runId}"`);
      return result;
    },
    deleteTrigger: async (name) => {
      await ctx.runMutation(internal.automations.mutations.storeDeleteTrigger, {
        organizationId,
        actor,
        name,
      });
    },
    listRuns: (options) =>
      ctx.runQuery(internal.automations.queries.storeListRuns, {
        organizationId,
        ...(options.name !== undefined && { name: options.name }),
        ...(options.limit !== undefined && { limit: options.limit }),
      }),
    getRun: (runId) =>
      ctx.runQuery(internal.automations.queries.storeGetRun, {
        organizationId,
        runId,
      }),
    listVersions: (name) =>
      ctx.runQuery(internal.automations.queries.storeListVersions, {
        organizationId,
        name,
      }),
    listTriggers: (name) =>
      ctx.runQuery(internal.automations.queries.storeListTriggers, {
        organizationId,
        ...(name !== undefined && { name }),
      }),
  };
}
