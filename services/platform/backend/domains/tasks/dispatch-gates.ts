import {
  DISPATCH_DEFAULTS,
  type DispatchGateReport,
  type ProjectDispatchGate,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import {
  assertProjectActive,
  assertProjectAdministrable,
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { requestDispatchPassInTx } from './dispatch-requests.ts';
import { readStoredDispatch } from './dispatch-store.ts';
import { TaskError } from './errors.ts';

/**
 * A dispatch's gates (migration 0210): signals from outside the platform
 * that hold the ready work they govern. The fleet this was built for held
 * its optional CI-producing work while the hosted runners' queue was full,
 * by rules an agent was asked to apply in its head; a gate is the same rule
 * as data, for any signal: something outside reports a state or a value, the
 * gate judges a value with hysteresis, and a pass leaves the work it governs
 * alone while it holds. A report nobody repeats goes stale, and the gate
 * then does what it declares (`whenStale`): an external system that stops
 * reporting can neither hold the fleet for ever nor, where it must not, let
 * it run unwatched.
 */

/** What was last reported on a gate. */
export interface GateState {
  held: boolean;
  value: number | null;
  reason: string | null;
  reportedAt: number | null;
  reportedBy: string | null;
  lastStartAt: number | null;
}

/** A gate as a pass judges it now. */
export interface GateVerdict {
  key: string;
  /** It holds the work it governs. */
  held: boolean;
  /** No report within its `staleAfterSeconds` (or none yet). */
  stale: boolean;
  /** Starts of the work it governs wait until then for its spacing; null
   * when they need not. */
  spacedUntil: number | null;
}

export function gateRecoverBelow(gate: ProjectDispatchGate): number | null {
  if (gate.holdAt === undefined) return null;
  return gate.recoverBelow ?? gate.holdAt / 2;
}

/** How a gate stands at `now`, from what was last reported on it. */
export function judgeGate(
  gate: ProjectDispatchGate,
  state: GateState | undefined,
  now: number,
): GateVerdict {
  const staleAfterMs =
    (gate.staleAfterSeconds ?? DISPATCH_DEFAULTS.gateStaleAfterSeconds) * 1000;
  const whenStale = gate.whenStale ?? DISPATCH_DEFAULTS.gateWhenStale;
  const reportedAt = state?.reportedAt ?? null;
  const stale = reportedAt === null || now - reportedAt > staleAfterMs;
  const held = stale ? whenStale === 'hold' : state?.held === true;
  const spacingMs = (gate.startSpacingSeconds ?? 0) * 1000;
  const lastStartAt = state?.lastStartAt ?? null;
  const spacedUntil =
    spacingMs > 0 && lastStartAt !== null && now < lastStartAt + spacingMs
      ? lastStartAt + spacingMs
      : null;
  return { key: gate.key, held, stale, spacedUntil };
}

/** The state a report leaves a gate in: a reported state as it is; a value
 * at or above `holdAt` holds, and a held gate opens only below
 * `recoverBelow`. A value on a gate that judges none is refused. */
export function applyGateReport(
  gate: ProjectDispatchGate,
  previouslyHeld: boolean,
  report: DispatchGateReport,
): { held: boolean } | { refused: 'value_without_threshold' } {
  if ('state' in report) return { held: report.state === 'hold' };
  const recoverBelow = gateRecoverBelow(gate);
  if (gate.holdAt === undefined || recoverBelow === null) {
    return { refused: 'value_without_threshold' };
  }
  if (report.value >= gate.holdAt) return { held: true };
  return { held: previouslyHeld && report.value >= recoverBelow };
}

/** Whether a gate governs a task: every task when the gate names no labels,
 * else a task carrying one of them. `labelIds` are the gate's label names
 * resolved to the project's label ids. */
export function gateGoverns(
  gate: ProjectDispatchGate,
  gateLabelIds: readonly string[],
  taskLabelIds: readonly string[],
): boolean {
  if (gate.labels === undefined) return true;
  return taskLabelIds.some((id) => gateLabelIds.includes(id));
}

export async function readGateStates(
  sql: Sql | TransactionSql,
  projectId: string,
): Promise<Map<string, GateState>> {
  const rows = await sql<(GateState & { key: string })[]>`
    SELECT gate_key AS key, held, value, reason,
           reported_at_ms::float8 AS "reportedAt",
           reported_by AS "reportedBy",
           last_start_at_ms::float8 AS "lastStartAt"
    FROM app.project_dispatch_gates
    WHERE project_id = ${projectId}
  `;
  return new Map(rows.map(({ key, ...state }) => [key, state]));
}

/** Record that dispatch started work these gates govern, for their spacing. */
export async function noteGatedStart(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    keys: readonly string[];
    at: number;
  },
): Promise<void> {
  if (args.keys.length === 0) return;
  await sql`
    INSERT INTO app.project_dispatch_gates (
      project_id, gate_key, org_id, last_start_at_ms, updated_at_ms
    )
    SELECT ${args.projectId}, key, ${args.organizationId}, ${args.at}, ${args.at}
    FROM unnest(${[...args.keys]}::text[]) AS key
    ON CONFLICT (project_id, gate_key) DO UPDATE SET
      last_start_at_ms = EXCLUDED.last_start_at_ms,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

/**
 * Record a report on one of a project's gates. Who may report: who may
 * edit the project (an external system reports with an API key whose holder
 * may). The gate must be declared by the project's dispatch. A report that
 * opens a gate asks for a pass at once, so the work it held starts without
 * waiting for the minute scan.
 */
export async function reportDispatchGate(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    key: string;
    report: DispatchGateReport;
    reporter: string;
    /** The door already checked that the reporter may edit the project. */
    access: 'checked' | 'administer';
    now?: number;
  },
): Promise<{ held: boolean; changed: boolean }> {
  const now = args.now ?? Date.now();
  const project = await loadProjectOrThrow(tx, args.projectId);
  if (args.access === 'administer') assertProjectAdministrable(project, auth);
  assertProjectActive(project);
  const stored = await readStoredDispatch(
    tx,
    auth.organizationId,
    args.projectId,
  );
  const gate = stored?.config.gates?.find((entry) => entry.key === args.key);
  if (gate === undefined) {
    throw new TaskError(
      'DISPATCH_GATE_UNKNOWN',
      "The project's dispatch declares no gate of that key.",
      404,
    );
  }
  const previous = await tx<{ held: boolean }[]>`
    SELECT held FROM app.project_dispatch_gates
    WHERE project_id = ${args.projectId} AND gate_key = ${args.key}
    FOR UPDATE
  `;
  const previouslyHeld = previous[0]?.held ?? false;
  const applied = applyGateReport(gate, previouslyHeld, args.report);
  if ('refused' in applied) {
    throw new TaskError(
      'DISPATCH_GATE_VALUE_UNJUDGED',
      'This gate judges no values: report a state, or give the gate a holdAt.',
      400,
    );
  }
  const value = 'value' in args.report ? args.report.value : null;
  await tx`
    INSERT INTO app.project_dispatch_gates (
      project_id, gate_key, org_id, held, value, reason, reported_at_ms,
      reported_by, updated_at_ms
    ) VALUES (
      ${args.projectId}, ${args.key}, ${auth.organizationId}, ${applied.held},
      ${value}, ${args.report.reason ?? null}, ${now}, ${args.reporter}, ${now}
    )
    ON CONFLICT (project_id, gate_key) DO UPDATE SET
      held = EXCLUDED.held,
      value = EXCLUDED.value,
      reason = EXCLUDED.reason,
      reported_at_ms = EXCLUDED.reported_at_ms,
      reported_by = EXCLUDED.reported_by,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
  const changed = previous.length === 0 || previouslyHeld !== applied.held;
  if (!applied.held && stored?.config.enabled === true) {
    await requestDispatchPassInTx(tx, {
      organizationId: auth.organizationId,
      projectId: args.projectId,
      trigger: 'gate',
    });
  }
  return { held: applied.held, changed };
}
