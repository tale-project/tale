/**
 * The recorder port: how an executor tells the run record what happened at
 * each unit of work — that it started, what it decided and read, what it
 * received and returned, how it waited and how it ended.
 *
 * The executors hold no record state of their own. They call one port, and
 * whether anything is kept is the port's business: {@link noRecorder} keeps
 * nothing (an executor without a recorder runs exactly as before), and
 * {@link createRecorder} keeps every unit in memory, answering the rows that
 * changed since the last flush ({@link RunRecorder.drain}, for the durable
 * runtime, which writes them in the transaction that commits the progress
 * they describe) or all of them ({@link RunRecorder.snapshot}, for a run
 * that executes in one call).
 */

import type {
  AttemptRecord,
  Decision,
  NodeRunRecord,
  StepFailure,
  UnitKey,
  WaitRecord,
} from './types';
import { RECORD_MAX_ATTEMPTS, RECORD_MAX_WAITS } from './types';
import {
  type RecordBudget,
  type RecordTier,
  recordValue,
  unlimitedBudget,
} from './value';

/** A decision as an executor states it; the recorder stamps the time. */
export type DecisionInput = WithoutAt<Decision>;

/** `D` without its time, each member of a union on its own. */
type WithoutAt<D> = D extends unknown ? Omit<D, 'at'> : never;

/** How a unit ended. */
export interface UnitEnd {
  status: 'ok' | 'skipped' | 'failed';
  output?: unknown;
  skip?: NonNullable<NodeRunRecord['skip']>;
  failure?: StepFailure;
}

/** A changed row and the bytes of stored values it newly spent, which the
 * durable runtime adds to the run's tally. */
export interface NodeRunWrite {
  record: NodeRunRecord;
  bytes: number;
}

export interface RunRecorder {
  /** Whether anything is kept: an executor evaluates conditions plainly,
   * without tracing them, when it is not. */
  readonly enabled: boolean;
  /** A unit begins, or resumes (`resuming`: the walker comes back to a unit
   * it left on purpose — a loop handed on between items). */
  unitStarted(
    key: UnitKey,
    a: { nodeId: string; nodeType: string; resuming?: boolean },
  ): void;
  decision(key: UnitKey, decision: DecisionInput): void;
  /** What the unit works on, as resolved. */
  unitInput(key: UnitKey, value: unknown): void;
  unitFinished(key: UnitKey, end: UnitEnd): void;
  /** The unit waits — for a person, a pass, room to run in. */
  waitOpened(key: UnitKey, wait: Omit<WaitRecord, 'until'>): void;
  /** The wait ends, with what was decided when someone decided. */
  waitClosed(key: UnitKey, closed?: Pick<WaitRecord, 'outcome' | 'by'>): void;
  /** An earlier try of the unit ended without settling it. */
  attempt(key: UnitKey, attempt: AttemptRecord): void;
  meta(key: UnitKey, meta: Partial<NodeRunRecord['meta']>): void;
  /** The rows changed since the last drain — of the given units only, when
   * `keys` names them. */
  drain(keys?: readonly UnitKey[]): NodeRunWrite[];
  /** Drained rows a write did not land: the next drain carries them again,
   * with the bytes they spent. */
  restore(rows: readonly NodeRunWrite[]): void;
  /** Every row kept, in the order units started. */
  snapshot(): NodeRunRecord[];
}

/** Keeps nothing; conditions evaluate plainly. */
export const noRecorder: RunRecorder = {
  enabled: false,
  unitStarted: () => undefined,
  decision: () => undefined,
  unitInput: () => undefined,
  unitFinished: () => undefined,
  waitOpened: () => undefined,
  waitClosed: () => undefined,
  attempt: () => undefined,
  meta: () => undefined,
  drain: () => [],
  restore: () => undefined,
  snapshot: () => [],
};

/** Rows one run keeps; past it, rows of settled items and passes are not
 * kept (their step's counts still are). */
export const RECORD_MAX_ROWS = 1000;
/** Item and pass rows kept per step before only failed ones are. */
export const RECORD_MAX_UNIT_ROWS = 200;
/** Failed item and pass rows kept per step past {@link RECORD_MAX_UNIT_ROWS}. */
const RECORD_MAX_EXTRA_FAILED = 100;

/** A re-park of the same kind this soon after the last closed reopens it. */
const WAIT_REOPEN_MS = 60_000;

export interface RecorderOptions {
  /** Epoch ms, for the times a record shows. */
  now: () => number;
  /** Monotonic ms, for how long a unit worked. */
  clock?: () => number;
  /** What the run may still store; unlimited when absent. */
  budget?: RecordBudget;
  /** Rows an earlier turn left running or waiting. */
  open?: readonly NodeRunRecord[];
  /** Rows the run already stores, so {@link RECORD_MAX_ROWS} holds for the
   * whole run rather than for each turn. */
  rowsKept?: number;
}

/** The key's text, one per unit. */
export function unitKeyOf(key: UnitKey): string {
  return `${key.path}\u0000${key.item}\u0000${key.pass}`;
}

/** Whether a key names one item or one pass of a step. */
function isUnitRow(key: UnitKey): boolean {
  return key.item >= 0 || key.pass >= 0;
}

/** Whether a key names a step of a subautomation an item or a pass walked
 * (`batch[2:-1]/send`): such steps multiply with the items that walk them. */
function isNestedStep(key: UnitKey): boolean {
  return key.path.includes('/');
}

/** The step row an item or pass row belongs to: the item's row for a pass
 * of an item, else the step's own. */
function parentKeyOf(key: UnitKey): UnitKey | undefined {
  if (key.pass >= 0 && key.item >= 0) {
    return { path: key.path, item: key.item, pass: -1 };
  }
  if (isUnitRow(key)) return { path: key.path, item: -1, pass: -1 };
  return undefined;
}

interface Slot {
  record: NodeRunRecord;
  /** Monotonic time the current working span began, while working. */
  activeSince?: number;
  /** Bytes of values stored since the last drain. */
  pendingBytes: number;
  dirty: boolean;
  /** Whether the row is written at all (row caps). */
  kept: boolean;
  /** Item/pass rows of this step: kept so far, and failed ones kept past
   * the cap. */
  keptUnits: number;
  extraFailed: number;
}

/** Keeps every unit in memory; see the module doc. */
export function createRecorder(options: RecorderOptions): RunRecorder {
  const now = (): number => options.now();
  const clock = options.clock ?? (() => performance.now());
  const budget = options.budget ?? unlimitedBudget();
  const slots = new Map<string, Slot>();
  const open = new Map<string, NodeRunRecord>();
  for (const record of options.open ?? []) {
    open.set(unitKeyOf(record.key), record);
  }
  let rows = options.rowsKept ?? 0;

  const slotOf = (key: UnitKey): Slot | undefined => slots.get(unitKeyOf(key));

  const touch = (slot: Slot): void => {
    slot.dirty = true;
  };

  const stopWork = (slot: Slot): void => {
    if (slot.activeSince === undefined) return;
    slot.record.activeMs += Math.max(0, Math.round(clock() - slot.activeSince));
    slot.activeSince = undefined;
  };

  const tierOf = (key: UnitKey): RecordTier =>
    isUnitRow(key) ? 'unit' : 'node';

  const store = (slot: Slot, value: unknown): NodeRunRecord['input'] => {
    const before = budget.left;
    const recorded = recordValue(value, tierOf(slot.record.key), budget);
    if (Number.isFinite(before)) slot.pendingBytes += before - budget.left;
    return recorded;
  };

  /** Whether a new item or pass row of `parent` may be kept. */
  const admit = (parent: Slot | undefined): boolean => {
    if (rows >= RECORD_MAX_ROWS) return false;
    return parent === undefined || parent.keptUnits < RECORD_MAX_UNIT_ROWS;
  };

  const countUnit = (key: UnitKey, end: UnitEnd): void => {
    const parentKey = parentKeyOf(key);
    if (parentKey === undefined) return;
    const parent = slotOf(parentKey);
    if (parent === undefined) return;
    const counts = (parent.record.counts ??= {
      items: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      kept: 0,
    });
    if (key.pass >= 0) {
      counts.passes = Math.max(counts.passes ?? 0, key.pass + 1);
    } else {
      counts.items = Math.max(counts.items, key.item + 1);
      if (end.status === 'ok') counts.ok++;
      else if (end.status === 'failed') counts.failed++;
      else counts.skipped++;
    }
    counts.kept = parent.keptUnits;
    touch(parent);
  };

  return {
    enabled: true,

    unitStarted(key, a) {
      const id = unitKeyOf(key);
      const at = now();
      const existing = slots.get(id);
      if (existing !== undefined) {
        // Back at a unit this turn already holds: a resumed loop, or a pass
        // that starts again.
        existing.record.status = 'running';
        existing.activeSince ??= clock();
        touch(existing);
        return;
      }
      const parentKey = parentKeyOf(key);
      const parent = parentKey === undefined ? undefined : slotOf(parentKey);
      const stored = open.get(id);
      const record: NodeRunRecord = stored
        ? structuredClone(stored)
        : {
            key: { ...key },
            nodeId: a.nodeId,
            nodeType: a.nodeType,
            status: 'running',
            startedAt: at,
            activeMs: 0,
            attempt: 1,
            attempts: [],
            decisions: [],
            waits: [],
            meta: {},
          };
      if (stored !== undefined) {
        if (stored.status === 'waiting') {
          const last = record.waits.at(-1);
          if (last !== undefined && last.until === undefined) last.until = at;
        } else if (stored.status === 'running' && a.resuming !== true) {
          // The walker that ran it stopped mid-unit: that try is over.
          record.attempts.push({
            n: record.attempt,
            startedAt: record.startedAt ?? at,
            endedAt: at,
            outcome: 'interrupted',
          });
          record.attempts = record.attempts.slice(-RECORD_MAX_ATTEMPTS);
          record.attempt += 1;
          record.startedAt = at;
          delete record.endedAt;
          delete record.failure;
        }
        record.status = 'running';
      }
      // A step of the automation itself is always kept; an item or a pass,
      // and a step a subautomation walk ran for one, only while the run's
      // rows last — past them, the step's counts still say what happened.
      const kept =
        stored !== undefined ||
        (isUnitRow(key)
          ? admit(parent)
          : !isNestedStep(key) || rows < RECORD_MAX_ROWS);
      const slot: Slot = {
        record,
        activeSince: clock(),
        pendingBytes: 0,
        dirty: true,
        kept,
        keptUnits: 0,
        extraFailed: 0,
      };
      slots.set(id, slot);
      if (kept) {
        // A row an earlier turn stored is counted in `rowsKept` already.
        if (stored === undefined) rows++;
        if (parent !== undefined && isUnitRow(key)) parent.keptUnits++;
      }
    },

    decision(key, decision) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      const stamped: Decision = { ...decision, at: now() };
      slot.record.decisions = [
        ...slot.record.decisions.filter((d) => d.kind !== decision.kind),
        stamped,
      ];
      touch(slot);
    },

    unitInput(key, value) {
      const slot = slotOf(key);
      if (slot === undefined || !slot.kept) return;
      slot.record.input = store(slot, value);
      touch(slot);
    },

    unitFinished(key, end) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      stopWork(slot);
      const at = now();
      const record = slot.record;
      record.status = end.status;
      record.endedAt = at;
      if (end.skip !== undefined) record.skip = end.skip;
      if (end.failure !== undefined) record.failure = end.failure;
      if (record.attempts.length > 0 && end.status !== 'skipped') {
        record.attempts = [
          ...record.attempts,
          {
            n: record.attempt,
            startedAt: record.startedAt ?? at,
            endedAt: at,
            outcome:
              end.status === 'ok' ? ('ok' as const) : ('failed' as const),
            ...(end.failure !== undefined && {
              failureCode: end.failure.code,
              reason: end.failure.reason,
            }),
          },
        ].slice(-RECORD_MAX_ATTEMPTS);
      }
      if (!slot.kept && end.status === 'failed') {
        // A failed item or pass is kept past the cap, a hundred more.
        const parentKey = parentKeyOf(key);
        const parent = parentKey === undefined ? undefined : slotOf(parentKey);
        if (
          rows < RECORD_MAX_ROWS + RECORD_MAX_EXTRA_FAILED &&
          (parent === undefined || parent.extraFailed < RECORD_MAX_EXTRA_FAILED)
        ) {
          slot.kept = true;
          rows++;
          if (parent !== undefined) {
            parent.extraFailed++;
            parent.keptUnits++;
          }
        }
      }
      if (end.status !== 'skipped' && end.output !== undefined && slot.kept) {
        record.output = store(slot, end.output);
      }
      countUnit(key, end);
      touch(slot);
    },

    waitOpened(key, wait) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      stopWork(slot);
      const record = slot.record;
      record.status = 'waiting';
      const last = record.waits.at(-1);
      if (
        last !== undefined &&
        last.kind === wait.kind &&
        last.until !== undefined &&
        wait.since - last.until <= WAIT_REOPEN_MS
      ) {
        delete last.until;
        delete last.outcome;
        delete last.by;
        if (wait.ref !== undefined) last.ref = wait.ref;
      } else if (
        record.waits.length >= RECORD_MAX_WAITS &&
        last !== undefined
      ) {
        // Past the cap the last wait stands for the rest.
        delete last.until;
      } else {
        record.waits = [...record.waits, { ...wait }];
      }
      touch(slot);
    },

    waitClosed(key, closed) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      const last = slot.record.waits.at(-1);
      if (last === undefined || last.until !== undefined) return;
      last.until = now();
      if (closed?.outcome !== undefined) last.outcome = closed.outcome;
      if (closed?.by !== undefined) last.by = closed.by;
      slot.record.status = 'running';
      slot.activeSince ??= clock();
      touch(slot);
    },

    attempt(key, attempt) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      slot.record.attempts = [...slot.record.attempts, attempt].slice(
        -RECORD_MAX_ATTEMPTS,
      );
      slot.record.attempt = Math.max(slot.record.attempt, attempt.n + 1);
      touch(slot);
    },

    meta(key, meta) {
      const slot = slotOf(key);
      if (slot === undefined) return;
      const before = slot.record.meta;
      slot.record.meta = {
        ...before,
        ...meta,
        // Each field's spans arrive on their own: a prompt's, then a
        // system text's.
        ...(meta.rendered !== undefined &&
          before.rendered !== undefined && {
            rendered: { ...before.rendered, ...meta.rendered },
          }),
      };
      touch(slot);
    },

    drain(keys) {
      const only =
        keys === undefined ? undefined : new Set(keys.map(unitKeyOf));
      const out: NodeRunWrite[] = [];
      for (const [id, slot] of slots) {
        if (!slot.dirty || !slot.kept) continue;
        if (only !== undefined && !only.has(id)) continue;
        out.push({ record: snapshotOf(slot, clock), bytes: slot.pendingBytes });
        slot.dirty = false;
        slot.pendingBytes = 0;
      }
      return out;
    },

    restore(lost) {
      for (const row of lost) {
        const slot = slots.get(unitKeyOf(row.record.key));
        if (slot === undefined) continue;
        slot.dirty = true;
        slot.pendingBytes += row.bytes;
      }
    },

    snapshot() {
      return [...slots.values()]
        .filter((slot) => slot.kept)
        .map((slot) => snapshotOf(slot, clock));
    },
  };
}

/** A copy of the slot's record, with a unit still working counted up to
 * now. */
function snapshotOf(slot: Slot, clock: () => number): NodeRunRecord {
  const record = structuredClone(slot.record);
  if (slot.activeSince !== undefined) {
    record.activeMs += Math.max(0, Math.round(clock() - slot.activeSince));
  }
  return record;
}
