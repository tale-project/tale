/**
 * The provenance ledger: one IMMUTABLE audit-chain entry per settled agent
 * run — the customer-facing record binding a run's artefacts to the model
 * identity, capability scope, knowledge read-set, and reviewer that produced
 * them. Entries ride the per-org hash-chained `auditLogs` table (category
 * `'agent'`, declared in the schema union since before anything emitted it),
 * so chain integrity verification, export, and retention already cover them.
 *
 * Exactly-once by construction, not by bookkeeping of its own: each writer
 * below is invoked INSIDE the one mutation that flips its run row from a
 * live status to a terminal one — the settle election's once-only claim.
 * That status guard admits exactly one terminal transition per run, the
 * ledger write shares its transaction, and so a raced double-settle that
 * degrades to a no-op also writes no second entry.
 *
 * Payloads are BOUNDED — an audit row is an ordinary Convex document, so
 * every embedded array is capped (the named constants below) and every read
 * this module performs is index-backed with an explicit scan bound.
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { convexStorageId } from '../lib/storage/blob_ref';
import { createAuditLog } from './helpers';
import type { AuditLogActorType } from './types';

/** One action for both surfaces; `metadata.surface` tells them apart. */
export const AGENT_RUN_LEDGER_ACTION = 'agent.run_settled';
export const AGENT_RUN_LEDGER_RESOURCE_TYPE = 'agent_run';

/** Deliverables embedded per entry (`metadata.outputs`); `outputCount` keeps
 * the true total when the cap clips. */
export const AGENT_RUN_LEDGER_OUTPUTS_CAP = 50;
/** Distinct knowledge-source refs embedded per entry. */
export const AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP = 200;
/** Approval ids embedded per automation entry. */
export const AGENT_RUN_LEDGER_APPROVALS_CAP = 50;
/** Newest-first bound on the `sandboxToolCalls` read-set scan — clips the
 * OLDEST calls of a pathological run, never the latest. */
export const AGENT_RUN_LEDGER_TOOL_CALL_SCAN_CAP = 500;

/** A standing project-agent session accumulates one gateway token per turn;
 * this run's own token (matched by key id) is among the newest. */
const TOKEN_SCAN_CAP = 50;
/** Reviews per task = runs per task; ours was minted moments before the
 * settle, so it is among the newest. */
const REVIEW_SCAN_CAP = 32;
/** Sandbox sessions per automation run (one per `sandbox`-scoped step). */
const RUN_SESSION_SCAN_CAP = 8;
/** Turn ops per automation-run session (one per agent exec + handoffs). */
const RUN_SESSION_OP_SCAN_CAP = 100;

/**
 * Write the ledger entry for a TASK agent run (`projectAgentRuns`). Must be
 * called from the mutation that stamps the run's terminal status, with the
 * PRE-PATCH row — see the module doctrine above. Every enrichment source is
 * optional-tolerant: a start that died before its op row, a pre-`toolGrants`
 * token, an `s3:` blob with no `_storage` system row, a refused review park
 * all degrade to omitted fields, never to a failed settle.
 */
export async function recordTaskAgentRunLedgerEntry(
  ctx: MutationCtx,
  args: {
    run: Doc<'projectAgentRuns'>;
    finalStatus: 'settled' | 'failed' | 'cancelled';
    settledAt: number;
    /** The failure reason for a `failed` stamp (mirrors the run row's patch). */
    error?: string;
  },
): Promise<void> {
  const { run, finalStatus, settledAt } = args;
  const runKey = String(run._id);

  const task = await ctx.db.get(run.taskId);
  const agent = await ctx.db.get(run.agentId);

  // The turn's op row records what actually SERVED the run: the gateway
  // model ref, the vision polyfill's pick, the minted key id, live spend.
  const op = await ctx.db
    .query('sandboxSessionOps')
    .withIndex('by_sessionId_and_execId', (q) =>
      q.eq('sessionId', run.sessionId).eq('execId', run.execId),
    )
    .first();

  // The run's gateway-token scope snapshot (capability bounds at mint),
  // matched to THIS run via the op row's minted key id.
  let token: Doc<'sandboxSessionTokens'> | undefined;
  if (op?.mintedKeyId !== undefined) {
    const mintedKeyId = op.mintedKeyId;
    const recentTokens = await ctx.db
      .query('sandboxSessionTokens')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', run.sessionId))
      .order('desc')
      .take(TOKEN_SCAN_CAP);
    token = recentTokens.find((row) => row.llmGatewayKeyId === mintedKeyId);
  }

  // Deliverables THIS run stamped onto the task (recorded by the settle
  // choreography before the terminal mark, so they are visible here).
  // sha256/size ride Convex `_storage` system metadata; an `s3:` blob ref
  // has no system row — size falls back to the task row's own snapshot and
  // the hash is omitted.
  const producedByRun = (task?.outputs ?? []).filter(
    (output) => output.runId === run._id,
  );
  const outputs: Record<string, unknown>[] = [];
  for (const output of producedByRun.slice(0, AGENT_RUN_LEDGER_OUTPUTS_CAP)) {
    // `convexStorageId` blind-casts every non-`s3:` string, and
    // `db.system.get` THROWS on an undecodable id — which would wedge the
    // terminal mutation forever (module doctrine: degrade to omitted
    // fields, never to a failed settle). Normalize first; a malformed ref
    // degrades exactly like an `s3:` one — hash omitted, size from the row.
    const rawStorageId = convexStorageId(output.fileId);
    const storageId =
      rawStorageId === null
        ? null
        : ctx.db.system.normalizeId('_storage', rawStorageId);
    const sys = storageId !== null ? await ctx.db.system.get(storageId) : null;
    outputs.push({
      fileName: output.fileName,
      ...(sys?.sha256 !== undefined ? { sha256: sys.sha256 } : {}),
      size: sys?.size ?? output.fileSize,
    });
  }

  // The run's knowledge read-set: distinct refs from this session's tool
  // calls. `knowledgeRefs` is optional — absent on rows written before the
  // field shipped and on non-RAG calls. Attribution prefers the row's
  // exec pin: a row pinned to THIS run's exec is definitively its read; a
  // row pinned to a DIFFERENT exec is a sibling turn's read on this
  // standing session and is excluded even inside the time window — false
  // provenance is worse than omission, and the full trail stays queryable
  // on `sandboxToolCalls`. (A steered run that rotated execs under-reports
  // its pre-rotation reads here for the same reason.) Un-pinned rows keep
  // the [startedAt, settledAt] window fallback.
  const knowledgeReads = new Set<string>();
  let toolCallsScanned = 0;
  for await (const call of ctx.db
    .query('sandboxToolCalls')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', run.sessionId))
    .order('desc')) {
    if (++toolCallsScanned > AGENT_RUN_LEDGER_TOOL_CALL_SCAN_CAP) break;
    if (call.calledAt > settledAt) continue;
    // Newest-first scan: everything from here on predates the run.
    if (call.calledAt < run.startedAt) break;
    if (call.execId !== undefined && call.execId !== run.execId) continue;
    for (const ref of call.knowledgeRefs ?? []) {
      if (knowledgeReads.size >= AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP) break;
      knowledgeReads.add(ref);
    }
    if (knowledgeReads.size >= AGENT_RUN_LEDGER_KNOWLEDGE_READS_CAP) break;
  }

  // Reviewer linkage: the settle minted this run's workflow-free
  // `task_review` earlier in the same choreography; its `requestedFor`
  // names the human the work now waits on. Absent for failed/cancelled
  // runs (nothing parked at in_review) and when the park was refused.
  let reviewerUserId: string | undefined;
  if (finalStatus === 'settled') {
    const reviews = await ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'task_review')
          .eq('resourceId', String(run.taskId)),
      )
      .order('desc')
      .take(REVIEW_SCAN_CAP);
    for (const review of reviews) {
      const metadata: unknown = review.metadata;
      if (!isRecord(metadata) || metadata.runId !== runKey) continue;
      if (typeof metadata.requestedFor === 'string') {
        reviewerUserId = metadata.requestedFor;
      }
      break;
    }
  }

  const gateway: Record<string, unknown> = {
    ...(op?.mintedKeyId !== undefined ? { keyId: op.mintedKeyId } : {}),
    ...(token !== undefined
      ? {
          allowedModels: token.scope.allowedModels,
          budgetCents: token.scope.budgetCents,
        }
      : {}),
    ...(op?.spentCents !== undefined ? { spentCents: op.spentCents } : {}),
  };

  await createAuditLog(ctx, {
    organizationId: run.organizationId,
    // The kick is a person's act on every task lane (board verb, comment
    // @mention, review request-changes): `startedBy` holds their userId.
    actorId: run.startedBy,
    actorType: 'user',
    action: AGENT_RUN_LEDGER_ACTION,
    category: 'agent',
    resourceType: AGENT_RUN_LEDGER_RESOURCE_TYPE,
    resourceId: runKey,
    ...(task !== null ? { resourceName: task.title } : {}),
    status: finalStatus === 'failed' ? 'failure' : 'success',
    ...(finalStatus === 'failed' && args.error !== undefined
      ? { errorMessage: args.error }
      : {}),
    metadata: {
      surface: 'task',
      runId: runKey,
      execId: run.execId,
      taskId: String(run.taskId),
      projectId: String(run.projectId),
      agentId: String(run.agentId),
      ...(agent !== null ? { agentName: agent.name } : {}),
      harness: run.harness,
      ...(run.trigger !== undefined ? { trigger: run.trigger } : {}),
      finalStatus,
      startedAt: run.startedAt,
      settledAt,
      durationMs: Math.max(0, settledAt - run.startedAt),
      model: {
        requested: run.model,
        ...(op?.modelRef !== undefined ? { servedRef: op.modelRef } : {}),
        ...(op?.visionModelRef !== undefined
          ? { visionRef: op.visionModelRef }
          : {}),
      },
      ...(Object.keys(gateway).length > 0 ? { gateway } : {}),
      ...(token !== undefined
        ? {
            grants: {
              connectors: token.scope.connectorGrants,
              ...(token.scope.toolGrants !== undefined
                ? { tools: token.scope.toolGrants }
                : {}),
            },
          }
        : {}),
      ...(outputs.length > 0
        ? { outputs, outputCount: producedByRun.length }
        : {}),
      ...(knowledgeReads.size > 0
        ? { knowledgeReads: [...knowledgeReads] }
        : {}),
      ...(reviewerUserId !== undefined ? { review: { reviewerUserId } } : {}),
    },
  });
}

/**
 * Write the ledger entry for an AUTOMATION run (`automationRuns`). Same
 * calling contract as the task writer: inside the run's one terminal
 * mutation, with the pre-patch row. LIVE runs only — a `mock` run is a test
 * that touches no outside world, so it mints no provenance (enforced here so
 * no call site can forget).
 */
export async function recordAutomationRunLedgerEntry(
  ctx: MutationCtx,
  args: {
    run: Doc<'automationRuns'>;
    finalStatus: 'success' | 'failed' | 'cancelled';
    finishedAt: number;
    /** Length of the run's effect log, where the terminal writer holds it. */
    effectsCount?: number;
    /** The failure detail for a `failed` finish (mirrors the row's patch). */
    detail?: string;
  },
): Promise<void> {
  const { run, finalStatus, finishedAt } = args;
  if (run.mode !== 'live') return;

  const runKey = String(run._id);

  // Approvals raised for this run: the live-write gate keys every
  // `connector_operation` approval on `<runId>:<nodeId>` (approvals/gate.ts),
  // so the run's rows are one contiguous `by_resource` index range —
  // `';'` = `':' + 1`, the established range-scan idiom (see
  // `listAutomationRunSessionsForExecution`). The org filter is defensive:
  // the runId prefix is globally unique by construction.
  const approvalRows = await ctx.db
    .query('approvals')
    .withIndex('by_resource', (q) =>
      q
        .eq('resourceType', 'connector_operation')
        .gte('resourceId', `${runKey}:`)
        .lt('resourceId', `${runKey};`),
    )
    .take(AGENT_RUN_LEDGER_APPROVALS_CAP);
  const approvals = approvalRows
    .filter((row) => row.organizationId === run.organizationId)
    .map((row) => String(row._id));

  // In-run LLM spend: the run's sandbox sessions are owner-keyed on the same
  // `${runId}:` prefix; each agent turn's op row carries its polled spend.
  // Best-effort — ops are session-scoped and can be purged with the session.
  let spentCents = 0;
  let sawSpend = false;
  const sessions = await ctx.db
    .query('sandboxSessions')
    .withIndex('by_owner', (q) =>
      q
        .eq('ownerType', 'workflow_run')
        .gte('ownerId', `${runKey}:`)
        .lt('ownerId', `${runKey};`),
    )
    .take(RUN_SESSION_SCAN_CAP);
  for (const session of sessions) {
    if (session.organizationId !== run.organizationId) continue;
    const ops = await ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', session.sessionId))
      .take(RUN_SESSION_OP_SCAN_CAP);
    for (const op of ops) {
      if (op.spentCents !== undefined) {
        sawSpend = true;
        spentCents += op.spentCents;
      }
    }
  }

  const actor = automationRunActor(run.startedBy);

  await createAuditLog(ctx, {
    organizationId: run.organizationId,
    actorId: actor.actorId,
    actorType: actor.actorType,
    action: AGENT_RUN_LEDGER_ACTION,
    category: 'agent',
    resourceType: AGENT_RUN_LEDGER_RESOURCE_TYPE,
    resourceId: runKey,
    resourceName: run.name,
    status: finalStatus === 'failed' ? 'failure' : 'success',
    ...(finalStatus === 'failed' && args.detail !== undefined
      ? { errorMessage: args.detail }
      : {}),
    metadata: {
      surface: 'automation',
      runId: runKey,
      automationName: run.name,
      automationVersion: run.version,
      ...(run.projectId !== undefined
        ? { projectId: String(run.projectId) }
        : {}),
      startedBy: run.startedBy,
      finalStatus,
      startedAt: run.startedAt,
      settledAt: finishedAt,
      durationMs: Math.max(0, finishedAt - run.startedAt),
      ...(approvals.length > 0 ? { approvals } : {}),
      ...(args.effectsCount !== undefined
        ? { effectsCount: args.effectsCount }
        : {}),
      ...(sawSpend ? { spentCents } : {}),
    },
  });
}

/**
 * The audit actor behind an automation run's `startedBy` marker: `user:<id>`
 * is a person, `api-key:<id>` is a person acting through an org API key, and
 * everything else (`trigger:<id>`, store actors) keeps its origin marker as
 * the actorId under the system actor pattern (`actorId: 'system'` writers
 * elsewhere carry no origin; here the marker IS the origin).
 */
function automationRunActor(startedBy: string): {
  actorId: string;
  actorType: AuditLogActorType;
} {
  if (startedBy.startsWith('user:')) {
    return { actorId: startedBy.slice('user:'.length), actorType: 'user' };
  }
  if (startedBy.startsWith('api-key:')) {
    return { actorId: startedBy.slice('api-key:'.length), actorType: 'api' };
  }
  return {
    actorId: startedBy === '' ? 'system' : startedBy,
    actorType: 'system',
  };
}
