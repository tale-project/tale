/**
 * Runs that are never stored: a try of a draft or a saved version, with the
 * stand-ins a test or a step test gives it, and an automation's tests run by
 * hand. Both execute in this process, so the routes charge them against the
 * organization's bench budget (`automation:bench`) and hold them to a few at
 * a time per process; each is cut off by its deadline, or by its caller
 * leaving.
 */

import { randomUUID } from 'node:crypto';

import { valueHash } from '@tale/ui/data/hash';

import {
  runAutomationTests,
  type TestReport,
} from '../../../lib/engine/api/tests.ts';
import { execute } from '../../../lib/engine/core/execute/index.ts';
import { createRecorder } from '../../../lib/engine/core/record/recorder.ts';
import { transientRecord } from '../../../lib/engine/core/record/transient.ts';
import { recordBudget } from '../../../lib/engine/core/record/value.ts';
import type { StoreAdapter } from '../../../lib/engine/core/slots.ts';
import type {
  Automation,
  RunBench,
  RunResult,
} from '../../../lib/engine/core/types.ts';
import { boundJson } from '../../../lib/shared/utils/bound-json.ts';

/** Bench runs one process executes at once; past it a caller is asked to
 * come back in a moment. Each holds a request and up to its deadline of
 * CPU, so a handful keeps the API answering everything else. */
export const BENCH_CONCURRENCY = 4;

/** A try's time limit. */
const TRY_DEADLINE_MS = 20_000;
/** Each test's time limit, and the suite's, when tests run by hand. */
const TEST_DEADLINE_MS = 10_000;
const SUITE_DEADLINE_MS = 60_000;

/** The most one value of an answer keeps whole, as UTF-8 JSON. */
export const VALUE_BYTES_MAX = 262_144;
/** The most a try's answer, and one test's run in a suite's, may hold. */
const TRY_ANSWER_BYTES_MAX = 4_194_304;
const TEST_RUN_BYTES_MAX = 524_288;
/** The most a suite's answer may hold. */
const SUITE_ANSWER_BYTES_MAX = 8_388_608;

let running = 0;

/** A place among the bench runs of this process, released when the run is
 * done; null when they are all taken. */
export function admitBenchRun(): (() => void) | null {
  if (running >= BENCH_CONCURRENCY) return null;
  running += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running -= 1;
  };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

/** What a display keeps of a value too large to answer whole: long text and
 * lists cut, with the count of what was left out. */
const SHOWN = { maxString: 8_192, maxItems: 100, maxDepth: 12 } as const;

/** A value as an answer carries it: whole, or cut to be shown. */
function bounded(value: unknown): unknown {
  if (value === undefined || jsonBytes(value) <= VALUE_BYTES_MAX) return value;
  return boundJson(value, SHOWN);
}

/** One run executed in this call, as the try answers it. */
export interface TransientRunAnswer extends Omit<RunResult, 'record'> {
  ms: number;
  documentHash: string;
  version?: number;
  bench?: RunBench;
  record?: ReturnType<typeof transientRecord>;
}

/** A try's run with every value kept within what an answer carries: each
 * value cut past {@link VALUE_BYTES_MAX}, and the steps' own values left
 * out — the record still holds them — when the whole would pass {@link
 * TRY_ANSWER_BYTES_MAX}. */
function boundedRun(run: TransientRunAnswer): TransientRunAnswer {
  const shaped: TransientRunAnswer = {
    ...run,
    ...(run.output !== undefined && { output: bounded(run.output) }),
    trace: run.trace.map((entry) => ({
      ...entry,
      ...(entry.input !== undefined && { input: bounded(entry.input) }),
      ...(entry.output !== undefined && { output: bounded(entry.output) }),
    })),
    effects: run.effects.map((effect) => ({
      ...effect,
      input: bounded(effect.input),
    })),
  };
  if (jsonBytes(shaped) <= TRY_ANSWER_BYTES_MAX) return shaped;
  return {
    ...shaped,
    trace: shaped.trace.map(
      ({ input: _input, output: _output, ...rest }) => rest,
    ),
  };
}

/**
 * One run of `document`, never stored: its input and stand-ins given, in
 * mock mode, recorded the way a stored run is, within {@link
 * TRY_DEADLINE_MS}. `version` names the saved version it is, absent for a
 * draft.
 */
export async function tryRun(args: {
  document: Automation;
  version?: number;
  input?: unknown;
  bench?: RunBench;
  store: StoreAdapter;
  signal?: AbortSignal;
}): Promise<TransientRunAnswer> {
  const startedAt = Date.now();
  const recorder = createRecorder({
    now: () => Date.now(),
    budget: recordBudget(),
  });
  const t0 = performance.now();
  const result = await execute(args.document, {
    mode: 'mock',
    store: args.store,
    deadline: startedAt + TRY_DEADLINE_MS,
    recorder,
    ...(args.input !== undefined && { input: args.input }),
    ...(args.bench !== undefined && { bench: args.bench }),
    ...(args.signal !== undefined && { signal: args.signal }),
  });
  const ms = Math.round((performance.now() - t0) * 10) / 10;
  const record = transientRecord({
    doc: args.document,
    result,
    id: `try-${randomUUID()}`,
    startedAt,
    finishedAt: Date.now(),
    ...(args.version !== undefined && { version: args.version }),
  });
  const { record: _records, ...rest } = result;
  return boundedRun({
    ...rest,
    ms,
    documentHash: valueHash(args.document),
    ...(args.version !== undefined && { version: args.version }),
    ...(args.bench !== undefined && { bench: args.bench }),
    ...(record !== undefined && { record }),
  });
}

/** A suite's report as answered: each test's run kept when it fits {@link
 * TEST_RUN_BYTES_MAX} and the whole stays within {@link
 * SUITE_ANSWER_BYTES_MAX}; a run left out is said so (`detailOmitted`). */
function boundedReport(report: TestReport): TestReport {
  let total = 0;
  return {
    ...report,
    results: report.results.map((result) => {
      if (result.run === undefined) return result;
      const bytes = jsonBytes(result.run);
      total += bytes;
      if (bytes <= TEST_RUN_BYTES_MAX && total <= SUITE_ANSWER_BYTES_MAX) {
        return result;
      }
      const { run: _run, ...rest } = result;
      return { ...rest, detailOmitted: true };
    }),
  };
}

/**
 * The tests of `document` run here — all of them, or those `select` names
 * by their place — each in mock mode within {@link TEST_DEADLINE_MS}, the
 * suite within {@link SUITE_DEADLINE_MS}; with `detail`, each test's run
 * and record. A document without tests answers an empty report.
 */
export async function runTestsByHand(args: {
  document: Automation;
  version?: number;
  select?: readonly number[];
  detail: boolean;
  store: StoreAdapter;
  signal?: AbortSignal;
}): Promise<TestReport> {
  const report = await runAutomationTests(args.document, {
    store: args.store,
    detail: args.detail,
    testDeadlineMs: TEST_DEADLINE_MS,
    suiteDeadlineMs: SUITE_DEADLINE_MS,
    ...(args.select !== undefined && { select: args.select }),
    ...(args.version !== undefined && { version: args.version }),
    ...(args.signal !== undefined && { signal: args.signal }),
  });
  if (!('failed' in report)) return { passed: 0, failed: 0, results: [] };
  return boundedReport(report);
}
