/**
 * The burst's runs as the board shows them. Each task's runs are polled
 * from the run list door, and every poll is folded into what a person
 * watching the board saw of each run: whether it waited, with which reason,
 * and how it ended.
 *
 * A queued run is in one of three places: parked (`waitingForCapacityAt`
 * set, with the reason the card shows), starting (it claimed a worker and
 * its sandbox is being made) or pending (neither). Pending is the moment
 * between the kick and dispatch's answer; a run that stays there waits
 * without saying why.
 */

import type { ApiClient } from '../api/client.ts';
import {
  asNumber,
  asRecord,
  asString,
  orgQuery,
  rowsOf,
} from '../api/client.ts';

/**
 * Failure codes that say a run found no room: no sandbox became free while
 * it waited (`park_deadline`), the sandbox refused it (`start_failed`), went
 * away under it (`session_gone`, `sandbox_capacity`) or ran out of memory
 * (`resource_exhausted`).
 */
export const CAPACITY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'park_deadline',
  'sandbox_capacity',
  'resource_exhausted',
  'start_failed',
  'session_gone',
]);

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'settled',
  'failed',
  'cancelled',
]);

/** One run as the run list door answers it. */
export interface RunRow {
  id: string;
  status: string;
  agentId: string | null;
  sessionId: string | null;
  trigger: string | null;
  failureCode: string | null;
  error: string | null;
  /** What the run answered at its end: its last turn's text. */
  resultText: string | null;
  waitingForCapacityAt: number | null;
  waitingReason: string | null;
  sessionClaimedAt: number | null;
  startedAt: number | null;
  launchedAt: number | null;
  settledAt: number | null;
}

/** The rows of a run list answer, newest first, as it sends them. */
export function parseRunRows(body: unknown): RunRow[] {
  const runs: RunRow[] = [];
  for (const row of rowsOf(body, 'runs')) {
    const id = asString(row.id);
    const status = asString(row.status);
    if (id === undefined || status === undefined) continue;
    runs.push({
      id,
      status,
      agentId: asString(row.agentId) ?? null,
      sessionId: asString(row.sessionId) ?? null,
      trigger: asString(row.trigger) ?? null,
      failureCode: asString(row.failureCode) ?? null,
      error: asString(row.error) ?? null,
      resultText: asString(row.resultText) ?? null,
      waitingForCapacityAt: asNumber(row.waitingForCapacityAt) ?? null,
      waitingReason: asString(row.waitingReason) ?? null,
      sessionClaimedAt: asNumber(row.sessionClaimedAt) ?? null,
      startedAt: asNumber(row.startedAt) ?? null,
      launchedAt: asNumber(row.launchedAt) ?? null,
      settledAt: asNumber(row.settledAt) ?? null,
    });
  }
  return runs;
}

export type RunPlace =
  | 'parked'
  | 'starting'
  | 'pending'
  | 'running'
  | 'settled'
  | 'failed'
  | 'cancelled'
  | 'other';

export function placeOf(row: RunRow): RunPlace {
  if (row.status === 'queued') {
    if (row.waitingForCapacityAt !== null) return 'parked';
    return row.sessionClaimedAt === null ? 'pending' : 'starting';
  }
  if (
    row.status === 'running' ||
    row.status === 'settled' ||
    row.status === 'failed' ||
    row.status === 'cancelled'
  ) {
    return row.status;
  }
  return 'other';
}

/** What the polls saw of one run. */
export interface RunTrack {
  id: string;
  taskId: string;
  agentId: string | null;
  trigger: string | null;
  /** Where the last poll saw it. */
  place: RunPlace;
  failureCode: string | null;
  error: string | null;
  /** What the run answered, as the last poll saw it. */
  resultText: string | null;
  startedAt: number | null;
  launchedAt: number | null;
  settledAt: number | null;
  /** The reasons its card showed while it was parked, in order seen. */
  reasons: string[];
  /** Polls that saw it parked with no reason to show. */
  parkedWithoutReason: number;
  /** How long it was seen parked, in total. */
  parkedMs: number;
  /** The longest stretch it was seen pending. */
  longestPendingMs: number;
  /** When the place the last poll saw began (wall clock, ms). */
  placeSinceMs: number;
}

/**
 * When a run first seen in a waiting place began to wait there: a pending
 * run since its kick, a parked one since it was parked. Any other place is
 * counted from the poll that saw it.
 */
function firstSeenSince(row: RunRow, nowMs: number): number {
  const place = placeOf(row);
  const since =
    place === 'pending'
      ? row.startedAt
      : place === 'parked'
        ? row.waitingForCapacityAt
        : null;
  return since === null ? nowMs : Math.min(since, nowMs);
}

export function newRunTrack(
  taskId: string,
  row: RunRow,
  nowMs: number,
): RunTrack {
  const track: RunTrack = {
    id: row.id,
    taskId,
    agentId: row.agentId,
    trigger: row.trigger,
    place: placeOf(row),
    failureCode: null,
    error: null,
    resultText: null,
    startedAt: row.startedAt,
    launchedAt: null,
    settledAt: null,
    reasons: [],
    parkedWithoutReason: 0,
    parkedMs: 0,
    longestPendingMs: 0,
    placeSinceMs: firstSeenSince(row, nowMs),
  };
  observeRun(track, row, nowMs);
  return track;
}

/** Fold one poll's row into its run's track. */
export function observeRun(track: RunTrack, row: RunRow, nowMs: number): void {
  const place = placeOf(row);
  closeStretch(track, nowMs);
  if (place !== track.place) {
    track.place = place;
    track.placeSinceMs = nowMs;
  }
  if (place === 'parked') {
    if (row.waitingReason === null) {
      track.parkedWithoutReason += 1;
    } else if (!track.reasons.includes(row.waitingReason)) {
      track.reasons.push(row.waitingReason);
    }
  }
  track.failureCode = row.failureCode;
  track.error = row.error;
  track.resultText = row.resultText;
  track.launchedAt = row.launchedAt ?? track.launchedAt;
  track.settledAt = row.settledAt;
}

/**
 * Bring the track's stretch in its current place up to `nowMs`: the time a
 * parked or pending run has waited so far counts even when no later poll
 * sees it move.
 */
export function closeStretch(track: RunTrack, nowMs: number): void {
  const stretch = Math.max(0, nowMs - track.placeSinceMs);
  if (track.place === 'pending') {
    track.longestPendingMs = Math.max(track.longestPendingMs, stretch);
  } else if (track.place === 'parked') {
    track.parkedMs += stretch;
    track.placeSinceMs = nowMs;
  }
}

/** What the polls saw of one task of the burst. */
export interface TaskTrack {
  taskId: string;
  title: string;
  agentIndex: number;
  /** When the burst created it (wall clock, ms). */
  createdAtMs: number;
  /** Its runs, oldest first. */
  runs: RunTrack[];
  /** When the polls first saw it end: its newest run terminal, no retry
   * pending. */
  doneAtMs: number | null;
  /** The longest stretch the board showed it in progress without any run. */
  longestWithoutRunMs: number;
}

/** A task's newest run, or null before any run was kicked. */
export function newestRun(task: TaskTrack): RunTrack | null {
  return task.runs.at(-1) ?? null;
}

export function isTerminal(place: RunPlace): boolean {
  return TERMINAL_STATUSES.has(place);
}

/** Fold one poll of a task's run list into its track. */
export function observeTask(
  task: TaskTrack,
  rows: readonly RunRow[],
  nowMs: number,
): void {
  if (rows.length === 0) {
    task.longestWithoutRunMs = Math.max(
      task.longestWithoutRunMs,
      nowMs - task.createdAtMs,
    );
    return;
  }
  // The door lists newest first; tracks keep the kick order.
  for (const row of [...rows].reverse()) {
    const track = task.runs.find((run) => run.id === row.id);
    if (track === undefined) {
      task.runs.push(newRunTrack(task.taskId, row, nowMs));
    } else {
      observeRun(track, row, nowMs);
    }
  }
}

/**
 * Whether a failed newest run will be retried by the platform: the
 * latest-run door says so while the retry is armed and not yet queued.
 */
export async function retryPending(
  api: ApiClient,
  orgId: string,
  taskId: string,
): Promise<boolean | null> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/tasks/${encodeURIComponent(taskId)}/agent-runs/latest`,
    query: orgQuery(orgId),
    name: 'GET /api/app/tasks/:id/agent-runs/latest',
  });
  if (!result.ok) return null;
  const run = asRecord(asRecord(result.body)?.run);
  return run?.retryPending === true;
}

/** The task's runs, newest first, or null when the door did not answer. */
export async function listRuns(
  api: ApiClient,
  orgId: string,
  taskId: string,
): Promise<RunRow[] | null> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/tasks/${encodeURIComponent(taskId)}/agent-runs`,
    query: orgQuery(orgId),
    name: 'GET /api/app/tasks/:id/agent-runs',
  });
  return result.ok ? parseRunRows(result.body) : null;
}
