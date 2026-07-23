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
import type { RunResult, Workflow } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

/** Who a write is attributed to — a user id, or a system marker for a write
 * the platform performs on its own behalf. */
export type Actor = string;

export interface AutomationStoreScope {
  organizationId: string;
  actor: Actor;
  /**
   * Owning project for a NEW automation this store creates. Ownership is a
   * property of the name: the first version pins it, later saves keep it,
   * and a save that names a DIFFERENT project than the existing rows refuses
   * rather than silently moving the automation between surfaces.
   */
  projectId?: Id<'projects'>;
}

/** Extra facts a save carries that the engine's `DispatchStore.save` signature
 * has no room for. `testsPassed` is the deploy gate's evidence: it records
 * whether the version's own acceptance tests passed at save time, so promotion
 * reads a fact instead of re-running them. */
export interface SaveOptions {
  testsPassed?: boolean;
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

export interface ConvexAutomationStore extends DispatchStore {
  save(
    workflow: Workflow,
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

const TRIGGER_KINDS = ['schedule', 'webhook', 'event', 'api-key'] as const;
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
): Promise<Array<Doc<'workflows'>>> {
  const rows = await ctx.db
    .query('workflows')
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
): Promise<Doc<'workflows'> | null> {
  if (version === undefined) {
    const rows = await versionsOf(ctx, organizationId, name);
    return rows.at(-1) ?? null;
  }
  return await ctx.db
    .query('workflows')
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
): Promise<Doc<'workflowDeployments'> | null> {
  return await ctx.db
    .query('workflowDeployments')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .unique();
}

export async function triggerRow(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
): Promise<Doc<'workflowTriggers'> | null> {
  return await ctx.db
    .query('workflowTriggers')
    .withIndex('by_org_name', (q) =>
      q.eq('organizationId', organizationId).eq('name', name),
    )
    .unique();
}

/** The organization's automations with their latest version — `list()`'s data,
 * shared with the read surface so the two can never disagree. */
export async function listAutomationsFor(
  ctx: QueryCtx,
  organizationId: string,
  /**
   * Surface filter: an id lists ONE project's automations, `null` lists the
   * org page's (project-less only), and `undefined` — the engine's view —
   * lists everything, so subworkflow resolution and the chat capability
   * registry see project automations too.
   */
  projectId?: Id<'projects'> | null,
): Promise<Array<{ name: string; latest: number }>> {
  const rows =
    projectId === undefined
      ? await ctx.db
          .query('workflows')
          .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
          .collect()
      : await ctx.db
          .query('workflows')
          .withIndex('by_org_project', (q) =>
            q
              .eq('organizationId', organizationId)
              .eq('projectId', projectId ?? undefined),
          )
          .collect();
  const latest = new Map<string, number>();
  for (const row of rows) {
    latest.set(row.name, Math.max(latest.get(row.name) ?? 0, row.version));
  }
  return [...latest.entries()]
    .map(([name, version]) => ({ name, latest: version }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The read half of the store — everything the executor needs to resolve a
 * subworkflow reference. Usable from a plain query, and org-scoped like the
 * full store.
 */
export function automationReadStore(
  ctx: QueryCtx,
  organizationId: string,
): StoreAdapter {
  return {
    list: () => listAutomationsFor(ctx, organizationId),
    async get(name, version) {
      const row = await versionRow(ctx, organizationId, name, version);
      if (!row) return null;
      return { meta: { version: row.version }, workflow: row.document };
    },
    async deployedVersion(name) {
      const row = await deploymentRow(ctx, organizationId, name);
      return row?.version ?? null;
    },
  };
}

// ------------------------------------------------------------------ writes

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
    async save(workflow, message, options) {
      const name = assertAutomationName(workflow.name ?? '');
      const rows = await versionsOf(ctx, organizationId, name);
      const version = (rows.at(-1)?.version ?? 0) + 1;
      // Ownership is pinned by the first version: later saves inherit it,
      // and a caller naming a DIFFERENT project refuses — an automation
      // never silently moves between the org page and a project tab.
      const owner = rows.length > 0 ? rows[0].projectId : scope.projectId;
      if (
        rows.length > 0 &&
        scope.projectId !== undefined &&
        scope.projectId !== owner
      ) {
        throw new Error(
          `"${name}" belongs to a different surface — it cannot be saved into another project`,
        );
      }
      await ctx.db.insert('workflows', {
        organizationId,
        name,
        version,
        ...(owner !== undefined && { projectId: owner }),
        document: workflow,
        ...(message !== undefined && message !== '' && { message }),
        ...(options?.testsPassed !== undefined && {
          testsPassed: options.testsPassed,
        }),
        createdBy: actor,
        createdAt: Date.now(),
      });
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
        await ctx.db.insert('workflowDeployments', {
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
      await ctx.db.insert('workflowTriggers', {
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
      // Denormalize the owning project from the version row so a project's
      // run log never joins over names.
      const versioned = await versionRow(ctx, organizationId, name, version);
      await ctx.db.insert('workflowRuns', {
        organizationId,
        name,
        version,
        ...(versioned?.projectId !== undefined && {
          projectId: versioned.projectId,
        }),
        status: result.status === 'success' ? 'success' : 'failed',
        mode,
        startedBy: actor,
        input: null,
        ...(result.output !== undefined && { output: result.output }),
        trace: result.trace,
        effects: result.effects,
        ...(result.error?.message !== undefined && {
          detail: result.error.message,
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
 * an action, because executing a workflow needs the code sandbox. It is handed
 * one of these: every method forwards to the registered function that wraps the
 * transactional store above, so an agent editing an automation and a person
 * clicking Save go through identical rules, and the organization scope travels
 * with every call rather than being remembered somewhere.
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
    save: (workflow, message, options) =>
      ctx.runMutation(internal.automations.mutations.storeSave, {
        organizationId,
        actor,
        workflow,
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
  };
}
