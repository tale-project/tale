import type { TransactionSql } from 'postgres';

import { createAuditLog } from '../audit_logs/service.ts';

/**
 * The provenance ledger: one IMMUTABLE audit-chain entry per settled agent
 * run — the customer-facing record binding a run's artefacts to the model
 * identity that produced them, the capability scope it held, the knowledge
 * it read, and the reviewer it now waits on. Entries ride the per-org
 * hash-chained `app.audit_logs` (category `agent`), so chain verification,
 * export and retention already cover them.
 *
 * Exactly-once BY CONSTRUCTION, not by bookkeeping: every caller invokes
 * this inside the transaction whose `UPDATE … WHERE status IN ('queued',
 * 'running') RETURNING` won the settle election. That guard admits exactly
 * one terminal transition per run, the ledger write shares its transaction,
 * so a raced double-settle that degrades to a no-op also writes no second
 * entry.
 *
 * Payloads are BOUNDED — an audit row is a row, not a bucket — and every
 * enrichment is optional-tolerant: a run that died before its op row, a
 * token without tool grants, a refused review park each degrade to an
 * omitted field, never to a failed settle.
 */

/** Deliverables embedded per entry; `outputCount` keeps the true total. */
const OUTPUTS_CAP = 50;
/** Distinct knowledge refs embedded per entry. */
const KNOWLEDGE_READS_CAP = 200;
/** Newest-first bound on the read-set scan — clips the OLDEST calls of a
 * pathological run, never the latest. */
const TOOL_CALL_SCAN_CAP = 500;

export const AGENT_RUN_LEDGER_ACTION = 'agent.run_settled';
export const AGENT_RUN_LEDGER_RESOURCE_TYPE = 'agent_run';

interface RunRow {
  id: string;
  organizationId: string;
  taskId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  execId: string;
  harness: string | null;
  model: string | null;
  trigger: string | null;
  startedBy: string;
  startedAt: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;
  return record;
}

/**
 * Write the ledger entry for a task agent run. Call from the transaction
 * that stamped the run terminal, with the run's identity — everything else
 * is read here so a caller cannot forget an enrichment.
 */
export async function recordTaskAgentRunLedgerEntry(
  tx: TransactionSql,
  args: {
    runId: string;
    organizationId: string;
    finalStatus: 'settled' | 'failed' | 'cancelled';
    settledAt: number;
    /** The failure reason for a `failed` stamp (mirrors the run row). */
    error?: string;
  },
): Promise<void> {
  const runs = await tx<RunRow[]>`
    SELECT id, org_id AS "organizationId", task_id AS "taskId",
           project_id AS "projectId", agent_id AS "agentId",
           session_id AS "sessionId", exec_id AS "execId", harness, model,
           trigger, started_by AS "startedBy",
           started_at_ms::float8 AS "startedAt"
    FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined) return;
  const startedAt = run.startedAt ?? args.settledAt;

  const tasks = await tx<{ title: string; outputs: unknown }[]>`
    SELECT title, outputs FROM app.tasks WHERE id = ${run.taskId} LIMIT 1
  `;
  const task = tasks[0];
  const agents = await tx<{ name: string }[]>`
    SELECT name FROM app.project_agents WHERE id = ${run.agentId} LIMIT 1
  `;

  // What actually SERVED the run: the gateway model ref, the vision
  // polyfill's pick, the minted key id, live spend.
  const ops = await tx<
    {
      modelRef: string | null;
      visionModelRef: string | null;
      mintedKeyId: string | null;
      spentCents: number | null;
    }[]
  >`
    SELECT model_ref AS "modelRef", vision_model_ref AS "visionModelRef",
           minted_key_id AS "mintedKeyId", spent_cents AS "spentCents"
    FROM app.sandbox_session_ops
    WHERE session_id = ${run.sessionId} AND exec_id = ${run.execId}
    LIMIT 1
  `;
  const op = ops[0];

  // The capability bounds at mint time, matched to THIS run by key id.
  let scope: Record<string, unknown> | null = null;
  if (op?.mintedKeyId != null) {
    const tokens = await tx<{ scope: unknown }[]>`
      SELECT scope FROM app.sandbox_session_tokens
      WHERE session_id = ${run.sessionId}
        AND llm_gateway_key_id = ${op.mintedKeyId}
      ORDER BY created_at_ms DESC LIMIT 1
    `;
    scope = asRecord(tokens[0]?.scope);
  }

  // Deliverables THIS run stamped onto the task (the settle choreography
  // records them before the terminal mark, so they are visible here).
  const allOutputs = Array.isArray(task?.outputs) ? task.outputs : [];
  const producedByRun = allOutputs.filter((output) => {
    const record = asRecord(output);
    return record !== null && record.runId === run.id;
  });
  const outputs = producedByRun.slice(0, OUTPUTS_CAP).map((output) => {
    const record = asRecord(output) ?? {};
    const entry: Record<string, unknown> = {
      fileName: record.fileName,
      size: record.fileSize,
    };
    if (record.sha256 !== undefined) entry.sha256 = record.sha256;
    return entry;
  });

  // The read-set: distinct knowledge refs from this session's tool calls.
  // Attribution prefers the row's exec pin — a row pinned to a DIFFERENT
  // exec is a sibling turn's read on the same standing session and is
  // excluded even inside the time window, because false provenance is worse
  // than omission (the full trail stays queryable on the tool-call table).
  const calls = await tx<
    { knowledgeRefs: string[] | null; mintedKeyId: string | null }[]
  >`
    SELECT knowledge_refs AS "knowledgeRefs", minted_key_id AS "mintedKeyId"
    FROM app.sandbox_tool_calls
    WHERE session_id = ${run.sessionId}
      AND created_at_ms BETWEEN ${startedAt} AND ${args.settledAt}
      AND (minted_key_id IS NULL
           OR ${op?.mintedKeyId ?? null}::text IS NULL
           OR minted_key_id = ${op?.mintedKeyId ?? null})
    ORDER BY created_at_ms DESC
    LIMIT ${TOOL_CALL_SCAN_CAP}
  `;
  const knowledgeReads = new Set<string>();
  for (const call of calls) {
    for (const ref of call.knowledgeRefs ?? []) {
      if (knowledgeReads.size >= KNOWLEDGE_READS_CAP) break;
      knowledgeReads.add(ref);
    }
    if (knowledgeReads.size >= KNOWLEDGE_READS_CAP) break;
  }

  // Reviewer linkage: the settle minted this run's `task_review` earlier in
  // the same choreography; its `requestedFor` names the human the work now
  // waits on. Absent for failed/cancelled runs and refused parks.
  let reviewerUserId: string | undefined;
  if (args.finalStatus === 'settled') {
    const reviews = await tx<{ metadata: unknown }[]>`
      SELECT metadata FROM app.approvals
      WHERE org_id = ${run.organizationId} AND resource_type = 'task_review'
        AND resource_id = ${run.taskId}
      ORDER BY created_at_ms DESC LIMIT 32
    `;
    for (const review of reviews) {
      const metadata = asRecord(review.metadata);
      if (metadata === null || metadata.runId !== run.id) continue;
      if (typeof metadata.requestedFor === 'string') {
        reviewerUserId = metadata.requestedFor;
      }
      break;
    }
  }

  const gateway: Record<string, unknown> = {
    ...(op?.mintedKeyId != null ? { keyId: op.mintedKeyId } : {}),
    ...(scope !== null
      ? {
          allowedModels: scope.allowedModels,
          budgetCents: scope.budgetCents,
        }
      : {}),
    ...(op?.spentCents != null ? { spentCents: op.spentCents } : {}),
  };

  await createAuditLog(tx, {
    organizationId: run.organizationId,
    // The kick is a person's act on every task lane (board verb, comment
    // @mention, review request-changes). An auto-retry run carries its
    // failed predecessor's starter — the retry continues THAT person's
    // kick; `metadata.trigger` tells the two apart.
    actorId: run.startedBy,
    actorType: 'user',
    action: AGENT_RUN_LEDGER_ACTION,
    category: 'agent',
    resourceType: AGENT_RUN_LEDGER_RESOURCE_TYPE,
    resourceId: run.id,
    ...(task !== undefined ? { resourceName: task.title } : {}),
    status: args.finalStatus === 'failed' ? 'failure' : 'success',
    ...(args.finalStatus === 'failed' && args.error !== undefined
      ? { errorMessage: args.error }
      : {}),
    metadata: {
      surface: 'task',
      runId: run.id,
      execId: run.execId,
      taskId: run.taskId,
      projectId: run.projectId,
      agentId: run.agentId,
      ...(agents[0] !== undefined ? { agentName: agents[0].name } : {}),
      ...(run.harness !== null ? { harness: run.harness } : {}),
      ...(run.trigger !== null ? { trigger: run.trigger } : {}),
      finalStatus: args.finalStatus,
      startedAt,
      settledAt: args.settledAt,
      durationMs: Math.max(0, args.settledAt - startedAt),
      model: {
        requested: run.model,
        ...(op?.modelRef != null ? { servedRef: op.modelRef } : {}),
        ...(op?.visionModelRef != null ? { visionRef: op.visionModelRef } : {}),
      },
      ...(Object.keys(gateway).length > 0 ? { gateway } : {}),
      ...(scope !== null
        ? {
            grants: {
              connectors: scope.connectorGrants,
              ...(scope.toolGrants !== undefined
                ? { tools: scope.toolGrants }
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
