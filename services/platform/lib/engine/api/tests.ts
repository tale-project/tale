/**
 * test_automation: run an automation's attached acceptance tests and judge
 * them. Tests are first-class in the document itself because authors that
 * verify against tests before shipping measurably (roughly twice as often)
 * land working automations — the fast feedback loop is the product.
 *
 * Each test runs through the executor in mock mode, with the stand-ins it
 * gives (`../core/execute/bench`: a stand-in replaces a node's call, never
 * the node). Then it is judged, in order: a test whose bench or input the
 * run refuses cannot run, and fails; the run must end as the test expects
 * (fail, where it names a failure — at its node, with its message — and
 * succeed otherwise); then every other expectation is checked and every
 * miss kept — the output (exactly, or what it must include), each effect
 * (that it happened, or with `absent` that it did not) and each node's
 * state. A miss is a typed failure that says what differed and where; its
 * English `message` is the first failure's sentence, worded as this runner
 * has always worded a run failure, an output mismatch and a missing effect,
 * for the clients that read it.
 *
 * Each test has a time limit, and so has the suite: a test that runs past
 * its own fails, and the tests the suite's time does not reach are named as
 * not run and count as failed.
 */

import type { ValidateFunction } from 'ajv';

import { cutText, storableText } from '../../shared/utils/storable-text';
import {
  assignmentFromRun,
  flowModel,
  type FlowModel,
  pathIdOf,
  possiblePaths,
} from '../core/analysis/flow';
import { execute } from '../core/execute';
import {
  benchFromTest,
  EXPECTED_STATE_WORDS,
  planBench,
  refusalIssue,
  refusalPath,
} from '../core/execute/bench';
import { createRecorder } from '../core/record/recorder';
import {
  transientRecord,
  type TransientRecord,
} from '../core/record/transient';
import type { StepFailure } from '../core/record/types';
import { recordBudget } from '../core/record/value';
import type { StoreAdapter } from '../core/slots';
import { ptr } from '../core/syntax/pointer';
import { SUITE_DEADLINE_MS, TEST_DEADLINE_MS } from '../core/test-limits';
import type {
  Automation,
  AutomationTest,
  Effect,
  ExpectedEffect,
  ExpectedNodeState,
  Issue,
  NodeTrace,
  RunError,
  RunResult,
  TestExpectation,
} from '../core/types';
import { inputCheck, testInputRefusal } from '../core/validate/document';
import { type Mismatch, mismatchesOf, reportChange } from './expect';
export { stableStringify } from '../../shared/utils/stable-stringify';

/** Why a test did not pass. A `Mismatch` (`./expect`) is one difference,
 * its values quoted to 200 characters; a failure lists five at most and
 * counts them all. */
export type TestFailure =
  /** The test could not run: its bench or its input was refused. */
  | { kind: 'refused'; issues: Issue[] }
  /** The run failed where the test expects it to succeed. */
  | {
      kind: 'run_failed';
      node?: string;
      /** The engine's English, for the technical details. */
      message: string;
      failure?: Pick<StepFailure, 'code' | 'reason' | 'params'>;
    }
  /** The run succeeded where the test expects it to fail. */
  | { kind: 'run_succeeded'; expected: { node?: string; message?: string } }
  /** The run failed at another node than the test expects (none: outside
   * its nodes, such as its output). */
  | {
      kind: 'failed_elsewhere';
      expectedNode: string;
      actualNode?: string;
      message: string;
    }
  /** The run failed where expected, with an error that does not contain the
   * message the test expects. */
  | { kind: 'failure_message'; expected: string; actual: string; node?: string }
  /** The output differs from `output` (`exact`) or does not contain
   * `outputIncludes` (`includes`): the first few differences, and how many
   * there are. */
  | {
      kind: 'output';
      mode: 'exact' | 'includes';
      mismatches: Mismatch[];
      total: number;
    }
  /** An expected effect did not happen: the effect of the same kind closest
   * to it, and which effects the run did perform. */
  | {
      kind: 'effect_missing';
      entry: number;
      connector: string;
      node?: string;
      closest?: { node: string; mismatches: Mismatch[]; total: number };
      actual: Array<{ node: string; connector: string }>;
    }
  /** An effect the test expects not to happen did, at `node`. */
  | { kind: 'effect_present'; entry: number; connector: string; node: string }
  /** A node did not do what the test expects of it. */
  | {
      kind: 'node_state';
      node: string;
      expected: ExpectedNodeState;
      actual: ExpectedNodeState | 'not_run';
    }
  /** The test ran past its time limit and was stopped. */
  | { kind: 'timeout'; limitMs: number };

/** What a test's run produced, for a reader that shows it. */
export interface TestRunDetail {
  status: RunResult['status'];
  output?: unknown;
  error?: RunError;
  effects?: Effect[];
  stoppedBy?: RunResult['stoppedBy'];
  /** Its record, read as a stored run's is. */
  record?: TransientRecord;
}

export interface TestResult {
  name: string;
  /** The test's place in the document's tests, from 0. */
  index: number;
  pass: boolean;
  /** The first failure, in English — kept whole, worded as this runner
   * has always worded it, for clients that read it. */
  message?: string;
  failures?: TestFailure[];
  /** How long the test took. */
  ms: number;
  /** The way through the automation's conditions and tolerated failures
   * the run took; absent when the run did not succeed, or the ways cannot
   * all be listed. */
  path?: { id: string; assignment: Record<string, boolean> };
  /** Nodes the test stands in for whose stand-in the run never used:
   * skipped, never got to, or run over no items. */
  unusedMocks?: string[];
  /** With `detail`: what the run produced. */
  run?: TestRunDetail;
}

export interface TestReport {
  passed: number;
  /** The tests that did not pass, those not run included. */
  failed: number;
  results: TestResult[];
  /** The tests the suite's time — or its caller — stopped before they
   * finished, by name. */
  notRun?: string[];
}

export interface MissingTests {
  error: string;
  hint?: string;
}

export interface TestRunOptions {
  /** The caller's org-scoped store, so a test can exercise subautomation
   * nodes; without it those nodes fail and the test reports why. */
  store?: StoreAdapter;
  /** Run these tests only, by their place in the document's tests. */
  select?: readonly number[];
  /** Each test's time limit (10 s). */
  testDeadlineMs?: number;
  /** The suite's time limit (60 s). */
  suiteDeadlineMs?: number;
  /** Keep what each run produced, with its record (`TestResult.run`). */
  detail?: boolean;
  /** The saved version the document is, named in each run's record; a
   * draft has none. */
  version?: number;
  /** Stops the suite once aborted: the tests it stops are not run. */
  signal?: AbortSignal;
}

/** Differences a failure lists; the rest are counted. */
const MISMATCHES_LISTED = 5;
/** Effects an `effect_missing` failure names as performed. */
const EFFECTS_LISTED = 20;
/** The most of the engine's English a typed failure keeps. */
const MESSAGE_LENGTH = 4096;

/** A test stopped by the suite, not by its own time limit. */
const NOT_RUN = Symbol('not run');

const ACTUAL_WORDS: Readonly<Record<ExpectedNodeState | 'not_run', string>> = {
  ran: 'ran',
  skipped: 'was skipped',
  failed: 'failed',
  not_run: 'did not run',
};

function english(text: string): string {
  return text.length > MESSAGE_LENGTH
    ? `${storableText(cutText(text, MESSAGE_LENGTH))}…`
    : storableText(text);
}

/** What a node did, as a test names it. */
function stateOf(entry: NodeTrace | undefined): ExpectedNodeState | 'not_run' {
  switch (entry?.status) {
    case 'ok':
      return 'ran';
    case 'skipped':
      return 'skipped';
    case 'error':
      return 'failed';
    default:
      return 'not_run';
  }
}

/** The effect an entry expects, matched against what the run did. */
function judgeEffect(
  j: number,
  entry: ExpectedEffect,
  effects: readonly Effect[],
): { failure: TestFailure; message: string } | undefined {
  const sameKind = effects.filter(
    (e) =>
      e.connector === entry.connector &&
      (entry.node === undefined || e.node === entry.node),
  );
  const matches = (e: Effect): boolean =>
    (entry.input === undefined ||
      mismatchesOf('exact', entry.input, e.input, 1).total === 0) &&
    (entry.inputIncludes === undefined ||
      mismatchesOf('includes', entry.inputIncludes, e.input, 1).total === 0);
  const hit = sameKind.find(matches);
  const byNode = entry.node === undefined ? '' : ` by "${entry.node}"`;
  if (entry.absent === true) {
    if (hit === undefined) return undefined;
    return {
      failure: {
        kind: 'effect_present',
        entry: j,
        connector: entry.connector,
        node: hit.node,
      },
      message: `expected no ${entry.connector} effect${byNode}, but "${hit.node}" performed one`,
    };
  }
  if (hit !== undefined) return undefined;
  let closest: Extract<TestFailure, { kind: 'effect_missing' }>['closest'];
  if (entry.input !== undefined || entry.inputIncludes !== undefined) {
    for (const e of sameKind) {
      const found =
        entry.input !== undefined
          ? mismatchesOf('exact', entry.input, e.input, MISMATCHES_LISTED)
          : mismatchesOf(
              'includes',
              entry.inputIncludes,
              e.input,
              MISMATCHES_LISTED,
            );
      if (closest === undefined || found.total < closest.total) {
        closest = {
          node: e.node,
          mismatches: found.changes.map(reportChange),
          total: found.total,
        };
      }
    }
  }
  const actual: Array<{ node: string; connector: string }> = [];
  const seen = new Set<string>();
  for (const e of effects) {
    const key = `${e.node}\u0000${e.connector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (actual.length < EFFECTS_LISTED) {
      actual.push({ node: e.node, connector: e.connector });
    }
  }
  return {
    failure: {
      kind: 'effect_missing',
      entry: j,
      connector: entry.connector,
      ...(entry.node !== undefined && { node: entry.node }),
      ...(closest !== undefined && { closest }),
      actual,
    },
    message: `expected effect ${entry.connector}${byNode}${entry.input ? ` with input ${JSON.stringify(entry.input)}` : ''}${entry.inputIncludes === undefined ? '' : ` with input including ${JSON.stringify(entry.inputIncludes)}`} did not occur (actual: ${effects.map((e) => e.connector).join(', ') || 'none'})`,
  };
}

/** The misses of a run that ended as its test expects. */
function judgeRun(
  expect: TestExpectation,
  r: RunResult,
): Array<{ failure: TestFailure; message: string }> {
  const found: Array<{ failure: TestFailure; message: string }> = [];
  if (expect.failure === undefined) {
    if (expect.output !== undefined) {
      const m = mismatchesOf(
        'exact',
        expect.output,
        r.output,
        MISMATCHES_LISTED,
      );
      if (m.total > 0) {
        found.push({
          failure: {
            kind: 'output',
            mode: 'exact',
            mismatches: m.changes.map(reportChange),
            total: m.total,
          },
          message: `output mismatch — expected ${JSON.stringify(expect.output)} but got ${JSON.stringify(r.output)}`,
        });
      }
    }
    if (expect.outputIncludes !== undefined) {
      const m = mismatchesOf(
        'includes',
        expect.outputIncludes,
        r.output,
        MISMATCHES_LISTED,
      );
      if (m.total > 0) {
        found.push({
          failure: {
            kind: 'output',
            mode: 'includes',
            mismatches: m.changes.map(reportChange),
            total: m.total,
          },
          message: `output mismatch — expected it to include ${JSON.stringify(expect.outputIncludes)} but got ${JSON.stringify(r.output)}`,
        });
      }
    }
  }
  for (const [j, entry] of (expect.effects ?? []).entries()) {
    const miss = judgeEffect(j, entry, r.effects);
    if (miss !== undefined) found.push(miss);
  }
  const traced = new Map(r.trace.map((e) => [e.node, e]));
  for (const [node, expected] of Object.entries(expect.nodes ?? {})) {
    const actual = stateOf(traced.get(node));
    if (actual === expected) continue;
    found.push({
      failure: { kind: 'node_state', node, expected, actual },
      message: `expected "${node}" ${EXPECTED_STATE_WORDS[expected]}, but it ${ACTUAL_WORDS[actual]}`,
    });
  }
  return found;
}

/** How the run ended against what the test expects of its end; undefined
 * when it ended as expected. */
function judgeEnd(
  expect: TestExpectation,
  r: RunResult,
): { failure: TestFailure; message: string; final: boolean } | undefined {
  const failed = r.error?.message ?? 'validation failed';
  const wanted = expect.failure;
  if (wanted === undefined) {
    if (r.status === 'success') return undefined;
    const cause = r.error?.failure;
    return {
      failure: {
        kind: 'run_failed',
        ...(r.error?.nodeId !== undefined && { node: r.error.nodeId }),
        message: english(failed),
        ...(cause !== undefined && {
          failure: {
            code: cause.code,
            reason: cause.reason,
            params: cause.params,
          },
        }),
      },
      message: `run ${r.status}: ${failed}`,
      final: true,
    };
  }
  const at = wanted.node === undefined ? '' : ` at "${wanted.node}"`;
  if (r.status === 'success') {
    return {
      failure: {
        kind: 'run_succeeded',
        expected: {
          ...(wanted.node !== undefined && { node: wanted.node }),
          ...(wanted.message !== undefined && { message: wanted.message }),
        },
      },
      message: `expected the run to fail${at}, but it succeeded`,
      final: true,
    };
  }
  const actualNode = r.error?.nodeId;
  if (wanted.node !== undefined && actualNode !== wanted.node) {
    return {
      failure: {
        kind: 'failed_elsewhere',
        expectedNode: wanted.node,
        ...(actualNode !== undefined && { actualNode }),
        message: english(failed),
      },
      message: `expected the run to fail at "${wanted.node}", but it failed ${actualNode === undefined ? 'outside its nodes' : `at "${actualNode}"`}: ${failed}`,
      final: true,
    };
  }
  if (
    wanted.message !== undefined &&
    !failed.toLowerCase().includes(wanted.message.toLowerCase())
  ) {
    const on = actualNode === undefined ? '' : ` at "${actualNode}"`;
    return {
      failure: {
        kind: 'failure_message',
        expected: wanted.message,
        actual: english(failed),
        ...(actualNode !== undefined && { node: actualNode }),
      },
      message: `the run failed${on} with "${failed}", which does not contain "${wanted.message}"`,
      final: false,
    };
  }
  return undefined;
}

/** The path a successful run took, among the ways its document can go. */
function pathOf(
  model: FlowModel | null,
  r: RunResult,
): TestResult['path'] | undefined {
  if (model === null || r.status !== 'success' || r.focus !== undefined) {
    return undefined;
  }
  const assignment = assignmentFromRun(model, {
    trace: r.trace,
    ...(r.record !== undefined && { record: r.record }),
  });
  return { id: pathIdOf(model, assignment), assignment };
}

export async function runAutomationTests(
  automation: Automation,
  opts: TestRunOptions = {},
): Promise<TestReport | MissingTests> {
  const tests = automation.tests ?? [];
  if (tests.length === 0) {
    return {
      error: 'the automation has no tests',
      hint: 'add a top-level tests: [{name, input, mocks?, failures?, expect?: {output?, outputIncludes?, effects?, nodes?, failure?}}] block',
    };
  }
  const chosen =
    opts.select === undefined
      ? tests.map((_, i) => i)
      : [...new Set(opts.select)]
          .filter((i) => Number.isInteger(i) && i >= 0 && i < tests.length)
          .toSorted((a, b) => a - b);
  const suiteEnds = Date.now() + (opts.suiteDeadlineMs ?? SUITE_DEADLINE_MS);
  const testLimit = opts.testDeadlineMs ?? TEST_DEADLINE_MS;
  const flow = flowModel(automation.nodes);
  const model = flow !== null && !possiblePaths(flow).truncated ? flow : null;
  // Compiled once, for the first test that has an input to check.
  let check: ValidateFunction | null | undefined;

  const runOne = async (
    index: number,
    test: AutomationTest,
  ): Promise<TestResult | typeof NOT_RUN> => {
    const t0 = performance.now();
    const done = (
      found: ReadonlyArray<{ failure: TestFailure; message: string }>,
      extra: Partial<TestResult> = {},
    ): TestResult => ({
      name: test.name,
      index,
      pass: found.length === 0,
      ...(found.length > 0 && {
        message: storableText(found[0]?.message ?? ''),
        failures: found.map((f) => f.failure),
      }),
      ms: Math.round((performance.now() - t0) * 10) / 10,
      ...extra,
    });

    const bench = benchFromTest(test, index);
    const planned = planBench(automation.nodes, bench);
    if (!planned.ok) {
      return done([
        {
          failure: {
            kind: 'refused',
            issues: [
              refusalIssue(
                planned,
                ptr('tests', index, ...refusalPath(planned.refusal)),
              ),
            ],
          },
          message: `the test could not run: ${planned.message}`,
        },
      ]);
    }
    check ??= inputCheck(automation.inputs);
    const refusedInput =
      check === null
        ? null
        : testInputRefusal(index, test.name, test.input, check);
    if (refusedInput !== null) {
      return done([
        {
          failure: { kind: 'refused', issues: [refusedInput.issue] },
          message: `run error: ${refusedInput.runMessage}`,
        },
      ]);
    }

    const startedAt = Date.now();
    const testEnds = startedAt + testLimit;
    const recorder =
      opts.detail === true
        ? createRecorder({ now: () => Date.now(), budget: recordBudget() })
        : undefined;
    const r = await execute(automation, {
      input: test.input,
      mode: 'mock',
      bench,
      deadline: Math.min(testEnds, suiteEnds),
      ...(opts.signal !== undefined && { signal: opts.signal }),
      ...(opts.store !== undefined && { store: opts.store }),
      ...(recorder !== undefined && { recorder }),
    });
    const extra: Partial<TestResult> = {
      ...(r.unusedMocks !== undefined && { unusedMocks: r.unusedMocks }),
      ...(opts.detail === true && {
        run: runDetail(automation, r, {
          id: `test-${index}`,
          startedAt,
          ...(opts.version !== undefined && { version: opts.version }),
        }),
      }),
    };
    if (r.stoppedBy !== undefined) {
      // Stopped by its own time limit, the test failed; stopped by the
      // suite's, or by its caller, it did not run to the end.
      if (r.stoppedBy === 'time_limit' && testEnds <= suiteEnds) {
        return done(
          [
            {
              failure: { kind: 'timeout', limitMs: testLimit },
              message: `the test took longer than ${testLimit / 1000} s and was stopped`,
            },
          ],
          extra,
        );
      }
      return NOT_RUN;
    }
    if (r.status === 'invalid') {
      const issues = r.validation?.errors ?? [];
      return done(
        [
          {
            failure: { kind: 'refused', issues },
            message: `the test could not run: ${issues.map((i) => i.message).join('; ')}`,
          },
        ],
        extra,
      );
    }
    const expect = test.expect ?? {};
    const end = judgeEnd(expect, r);
    const found =
      end?.final === true
        ? [end]
        : [...(end === undefined ? [] : [end]), ...judgeRun(expect, r)];
    const path = pathOf(model, r);
    return done(found, { ...(path !== undefined && { path }), ...extra });
  };

  const results: TestResult[] = [];
  const notRun: string[] = [];
  for (const [k, index] of chosen.entries()) {
    const test = tests[index];
    if (test === undefined) continue;
    const result =
      opts.signal?.aborted === true || Date.now() >= suiteEnds
        ? NOT_RUN
        : await runOne(index, test);
    if (result === NOT_RUN) {
      for (const rest of chosen.slice(k)) notRun.push(tests[rest]?.name ?? '');
      break;
    }
    results.push(result);
  }
  const passed = results.filter((r) => r.pass).length;
  return {
    passed,
    failed: chosen.length - passed,
    results,
    ...(notRun.length > 0 && { notRun }),
  };
}

/** What a test's run produced, with its record when it kept one. */
function runDetail(
  automation: Automation,
  r: RunResult,
  at: { id: string; startedAt: number; version?: number },
): TestRunDetail {
  const record = transientRecord({
    doc: automation,
    result: r,
    id: at.id,
    startedAt: at.startedAt,
    finishedAt: Date.now(),
    ...(at.version !== undefined && { version: at.version }),
  });
  return {
    status: r.status,
    ...(r.output !== undefined && { output: r.output }),
    ...(r.error !== undefined && { error: r.error }),
    effects: r.effects,
    ...(r.stoppedBy !== undefined && { stoppedBy: r.stoppedBy }),
    ...(record !== undefined && { record }),
  };
}
