/**
 * Save a run as a test — the one builder behind every way a run becomes a
 * test: the run page and the runs list, the banner of a try, a test's own
 * result, the app's `GET …/runs/:runId/as-test` and the agent tool's
 * `get_run {include: ['test']}`.
 *
 * The test takes the run's input. What it expects follows how the run
 * ended: by default the output a run that succeeded returned, and success
 * from a run that failed — a test that fails until the failure is fixed.
 * The nodes that called out (a model, an agent, a connector, a called
 * automation) answer in the test what they answered in the run (`mocks`),
 * or fail as they failed (`failures`), so the test replays the run's
 * outside world in mock mode. Code is never stood in for: what a transform
 * does is what the test checks.
 *
 * Nothing is copied silently. A value that looks like a secret is withheld
 * by the run record's own rule (`redactValue`: it reads `null`, and the
 * place is listed); a stand-in too large to keep in a document is dropped
 * and said; a live run whose calls the test does not stand in for is told
 * that those calls answer otherwise in a test.
 *
 * Pure and browser-safe: a door hands it the run's raw values — a stored
 * run's input, output, checkpoints and effects, or a try's result.
 */

import { reportText } from '../../engine/api/expect';
import { redactValue, utf8Bytes } from '../../engine/core/record/value';
import { ptr } from '../../engine/core/syntax/pointer';
import type {
  Automation,
  AutomationTest,
  Effect,
  ExpectedEffect,
  Json,
  NodeDef,
  NodeTrace,
  TestExpectation,
} from '../../engine/core/types';
import {
  BENCH_LIMITS,
  type DroppedStandIn,
  type TestFromRunWarning,
} from '../../shared/schemas/automation-tests';
import { storableText } from '../../shared/utils/storable-text';
import { isRecord } from '../../utils/type-utils';

/** What a test made from a run expects: the run's output exactly, or what
 * it includes; that the run succeeds; that it fails where the run failed;
 * or nothing beyond what every test asks — that its run succeeds. */
export type TestFromRunExpect =
  | 'equals'
  | 'includes'
  | 'succeeds'
  | 'fails-here'
  | 'none';

/** A run as the builder reads it: a stored run's raw columns, or a run
 * made in one call. */
export interface RunForTest {
  /** `live` and `preview` runs had their answers from the outside world;
   * a `mock` run from the deterministic stand-ins a test also gets. */
  mode: string;
  /** A stored run's status (`success`, `failed`, `cancelled`, …), or a run
   * made in one call's (`success`, `error`, `invalid`). */
  status: string;
  input: unknown;
  /** What a run that succeeded returned. */
  output?: unknown;
  /** A stored run's checkpoints: what each finished step returned. */
  checkpoints?: unknown;
  /** A run made in one call's trace — or a stored run's, for the steps its
   * checkpoints do not hold (the one it failed at). */
  trace?: readonly NodeTrace[];
  effects?: readonly Effect[];
  /** Where a failed run failed, and why. */
  error?: { nodeId?: string; message?: string };
  /** When the run started, epoch ms: a test is named after it. */
  startedAt: number;
}

export interface TestFromRunOptions {
  /** By default "From the run of <when it started>", made unique among the
   * document's tests. */
  name?: string;
  /** By default by how the run ended ({@link defaultExpect}); one the run
   * does not offer ({@link expectChoices}) reads as that default. */
  expect?: TestFromRunExpect;
  /** The nodes that answer as they did in the run; by default the
   * candidates on by default ({@link simulationCandidates}). */
  simulate?: readonly string[];
  /** Also expect the actions the run performed: each node and connector
   * once, without their inputs. */
  expectActions?: boolean;
}

export interface TestFromRun {
  test: AutomationTest;
  /** The nodes asked to answer as they did that cannot, and why. */
  dropped: DroppedStandIn[];
  warnings: TestFromRunWarning[];
}

/** One node that may answer in the test as it did in the run. */
export interface SimulationCandidate {
  node: string;
  /** Its type in the document — or in the run, for a node the document no
   * longer has. */
  type: string;
  /** What would stand in: the output the step returned, or the failure it
   * ended in. */
  standIn: 'output' | 'failure';
  /** The stand-in's size as UTF-8 JSON, its secrets withheld. */
  bytes: number;
  defaultOn: boolean;
  /** Why it cannot stand in. */
  disabledReason?: 'too_large' | 'not_in_document' | 'transform';
}

/**
 * What a test made from a run keeps in a document: one stand-in, and the
 * output it expects, each at most `valueBytes` as UTF-8 JSON (a stand-in's
 * own cap at the door, `BENCH_LIMITS.mockBytes`); a test larger than
 * `testBytes` in all is kept, and said to be large.
 */
export const TEST_FROM_RUN_LIMITS = {
  valueBytes: BENCH_LIMITS.mockBytes,
  testBytes: 262_144,
} as const;

/** The places a `redacted` warning lists; the rest are counted. */
const REDACTED_PLACES_LISTED = 100;

/** The words the engine adds to a failure a test simulated. */
const SIMULATED_SUFFIX = ' (simulated by the test)';
const SIMULATED_EMPTY = 'a failure simulated by the test';

/** What one step of the run did, as far as a test can stand in for it. */
type Step =
  | { state: 'ran'; type?: string; output: unknown }
  | { state: 'failed'; type?: string; message: string }
  | { state: 'skipped'; type?: string };

type End = 'succeeded' | 'failed' | 'other';

function endOf(run: RunForTest): End {
  if (run.status === 'success') return 'succeeded';
  return run.status === 'failed' || run.status === 'error' ? 'failed' : 'other';
}

/** The nodes of a document by id, the first of a duplicate id. */
function nodesById(document: Pick<Automation, 'nodes'>): Map<string, NodeDef> {
  const byId = new Map<string, NodeDef>();
  for (const node of document.nodes) {
    if (typeof node.id === 'string' && !byId.has(node.id)) {
      byId.set(node.id, node);
    }
  }
  return byId;
}

/**
 * What each step of the run did, in the order the run recorded it: a stored
 * run's checkpoints first (each finished step's raw output, a tolerated
 * failure as a skip for an error), then its trace for the steps they do not
 * hold, then the step the run failed at.
 */
function stepsOf(run: RunForTest): Map<string, Step> {
  const steps = new Map<string, Step>();
  const saved =
    isRecord(run.checkpoints) && isRecord(run.checkpoints.nodes)
      ? run.checkpoints.nodes
      : {};
  for (const [id, entry] of Object.entries(saved)) {
    if (!isRecord(entry)) continue;
    const trace = isRecord(entry.trace) ? entry.trace : undefined;
    const type = typeof trace?.type === 'string' ? trace.type : undefined;
    const typed = type === undefined ? {} : { type };
    if (entry.status === 'ok') {
      steps.set(id, { state: 'ran', ...typed, output: entry.output });
    } else if (entry.status === 'skipped' && entry.reason === 'error') {
      const message = typeof trace?.error === 'string' ? trace.error : '';
      steps.set(id, { state: 'failed', ...typed, message });
    } else if (entry.status === 'skipped') {
      steps.set(id, { state: 'skipped', ...typed });
    }
  }
  for (const entry of run.trace ?? []) {
    if (steps.has(entry.node)) continue;
    if (entry.status === 'ok') {
      steps.set(entry.node, {
        state: 'ran',
        type: entry.type,
        output: entry.output,
      });
    } else if (entry.status === 'error') {
      steps.set(entry.node, {
        state: 'failed',
        type: entry.type,
        message: entry.error ?? '',
      });
    } else if (entry.status === 'skipped') {
      steps.set(entry.node, { state: 'skipped', type: entry.type });
    }
  }
  const failedAt = run.error?.nodeId;
  if (failedAt !== undefined && !steps.has(failedAt)) {
    steps.set(failedAt, { state: 'failed', message: run.error?.message ?? '' });
  }
  return steps;
}

/** The message a failure stands in with: the step's own words, without
 * what a test that simulated it added — cut, as a report cuts text, to the
 * length a document keeps. */
function failureMessage(message: string): string {
  let own = message;
  if (own === SIMULATED_EMPTY) own = '';
  else if (own.endsWith(SIMULATED_SUFFIX)) {
    own = own.slice(0, -SIMULATED_SUFFIX.length);
  }
  return own.length > BENCH_LIMITS.failureChars
    ? reportText(own, BENCH_LIMITS.failureChars - 1)
    : storableText(own);
}

/** A value as a test keeps it, its secrets withheld: plain JSON, `null` for
 * nothing, and the places withheld, below `at`. */
function kept(
  value: unknown,
  at: string,
): {
  value: Json;
  places: Array<{ pointer: string; why: 'key' | 'pattern' | 'name' }>;
  total: number;
} {
  const redacted = redactValue(value);
  return {
    value: redacted.value ?? null,
    places: redacted.redacted.map((mark) => ({
      pointer: `${at}${mark.pointer}`,
      why: mark.why,
    })),
    total: redacted.total,
  };
}

function bytesOf(value: unknown): number {
  return utf8Bytes(JSON.stringify(value) ?? 'null');
}

/** Whether a node's work is the author's code, which a test checks. */
function isCode(type: string | undefined): boolean {
  return type === 'transform';
}

/** A stand-in for one step: its output, or its failure's message. */
function standInOf(
  id: string,
  step: Step,
): ReturnType<typeof kept> & { kind: 'output' | 'failure' } {
  if (step.state === 'ran') {
    return { kind: 'output', ...kept(step.output, ptr('mocks', id)) };
  }
  if (step.state === 'failed') {
    const message = kept(failureMessage(step.message), ptr('failures', id));
    return {
      ...message,
      kind: 'failure',
      value: typeof message.value === 'string' ? message.value : '',
    };
  }
  return { kind: 'output', value: null, places: [], total: 0 };
}

/**
 * The nodes whose step ran or failed in the run, each as it could answer in
 * a test: in the document's order, then the run's nodes the document does
 * not have. One that calls out is on by default; code is never stood in
 * for, a stand-in larger than a document keeps cannot be, and neither can
 * a node the document does not have.
 */
export function simulationCandidates(
  run: RunForTest,
  document: Pick<Automation, 'nodes'>,
): SimulationCandidate[] {
  const byId = nodesById(document);
  const steps = stepsOf(run);
  const ids = [
    ...[...byId.keys()].filter((id) => steps.has(id)),
    ...[...steps.keys()].filter((id) => !byId.has(id)),
  ];
  const out: SimulationCandidate[] = [];
  for (const id of ids) {
    const step = steps.get(id);
    if (step === undefined || step.state === 'skipped') continue;
    const type = byId.get(id)?.type ?? step.type ?? '';
    const standIn = standInOf(id, step);
    const bytes = bytesOf(standIn.value);
    const disabledReason = !byId.has(id)
      ? ('not_in_document' as const)
      : isCode(type)
        ? ('transform' as const)
        : standIn.kind === 'output' && bytes > TEST_FROM_RUN_LIMITS.valueBytes
          ? ('too_large' as const)
          : undefined;
    out.push({
      node: id,
      type,
      standIn: standIn.kind,
      bytes,
      defaultOn: disabledReason === undefined,
      ...(disabledReason !== undefined && { disabledReason }),
    });
  }
  return out;
}

/** The run's output as a test would expect it, or the reason it cannot. */
function expectedOutput(run: RunForTest): ReturnType<typeof kept> & {
  bytes: number;
} {
  const output = kept(run.output, '');
  return { ...output, bytes: bytesOf(output.value) };
}

/** What a test made from `run` may expect, by how the run ended: its output
 * (when it fits a document) or success from a run that succeeded; success,
 * or failing where it failed (a node of the document), from a run that
 * failed; success alone from a run that has not ended either way. */
export function expectChoices(
  run: RunForTest,
  document: Pick<Automation, 'nodes'>,
): TestFromRunExpect[] {
  switch (endOf(run)) {
    case 'succeeded':
      return expectedOutput(run).bytes <= TEST_FROM_RUN_LIMITS.valueBytes
        ? ['equals', 'includes', 'succeeds', 'none']
        : ['succeeds', 'none'];
    case 'failed': {
      const at = run.error?.nodeId;
      return at !== undefined && nodesById(document).has(at)
        ? ['succeeds', 'fails-here', 'none']
        : ['succeeds', 'none'];
    }
    default:
      return ['succeeds', 'none'];
  }
}

/** What a test made from `run` expects unless told otherwise: the output of
 * a run that succeeded (success, when it does not fit a document), success
 * from a run that failed, nothing from one that has not ended. */
export function defaultExpect(
  run: RunForTest,
  document: Pick<Automation, 'nodes'>,
): TestFromRunExpect {
  const end = endOf(run);
  if (end === 'succeeded') {
    return expectChoices(run, document).includes('equals')
      ? 'equals'
      : 'succeeds';
  }
  return end === 'failed' ? 'succeeds' : 'none';
}

/** "From the run of 2026-10-10 08:03 UTC", or with " (2)", " (3)", … when a
 * test of the document already has that name. */
function defaultName(
  startedAt: number,
  document: Pick<Automation, 'tests'>,
): string {
  const when = Number.isFinite(startedAt)
    ? `${new Date(startedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'an unknown time';
  const base = `From the run of ${when}`;
  const taken = new Set(
    (document.tests ?? []).flatMap((test: unknown) =>
      isRecord(test) && typeof test.name === 'string' ? [test.name] : [],
    ),
  );
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
  return name;
}

/**
 * The test `run` makes for `document` — the automation's latest version, or
 * the draft it is added to — with what it was asked and could not keep, and
 * what its author should know before saving it.
 */
export function testFromRun(args: {
  run: RunForTest;
  document: Pick<Automation, 'nodes' | 'tests'>;
  options?: TestFromRunOptions;
}): TestFromRun {
  const { run, document } = args;
  const options = args.options ?? {};
  const byId = nodesById(document);
  const steps = stepsOf(run);
  const dropped: DroppedStandIn[] = [];
  const warnings: TestFromRunWarning[] = [];
  const places: Array<{ pointer: string; why: 'key' | 'pattern' | 'name' }> =
    [];
  let withheld = 0;
  const note = (value: ReturnType<typeof kept>): void => {
    places.push(...value.places);
    withheld += value.total;
  };

  const input = kept(run.input, ptr('input'));
  note(input);
  const inputBytes = bytesOf(input.value);
  if (inputBytes > TEST_FROM_RUN_LIMITS.valueBytes) {
    warnings.push({ kind: 'too-large', part: 'input', bytes: inputBytes });
  }

  const simulate =
    options.simulate ??
    simulationCandidates(run, document)
      .filter((candidate) => candidate.defaultOn)
      .map((candidate) => candidate.node);
  const mocks: Record<string, Json> = {};
  const failures: Record<string, string> = {};
  for (const id of new Set(simulate)) {
    const node = byId.get(id);
    const step = steps.get(id);
    if (node === undefined) {
      dropped.push({ node: id, reason: 'not_in_document' });
    } else if (isCode(node.type)) {
      dropped.push({ node: id, reason: 'transform' });
    } else if (step === undefined || step.state === 'skipped') {
      dropped.push({ node: id, reason: 'no_output' });
    } else {
      const standIn = standInOf(id, step);
      if (
        standIn.kind === 'output' &&
        bytesOf(standIn.value) > TEST_FROM_RUN_LIMITS.valueBytes
      ) {
        dropped.push({ node: id, reason: 'too_large' });
        continue;
      }
      note(standIn);
      if (standIn.kind === 'failure') {
        failures[id] = typeof standIn.value === 'string' ? standIn.value : '';
      } else {
        mocks[id] = standIn.value;
      }
    }
  }

  const asked = options.expect;
  const expect =
    asked !== undefined && expectChoices(run, document).includes(asked)
      ? asked
      : defaultExpect(run, document);
  if (
    (asked === 'equals' || asked === 'includes') &&
    endOf(run) === 'succeeded' &&
    expect !== asked
  ) {
    warnings.push({
      kind: 'too-large',
      part: 'output',
      bytes: expectedOutput(run).bytes,
    });
  }
  const expectation: TestExpectation = {};
  if (expect === 'equals' || expect === 'includes') {
    const field = expect === 'equals' ? 'output' : 'outputIncludes';
    const output = kept(run.output, ptr('expect', field));
    note(output);
    expectation[field] = output.value;
  } else if (expect === 'fails-here' && run.error?.nodeId !== undefined) {
    expectation.failure = { node: run.error.nodeId };
  }
  if (options.expectActions === true) {
    const actions = expectedActions(run, byId, mocks, failures);
    if (actions.length > 0) expectation.effects = actions;
  }

  const isLive = run.mode === 'live' || run.mode === 'preview';
  const answeredLive = [...byId.keys()].filter((id) => {
    const step = steps.get(id);
    return (
      isLive &&
      step !== undefined &&
      step.state !== 'skipped' &&
      !isCode(byId.get(id)?.type) &&
      !Object.hasOwn(mocks, id) &&
      !Object.hasOwn(failures, id)
    );
  });
  if (answeredLive.length > 0) {
    warnings.push({ kind: 'live-run-needs-stand-ins', nodes: answeredLive });
  }

  const test: AutomationTest = {
    name: options.name ?? defaultName(run.startedAt, document),
    input: input.value,
    ...(Object.keys(mocks).length > 0 && { mocks }),
    ...(Object.keys(failures).length > 0 && { failures }),
    ...(Object.keys(expectation).length > 0 && { expect: expectation }),
  };
  const testBytes = bytesOf(test);
  if (testBytes > TEST_FROM_RUN_LIMITS.testBytes) {
    warnings.push({ kind: 'too-large', part: 'test', bytes: testBytes });
  }
  if (withheld > 0) {
    warnings.unshift({
      kind: 'redacted',
      places: places.slice(0, REDACTED_PLACES_LISTED),
      total: withheld,
    });
  }
  return { test, dropped, warnings };
}

/**
 * The actions the run performed that its test can expect: each node and
 * connector once, in the order the run first performed them, of a node the
 * document has — but none of a node the test fails (a failing call
 * performs nothing), and none inside a called automation the test stands in
 * for (nothing of it runs).
 */
function expectedActions(
  run: RunForTest,
  byId: ReadonlyMap<string, NodeDef>,
  mocks: Readonly<Record<string, Json>>,
  failures: Readonly<Record<string, string>>,
): ExpectedEffect[] {
  const seen = new Set<string>();
  const out: ExpectedEffect[] = [];
  for (const effect of run.effects ?? []) {
    const [top = ''] = effect.node.split('/');
    if (!byId.has(top) || Object.hasOwn(failures, top)) continue;
    if (effect.node !== top && Object.hasOwn(mocks, top)) continue;
    const key = `${effect.node}\u0000${effect.connector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ connector: effect.connector, node: effect.node });
  }
  return out;
}
