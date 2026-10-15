import { SANDBOX_SESSION_BUDGET_MAX } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { requestOrganizationDispatchPassesInTx } from './dispatch-requests.ts';

/**
 * Model capacity holds (migration 0205): when a provider answers a run "the
 * selected model is at capacity", the model is overloaded for every run on
 * it, so every run of the organization on that model waits instead of
 * launching into the same refusal.
 *
 * - A refusal extends the (organization, provider, model) hold
 *   ({@link recordModelCapacityRefusalInTx}). The run that met it fails as
 *   `model_capacity`; its automatic retry is free while the model has been at
 *   capacity for less than {@link MODEL_CAPACITY_MAX_WAIT_MS}
 *   (`freeCapacityWaits`) and parks until the hold runs out.
 * - A run's claim asks first ({@link admitModelCapacityInTx}): while the hold
 *   lasts it parks with the reason `model_capacity`, woken when the hold
 *   runs out. The first claim after that is the probe; the others wait until
 *   the probe has proved the model answers again — a run on the model that
 *   settles, or a probe that has worked for {@link MODEL_CAPACITY_PROBE_PROOF_MS}
 *   — which clears the hold ({@link clearModelCapacityHoldInTx}) and wakes
 *   them in waves ({@link modelCapacityWakeDelaysMs}), so the model is not
 *   met by every waiter at once and hundreds of waiters still start within
 *   minutes.
 *
 * Only a refusal that is new information doubles the wait: the probe's own,
 * or one after the hold ran out. Runs that were already working when the
 * model saturated fail in a burst; those keep the hold as it is.
 */

/** The waits in a row a hold imposes, by the refusals that extended it. */
const MODEL_CAPACITY_BACKOFF_MS = [
  60_000,
  2 * 60_000,
  4 * 60_000,
  8 * 60_000,
  15 * 60_000,
] as const;

/** A model that has been at capacity this long is no longer waited for: the
 * next refusal counts like any failure, so the run ends instead of waiting
 * forever. The same 12 hours a run may wait for a worker. */
export const MODEL_CAPACITY_MAX_WAIT_MS = 12 * 60 * 60_000;

/** A probe that has worked this long without being refused proves the model
 * answers again. */
export const MODEL_CAPACITY_PROBE_PROOF_MS = 2 * 60_000;

/** The runs one cleared hold wakes itself: as many as an organization may
 * have agent workers. A run beyond them is reached by the generic wakes
 * once the hold is gone. */
const MODEL_CAPACITY_WAKES_MAX = SANDBOX_SESSION_BUDGET_MAX;

/** How far apart the waves of runs a cleared hold wakes start. */
export const MODEL_CAPACITY_WAKE_SPACING_MS = 15_000;

/** A cleared hold wakes its waiters in about this many waves once its first
 * waves have ramped up: a wave holds at most the waiters over this many,
 * rounded up. Up to this many waiters, one run starts at a time. */
const MODEL_CAPACITY_WAKE_WAVES = 16;

/**
 * When each of `count` runs a cleared hold wakes starts, oldest park first,
 * in milliseconds after the clear. The runs start in waves
 * {@link MODEL_CAPACITY_WAKE_SPACING_MS} apart: the first wave is one run,
 * and each next one twice the last, up to `count / MODEL_CAPACITY_WAKE_WAVES`
 * (rounded up) runs. The model that just answered again meets a few runs
 * first; if it refuses them, its hold is back before the bigger waves come,
 * and their claims park again without starting. Up to sixteen waiters wake
 * one at a time; 256 wake in 20 waves, the last after 4 minutes 45 seconds,
 * where one at a time would take over an hour.
 */
export function modelCapacityWakeDelaysMs(count: number): number[] {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const widest = Math.max(1, Math.ceil(total / MODEL_CAPACITY_WAKE_WAVES));
  const delays: number[] = [];
  let wave = 0;
  let size = 1;
  while (delays.length < total) {
    const take = Math.min(size, widest, total - delays.length);
    for (let i = 0; i < take; i += 1) {
      delays.push(wave * MODEL_CAPACITY_WAKE_SPACING_MS);
    }
    wave += 1;
    size *= 2;
  }
  return delays;
}

/** The wait a hold imposes after its `consecutive`-th refusal, with ±10 %
 * jitter so the runs it parks do not wake in lockstep. */
export function modelCapacityBackoffMs(
  consecutive: number,
  random: () => number = Math.random,
): number {
  const count = Number.isFinite(consecutive) ? Math.floor(consecutive) : 1;
  const index = Math.min(Math.max(count, 1), MODEL_CAPACITY_BACKOFF_MS.length);
  const base = MODEL_CAPACITY_BACKOFF_MS[index - 1] ?? 15 * 60_000;
  return Math.round(base * (0.9 + random() * 0.2));
}

/** The hold's key for a run: an absent provider is one key of its own. */
export interface ModelCapacityKey {
  organizationId: string;
  modelProvider: string | null;
  model: string;
}

export interface ModelCapacityHold {
  heldUntilMs: number;
  consecutive: number;
  firstRefusedAtMs: number;
  lastRefusedAtMs: number;
  lastRunId: string | null;
  probeRunId: string | null;
  probeClaimedAtMs: number | null;
}

const HOLD_COLUMNS = `held_until_ms::float8 AS "heldUntilMs",
  consecutive, first_refused_at_ms::float8 AS "firstRefusedAtMs",
  last_refused_at_ms::float8 AS "lastRefusedAtMs", last_run_id AS "lastRunId",
  probe_run_id AS "probeRunId",
  probe_claimed_at_ms::float8 AS "probeClaimedAtMs"`;

function providerKey(key: ModelCapacityKey): string {
  return key.modelProvider ?? '';
}

/** The model's hold, if one stands. */
export async function readModelCapacityHold(
  sql: Sql | TransactionSql,
  key: ModelCapacityKey,
): Promise<ModelCapacityHold | null> {
  const rows = await sql<ModelCapacityHold[]>`
    SELECT ${sql.unsafe(HOLD_COLUMNS)}
    FROM app.model_capacity_holds
    WHERE org_id = ${key.organizationId}
      AND model_provider = ${providerKey(key)} AND model = ${key.model}
  `;
  return rows[0] ?? null;
}

/** Every hold of an organization, for the readbacks that say why work
 * waits. */
export async function listModelCapacityHolds(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<
  Array<ModelCapacityHold & { modelProvider: string; model: string }>
> {
  return sql<
    Array<ModelCapacityHold & { modelProvider: string; model: string }>
  >`
    SELECT model_provider AS "modelProvider", model,
           ${sql.unsafe(HOLD_COLUMNS)}
    FROM app.model_capacity_holds
    WHERE org_id = ${organizationId}
    ORDER BY model_provider, model
  `;
}

/**
 * Record that the provider refused `runId` for capacity: open the model's
 * hold, or extend it when the refusal is new information — the probe's, or
 * one after the hold ran out. A refusal of a run that was already working
 * when the model saturated leaves a standing hold as it is. In the
 * transaction that fails the run.
 */
export async function recordModelCapacityRefusalInTx(
  tx: TransactionSql,
  args: ModelCapacityKey & { runId: string; now?: number },
  random: () => number = Math.random,
): Promise<ModelCapacityHold> {
  const now = args.now ?? Date.now();
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(
      'model-capacity:' || ${args.organizationId} || ':' ||
      ${providerKey(args)} || ':' || ${args.model}, 0))
  `;
  const existing = await readModelCapacityHold(tx, args);
  if (existing === null) {
    const heldUntil = now + modelCapacityBackoffMs(1, random);
    await tx`
      INSERT INTO app.model_capacity_holds (
        org_id, model_provider, model, held_until_ms, consecutive,
        first_refused_at_ms, last_refused_at_ms, last_run_id, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${providerKey(args)}, ${args.model},
        ${heldUntil}, 1, ${now}, ${now}, ${args.runId}, ${now}
      )
    `;
    return {
      heldUntilMs: heldUntil,
      consecutive: 1,
      firstRefusedAtMs: now,
      lastRefusedAtMs: now,
      lastRunId: args.runId,
      probeRunId: null,
      probeClaimedAtMs: null,
    };
  }
  const news =
    existing.heldUntilMs <= now || existing.probeRunId === args.runId;
  const consecutive = news ? existing.consecutive + 1 : existing.consecutive;
  const heldUntil = news
    ? now + modelCapacityBackoffMs(consecutive, random)
    : existing.heldUntilMs;
  await tx`
    UPDATE app.model_capacity_holds SET
      held_until_ms = ${heldUntil}, consecutive = ${consecutive},
      last_refused_at_ms = ${now}, last_run_id = ${args.runId},
      probe_run_id = CASE WHEN ${news} THEN NULL ELSE probe_run_id END,
      probe_claimed_at_ms = CASE WHEN ${news} THEN NULL
        ELSE probe_claimed_at_ms END,
      updated_at_ms = ${now}
    WHERE org_id = ${args.organizationId}
      AND model_provider = ${providerKey(args)} AND model = ${args.model}
  `;
  return {
    ...existing,
    heldUntilMs: heldUntil,
    consecutive,
    lastRefusedAtMs: now,
    lastRunId: args.runId,
    ...(news ? { probeRunId: null, probeClaimedAtMs: null } : {}),
  };
}

/** What a run's claim may do about its model's capacity. */
export type ModelCapacityAdmission =
  | { admitted: true; probe: boolean }
  /** Wait: parked with the reason `model_capacity` until `wakeAtMs`. */
  | { admitted: false; wakeAtMs: number };

/**
 * Whether a run on the model may start now, in its claim's transaction:
 * yes when no hold stands; no while the hold lasts, or while another run
 * probes the model; yes, as the probe, for the first claim after the hold
 * ran out. A probe that has worked for {@link MODEL_CAPACITY_PROBE_PROOF_MS}
 * proved the model: its hold is cleared and the claim goes ahead. A probe
 * that never launched in that time (parked for another reason, cancelled)
 * gives its place to this claim.
 */
export async function admitModelCapacityInTx(
  tx: TransactionSql,
  args: ModelCapacityKey & { runId: string; now?: number },
): Promise<ModelCapacityAdmission> {
  const now = args.now ?? Date.now();
  const hold = await readModelCapacityHold(tx, args);
  if (hold === null) return { admitted: true, probe: false };
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended(
      'model-capacity:' || ${args.organizationId} || ':' ||
      ${providerKey(args)} || ':' || ${args.model}, 0))
  `;
  // Re-read under the lock: a refusal or a clear may have landed meanwhile.
  const current = await readModelCapacityHold(tx, args);
  if (current === null) return { admitted: true, probe: false };
  if (current.heldUntilMs > now) {
    return { admitted: false, wakeAtMs: current.heldUntilMs };
  }
  if (current.probeRunId !== null && current.probeRunId !== args.runId) {
    const probes = await tx<{ status: string; launchedAt: number | null }[]>`
      SELECT status, launched_at_ms::float8 AS "launchedAt"
      FROM app.project_agent_runs
      WHERE id = ${current.probeRunId} AND org_id = ${args.organizationId}
    `;
    const probe = probes[0];
    const claimedAt = current.probeClaimedAtMs ?? now;
    const proofAt = claimedAt + MODEL_CAPACITY_PROBE_PROOF_MS;
    if (probe?.status === 'running' && probe.launchedAt !== null) {
      if (now >= proofAt) {
        await clearModelCapacityHoldInTx(tx, { ...args, now });
        return { admitted: true, probe: false };
      }
      return { admitted: false, wakeAtMs: proofAt };
    }
    if (probe?.status === 'queued' && now < proofAt) {
      return { admitted: false, wakeAtMs: proofAt };
    }
  }
  await tx`
    UPDATE app.model_capacity_holds SET
      probe_run_id = ${args.runId}, probe_claimed_at_ms = ${now},
      updated_at_ms = ${now}
    WHERE org_id = ${args.organizationId}
      AND model_provider = ${providerKey(args)} AND model = ${args.model}
  `;
  return { admitted: true, probe: true };
}

/**
 * The model answers again: drop its hold and wake every run parked on it,
 * oldest park first, in the waves {@link modelCapacityWakeDelaysMs} spaces.
 * A no-op when no hold stands. In the transaction that proved it (a settle,
 * or the claim that found the probe proven).
 */
export async function clearModelCapacityHoldInTx(
  tx: TransactionSql,
  args: ModelCapacityKey & { now?: number },
): Promise<number> {
  const now = args.now ?? Date.now();
  const cleared = await tx<{ model: string }[]>`
    DELETE FROM app.model_capacity_holds
    WHERE org_id = ${args.organizationId}
      AND model_provider = ${providerKey(args)} AND model = ${args.model}
    RETURNING model
  `;
  if (cleared.length === 0) return 0;
  const parked = await tx<{ id: string; execId: string }[]>`
    SELECT id, exec_id AS "execId"
    FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId}
      AND status = 'queued' AND waiting_for_capacity_at_ms IS NOT NULL
      AND waiting_reason = 'model_capacity'
      AND coalesce(model_provider, '') = ${providerKey(args)}
      AND model = ${args.model}
    ORDER BY waiting_for_capacity_at_ms
    LIMIT ${MODEL_CAPACITY_WAKES_MAX}
  `;
  const delays = modelCapacityWakeDelaysMs(parked.length);
  for (const [index, run] of parked.entries()) {
    const delay = delays[index] ?? 0;
    await addJobInTx(
      tx,
      'task.agent_park_wake',
      {
        organizationId: args.organizationId,
        runId: run.id,
        execId: run.execId,
      },
      delay === 0 ? {} : { startAfter: new Date(now + delay) },
    );
  }
  // Dispatch held ready work for agents on this model: it may start it now.
  await requestOrganizationDispatchPassesInTx(tx, {
    organizationId: args.organizationId,
    trigger: 'capacity_cleared',
  });
  return parked.length;
}

/** SQL over `app.project_agent_runs r`: the run is parked on a model whose
 * hold still stands. The generic wakes (a release edge, the watchdog) skip
 * such a run: its claim would only park it again, at the back of the line,
 * and spend a wake another run could use. The hold's own wakes reach it. */
export const PARKED_ON_HELD_MODEL_SQL = `(r.waiting_reason = 'model_capacity'
  AND EXISTS (
    SELECT 1 FROM app.model_capacity_holds h
    WHERE h.org_id = r.org_id
      AND h.model_provider = coalesce(r.model_provider, '')
      AND h.model = r.model
      AND (h.held_until_ms > (extract(epoch FROM clock_timestamp()) * 1000)
        OR h.probe_run_id IS NOT NULL)
  ))`;
