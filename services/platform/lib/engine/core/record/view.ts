/**
 * How a run's record reads: the stored records of each step, completed with
 * what the run as a whole says, in the words every reader shares — a step
 * the run never reached is `not_run`, one still working when the run ended
 * was `stopped`, one taken from an earlier run is `reused`.
 *
 * The projection the app, the API and the agent tools serve, and the one a
 * run that is never stored (a test of a single step) is read through. Pure
 * and browser-safe; values appear as their summaries and shapes, never
 * themselves.
 */

import type { SchemaTreeSchema } from '@tale/ui/data/infer-schema';
import type { ValueSummary } from '@tale/ui/data/value-summary';

import { topoSort } from '../execute/controlflow';
import type { Automation, NodeDef } from '../types';
import { failedAndContinued, skipChain, type SkipCause } from './skip-chain';
import {
  END_PATH,
  START_PATH,
  type AttemptRecord,
  type Decision,
  type NodeRunRecord,
  type StepFailure,
  type ValueRecord,
  type ViewStatus,
  type WaitRecord,
} from './types';

/** What the run as a whole says. */
export interface RunFacts {
  /** The run's status: a stored run's (`success`, `failed`, `cancelled`, …)
   * or an in-process run's (`error` reads as `failed`). */
  status: string;
  /** The run has ended: it succeeded, failed or was stopped. */
  finished: boolean;
  /** The step the run failed at, or was stopped at. */
  failedNode?: string;
  /** Epoch ms of the reading, for a wait or a step still open. */
  now?: number;
  /** Epoch ms the run ended: what was still open then is measured to it,
   * never to the time of reading. */
  finishedAt?: number;
}

/** The facts as the projection reads them: one word for a failed run, and
 * the moment open spans end — the run's end once it ended. */
function settledFacts(run: RunFacts): RunFacts {
  const status = run.status === 'error' ? 'failed' : run.status;
  const { now: _now, ...rest } = run;
  const clock = run.finished ? run.finishedAt : run.now;
  return { ...rest, status, ...(clock !== undefined && { now: clock }) };
}

/** A recorded value as a summary row shows it: never the value itself. */
export interface ValueGlimpse {
  summary: ValueSummary;
  /** Read from the whole value, {@link GLIMPSE_SHAPE_DEPTH} levels deep. */
  shape: SchemaTreeSchema;
  bytes: number;
  /** The stored copy was cut somewhere. */
  elided: boolean;
  /** Places a secret was withheld from. */
  redactions: number;
}

/** Levels of a shape a summary keeps. */
export const GLIMPSE_SHAPE_DEPTH = 3;

export type NodeRunCounts = NonNullable<NodeRunRecord['counts']>;

type SkipReason = NonNullable<NodeRunRecord['skip']>['reason'];

/** One step of a run, as the run's record reads. */
export interface NodeRunSummary {
  /** Its id at the top level; `parent[item:pass]/id` inside a
   * subautomation. */
  path: string;
  nodeId: string;
  type: string;
  /** For a step inside a subautomation: the step that walked it, and the
   * item and pass it was walked for, as the path writes them. */
  parentPath?: string;
  parentItem?: number;
  parentPass?: number;
  status: ViewStatus;
  startedAt?: number;
  endedAt?: number;
  activeMs: number;
  waitedMs: number;
  attempt: number;
  attempts: AttemptRecord[];
  /** Why it produced no output, followed back to the cause. A step that
   * failed and let the run go on reads `error`. */
  skip?: {
    reason: SkipReason;
    via?: string[];
    at?: number;
    chain: SkipCause[];
  };
  /** For a step the run never reached: where the run ended. */
  notRun?: { stoppedAt?: string; runStatus: 'failed' | 'cancelled' };
  failure?: StepFailure;
  /** Each with the condition or list text it evaluated, when the step is
   * one of the version's own. */
  decisions: Array<Decision & { source?: string }>;
  waits: WaitRecord[];
  counts?: NodeRunCounts;
  input?: ValueGlimpse;
  output?: ValueGlimpse;
  reused?: { runId: string };
  meta: Pick<
    NodeRunRecord['meta'],
    | 'model'
    | 'connector'
    | 'action'
    | 'effect'
    | 'execId'
    | 'docRef'
    | 'pins'
    | 'bench'
  >;
}

/**
 * The status a reader sees for one unit: the stored one in the shared
 * words, completed with the run's. `path` names a unit that has no record,
 * so the step a run ended at reads as where it ended.
 */
export function viewStatusOf(
  record: NodeRunRecord | undefined,
  run: Pick<RunFacts, 'status' | 'finished' | 'failedNode'>,
  path?: string,
): ViewStatus {
  if (record === undefined) {
    if (!run.finished) return 'pending';
    if (path !== undefined && path === run.failedNode) {
      if (run.status === 'cancelled') return 'stopped';
      if (run.status === 'failed') return 'failed';
    }
    return 'not_run';
  }
  if (record.meta.reused !== undefined) return 'reused';
  if (failedAndContinued(record)) return 'failed';
  switch (record.status) {
    case 'ok':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'running':
    case 'waiting':
      // Still working when the run ended: it was cut off, not finished.
      return run.finished ? 'stopped' : record.status;
    default:
      // A status a newer server stores.
      return run.finished ? 'not_run' : 'pending';
  }
}

/** Milliseconds from a unit's start to its end, or to `now` while it is
 * open; undefined when either end is unknown. */
export function spanMs(
  record: Pick<NodeRunRecord, 'startedAt' | 'endedAt'>,
  now?: number,
): number | undefined {
  const end = record.endedAt ?? now;
  if (record.startedAt === undefined || end === undefined) return undefined;
  return Math.max(0, end - record.startedAt);
}

/**
 * Milliseconds a unit spent waiting: each wait from its start to its end,
 * a wait still open to `now` (or not at all without it), time two waits
 * share counted once, never more than the unit's own span.
 */
export function waitedMs(
  record: Pick<NodeRunRecord, 'waits' | 'startedAt' | 'endedAt'>,
  now?: number,
): number {
  const spans = record.waits
    .map((wait) => [wait.since, wait.until ?? now] as const)
    .filter(
      (span): span is readonly [number, number] =>
        span[1] !== undefined &&
        Number.isFinite(span[0]) &&
        Number.isFinite(span[1]) &&
        span[1] > span[0],
    )
    .toSorted((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const [since, until] of spans) {
    const from = Math.max(since, reach);
    if (until > from) total += until - from;
    reach = Math.max(reach, until);
  }
  const span = spanMs(record, now);
  return span === undefined ? total : Math.min(total, span);
}

/** Milliseconds a unit spent working, as stored: never negative, and
 * never more than its span (two walkers' clocks may disagree). */
export function activeMsOf(
  record: Pick<NodeRunRecord, 'activeMs' | 'startedAt' | 'endedAt'>,
  now?: number,
): number {
  const active = Number.isFinite(record.activeMs)
    ? Math.max(0, record.activeMs)
    : 0;
  const span = spanMs(record, now);
  return span === undefined ? active : Math.min(active, span);
}

/**
 * How a step that runs per item or repeats went, item by item: the counts
 * its own record keeps (they include items whose rows were not kept), or
 * else counted from the rows of its items and passes. `units` are the
 * step's item and pass rows; undefined when there are none.
 */
export function countsOf(
  own: NodeRunRecord | undefined,
  units: readonly NodeRunRecord[],
): NodeRunCounts | undefined {
  if (own?.counts !== undefined) return { ...own.counts };
  if (units.length === 0) return undefined;
  const counts: NodeRunCounts = {
    items: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    kept: 0,
  };
  let passes = -1;
  for (const unit of units) {
    const { item, pass } = unit.key;
    if (item >= 0) counts.items = Math.max(counts.items, item + 1);
    if (item >= 0 && pass < 0) {
      counts.kept++;
      if (unit.status === 'ok') counts.ok++;
      else if (unit.status === 'failed') counts.failed++;
      else if (unit.status === 'skipped') counts.skipped++;
    } else if (item < 0 && pass >= 0) {
      counts.kept++;
      passes = Math.max(passes, pass);
    }
  }
  if (passes >= 0) counts.passes = passes + 1;
  return counts;
}

/** `shape` with its levels past `depth` left out: a level kept that far
 * still says what type it is. */
export function shapeToDepth(
  shape: SchemaTreeSchema,
  depth: number,
): SchemaTreeSchema {
  const {
    properties,
    items,
    anyOf,
    required,
    'x-omitted': omitted,
    ...rest
  } = shape;
  const out: SchemaTreeSchema = { ...rest };
  if (anyOf !== undefined) {
    out.anyOf = anyOf.map((alternative) => shapeToDepth(alternative, depth));
  }
  if (depth <= 0) return out;
  if (properties !== undefined) {
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([name, child]) => [
        name,
        shapeToDepth(child, depth - 1),
      ]),
    );
    if (required !== undefined) out.required = required;
    if (omitted !== undefined) out['x-omitted'] = omitted;
  }
  if (items !== undefined) out.items = shapeToDepth(items, depth - 1);
  return out;
}

/** A recorded value as a summary row shows it. */
export function glimpseOf(record: ValueRecord): ValueGlimpse {
  return {
    summary: record.summary,
    shape: shapeToDepth(record.shape, GLIMPSE_SHAPE_DEPTH),
    bytes: record.bytes,
    elided:
      (record.elided?.length ?? 0) > 0 || record.elidedTotal !== undefined,
    redactions: record.redactedTotal ?? record.redacted?.length ?? 0,
  };
}

/** The records with one per unit: the last of a repeated key, as a later
 * write replaces an earlier one. */
export function latestPerUnit(
  records: readonly NodeRunRecord[],
): NodeRunRecord[] {
  const byUnit = new Map<string, NodeRunRecord>();
  for (const record of records) {
    byUnit.set(
      `${record.key.path}\u0000${record.key.item}\u0000${record.key.pass}`,
      record,
    );
  }
  return [...byUnit.values()];
}

const NESTED = /^(.*)\[(\d+):(\d+)\]\/([^/]+)$/;

/** The step that walked the step at `path`, and the item and pass it was
 * walked for; undefined at the top level. */
export function parentOfPath(
  path: string,
): { path: string; item: number; pass: number } | undefined {
  const match = NESTED.exec(path);
  if (match === null) return undefined;
  return { path: match[1], item: Number(match[2]), pass: Number(match[3]) };
}

/** The decision's text in the version's document. */
function sourceOf(decision: Decision, node: NodeDef | undefined) {
  if (node === undefined) return undefined;
  switch (decision.kind) {
    case 'when':
      return node.when;
    case 'forEach':
      return node.forEach;
    case 'repeatUntil':
      return node.repeatUntil;
    default:
      return undefined;
  }
}

/** The moment the decision that skipped a step was taken. */
function skipAt(record: NodeRunRecord, reason: SkipReason): number | undefined {
  const kind = reason === 'error' ? 'onError' : reason;
  return (
    record.decisions.findLast((decision) => decision.kind === kind)?.at ??
    record.endedAt
  );
}

/** The status of a step whose own record is missing, from its items' and
 * passes' rows. */
function statusFromUnits(
  units: readonly NodeRunRecord[],
  run: RunFacts,
): ViewStatus {
  if (units.some((u) => u.status === 'running' || u.status === 'waiting')) {
    return run.finished ? 'stopped' : 'running';
  }
  if (units.some((u) => u.status === 'failed')) return 'failed';
  return run.finished ? 'succeeded' : 'running';
}

function pickMeta(meta: NodeRunRecord['meta']): NodeRunSummary['meta'] {
  const out: NodeRunSummary['meta'] = {};
  if (meta.model !== undefined) out.model = meta.model;
  if (meta.connector !== undefined) out.connector = meta.connector;
  if (meta.action !== undefined) out.action = meta.action;
  if (meta.effect !== undefined) out.effect = meta.effect;
  if (meta.execId !== undefined) out.execId = meta.execId;
  if (meta.docRef !== undefined) out.docRef = meta.docRef;
  if (meta.pins !== undefined) out.pins = { ...meta.pins };
  if (meta.bench !== undefined) out.bench = meta.bench;
  return out;
}

interface Context {
  run: RunFacts;
  steps: ReadonlyMap<string, NodeRunRecord>;
  units: ReadonlyMap<string, NodeRunRecord[]>;
  /** Whether a step of the version runs per item, and whether it repeats:
   * a nested step's path writes 0 for both when its parent does neither. */
  shapes: ReadonlyMap<string, { items: boolean; passes: boolean }>;
}

function summarize(
  path: string,
  record: NodeRunRecord | undefined,
  node: NodeDef | undefined,
  type: string,
  ctx: Context,
  status?: ViewStatus,
): NodeRunSummary {
  const { run } = ctx;
  const units = ctx.units.get(path) ?? [];
  const parent = parentOfPath(path);
  // The path writes 0 where its parent does not iterate; a reader reads -1,
  // as in a unit's own key.
  const shape = parent === undefined ? undefined : ctx.shapes.get(parent.path);
  const summary: NodeRunSummary = {
    path,
    nodeId: record?.nodeId ?? path.slice(path.lastIndexOf('/') + 1),
    type: record?.nodeType ?? type,
    ...(parent !== undefined && {
      parentPath: parent.path,
      parentItem: shape?.items === false ? -1 : parent.item,
      parentPass: shape?.passes === false ? -1 : parent.pass,
    }),
    status:
      status ??
      (record === undefined && units.length > 0
        ? statusFromUnits(units, run)
        : viewStatusOf(record, run, path)),
    activeMs: record === undefined ? 0 : activeMsOf(record, run.now),
    waitedMs: record === undefined ? 0 : waitedMs(record, run.now),
    attempt: record?.attempt ?? 0,
    attempts: record === undefined ? [] : [...record.attempts],
    decisions: (record?.decisions ?? []).map((decision) => {
      const source = sourceOf(decision, node);
      const copy: Decision & { source?: string } = structuredClone(decision);
      if (source !== undefined) copy.source = source;
      return copy;
    }),
    waits: record === undefined ? [] : record.waits.map((w) => ({ ...w })),
    meta: record === undefined ? {} : pickMeta(record.meta),
  };
  if (record?.startedAt !== undefined) summary.startedAt = record.startedAt;
  if (record?.endedAt !== undefined) summary.endedAt = record.endedAt;
  if (record !== undefined) {
    const reason: SkipReason | undefined = failedAndContinued(record)
      ? 'error'
      : record.status === 'skipped'
        ? record.skip?.reason
        : undefined;
    if (reason !== undefined) {
      const at = skipAt(record, reason);
      const via = record.skip?.via;
      summary.skip = {
        reason,
        ...(via !== undefined && { via: [...via] }),
        ...(at !== undefined && { at }),
        chain: skipChain(ctx.steps, path, run),
      };
    }
    if (record.failure !== undefined) summary.failure = record.failure;
    if (record.input !== undefined) summary.input = glimpseOf(record.input);
    if (record.output !== undefined) summary.output = glimpseOf(record.output);
    if (record.meta.reused !== undefined) {
      summary.reused = { runId: record.meta.reused.runId };
    }
  } else if (summary.status === 'not_run') {
    const cause = skipChain(ctx.steps, path, run)[0];
    if (cause?.kind === 'not_run') {
      summary.notRun = {
        ...(cause.stoppedAt !== undefined && { stoppedAt: cause.stoppedAt }),
        runStatus: cause.runStatus,
      };
    }
  }
  const counts = countsOf(record, units);
  if (counts !== undefined) summary.counts = counts;
  return summary;
}

/**
 * Every step of a run as its record reads: the run input (`__start`), the
 * version's steps in the order they run — each, recorded or not — the
 * document output (`__end`), then any other step the records hold (steps
 * inside subautomations, in the order they started). Each step that
 * produced no output carries its skip chain.
 *
 * `records` are the run's stored rows, items and passes included: they
 * count into their step's summary rather than standing as their own.
 */
export function projectRecord(
  doc: Automation,
  records: readonly NodeRunRecord[],
  facts: RunFacts,
): NodeRunSummary[] {
  const run = settledFacts(facts);
  const steps = new Map<string, NodeRunRecord>();
  const units = new Map<string, NodeRunRecord[]>();
  for (const record of latestPerUnit(records)) {
    const { path, item, pass } = record.key;
    if (item < 0 && pass < 0) {
      steps.set(path, record);
      continue;
    }
    const list = units.get(path);
    if (list === undefined) units.set(path, [record]);
    else list.push(record);
  }
  for (const list of units.values()) {
    list.sort((a, b) => a.key.item - b.key.item || a.key.pass - b.key.pass);
  }
  const shapes = new Map(
    doc.nodes
      .filter((node) => typeof node.id === 'string')
      .map((node) => [
        node.id,
        {
          items: typeof node.forEach === 'string',
          passes: typeof node.repeatUntil === 'string',
        },
      ]),
  );
  const ctx: Context = { run, steps, units, shapes };

  const nodes: NodeDef[] = [];
  const known = new Set<string>();
  for (const node of doc.nodes) {
    if (typeof node.id !== 'string' || known.has(node.id)) continue;
    known.add(node.id);
    nodes.push(node);
  }
  const ordered = topoSort(nodes) ?? nodes;
  const rank = new Map(ordered.map((node, index) => [node.id, index]));

  const out: NodeRunSummary[] = [];
  const done = new Set<string>([START_PATH, END_PATH]);
  const start = steps.get(START_PATH);
  out.push(
    summarize(
      START_PATH,
      start,
      undefined,
      'input',
      ctx,
      start === undefined
        ? run.status === 'queued'
          ? 'pending'
          : 'succeeded'
        : undefined,
    ),
  );
  for (const node of ordered) {
    done.add(node.id);
    out.push(summarize(node.id, steps.get(node.id), node, node.type, ctx));
  }
  const end = steps.get(END_PATH);
  out.push(
    summarize(
      END_PATH,
      end,
      undefined,
      'output',
      ctx,
      end === undefined && run.status === 'success' ? 'succeeded' : undefined,
    ),
  );

  const rest = [...new Set([...steps.keys(), ...units.keys()])]
    .filter((path) => !done.has(path))
    .map((path) => {
      const root = path.split('[')[0]?.split('/')[0] ?? path;
      const record = steps.get(path) ?? units.get(path)?.[0];
      return {
        path,
        rank: rank.get(root) ?? Number.POSITIVE_INFINITY,
        startedAt: record?.startedAt ?? Number.POSITIVE_INFINITY,
      };
    })
    .toSorted(
      (a, b) =>
        a.rank - b.rank ||
        a.startedAt - b.startedAt ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );
  for (const { path } of rest) {
    const record = steps.get(path);
    const type = record?.nodeType ?? units.get(path)?.[0]?.nodeType ?? '';
    out.push(summarize(path, record, undefined, type, ctx));
  }
  return out;
}
