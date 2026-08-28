import type { Sql, TransactionSql } from 'postgres';

import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../../convex/automations/webhook_token.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * The automation store over PG — versions (immutable, contiguous),
 * bindings, deployments, triggers, tombstones, and the durable RUN
 * substrate the reused 0.4 stepper drives: claim with an epoch fence,
 * heartbeat/progress renewing the wakeAt liveness promise, suspend with a
 * chainSeq-fenced poll chain, continue hand-offs, and a single terminal
 * door. Scheduling maps 1:1 from the 0.4 scheduler onto pg-boss
 * (`automation.step` / `automation.poll` jobs with `startAfter`), enqueued
 * IN the same transaction as the state write (the constitution's
 * transactional-enqueue rule) so a scheduled resume can never outrun or
 * miss its row.
 */

export const RUN_CLAIM_PROMISE_MS = 3 * 60_000;

export class AutomationError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.status = status;
  }
}

/** Mirror of the 0.4 name rule: '/'-separated slug path. */
export function assertAutomationName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 200 ||
    !/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/.test(trimmed)
  ) {
    throw new AutomationError(
      'AUTOMATION_NAME_INVALID',
      `"${name}" is not a valid automation name — lowercase slug segments separated by "/".`,
    );
  }
  return trimmed;
}

// ------------------------------------------------------------- definitions

export interface SaveVersionArgs {
  organizationId: string;
  name: string;
  document: unknown;
  actor: string;
  message?: string;
  testsPassed?: boolean;
  taskContract?: unknown;
  settings?: unknown;
  presentation?: unknown;
}

export async function saveVersion(
  sql: Sql,
  args: SaveVersionArgs,
): Promise<{ name: string; version: number }> {
  const name = assertAutomationName(args.name);
  return sql.begin(async (tx) => {
    const rows = await tx<{ version: number }[]>`
      INSERT INTO app.automations (
        org_id, name, version, document, message, tests_passed,
        task_contract, settings, presentation, created_by, created_at_ms
      )
      SELECT ${args.organizationId}, ${name},
             coalesce(max(version), 0) + 1,
             ${tx.json(toJson(args.document))}, ${args.message ?? null},
             ${args.testsPassed ?? null},
             ${args.taskContract === undefined ? null : tx.json(toJson(args.taskContract))},
             ${args.settings === undefined ? null : tx.json(toJson(args.settings))},
             ${args.presentation === undefined ? null : tx.json(toJson(args.presentation))},
             ${args.actor}, ${Date.now()}
      FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${name}
      RETURNING version
    `;
    const version = rows[0]?.version;
    if (version === undefined) throw new Error('version insert failed');
    // Saving under a deleted name makes it alive again.
    await tx`
      DELETE FROM app.automation_tombstones
      WHERE org_id = ${args.organizationId} AND name = ${name}
    `;
    return { name, version };
  });
}

export interface VersionRow {
  name: string;
  version: number;
  document: unknown;
  message: string | null;
  testsPassed: boolean | null;
  taskContract: unknown;
  settings: unknown;
  presentation: unknown;
  createdBy: string;
  createdAt: number;
}

export async function versionRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
  version: number | undefined,
): Promise<VersionRow | null> {
  if (version === undefined) return null;
  const rows = await sql<VersionRow[]>`
    SELECT name, version, document, message, tests_passed AS "testsPassed",
           task_contract AS "taskContract", settings, presentation,
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt"
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
      AND version = ${version}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deployedVersion(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<number | undefined> {
  const rows = await sql<{ version: number }[]>`
    SELECT version FROM app.automation_deployments
    WHERE org_id = ${organizationId} AND name = ${name}
    LIMIT 1
  `;
  return rows[0]?.version;
}

export async function deploy(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    version: number;
    actor: string;
  },
): Promise<{ name: string; version: number }> {
  const row = await versionRow(
    sql,
    args.organizationId,
    args.name,
    args.version,
  );
  if (!row) {
    throw new AutomationError(
      'AUTOMATION_VERSION_UNKNOWN',
      `cannot deploy unknown version ${args.name}@${args.version}`,
      404,
    );
  }
  if (row.testsPassed === false) {
    throw new AutomationError(
      'AUTOMATION_DEPLOY_REJECTED',
      `deploy gate: ${args.name}@${args.version} was saved with failing tests — fix them and save a new version`,
      409,
    );
  }
  await sql`
    INSERT INTO app.automation_deployments (
      org_id, name, version, deployed_by, deployed_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.name}, ${args.version}, ${args.actor},
      ${Date.now()}
    )
    ON CONFLICT (org_id, name) DO UPDATE SET
      version = EXCLUDED.version, deployed_by = EXCLUDED.deployed_by,
      deployed_at_ms = EXCLUDED.deployed_at_ms
  `;
  return { name: args.name, version: args.version };
}

export interface AutomationListing {
  name: string;
  latestVersion: number;
  deployedVersion: number | null;
  presentation: unknown;
  projectIds: string[];
}

export async function listAutomations(
  sql: Sql,
  organizationId: string,
): Promise<AutomationListing[]> {
  const rows = await sql<
    {
      name: string;
      latestVersion: number;
      deployedVersion: number | null;
      presentation: unknown;
    }[]
  >`
    SELECT a.name, max(a.version) AS "latestVersion",
           d.version AS "deployedVersion",
           (array_agg(a.presentation ORDER BY a.version DESC))[1]
             AS presentation
    FROM app.automations a
    LEFT JOIN app.automation_deployments d
      ON d.org_id = a.org_id AND d.name = a.name
    WHERE a.org_id = ${organizationId}
    GROUP BY a.name, d.version
    ORDER BY a.name
  `;
  const bindings = await sql<{ automationName: string; projectId: string }[]>`
    SELECT automation_name AS "automationName", project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId}
  `;
  const byName = new Map<string, string[]>();
  for (const binding of bindings) {
    const list = byName.get(binding.automationName) ?? [];
    list.push(binding.projectId);
    byName.set(binding.automationName, list);
  }
  return rows.map((row) =>
    Object.assign({ projectIds: byName.get(row.name) ?? [] }, row),
  );
}

export async function listVersions(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<
  Array<{
    version: number;
    message: string | null;
    testsPassed: boolean | null;
    createdBy: string;
    createdAt: number;
  }>
> {
  return sql`
    SELECT version, message, tests_passed AS "testsPassed",
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt"
    FROM app.automations
    WHERE org_id = ${organizationId} AND name = ${name}
    ORDER BY version DESC
  ` as unknown as Promise<
    Array<{
      version: number;
      message: string | null;
      testsPassed: boolean | null;
      createdBy: string;
      createdAt: number;
    }>
  >;
}

// ---------------------------------------------------------------- bindings

export async function setAutomationProjects(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    projectIds: string[];
    actor: string;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const owned = await tx<{ id: string }[]>`
      SELECT id FROM app.projects
      WHERE org_id = ${args.organizationId}
        AND id = ANY(${args.projectIds})
    `;
    if (owned.length !== new Set(args.projectIds).size) {
      throw new AutomationError(
        'AUTOMATION_PROJECT_UNKNOWN',
        'One of the projects does not exist in this organization.',
        404,
      );
    }
    await tx`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${args.organizationId}
        AND automation_name = ${args.name}
        AND NOT (project_id = ANY(${args.projectIds}))
    `;
    for (const projectId of args.projectIds) {
      await tx`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_at_ms, bound_by
        ) VALUES (
          ${args.organizationId}, ${args.name}, ${projectId}, ${Date.now()},
          ${args.actor}
        )
        ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
      `;
    }
  });
}

export async function bindingProjectIds(
  sql: Sql | TransactionSql,
  organizationId: string,
  name: string,
): Promise<string[]> {
  const rows = await sql<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.automation_project_bindings
    WHERE org_id = ${organizationId} AND automation_name = ${name}
  `;
  return rows.map((row) => row.projectId);
}

// ---------------------------------------------------------------- triggers

export interface TriggerInput {
  kind: 'schedule' | 'webhook' | 'event';
  cron?: string;
  timezone?: string;
  event?: string;
  enabled?: boolean;
  rotateToken?: boolean;
}

/** One trigger per name; a webhook mints its token here and returns the
 * plaintext exactly once. Re-binding keeps the previous token unless asked
 * to rotate. */
export async function setTrigger(
  sql: Sql,
  args: {
    organizationId: string;
    name: string;
    trigger: TriggerInput;
    actor: string;
  },
): Promise<{ token?: string }> {
  const now = Date.now();
  return sql.begin(async (tx) => {
    const existing = await tx<
      { id: string; kind: string; tokenHash: string | null }[]
    >`
      SELECT id, kind, token_hash AS "tokenHash"
      FROM app.automation_triggers
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      LIMIT 1
    `;
    let token: string | undefined;
    let tokenHash: string | null = existing[0]?.tokenHash ?? null;
    if (
      args.trigger.kind === 'webhook' &&
      (tokenHash === null || args.trigger.rotateToken === true)
    ) {
      token = mintWebhookToken();
      tokenHash = await hashWebhookToken(token);
    }
    if (args.trigger.kind !== 'webhook') tokenHash = null;
    const enabled = args.trigger.enabled ?? true;
    if (existing[0]) {
      await tx`
        UPDATE app.automation_triggers SET
          kind = ${args.trigger.kind}, cron = ${args.trigger.cron ?? null},
          timezone = ${args.trigger.timezone ?? null},
          event = ${args.trigger.event ?? null},
          token_hash = ${tokenHash}, enabled = ${enabled},
          updated_at_ms = ${now}
        WHERE id = ${existing[0].id}
      `;
    } else {
      await tx`
        INSERT INTO app.automation_triggers (
          org_id, name, kind, cron, timezone, event, token_hash, enabled,
          created_by, created_at_ms, updated_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.name}, ${args.trigger.kind},
          ${args.trigger.cron ?? null}, ${args.trigger.timezone ?? null},
          ${args.trigger.event ?? null}, ${tokenHash}, ${enabled},
          ${args.actor}, ${now}, ${now}
        )
      `;
    }
    return token !== undefined ? { token } : {};
  });
}

export async function deleteTrigger(
  sql: Sql,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM app.automation_triggers
    WHERE org_id = ${organizationId} AND name = ${name}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listTriggers(
  sql: Sql,
  organizationId: string,
  name?: string,
): Promise<
  Array<{
    name: string;
    kind: string;
    cron: string | null;
    timezone: string | null;
    event: string | null;
    enabled: boolean;
    lastFiredAt: number | null;
  }>
> {
  return sql`
    SELECT name, kind, cron, timezone, event, enabled,
           last_fired_at_ms::float8 AS "lastFiredAt"
    FROM app.automation_triggers
    WHERE org_id = ${organizationId}
      AND (${name ?? null}::text IS NULL OR name = ${name ?? null})
    ORDER BY name
  ` as unknown as Promise<
    Array<{
      name: string;
      kind: string;
      cron: string | null;
      timezone: string | null;
      event: string | null;
      enabled: boolean;
      lastFiredAt: number | null;
    }>
  >;
}

// ------------------------------------------------------------------- runs

export interface RunRow {
  id: string;
  organizationId: string;
  name: string;
  version: number;
  projectId: string | null;
  status: string;
  mode: 'mock' | 'live';
  startedBy: string;
  input: unknown;
  output: unknown;
  checkpoints: unknown;
  trace: unknown;
  effects: unknown;
  detail: string | null;
  claimEpoch: number;
  chainSeq: number;
  startedAt: number;
  finishedAt: number | null;
}

const RUN_COLUMNS = `
  id, org_id AS "organizationId", name, version, project_id AS "projectId",
  status, mode, started_by AS "startedBy", input, output, checkpoints, trace,
  effects, detail, claim_epoch AS "claimEpoch", chain_seq AS "chainSeq",
  started_at_ms::float8 AS "startedAt", finished_at_ms::float8 AS "finishedAt"
`;

async function runRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  const rows = await sql<RunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<RunRow | null> {
  return runRow(sql, organizationId, runId);
}

export async function listRuns(
  sql: Sql,
  organizationId: string,
  options: { name?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return sql<RunRow[]>`
    SELECT ${sql.unsafe(RUN_COLUMNS)} FROM app.automation_runs
    WHERE org_id = ${organizationId}
      AND (${options.name ?? null}::text IS NULL
           OR name = ${options.name ?? null})
    ORDER BY started_at_ms DESC
    LIMIT ${limit}
  `;
}

/** Enqueue the stepper turn for a run, optionally delayed. */
async function enqueueStep(
  tx: TransactionSql,
  organizationId: string,
  runId: string,
  delayMs: number,
): Promise<void> {
  await addJobInTx(
    tx,
    'automation.step',
    { organizationId, runId },
    delayMs > 0 ? { startAfter: new Date(Date.now() + delayMs) } : {},
  );
}

async function enqueuePoll(
  tx: TransactionSql,
  args: { organizationId: string; runId: string; seq: number; pollMs: number },
): Promise<void> {
  await addJobInTx(tx, 'automation.poll', args, {
    startAfter: new Date(Date.now() + args.pollMs),
  });
}

export interface BeginRunArgs {
  organizationId: string;
  name: string;
  input: unknown;
  mode: 'mock' | 'live';
  startedBy: string;
  version?: number;
  projectId?: string;
}

export async function beginRun(
  sql: Sql,
  args: BeginRunArgs,
): Promise<{ runId: string; version: number } | null> {
  return sql.begin((tx) => beginRunInTx(tx, args));
}

/** The run insert + first-step enqueue INSIDE a caller's transaction — how
 * an event emitted by a producing write starts runs atomically with it. */
export async function beginRunInTx(
  tx: TransactionSql,
  args: BeginRunArgs,
): Promise<{ runId: string; version: number } | null> {
  {
    const version =
      args.version ??
      (await deployedVersion(tx, args.organizationId, args.name));
    if (version === undefined) return null;
    const row = await versionRow(tx, args.organizationId, args.name, version);
    if (!row) return null;
    if (args.projectId !== undefined) {
      const bindings = await bindingProjectIds(
        tx,
        args.organizationId,
        args.name,
      );
      if (bindings.length > 0 && !bindings.includes(args.projectId)) {
        throw new AutomationError(
          'AUTOMATION_PROJECT_FORBIDDEN',
          `"${args.name}" is not bound to that project.`,
          403,
        );
      }
    }
    // The caller's project wins; otherwise the sole bound project keeps
    // trigger and manual runs attributed as the single-surface model did.
    const bindings = await bindingProjectIds(
      tx,
      args.organizationId,
      args.name,
    );
    const projectId =
      args.projectId ?? (bindings.length === 1 ? bindings[0] : undefined);
    const now = Date.now();
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.automation_runs (
        org_id, name, version, project_id, status, mode, started_by, input,
        checkpoints, wake_at_ms, claim_epoch, started_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${version},
        ${projectId ?? null}, 'queued', ${args.mode}, ${args.startedBy},
        ${tx.json(toJson(JSON.stringify(args.input)))},
        ${tx.json(toJson({ nodes: {}, executions: 0 }))},
        ${now}, 0, ${now}
      )
      RETURNING id
    `;
    const runId = inserted[0]?.id;
    if (!runId) throw new Error('run insert failed');
    await enqueueStep(tx, args.organizationId, runId, 0);
    return { runId, version };
  }
}

export async function cancelRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ cancelled: boolean }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.automation_runs SET
      status = 'cancelled', finished_at_ms = ${Date.now()}, wake_at_ms = NULL
    WHERE id = ${runId} AND org_id = ${organizationId}
      AND status IN ('queued', 'running', 'waiting')
    RETURNING id
  `;
  return { cancelled: rows.length > 0 };
}

// ----------------------------------------------- the stepper's run contract

export async function claimRun(
  sql: Sql,
  organizationId: string,
  runId: string,
): Promise<{ claimed: boolean; status: string; epoch: number }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, organizationId, runId);
    if (!row) return { claimed: false, status: 'missing', epoch: 0 };
    if (
      row.status !== 'queued' &&
      row.status !== 'running' &&
      row.status !== 'waiting'
    ) {
      return { claimed: false, status: row.status, epoch: row.claimEpoch };
    }
    const epoch = row.claimEpoch + 1;
    const now = Date.now();
    await tx`
      UPDATE app.automation_runs SET
        status = 'running', claim_epoch = ${epoch}, claimed_at_ms = ${now},
        wake_at_ms = ${now + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${runId}
    `;
    return { claimed: true, status: 'running', epoch };
  });
}

export async function heartbeatRun(
  sql: Sql,
  organizationId: string,
  runId: string,
  epoch: number,
): Promise<{ alive: boolean }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.automation_runs SET
      wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
    WHERE id = ${runId} AND org_id = ${organizationId}
      AND status = 'running' AND claim_epoch = ${epoch}
    RETURNING id
  `;
  return { alive: rows.length > 0 };
}

interface CheckpointsShape {
  nodes: Record<string, unknown>;
  cursor?: unknown;
  executions: number;
}

function readCheckpoints(raw: unknown): CheckpointsShape {
  if (raw !== null && typeof raw === 'object' && 'nodes' in raw) {
    const record = raw as {
      nodes?: unknown;
      cursor?: unknown;
      executions?: unknown;
    };
    return {
      nodes:
        record.nodes !== null && typeof record.nodes === 'object'
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns this JSON shape
            (record.nodes as Record<string, unknown>)
          : {},
      ...(record.cursor !== undefined ? { cursor: record.cursor } : {}),
      executions: typeof record.executions === 'number' ? record.executions : 0,
    };
  }
  return { nodes: {}, executions: 0 };
}

export async function recordProgress(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    nodeId?: string;
    checkpoint?: unknown;
    cursor?: unknown;
    executions: number;
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (!row) return { status: 'missing' };
    if (
      row.status === 'success' ||
      row.status === 'failed' ||
      row.status === 'cancelled'
    ) {
      return { status: row.status };
    }
    if (row.claimEpoch !== args.epoch) return { status: 'stale' };
    const checkpoints = readCheckpoints(row.checkpoints);
    const nodes =
      args.nodeId !== undefined && args.checkpoint !== undefined
        ? Object.assign({}, checkpoints.nodes, {
            [args.nodeId]: args.checkpoint,
          })
        : checkpoints.nodes;
    await tx`
      UPDATE app.automation_runs SET
        checkpoints = ${tx.json(
          toJson({
            nodes,
            ...(args.cursor !== undefined && args.cursor !== null
              ? { cursor: args.cursor }
              : {}),
            executions: args.executions,
          }),
        )},
        wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
      WHERE id = ${args.runId}
    `;
    return { status: row.status };
  });
}

export async function suspendRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    detail: string;
    cursor?: unknown;
    executions: number;
    resumeInMs: number;
  },
): Promise<{ suspended: boolean }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { suspended: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const seq = row.chainSeq + 1;
    await tx`
      UPDATE app.automation_runs SET
        status = 'waiting', detail = ${args.detail.slice(0, 2000)},
        checkpoints = ${tx.json(
          toJson({
            nodes: checkpoints.nodes,
            ...(args.cursor !== undefined && args.cursor !== null
              ? { cursor: args.cursor }
              : {}),
            executions: args.executions,
          }),
        )},
        wake_at_ms = ${Date.now() + args.resumeInMs},
        chain_seq = ${seq}
      WHERE id = ${args.runId}
    `;
    await enqueuePoll(tx, {
      organizationId: args.organizationId,
      runId: args.runId,
      seq,
      pollMs: args.resumeInMs,
    });
    return { suspended: true };
  });
}

/** One hop of a parked run's poll chain (the pg-boss `automation.poll`
 * handler): fenced by chainSeq, cheap row-facts decision, re-arms itself or
 * wakes the stepper. */
export async function pollParkedRun(
  sql: Sql,
  args: { organizationId: string; runId: string; seq: number; pollMs: number },
): Promise<{ due: boolean; rearmed: boolean }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (!row || row.status !== 'waiting' || row.chainSeq !== args.seq) {
      return { due: false, rearmed: false };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const cursor =
      checkpoints.cursor !== null && typeof checkpoints.cursor === 'object'
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stepper owns the cursor shape
          (checkpoints.cursor as {
            agent?: { result?: unknown; deadlineAt?: number };
          })
        : undefined;
    const agent = cursor?.agent;
    // An agent park is quiet until its settle lands or its deadline passes;
    // anything else counts as due — the stepper is the arbiter, this hop
    // only a filter. (The approval-park branch returns with the approvals
    // domain.)
    const due =
      agent !== undefined
        ? agent.result !== undefined || Date.now() > (agent.deadlineAt ?? 0)
        : true;
    if (due) {
      await tx`
        UPDATE app.automation_runs SET wake_at_ms = ${Date.now()}
        WHERE id = ${args.runId}
      `;
      await enqueueStep(tx, args.organizationId, args.runId, 0);
      return { due: true, rearmed: false };
    }
    await tx`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + args.pollMs}
      WHERE id = ${args.runId}
    `;
    await enqueuePoll(tx, args);
    return { due: false, rearmed: true };
  });
}

export async function continueRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    resumeInMs: number;
  },
): Promise<{ scheduled: boolean }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { scheduled: false };
    }
    await tx`
      UPDATE app.automation_runs SET
        wake_at_ms = ${Date.now() + args.resumeInMs}
      WHERE id = ${args.runId}
    `;
    await enqueueStep(tx, args.organizationId, args.runId, args.resumeInMs);
    return { scheduled: true };
  });
}

export async function finishRun(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    epoch: number;
    status: 'success' | 'failed';
    output?: unknown;
    trace: unknown;
    effects: unknown;
    detail?: string;
    executions: number;
  },
): Promise<{ status: string }> {
  return sql.begin(async (tx) => {
    const row = await runRow(tx, args.organizationId, args.runId);
    if (
      !row ||
      row.status === 'cancelled' ||
      row.status === 'success' ||
      row.status === 'failed' ||
      row.claimEpoch !== args.epoch
    ) {
      return { status: row?.status ?? 'missing' };
    }
    const checkpoints = readCheckpoints(row.checkpoints);
    const now = Date.now();
    await tx`
      UPDATE app.automation_runs SET
        status = ${args.status},
        output = coalesce(${args.output === undefined ? null : tx.json(toJson(JSON.stringify(args.output)))}, output),
        trace = ${tx.json(toJson(args.trace ?? []))},
        effects = ${tx.json(toJson(args.effects ?? []))},
        detail = ${args.detail !== undefined ? args.detail.slice(0, 2000) : null},
        checkpoints = ${tx.json(
          toJson({ nodes: checkpoints.nodes, executions: args.executions }),
        )},
        wake_at_ms = NULL, finished_at_ms = ${now}
      WHERE id = ${args.runId}
    `;
    // The provenance record, atomic with the finish (LIVE runs only). The
    // full fold (approvals + connector effects) grows with those domains;
    // the terminal audit row is the contract that must never be missing.
    if (row.mode === 'live') {
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: row.startedBy,
        actorType: 'system',
        action: `automation.run.${args.status}`,
        category: 'ai',
        resourceType: 'automation_run',
        resourceId: args.runId,
        resourceName: `${row.name}@${row.version}`,
        status: args.status === 'success' ? 'success' : 'failure',
        ...(args.detail !== undefined ? { errorMessage: args.detail } : {}),
        metadata: {
          effectsCount: Array.isArray(args.effects) ? args.effects.length : 0,
          executions: args.executions,
        },
      });
    }
    // The run's sandbox sessions are per-execution — free their slots now.
    await tx`
      UPDATE app.sandbox_sessions SET status = 'stopped'
      WHERE org_id = ${args.organizationId}
        AND owner_type = 'workflow_run'
        AND (owner_id = ${args.runId} OR owner_id LIKE ${args.runId + ':%'})
        AND status IN ('creating', 'active', 'degraded')
        AND pinned = false
    `;
    return { status: args.status };
  });
}

// ---------------------------------------------------------------- liveness

/** The sweep: overdue non-terminal runs get a fresh stepper poke. */
export async function sweepOverdueRuns(sql: Sql, limit = 50): Promise<number> {
  const rows = await sql<{ id: string; orgId: string }[]>`
    SELECT id, org_id AS "orgId" FROM app.automation_runs
    WHERE status IN ('queued', 'running', 'waiting')
      AND wake_at_ms IS NOT NULL AND wake_at_ms < ${Date.now()}
    ORDER BY wake_at_ms
    LIMIT ${limit}
  `;
  for (const row of rows) {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE app.automation_runs SET
          wake_at_ms = ${Date.now() + RUN_CLAIM_PROMISE_MS}
        WHERE id = ${row.id}
      `;
      await enqueueStep(tx, row.orgId, row.id, 0);
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------- deletion

export async function deleteAutomationCascade(
  sql: Sql,
  args: { organizationId: string; name: string; actor: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM app.automations
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    await tx`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    await tx`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
    `;
    await tx`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${args.organizationId} AND automation_name = ${args.name}
    `;
    await tx`
      INSERT INTO app.automation_tombstones (
        org_id, name, deleted_by, deleted_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.name}, ${args.actor}, ${Date.now()}
      )
      ON CONFLICT (org_id, name) DO UPDATE SET
        deleted_by = EXCLUDED.deleted_by,
        deleted_at_ms = EXCLUDED.deleted_at_ms
    `;
  });
}
