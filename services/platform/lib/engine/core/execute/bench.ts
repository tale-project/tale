/**
 * The test bench: what stands in for each node of a run — its call as
 * written, an output or a failure a test simulates, a scenario of its
 * connector action the test picks, data a step test pins, or nothing at all
 * (a node a step test leaves out).
 *
 * A stand-in replaces a node's CALL, never the node. The skip rules apply
 * as written, the node's input is still resolved (and checked against its
 * connector's schema) and its effect recorded; only then does the simulated
 * output take the place of what the connector, model, agent, called
 * automation or code would have answered. So a test proves the branching
 * and "what it would send", and makes up only the outside world's answer.
 *
 * Two scopes narrow a run for a step test: `upTo` runs a node and
 * everything it needs (its ancestors: what it reads, its `elseOf` partner,
 * and theirs, as written) and leaves the rest out; `only` runs one node on
 * pinned data — every node it reads is given as data and never evaluated —
 * and `item` picks one item of a forEach node run that way.
 *
 * A scenario is a case the node's connector action ships (`scenarios` in
 * its catalog entry): it answers the calls whose input matches its `when`
 * with its output, or fails them with its error, classified as a live
 * call's failure; any other call of the node gets the action's mock.
 *
 * Stand-ins address the automation's own nodes; a simulated subautomation
 * node replaces the whole called automation. Pure and browser-safe: the
 * editor plans a bench exactly as the executors run one.
 */

import { stableStringify } from '@tale/ui/data/stable-stringify';
import { kindOf } from '@tale/ui/data/value-summary';

import { isRecord } from '../../../utils/type-utils';
import { type ConnectorScenario, nodeTypes } from '../slots';
import type {
  AutomationTest,
  ExpectedNodeState,
  Issue,
  Json,
  NodeDef,
  RunBench,
  RunResult,
} from '../types';
import { closestName } from '../validate/similar';
import { refsOf } from './controlflow';

/** What takes the place of one node's work in a run. */
export type BenchCall =
  /** The node runs as written. */
  | { kind: 'call' }
  /** The input is resolved and the effect recorded; this is returned. */
  | { kind: 'mock'; output: Json }
  /** The input is resolved; then the node fails with this message. */
  | { kind: 'fail'; message: string }
  /** The input is resolved and checked; a call it matches gets this
   * scenario's answer, any other the action's mock. */
  | { kind: 'scenario'; scenario: ConnectorScenario }
  /** `only`: this is the node's output; nothing of it is evaluated. */
  | { kind: 'pinned'; output: Json }
  /** Outside a step test's scope: the node does not run. */
  | { kind: 'left-out' };

export interface BenchPlan {
  /** The nodes the run includes; null when it includes every node. */
  included: ReadonlySet<string> | null;
  /** The step test's scope, when it has one. */
  focus?: NonNullable<RunResult['focus']>;
  /** The nodes a test stands in for (`mocks`, `failures` and
   * `scenarios`), in document order. */
  standIns: readonly string[];
  call(nodeId: string): BenchCall;
  /**
   * A forEach node's simulated outputs, one per item of its list of `count`
   * items: the entries of its stand-in, which must be a list at least that
   * long — or, for a run that picks one item (`only` with `item`), long
   * enough to hold that item's. Otherwise the sentence the node fails with.
   */
  itemOutputs(
    nodeId: string,
    count: number,
    picked?: number,
  ): { ok: true; outputs: readonly Json[] } | { ok: false; message: string };
}

/** Why a bench cannot run, before the run starts. */
export type BenchRefusal =
  | {
      code: 'BENCH_UNKNOWN_NODE';
      field: StandInField | 'upTo' | 'only';
      node: string;
      suggestion?: string;
    }
  | {
      code: 'BENCH_CONFLICT';
      node: string;
      /** The two stand-ins it has, in the order the bench lists them. */
      fields: readonly [StandInField, StandInField];
    }
  | {
      code: 'BENCH_UNKNOWN_SCENARIO';
      node: string;
      /** The node's type, and the scenarios it ships (none for a node
       * that is no connector action). */
      type: string;
      scenario: string;
      scenarios: string[];
      suggestion?: string;
    }
  | { code: 'BENCH_PINS_MISSING'; node: string; missing: string[] }
  | {
      code: 'BENCH_ITEM_OUT_OF_RANGE';
      node: string;
      item: number;
      count?: number;
    }
  | { code: 'BENCH_NOT_ITERATING'; node: string }
  | { code: 'BENCH_SCOPE_CONFLICT'; field: 'upTo' | 'item' };

/** The members of a bench that stand in for a node. */
type StandInField = 'mocks' | 'failures' | 'scenarios';

export type BenchPlanned =
  | { ok: true; plan: BenchPlan }
  | { ok: false; refusal: BenchRefusal; message: string; hint: string };

/** What a node does when nothing stands in for it: its call as written. */
export const CALL_AS_WRITTEN: BenchCall = Object.freeze({ kind: 'call' });
const LEFT_OUT: BenchCall = Object.freeze({ kind: 'left-out' });

/** The nodes of a document by id, the first of a duplicate id, in order. */
function nodesById(nodes: readonly NodeDef[]): Map<string, NodeDef> {
  const byId = new Map<string, NodeDef>();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || byId.has(node.id)) continue;
    byId.set(node.id, node);
  }
  return byId;
}

/** The stand-ins a bench gives, kept only where they have the grammar's
 * shape (the document check refuses any other before a test runs). */
function standInsOf(bench: RunBench): {
  mocks: Record<string, Json>;
  failures: Record<string, string>;
  scenarios: Record<string, string>;
} {
  const mocks: Record<string, Json> = isRecord(bench.mocks)
    ? { ...bench.mocks }
    : {};
  const texts = (value: unknown): Record<string, string> => {
    const kept: Record<string, string> = {};
    if (!isRecord(value)) return kept;
    for (const [id, text] of Object.entries(value)) {
      if (typeof text === 'string') kept[id] = text;
    }
    return kept;
  };
  return {
    mocks,
    failures: texts(bench.failures),
    scenarios: texts(bench.scenarios),
  };
}

/** The scenarios a node type ships: its connector action's, none for any
 * other node. */
function scenariosOfType(type: string): readonly ConnectorScenario[] {
  return nodeTypes().get(type)?.connector?.scenarios ?? [];
}

/**
 * Whether a scenario answers a call with this input: the input carries
 * every member its `when` names, each equal as JSON. A scenario without
 * `when` answers every call.
 */
export function scenarioMatches(
  scenario: ConnectorScenario,
  input: unknown,
): boolean {
  const when = scenario.when;
  if (when === undefined) return true;
  return Object.entries(when).every(
    ([member, value]) =>
      isRecord(input) &&
      Object.hasOwn(input, member) &&
      stableStringify(input[member]) === stableStringify(value),
  );
}

/**
 * Every node `id` needs to run as written: the nodes it reads, its `elseOf`
 * partner, and theirs — each once. `id` itself is not among them.
 */
export function ancestorsOf(
  nodes: readonly NodeDef[],
  id: string,
): Set<string> {
  const byId = nodesById(nodes);
  const found = new Set<string>();
  const pending = [id];
  while (pending.length > 0) {
    const current = pending.pop();
    const node = current === undefined ? undefined : byId.get(current);
    if (node === undefined) continue;
    for (const ref of refsOf(node).order) {
      if (ref === id || found.has(ref) || !byId.has(ref)) continue;
      found.add(ref);
      pending.push(ref);
    }
  }
  return found;
}

/** The nodes `node` reads in its expressions — data and conditions — but
 * not its `elseOf` partner, which a node run alone does not consult. */
export function readsOf(
  node: NodeDef,
  byId: ReadonlyMap<string, NodeDef>,
): string[] {
  const { elseOf: _elseOf, ...withoutElse } = node;
  return [...refsOf(withoutElse).order].filter(
    (ref) => ref !== node.id && byId.has(ref),
  );
}

/** A value's kind, as the engine's English names it: "an object", "text",
 * "a list". */
export function kindWords(value: unknown): string {
  switch (kindOf(value)) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'null':
      return 'null';
    case 'array':
      return 'a list';
    case 'object':
      return 'an object';
    default:
      return 'nothing';
  }
}

/** What a test expects of a node, as the engine's English says it. */
export const EXPECTED_STATE_WORDS: Readonly<Record<ExpectedNodeState, string>> =
  {
    ran: 'to run',
    skipped: 'to be skipped',
    failed: 'to fail and let the run go on',
  };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The English of a refusal: what is wrong, and what to do. */
function refusalText(
  refusal: BenchRefusal,
  ids: readonly string[],
): { message: string; hint: string } {
  switch (refusal.code) {
    case 'BENCH_UNKNOWN_NODE': {
      const did =
        refusal.suggestion === undefined
          ? ''
          : `did you mean "${refusal.suggestion}"? `;
      const hint = `${did}nodes: ${ids.join(', ')}`;
      return refusal.field === 'mocks' || refusal.field === 'failures'
        ? {
            message: `the test simulates "${refusal.node}", which is not a node of this automation`,
            hint,
          }
        : refusal.field === 'scenarios'
          ? {
              message: `the test picks a scenario for "${refusal.node}", which is not a node of this automation`,
              hint,
            }
          : {
              message: `${refusal.field} names "${refusal.node}", which is not a node of this automation`,
              hint,
            };
    }
    case 'BENCH_CONFLICT': {
      const [first, second] = refusal.fields;
      const what: Record<StandInField, string> = {
        mocks: 'simulates an output',
        failures: 'simulates a failure',
        scenarios: 'picks a scenario',
      };
      return {
        message:
          second === 'failures'
            ? `the test both simulates an output and a failure for "${refusal.node}"`
            : `the test both ${what[first]} and ${what[second]} for "${refusal.node}"`,
        hint: `keep one of ${first}.${refusal.node} and ${second}.${refusal.node}`,
      };
    }
    case 'BENCH_UNKNOWN_SCENARIO': {
      const did =
        refusal.suggestion === undefined
          ? ''
          : `did you mean "${refusal.suggestion}"? `;
      return {
        message: `the test picks the scenario "${refusal.scenario}" for "${refusal.node}", which ${refusal.type} does not ship`,
        hint:
          refusal.scenarios.length === 0
            ? `${refusal.type} ships no scenarios — simulate its output (mocks) or its failure (failures) instead`
            : `${did}scenarios of ${refusal.type}: ${refusal.scenarios.join(', ')}`,
      };
    }
    case 'BENCH_PINS_MISSING':
      return {
        message: `running "${refusal.node}" alone needs the data of every node it reads — no data for ${refusal.missing.map((id) => `"${id}"`).join(', ')}`,
        hint: `give each of them in mocks (the output it would have returned), or run up to "${refusal.node}" instead (upTo), which runs them`,
      };
    case 'BENCH_ITEM_OUT_OF_RANGE':
      return refusal.count === undefined
        ? {
            message: `item ${refusal.item} is not an item of "${refusal.node}" — items count from 0`,
            hint: 'give the number of one item: 0 for the first',
          }
        : {
            message: `item ${refusal.item} is out of range — the forEach of "${refusal.node}" gave ${plural(refusal.count, 'item', 'items')}`,
            hint:
              refusal.count === 0
                ? 'the list is empty — run the node without item'
                : `give an item from 0 to ${refusal.count - 1}`,
          };
    case 'BENCH_NOT_ITERATING':
      return {
        message: `item picks one item of a forEach node, but "${refusal.node}" has no forEach`,
        hint: `leave item out to run "${refusal.node}" once`,
      };
    default:
      return refusal.field === 'upTo'
        ? {
            message:
              'a bench runs either up to a node (upTo) or one node alone (only), not both',
            hint: 'keep one of upTo and only',
          }
        : {
            message:
              'item picks one item of the node a bench runs alone, so it needs only',
            hint: 'add only: <the forEach node>, or leave item out',
          };
  }
}

function refused(
  refusal: BenchRefusal,
  ids: readonly string[],
): Extract<BenchPlanned, { ok: false }> {
  return { ok: false, refusal, ...refusalText(refusal, ids) };
}

/** A refusal named the way a run started with it later finds out — a
 * forEach list the bench's item is not in. */
export function itemOutOfRange(
  node: string,
  item: number,
  count: number,
): { refusal: BenchRefusal; message: string; hint: string } {
  const refusal: BenchRefusal = {
    code: 'BENCH_ITEM_OUT_OF_RANGE',
    node,
    item,
    count,
  };
  return { refusal, ...refusalText(refusal, []) };
}

/**
 * Plan a bench over a document's nodes: refuse one that names nodes the
 * document does not have, gives one node two stand-ins, picks a scenario
 * its node's action does not ship, combines scopes that do not combine, or
 * runs a node alone without the data it reads; else answer what stands in
 * for each node. `scenariosOf` answers the scenarios a node type ships —
 * by default those of the registered connector action.
 */
export function planBench(
  nodes: readonly NodeDef[],
  bench: RunBench | undefined,
  scenariosOf: (type: string) => readonly ConnectorScenario[] = scenariosOfType,
): BenchPlanned {
  const byId = nodesById(nodes);
  const ids = [...byId.keys()];
  const { mocks, failures, scenarios } = standInsOf(bench ?? {});
  const unknown = (
    field: StandInField | 'upTo' | 'only',
    node: string,
  ): Extract<BenchPlanned, { ok: false }> => {
    const suggestion = closestName(node, ids);
    return refused(
      {
        code: 'BENCH_UNKNOWN_NODE',
        field,
        node,
        ...(suggestion !== undefined && { suggestion }),
      },
      ids,
    );
  };
  for (const id of Object.keys(mocks)) {
    if (!byId.has(id)) return unknown('mocks', id);
  }
  for (const id of Object.keys(failures)) {
    if (!byId.has(id)) return unknown('failures', id);
  }
  for (const id of Object.keys(scenarios)) {
    if (!byId.has(id)) return unknown('scenarios', id);
  }
  const upTo = typeof bench?.upTo === 'string' ? bench.upTo : undefined;
  const only = typeof bench?.only === 'string' ? bench.only : undefined;
  if (upTo !== undefined && !byId.has(upTo)) return unknown('upTo', upTo);
  if (only !== undefined && !byId.has(only)) return unknown('only', only);
  for (const id of Object.keys(mocks)) {
    if (Object.hasOwn(failures, id)) {
      return refused(
        { code: 'BENCH_CONFLICT', node: id, fields: ['mocks', 'failures'] },
        ids,
      );
    }
  }
  const pickedScenarios = new Map<string, ConnectorScenario>();
  for (const [id, name] of Object.entries(scenarios)) {
    for (const field of ['mocks', 'failures'] as const) {
      const given = field === 'mocks' ? mocks : failures;
      if (!Object.hasOwn(given, id)) continue;
      return refused(
        { code: 'BENCH_CONFLICT', node: id, fields: [field, 'scenarios'] },
        ids,
      );
    }
    const type = byId.get(id)?.type ?? '';
    const shipped = scenariosOf(type);
    const scenario = shipped.find((s) => s.name === name);
    if (scenario === undefined) {
      const names = shipped.map((s) => s.name);
      const suggestion = closestName(name, names);
      return refused(
        {
          code: 'BENCH_UNKNOWN_SCENARIO',
          node: id,
          type,
          scenario: name,
          scenarios: names,
          ...(suggestion !== undefined && { suggestion }),
        },
        ids,
      );
    }
    pickedScenarios.set(id, scenario);
  }
  if (upTo !== undefined && only !== undefined) {
    return refused({ code: 'BENCH_SCOPE_CONFLICT', field: 'upTo' }, ids);
  }
  const item = bench?.item;
  if (item !== undefined && only === undefined) {
    return refused({ code: 'BENCH_SCOPE_CONFLICT', field: 'item' }, ids);
  }

  let included: Set<string> | null = null;
  let pinned: ReadonlySet<string> = new Set();
  let focus: BenchPlan['focus'];
  if (upTo !== undefined) {
    included = ancestorsOf(nodes, upTo);
    included.add(upTo);
    focus = { node: upTo, kind: 'upTo' };
  } else if (only !== undefined) {
    const target = byId.get(only);
    if (target === undefined) return unknown('only', only);
    if (item !== undefined) {
      if (typeof target.forEach !== 'string') {
        return refused({ code: 'BENCH_NOT_ITERATING', node: only }, ids);
      }
      if (!Number.isInteger(item) || item < 0) {
        return refused(
          { code: 'BENCH_ITEM_OUT_OF_RANGE', node: only, item },
          ids,
        );
      }
    }
    const reads = readsOf(target, byId);
    const missing = reads.filter((id) => !Object.hasOwn(mocks, id));
    if (missing.length > 0) {
      return refused({ code: 'BENCH_PINS_MISSING', node: only, missing }, ids);
    }
    pinned = new Set(reads);
    included = new Set([only, ...reads]);
    focus = {
      node: only,
      kind: 'only',
      ...(item !== undefined && { item }),
    };
  }

  const standIns = ids.filter(
    (id) =>
      Object.hasOwn(mocks, id) ||
      Object.hasOwn(failures, id) ||
      pickedScenarios.has(id),
  );
  const plan: BenchPlan = {
    included,
    ...(focus !== undefined && { focus }),
    standIns,
    call(nodeId) {
      if (included !== null && !included.has(nodeId)) return LEFT_OUT;
      if (pinned.has(nodeId)) {
        return { kind: 'pinned', output: mocks[nodeId] ?? null };
      }
      if (Object.hasOwn(mocks, nodeId)) {
        return { kind: 'mock', output: mocks[nodeId] ?? null };
      }
      if (Object.hasOwn(failures, nodeId)) {
        return { kind: 'fail', message: failures[nodeId] ?? '' };
      }
      const scenario = pickedScenarios.get(nodeId);
      if (scenario !== undefined) return { kind: 'scenario', scenario };
      return CALL_AS_WRITTEN;
    },
    itemOutputs(nodeId, items, picked) {
      const mock = mocks[nodeId];
      if (!Array.isArray(mock)) {
        return {
          ok: false,
          message: `the test's simulated output for "${nodeId}" is ${kindWords(mock)}, but "${nodeId}" runs once per item (forEach) — it needs a list`,
        };
      }
      if (picked !== undefined) {
        return mock.length > picked
          ? { ok: true, outputs: mock }
          : {
              ok: false,
              message: `the test's simulated output for "${nodeId}" has ${plural(mock.length, 'entry', 'entries')}, but this run picks item ${picked} — items count from 0`,
            };
      }
      if (mock.length < items) {
        return {
          ok: false,
          message: `the test's simulated output for "${nodeId}" has ${plural(mock.length, 'entry', 'entries')}, but forEach gave ${plural(items, 'item', 'items')}`,
        };
      }
      return { ok: true, outputs: mock };
    },
  };
  return { ok: true, plan };
}

/** The bench a test runs with: its stand-ins, labelled with the test. */
export function benchFromTest(test: AutomationTest, index?: number): RunBench {
  return {
    ...(test.mocks !== undefined && { mocks: test.mocks }),
    ...(test.failures !== undefined && { failures: test.failures }),
    ...(test.scenarios !== undefined && { scenarios: test.scenarios }),
    test: { name: test.name, ...(index !== undefined && { index }) },
  };
}

/** Where in a bench a refusal points: the stand-in, the scope or the
 * item it is about, as a path below the bench. */
export function refusalPath(refusal: BenchRefusal): Array<string | number> {
  switch (refusal.code) {
    case 'BENCH_UNKNOWN_NODE':
      return refusal.field === 'upTo' || refusal.field === 'only'
        ? [refusal.field]
        : [refusal.field, refusal.node];
    case 'BENCH_CONFLICT':
      return [refusal.fields[1], refusal.node];
    case 'BENCH_UNKNOWN_SCENARIO':
      return ['scenarios', refusal.node];
    case 'BENCH_PINS_MISSING':
      return ['only'];
    case 'BENCH_ITEM_OUT_OF_RANGE':
    case 'BENCH_NOT_ITERATING':
      return ['item'];
    default:
      return [refusal.field];
  }
}

/**
 * A refusal as an issue: its code, its English, where in the bench it is
 * (`pointer`, built by the caller from {@link refusalPath} — a run's bench,
 * or the test it came from) and its facts as params.
 */
export function refusalIssue(
  planned: { refusal: BenchRefusal; message: string; hint: string },
  pointer: string,
): Issue {
  const { refusal } = planned;
  // A stand-in for a node that does not exist is a member that should not
  // be there; every other refusal is about a value.
  const aboutKey =
    refusal.code === 'BENCH_UNKNOWN_NODE' &&
    refusal.field !== 'upTo' &&
    refusal.field !== 'only';
  return {
    level: 'error',
    code: refusal.code,
    message: planned.message,
    hint: planned.hint,
    at: { pointer, ...(aboutKey && { subject: 'key' as const }) },
    params: refusalParams(refusal),
  };
}

/** A refusal's facts, as an issue's params. */
function refusalParams(refusal: BenchRefusal): Issue['params'] {
  switch (refusal.code) {
    case 'BENCH_UNKNOWN_NODE':
      return {
        field: refusal.field,
        node: refusal.node,
        ...(refusal.suggestion !== undefined && {
          suggestion: refusal.suggestion,
        }),
      };
    case 'BENCH_CONFLICT':
      return { node: refusal.node, fields: [...refusal.fields] };
    case 'BENCH_UNKNOWN_SCENARIO':
      return {
        node: refusal.node,
        type: refusal.type,
        scenario: refusal.scenario,
        scenarios: refusal.scenarios,
        ...(refusal.suggestion !== undefined && {
          suggestion: refusal.suggestion,
        }),
      };
    case 'BENCH_NOT_ITERATING':
      return { node: refusal.node };
    case 'BENCH_PINS_MISSING':
      return { node: refusal.node, missing: refusal.missing };
    case 'BENCH_ITEM_OUT_OF_RANGE':
      return {
        node: refusal.node,
        item: refusal.item,
        ...(refusal.count !== undefined && { count: refusal.count }),
      };
    default:
      return { field: refusal.field };
  }
}
