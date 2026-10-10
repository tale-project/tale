import type { Sql, TransactionSql } from 'postgres';

import { findConnector } from '../../../lib/connectors/catalog.ts';
import {
  planReplay,
  type ReplayKind,
  type ReplayPlan,
  type ReplayRefusalCode,
  type ReplayVersionChoice,
} from '../../../lib/engine/core/record/replay.ts';
import type { Automation } from '../../../lib/engine/core/types.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  type NodeCheckpoint,
  parseRunCheckpoints,
} from '../../core/automations/checkpoints.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { auditActor } from './audit.ts';
import { copyNodeRunsForForkInTx } from './node-runs.ts';
import {
  AutomationError,
  beginRunIdempotentInTx,
  beginRunInTx,
  type BeginRunArgs,
  decodeRunInput,
  deployedVersion,
  versionRow,
} from './store.ts';

/**
 * Running a run again (`lib/engine/core/record/replay.ts` plans it): the
 * run's own input again (`again`), an input a person edited (`edited`), or
 * from one of its steps (`from`) — a fork born with the steps the source
 * finished outside that step and what it feeds, each marked reused, their
 * record copied, and the rest run anew. The replay keeps the source's
 * project; every check a start makes applies (the input schema, the
 * project, a live run on the deployed version), and a live replay is
 * audited. Who replayed it is the new run's own `started_by`.
 *
 * Each door checks who may read the source and start the run, then asks
 * here; a source it may not read answers like a missing one.
 */

/** What a replay asks for. */
export interface ReplayRequest {
  kind: ReplayKind;
  /** The version to run; the source's by default. */
  version?: ReplayVersionChoice;
  /** The source's mode by default. */
  mode?: 'mock' | 'live';
  /** `edited`: the run's input. */
  input?: unknown;
  /** `from`: the step to run again from. */
  from?: string;
}

/** What a replay started. */
export interface ReplayStarted {
  runId: string;
  version: number;
  mode: 'mock' | 'live';
  kind: ReplayKind;
  /** Steps taken from the source run. */
  reused: number;
  /** An idempotency key that already started this replay answered it. */
  duplicate?: true;
}

const REFUSAL_STATUS: Readonly<Record<ReplayRefusalCode, 404 | 409>> = {
  REPLAY_NODE_UNKNOWN: 404,
  REPLAY_GRAPH_CHANGED: 409,
  REPLAY_RUN_NOT_FINISHED: 409,
  REPLAY_MODE_MISMATCH: 409,
  REPLAY_PROGRESS_UNREADABLE: 409,
  REPLAY_INPUT_UNAVAILABLE: 409,
};

interface SourceRow {
  name: string;
  version: number;
  status: string;
  mode: 'mock' | 'live';
  input: unknown;
  checkpoints: unknown;
  projectId: string | null;
}

async function sourceRun(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
  lock: boolean,
): Promise<SourceRow | null> {
  const rows = lock
    ? await sql<SourceRow[]>`
        SELECT name, version, status, mode, input, checkpoints,
               project_id AS "projectId"
        FROM app.automation_runs
        WHERE id = ${runId} AND org_id = ${organizationId}
        FOR SHARE
      `
    : await sql<SourceRow[]>`
        SELECT name, version, status, mode, input, checkpoints,
               project_id AS "projectId"
        FROM app.automation_runs
        WHERE id = ${runId} AND org_id = ${organizationId}
      `;
  return rows[0] ?? null;
}

/** The version a replay runs, and whether it is the deployed one. */
async function targetVersion(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  source: number,
  choice: ReplayVersionChoice,
): Promise<{
  version: number;
  resolved: ReplayPlan['version']['resolved'];
  deployed: boolean;
}> {
  const deployed = await deployedVersion(sql, organizationId, name);
  const of = (
    version: number,
    resolved: ReplayPlan['version']['resolved'],
  ) => ({ version, resolved, deployed: version === deployed });
  if (choice === 'same') return of(source, 'same');
  if (choice === 'deployed') {
    if (deployed === undefined) {
      throw new AutomationError(
        'AUTOMATION_NOT_DEPLOYED',
        'Nothing of this automation is deployed: run another version again.',
        409,
      );
    }
    return of(deployed, 'deployed');
  }
  if (choice === 'latest') {
    const latest = await versionRow(sql, organizationId, name, undefined);
    if (latest === null) {
      throw new AutomationError(
        'AUTOMATION_NOT_FOUND',
        'The automation this run belongs to no longer exists.',
        404,
      );
    }
    return of(latest.version, 'latest');
  }
  const row = await versionRow(sql, organizationId, name, choice);
  if (row === null) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `There is no version ${choice} of this automation.`,
      404,
    );
  }
  return of(choice, 'number');
}

/** What a connector action does, read from the shipped catalog. */
function effectOf(nodeType: string): 'read' | 'write' | 'unknown' {
  const separator = nodeType.indexOf('.');
  if (separator <= 0 || separator === nodeType.length - 1) return 'unknown';
  const connector = findConnector(nodeType.slice(0, separator));
  const action = connector?.actions.find(
    (candidate) => candidate.name === nodeType.slice(separator + 1),
  );
  return action ? action.effects : 'unknown';
}

/** How many items each step ran for in a run, from its record. */
async function itemsOf(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<Map<string, number>> {
  const rows = await sql<{ path: string; items: number }[]>`
    SELECT path, (record -> 'counts' ->> 'items')::int AS items
    FROM app.automation_node_runs
    WHERE run_id = ${runId} AND org_id = ${organizationId}
      AND item_index = -1 AND pass = -1 AND record ? 'counts'
      AND position('[' in path) = 0
  `;
  return new Map(
    rows
      .filter((row) => Number.isInteger(row.items) && row.items > 0)
      .map((row) => [row.path, row.items]),
  );
}

interface Planned {
  source: SourceRow;
  plan: ReplayPlan;
  checkpoints: Record<string, NodeCheckpoint> | null;
}

async function planFor(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sourceRunId: string;
    request: ReplayRequest;
    canStartLive: boolean;
    lock: boolean;
  },
): Promise<Planned | null> {
  const source = await sourceRun(
    sql,
    args.organizationId,
    args.sourceRunId,
    args.lock,
  );
  if (source === null) return null;
  const target = await targetVersion(
    sql,
    args.organizationId,
    source.name,
    source.version,
    args.request.version ?? 'same',
  );
  const [sourceVersion, targetRow] = await Promise.all([
    versionRow(sql, args.organizationId, source.name, source.version),
    target.version === source.version
      ? Promise.resolve(null)
      : versionRow(sql, args.organizationId, source.name, target.version),
  ]);
  const documentOf = (value: unknown): Automation =>
    isRecord(value)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
        (value as unknown as Automation)
      : { name: source.name, nodes: [] };
  const sourceDoc = documentOf(sourceVersion?.document);
  const targetDoc =
    target.version === source.version
      ? sourceDoc
      : documentOf(targetRow?.document);
  const parsed = parseRunCheckpoints(source.checkpoints);
  const checkpoints = parsed.ok ? parsed.checkpoints.nodes : null;
  const plan = planReplay({
    kind: args.request.kind,
    ...(args.request.from !== undefined && { from: args.request.from }),
    mode: args.request.mode ?? source.mode,
    canStartLive: args.canStartLive,
    source: {
      id: args.sourceRunId,
      status: source.status,
      mode: source.mode,
      version: source.version,
      document: sourceDoc,
      checkpoints: checkpoints === null ? null : { nodes: checkpoints },
      // A run recorded before inputs were kept stored none at all.
      inputKnown: source.input !== null,
      items: await itemsOf(sql, args.organizationId, args.sourceRunId),
    },
    target: {
      version: target.version,
      resolved: target.resolved,
      document: targetDoc,
      deployed: target.deployed,
    },
    effectOf,
  });
  return { source, plan, checkpoints };
}

/**
 * What a replay would do, without doing it: what it reuses, what it runs
 * again and sends out a second time, or why it cannot start. Null when the
 * run is not this organization's.
 */
export async function readReplayPlan(
  sql: Sql,
  args: {
    organizationId: string;
    sourceRunId: string;
    request: ReplayRequest;
    canStartLive: boolean;
  },
): Promise<ReplayPlan | null> {
  const planned = await planFor(sql, { ...args, lock: false });
  return planned?.plan ?? null;
}

/**
 * Run a run again, inside the caller's transaction. Null when the run is
 * not this organization's; a replay its plan refuses throws the plan's
 * refusal, and every refusal of a start applies. An idempotency key that
 * already started this replay answers that run, and starts nothing.
 */
export async function replayRunInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    sourceRunId: string;
    request: ReplayRequest;
    startedBy: string;
    canStartLive: boolean;
    apiKeyId?: string;
    visibleProjectIds?: string[];
    idempotencyKey?: string;
  },
): Promise<ReplayStarted | null> {
  const planned = await planFor(tx, { ...args, lock: true });
  if (planned === null) return null;
  const { source, plan, checkpoints } = planned;
  if (plan.refusal !== undefined) {
    throw new AutomationError(
      plan.refusal.code,
      plan.refusal.message,
      REFUSAL_STATUS[plan.refusal.code],
      plan.refusal.nodes === undefined
        ? undefined
        : { nodes: plan.refusal.nodes },
    );
  }
  const { kind } = args.request;
  const reused: Record<string, NodeCheckpoint> = {};
  for (const { nodeId } of plan.reuse) {
    const entry = checkpoints?.[nodeId];
    if (entry !== undefined) {
      reused[nodeId] = { ...entry, reused: { runId: args.sourceRunId } };
    }
  }
  const start: BeginRunArgs = {
    organizationId: args.organizationId,
    name: source.name,
    input:
      kind === 'edited' ? args.request.input : decodeRunInput(source.input),
    mode: plan.mode,
    startedBy: args.startedBy,
    ...(args.apiKeyId !== undefined && { apiKeyId: args.apiKeyId }),
    version: plan.version.target,
    // A replay keeps its source's scope; it is never chosen anew.
    ...(source.projectId === null
      ? { requireOrgScope: true }
      : { projectId: source.projectId }),
    ...(args.visibleProjectIds !== undefined && {
      visibleProjectIds: args.visibleProjectIds,
    }),
    replay: {
      of: args.sourceRunId,
      kind,
      ...(kind === 'from' &&
        args.request.from !== undefined && { fromNode: args.request.from }),
      ...(kind === 'from' && { reused }),
    },
  };
  const started =
    args.idempotencyKey === undefined
      ? await beginRunInTx(tx, start)
      : await beginRunIdempotentInTx(tx, start, {
          // One key, one replay: of this run, of this kind, from this step.
          key: `replay:${args.sourceRunId}:${kind}:${args.request.from ?? ''}:${args.idempotencyKey}`,
        });
  if (started === null) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `There is no version ${plan.version.target} of this automation.`,
      404,
    );
  }
  const answer: ReplayStarted = {
    runId: started.runId,
    version: started.version,
    mode: plan.mode,
    kind,
    reused: plan.reuse.length,
  };
  if ('duplicate' in started && started.duplicate === true) {
    return { ...answer, duplicate: true };
  }
  if (kind === 'from') {
    await copyNodeRunsForForkInTx(tx, {
      organizationId: args.organizationId,
      sourceRunId: args.sourceRunId,
      runId: started.runId,
      paths: plan.reuse.map((step) => step.nodeId),
      at: Date.now(),
    });
  }
  if (plan.mode === 'live') {
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      ...auditActor(args.startedBy),
      action: 'automation.run.replayed',
      category: 'ai',
      resourceType: 'automation_run',
      resourceId: started.runId,
      resourceName: `${source.name}@${started.version}`,
      status: 'success',
      metadata: {
        replayOf: args.sourceRunId,
        kind,
        ...(args.request.from !== undefined && { fromNode: args.request.from }),
        version: started.version,
        reused: plan.reuse.length,
      },
    });
  }
  return answer;
}
