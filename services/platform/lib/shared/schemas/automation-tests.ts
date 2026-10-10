/**
 * Automation tests on the wire: what a document's tests say (the grammar a
 * person, a coding agent and the engine share), the bench a run is given,
 * what a run of the tests answers (each test, whether it passed and, for one
 * that did not, what differed), the report a saved version keeps of its
 * latest check, and the answer of a run made in one call and never stored.
 *
 * The engine owns every shape: the grammar in `lib/engine/core/types.ts`,
 * the report in `lib/engine/api/tests.ts`, the record of a run that is never
 * stored in `lib/engine/core/record/transient.ts`. These schemas read those
 * shapes at the boundary — the app parses an answer instead of casting it,
 * and a door checks a body before the engine sees it — and their tests hold
 * them to what the engine produces.
 *
 * The grammar reads the way the engine's own document check does: a test
 * keeps members it does not know (the check only warns about them), and so
 * does an expected effect; `expect` and an expected failure take their own
 * members only. Everywhere else a member this build does not read is
 * dropped.
 */

import type { DiffKind } from '@tale/ui/data/value-diff';
import type { ValueKind } from '@tale/ui/data/value-summary';
import { z } from 'zod';

import { reportText } from '../../engine/api/expect';
import type { TestFailure, TestReport } from '../../engine/api/tests';
import type { TransientRecord } from '../../engine/core/record/transient';
import type { EvalTrace } from '../../engine/core/record/types';
import type { BenchMark } from '../../engine/core/types';
import { isRecord } from '../../utils/type-utils';
import { issueSchema } from './automation-issues';

/**
 * What a bench may carry, at a door that takes one: one simulated output
 * (as UTF-8 JSON), a whole bench — every stand-in of a test or a step
 * test — and one simulated failure's message, which the document check
 * holds to the same length.
 */
export const BENCH_LIMITS = {
  mockBytes: 65_536,
  benchBytes: 524_288,
  failureChars: 2_000,
} as const;

/** The longest node id the grammar allows (`^[a-z][a-z0-9_]{0,49}$`). */
const NODE_ID_MAX = 50;

const count = z.number().int().nonnegative();

// ------------------------------------------------------------- the grammar

const expectedNodeStateSchema = z.enum(['ran', 'skipped', 'failed']);

/** One effect a test expects — or, with `absent`, expects not to happen. */
const expectedEffectSchema = z
  .looseObject({
    connector: z.string(),
    node: z.string().optional(),
    input: z.json().optional(),
    inputIncludes: z.json().optional(),
    absent: z.literal(true).optional(),
  })
  .refine(
    (effect) =>
      effect.input === undefined || effect.inputIncludes === undefined,
    {
      message:
        'compares the effect input exactly (input) or by inclusion (inputIncludes), not both',
    },
  );

/** What a run must do for its test to pass. */
export const testExpectationSchema = z
  .strictObject({
    output: z.json().optional(),
    outputIncludes: z.json().optional(),
    effects: z.array(expectedEffectSchema).optional(),
    nodes: z.record(z.string(), expectedNodeStateSchema).optional(),
    failure: z
      .strictObject({
        node: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (expect) =>
      expect.failure === undefined ||
      (expect.output === undefined && expect.outputIncludes === undefined),
    {
      message:
        'a run that must fail has no output to compare: failure excludes output and outputIncludes',
      path: ['failure'],
    },
  );

const mocksSchema = z.record(z.string(), z.json());
const failuresSchema = z.record(
  z.string(),
  z.string().max(BENCH_LIMITS.failureChars),
);

/** A test as a document holds it: its input, the calls it stands in for,
 * and what the run must do. */
export const automationTestSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  input: z.json(),
  mocks: mocksSchema.optional(),
  failures: failuresSchema.optional(),
  expect: testExpectationSchema.optional(),
});

/** The bench a run is given: a test's stand-ins, and a step test's scope.
 * Which nodes it may name, and how its scopes combine, the engine's bench
 * plan decides (`planBench`), with a refusal of its own for each. */
export const runBenchSchema = z.strictObject({
  mocks: mocksSchema.optional(),
  failures: failuresSchema.optional(),
  upTo: z.string().max(NODE_ID_MAX).optional(),
  only: z.string().max(NODE_ID_MAX).optional(),
  item: count.optional(),
  test: z
    .strictObject({ name: z.string(), index: count.optional() })
    .optional(),
});

// ------------------------------------------------------------ the answers

const DIFF_KINDS = [
  'added',
  'removed',
  'changed',
  'type-changed',
  'reordered',
  'unknown',
] as const satisfies readonly DiffKind[];

const VALUE_KINDS = [
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'array',
  'object',
] as const satisfies readonly ValueKind[];

/** One difference the shared value diff names (`@tale/ui/data/value-diff`):
 * where, what kind, and both values. */
export const diffChangeSchema = z.object({
  pointer: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  kind: z.enum(DIFF_KINDS),
  before: z.json().optional(),
  after: z.json().optional(),
  beforeKind: z.enum(VALUE_KINDS).optional(),
  afterKind: z.enum(VALUE_KINDS).optional(),
});

/** The differences a failure lists: the test runner lists five, each value
 * quoted to 200 characters, and counts them all in `total`. */
const MISMATCHES_LISTED = 5;

const mismatchesSchema = z.array(diffChangeSchema).max(MISMATCHES_LISTED);

const failureParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
);

/** The sub-expression values of a failing expression: the run record's own
 * read model, checked here for its frame only. */
const evalTraceSchema = z.custom<EvalTrace>(
  (value) =>
    isRecord(value) &&
    typeof value.pointer === 'string' &&
    Array.isArray(value.units),
);

/** Why a step failed, as a reason a reader explains in its own language. A
 * reason is any string: one a newer server names reads without words. */
const stepFailureSchema = z.object({
  code: z.string(),
  reason: z.string(),
  params: failureParamsSchema,
  message: z.string(),
  hint: z.string().optional(),
  at: z
    .object({
      pointer: z.string(),
      range: z.tuple([z.number(), z.number()]).optional(),
    })
    .optional(),
  trace: evalTraceSchema.optional(),
});

/** Every kind of failure a test can end in. */
const TEST_FAILURE_KINDS = [
  'refused',
  'run_failed',
  'run_succeeded',
  'failed_elsewhere',
  'failure_message',
  'output',
  'effect_missing',
  'effect_present',
  'node_state',
  'timeout',
] as const satisfies ReadonlyArray<TestFailure['kind']>;

/** Why a test did not pass, as `lib/engine/api/tests.ts` types it. */
export const testFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('refused'), issues: z.array(issueSchema) }),
  z.object({
    kind: z.literal('run_failed'),
    node: z.string().optional(),
    message: z.string(),
    failure: stepFailureSchema
      .pick({ code: true, reason: true, params: true })
      .optional(),
  }),
  z.object({
    kind: z.literal('run_succeeded'),
    expected: z.object({
      node: z.string().optional(),
      message: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('failed_elsewhere'),
    expectedNode: z.string(),
    actualNode: z.string().optional(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('failure_message'),
    expected: z.string(),
    actual: z.string(),
    node: z.string().optional(),
  }),
  z.object({
    kind: z.literal('output'),
    mode: z.enum(['exact', 'includes']),
    mismatches: mismatchesSchema,
    total: count,
  }),
  z.object({
    kind: z.literal('effect_missing'),
    entry: count,
    connector: z.string(),
    node: z.string().optional(),
    closest: z
      .object({ node: z.string(), mismatches: mismatchesSchema, total: count })
      .optional(),
    actual: z.array(z.object({ node: z.string(), connector: z.string() })),
  }),
  z.object({
    kind: z.literal('effect_present'),
    entry: count,
    connector: z.string(),
    node: z.string(),
  }),
  z.object({
    kind: z.literal('node_state'),
    node: z.string(),
    expected: expectedNodeStateSchema,
    actual: z.enum(['ran', 'skipped', 'failed', 'not_run']),
  }),
  z.object({ kind: z.literal('timeout'), limitMs: count }),
]);

/** One external side effect a run performed, in execution order. */
const effectSchema = z.object({
  node: z.string(),
  connector: z.string(),
  input: z.json(),
  item: count.optional(),
  pass: count.optional(),
});

const runErrorSchema = z.object({
  nodeId: z.string().optional(),
  message: z.string(),
  hint: z.string().optional(),
  failure: stepFailureSchema.optional(),
});

/** The record of a run that is never stored — its view and every unit read
 * whole: the run record's own read model (`RunRecordView`,
 * `NodeRunDetail`), checked here for its frame only. */
const transientRecordSchema = z.custom<TransientRecord>(
  (value) =>
    isRecord(value) && isRecord(value.view) && Array.isArray(value.details),
);

const runStatusSchema = z.enum(['success', 'error', 'invalid']);
const stoppedBySchema = z.enum(['time_limit', 'cancelled']);

/** What a test's run produced, kept when its caller asked for the detail. */
const testRunDetailSchema = z.object({
  status: runStatusSchema,
  output: z.json().optional(),
  error: runErrorSchema.optional(),
  effects: z.array(effectSchema).optional(),
  stoppedBy: stoppedBySchema.optional(),
  record: transientRecordSchema.optional(),
});

export const testResultSchema = z.object({
  name: z.string(),
  index: count,
  pass: z.boolean(),
  /** The first failure, in the engine's English. */
  message: z.string().optional(),
  failures: z.array(testFailureSchema).optional(),
  ms: z.number().nonnegative(),
  path: z
    .object({
      id: z.string(),
      assignment: z.record(z.string(), z.boolean()),
    })
    .optional(),
  unusedMocks: z.array(z.string()).optional(),
  run: testRunDetailSchema.optional(),
});

/** What a run of an automation's tests answers. */
export const testReportSchema = z.object({
  passed: count,
  failed: count,
  results: z.array(testResultSchema),
  notRun: z.array(z.string()).optional(),
});

const BENCH_MARKS = [
  'mocked',
  'pinned',
  'failed',
  'left-out',
] as const satisfies readonly BenchMark[];

/** One step of a run, as its trace records it. */
const nodeTraceSchema = z.object({
  node: z.string(),
  type: z.string(),
  status: z.enum(['ok', 'skipped', 'error', 'not_run']),
  execId: z.string().optional(),
  input: z.json().optional(),
  output: z.json().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  ms: z.number().optional(),
  bench: z.enum(BENCH_MARKS).optional(),
  whenWouldSkip: z.literal(true).optional(),
});

/**
 * A run made in one call and never stored — a try of a draft, a step test —
 * as it is answered: the run's outcome, trace and effects, how long it took,
 * the document it ran (by hash, and its version when it is a saved one), the
 * bench it was given, and its record read the way a stored run's is.
 */
export const transientRunSchema = z.object({
  status: runStatusSchema,
  output: z.json().optional(),
  error: runErrorSchema.optional(),
  trace: z.array(nodeTraceSchema),
  effects: z.array(effectSchema),
  validation: z
    .object({
      errors: z.array(issueSchema),
      warnings: z.array(issueSchema),
    })
    .optional(),
  focus: z
    .object({
      node: z.string(),
      kind: z.enum(['upTo', 'only']),
      item: count.optional(),
    })
    .optional(),
  stoppedBy: stoppedBySchema.optional(),
  unusedMocks: z.array(z.string()).optional(),
  ms: z.number().nonnegative(),
  documentHash: z.string(),
  version: z.number().int().min(1).optional(),
  bench: runBenchSchema.optional(),
  record: transientRecordSchema.optional(),
});

// ------------------------------------------------------ the stored report

/** The most a stored report takes as UTF-8 JSON. */
export const STORED_TEST_REPORT_MAX_BYTES = 65_536;

/** The characters of a test name a report trimmed past its size keeps. */
const STORED_NAME_CHARS = 200;

/** A failure of a report trimmed past its size: its kind alone. */
const trimmedFailureSchema = z.strictObject({
  kind: z.enum(TEST_FAILURE_KINDS),
});

const storedResultFields = {
  name: z.string(),
  index: count,
  pass: z.boolean(),
  ms: z.number().nonnegative(),
  /** The id of the path the run took, among the document's possible ones. */
  path: z.string().optional(),
};

const storedReportFields = {
  /** When the tests ran: the version's `tests_checked_at_ms` while this
   * report is its current one. */
  checkedAt: z.number(),
  passed: count,
  failed: count,
  notRun: z.array(z.string()).optional(),
};

/** A report that kept every failure whole. */
const wholeStoredReportSchema = z.object({
  ...storedReportFields,
  results: z.array(
    z.object({
      ...storedResultFields,
      failures: z.array(testFailureSchema).optional(),
    }),
  ),
});

/** A report trimmed past its size: each failure by its kind alone. */
const trimmedStoredReportSchema = z.object({
  ...storedReportFields,
  trimmed: z.literal(true),
  results: z.array(
    z.object({
      ...storedResultFields,
      failures: z.array(trimmedFailureSchema).optional(),
    }),
  ),
});

/**
 * What a saved version keeps of its latest test check: each test, whether
 * it passed and how long it took, the path its run took, and for one that
 * failed each failure with at most five differences, their values quoted —
 * never a trace or an output. A report past {@link
 * STORED_TEST_REPORT_MAX_BYTES} keeps each failure's kind alone (`trimmed`).
 */
export const storedTestReportSchema = z.union([
  wholeStoredReportSchema,
  trimmedStoredReportSchema,
]);

export type StoredTestReport = z.infer<typeof storedTestReportSchema>;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The report a saved version keeps of a run of its tests, made at
 * `checkedAt`: each result without its run, its first-failure sentence and
 * its unused stand-ins, and with its path's id only. A report past {@link
 * STORED_TEST_REPORT_MAX_BYTES} keeps each failure's kind alone, and past
 * that too each test name is cut — a version holds at most fifty tests, so
 * that always fits. A failure this schema cannot read is kept by its kind
 * alone too, in a report trimmed the same way.
 */
export function storedTestReport(
  report: TestReport,
  checkedAt: number,
): StoredTestReport {
  const fields = {
    checkedAt,
    passed: report.passed,
    failed: report.failed,
    ...(report.notRun !== undefined && { notRun: [...report.notRun] }),
  };
  const results = report.results.map((result) => ({
    stored: {
      name: result.name,
      index: result.index,
      pass: result.pass,
      ms: result.ms,
      ...(result.path !== undefined && { path: result.path.id }),
    },
    failures: (result.failures ?? []).map((failure) => ({
      kind: failure.kind,
      read: testFailureSchema.safeParse(JSON.parse(JSON.stringify(failure))),
    })),
  }));
  if (results.every(({ failures }) => failures.every((f) => f.read.success))) {
    const whole: z.infer<typeof wholeStoredReportSchema> = {
      ...fields,
      results: results.map(({ stored, failures }) => ({
        ...stored,
        ...(failures.length > 0 && {
          failures: failures.flatMap((f) =>
            f.read.success ? [f.read.data] : [],
          ),
        }),
      })),
    };
    if (jsonBytes(whole) <= STORED_TEST_REPORT_MAX_BYTES) return whole;
  }
  const trimmed = (
    cut: boolean,
  ): z.infer<typeof trimmedStoredReportSchema> => ({
    ...fields,
    ...(cut &&
      fields.notRun !== undefined && {
        notRun: fields.notRun.map((name) =>
          reportText(name, STORED_NAME_CHARS),
        ),
      }),
    trimmed: true,
    results: results.map(({ stored, failures }) => ({
      ...stored,
      ...(cut && { name: reportText(stored.name, STORED_NAME_CHARS) }),
      ...(failures.length > 0 && {
        failures: failures.map(({ kind }) => ({ kind })),
      }),
    })),
  });
  const kinds = trimmed(false);
  return jsonBytes(kinds) <= STORED_TEST_REPORT_MAX_BYTES
    ? kinds
    : trimmed(true);
}
