/**
 * Acceptance tests that cannot run, or cannot pass, as written.
 *
 *  - TESTS_TOO_MANY (error) — more than {@link MAX_TESTS} tests: every
 *    save and every deploy runs them all.
 *  - TESTS_UNKNOWN_FIELD — a field of a test, or of an effect it expects,
 *    outside the grammar, which the tests ignore (`mock:` for `mocks:`,
 *    `absnt:` for `absent:` — the effect is then judged without it); never
 *    an error, so a managed or stored document carrying a field of its own
 *    still saves and deploys.
 *  - TESTS_NAME_DUPLICATE — two tests with one name: results are listed by
 *    name.
 *  - TESTS_MOCK_UNKNOWN_NODE, TESTS_MOCK_CONFLICT — a stand-in for a node
 *    the automation does not have, or both an output and a failure for one
 *    node: the test cannot run (its bench is refused).
 *  - TESTS_MOCK_NOT_LIST — the stand-in of a node that runs once per item
 *    (forEach) is no list.
 *  - TESTS_MOCK_TYPE — a stand-in has a kind the node never returns there,
 *    so the nodes reading it may behave as no real run would. Members the
 *    node's type does not list are no wrong shape: a real answer, and a
 *    stand-in copied from one, carries more than the type names.
 *  - TESTS_EXPECT_NODE_UNKNOWN — what a test expects names a node the
 *    automation does not have.
 *  - TESTS_EXPECT_PATH_IMPOSSIBLE — no way a run can go (with the failures
 *    the test simulates) gives the nodes the states the test expects.
 *    Silent where the ways cannot all be listed, where the run must fail,
 *    and where the expectations conflict in a way none of its reasons
 *    words.
 *  - TESTS_EXPECT_FAILURE_IMPOSSIBLE — the run is expected to fail at a node
 *    whose failure never stops it (`onError: continue`), or that never runs.
 *  - TESTS_EFFECT_UNKNOWN — an expected effect names a connector no node
 *    performs: effects come from connector nodes that write, from `llm` and
 *    `agent` nodes, and from the automations subautomation nodes call (as
 *    deep as a run nests them). Silent when a called automation could not
 *    be resolved — its effects are not known — and for an effect expected
 *    not to happen.
 *  - TESTS_EXPECT_TYPE — an expected output value (`output` or
 *    `outputIncludes`) has a kind the output can never have there (a number
 *    where the output is text, a key the output never carries). An expected
 *    null is never judged: a skipped node's output is null whatever its
 *    type, and the types describe nodes that ran.
 */

import { kindOf } from '@tale/ui/data/value-summary';

import { isRecord } from '../../../../utils/type-utils';
import { err, warn } from '../../errors';
import { EXPECTED_STATE_WORDS, kindWords } from '../../execute/bench';
import { nodeTypes } from '../../slots';
import { ptr } from '../../syntax/pointer';
import { renderPath } from '../../syntax/walk';
import { MAX_TESTS } from '../../test-limits';
import type { ExpectedNodeState, Issue, NodeDef } from '../../types';
import {
  MAX_SUBAUTOMATION_DEPTH,
  type ChildDocuments,
} from '../../typing/children';
import {
  elementOf,
  isUnknown,
  kindsOf,
  lookup,
  shapeOfValue,
  toTs,
  type Kind,
  type Shape,
} from '../../typing/shape';
import { closestName } from '../../validate/similar';
import { testsOf, type RuleContext } from '../context';
import type { FlowFacts, PathOutcome } from '../flow';

/** The fields of a test. */
const TEST_FIELDS = [
  'name',
  'description',
  'input',
  'mocks',
  'failures',
  'expect',
] as const;

/** The fields of an effect a test expects. */
const EFFECT_FIELDS = [
  'connector',
  'node',
  'input',
  'inputIncludes',
  'absent',
] as const;

/**
 * The connectors a document's nodes record effects under, in document
 * order; undefined when a called automation is not known (no store, or it
 * could not be read).
 */
function effectsOf(
  nodes: unknown,
  children: ChildDocuments | undefined,
  depth: number,
): string[] | undefined {
  if (!Array.isArray(nodes)) return [];
  const out: string[] = [];
  const add = (name: string) => {
    if (!out.includes(name)) out.push(name);
  };
  for (const n of nodes) {
    if (!isRecord(n) || typeof n.type !== 'string') continue;
    if (n.type === 'llm' || n.type === 'agent') {
      add(n.type);
    } else if (n.type === 'subautomation') {
      if (typeof n.automation !== 'string') continue;
      if (depth >= MAX_SUBAUTOMATION_DEPTH) continue;
      const child = children?.get(n.automation);
      if (child === undefined) return undefined;
      // A reference that resolves to nothing fails the run; it performs no
      // effect either way.
      if (child === null || !isRecord(child.automation)) continue;
      const inner = effectsOf(child.automation.nodes, children, depth + 1);
      if (inner === undefined) return undefined;
      for (const name of inner) add(name);
    } else if (nodeTypes().get(n.type)?.connector?.hasEffect === true) {
      add(n.type);
    }
  }
  return out;
}

function kindOfValue(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}

interface ExpectMismatch {
  path: Array<string | number>;
  /** The type of the value the test gives. */
  expected: string;
  /** The type the automation has there. */
  actual: string;
}

/** How a value a test gives is held to a shape. */
interface MismatchRules {
  /** Members a closed shape does not list are fine: the value of a real
   * call (a service's whole answer) carries more than its type names, and
   * only the kinds of the members it lists can be wrong. */
  extraMembers: boolean;
}

/** The first place a value a test gives certainly differs in kind from a
 * shape; null when every place may match. */
function expectMismatch(
  value: unknown,
  shape: Shape,
  path: Array<string | number>,
  depth: number,
  rules: MismatchRules,
): ExpectMismatch | null {
  if (value === null || value === undefined || depth > 8) return null;
  if (isUnknown(shape)) return null;
  const kinds = kindsOf(shape);
  if (kinds === null) return null;
  const kind = kindOfValue(value);
  if (!kinds.has(kind)) {
    return {
      path,
      expected: toTs(shapeOfValue(value)),
      actual: toTs(shape),
    };
  }
  const nonNull = [...kinds].filter((k) => k !== 'null');
  if (nonNull.length !== 1) return null;
  if (kind === 'array' && Array.isArray(value)) {
    const element = elementOf(shape);
    for (const [i, item] of value.entries()) {
      const m = expectMismatch(item, element, [...path, i], depth + 1, rules);
      if (m !== null) return m;
    }
    return null;
  }
  if (kind === 'object' && isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = lookup(shape, key);
      if (found.kind === 'missing' && found.closed) {
        if (item === null || rules.extraMembers) continue;
        return {
          path: [...path, key],
          expected: toTs(shapeOfValue(item)),
          actual: 'undefined',
        };
      }
      if (found.kind !== 'found') continue;
      const m = expectMismatch(
        item,
        found.shape,
        [...path, key],
        depth + 1,
        rules,
      );
      if (m !== null) return m;
    }
  }
  return null;
}

/** `path` the way the messages write a place in a value: `.rows[0]`. */
function propertyOf(path: Array<string | number>): string {
  return renderPath(path.map((key) => ({ key })));
}

/** One test, as each rule below reads it. */
interface TestAt {
  index: number;
  name: string;
  test: Record<string, unknown>;
}

function unknownFields(at: TestAt, out: Issue[]): void {
  const { index, name, test } = at;
  for (const field of Object.keys(test)) {
    if ((TEST_FIELDS as readonly string[]).includes(field)) continue;
    const suggestion = closestName(field, TEST_FIELDS);
    out.push(
      warn(
        'TESTS_UNKNOWN_FIELD',
        `tests[${index}] "${name}" has an unknown field "${field}"`,
        {
          hint: `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}a test has name, description, input, mocks, failures and expect`,
          at: { pointer: ptr('tests', index, field), subject: 'key' },
          params: {
            test: index,
            name,
            field,
            ...(suggestion !== undefined && { suggestion }),
          },
        },
      ),
    );
  }
  const effects = isRecord(test.expect) ? test.expect.effects : undefined;
  if (!Array.isArray(effects)) return;
  for (const [j, effect] of effects.entries()) {
    if (!isRecord(effect)) continue;
    for (const field of Object.keys(effect)) {
      if ((EFFECT_FIELDS as readonly string[]).includes(field)) continue;
      const suggestion = closestName(field, EFFECT_FIELDS);
      out.push(
        warn(
          'TESTS_UNKNOWN_FIELD',
          `tests[${index}] "${name}" has an unknown field "${field}" in expect.effects[${j}]`,
          {
            hint: `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}an expected effect has connector, node, input, inputIncludes and absent`,
            at: {
              pointer: ptr('tests', index, 'expect', 'effects', j, field),
              subject: 'key',
            },
            params: {
              test: index,
              name,
              field,
              effect: j,
              ...(suggestion !== undefined && { suggestion }),
            },
          },
        ),
      );
    }
  }
}

function standIns(cx: RuleContext, at: TestAt, out: Issue[]): void {
  const { index, name, test } = at;
  const ids = [...cx.byId.keys()];
  const mocks = isRecord(test.mocks) ? test.mocks : {};
  const failures = isRecord(test.failures) ? test.failures : {};
  for (const [field, entries] of [
    ['mocks', mocks],
    ['failures', failures],
  ] as const) {
    for (const node of Object.keys(entries)) {
      if (cx.byId.has(node)) continue;
      const suggestion = closestName(node, ids);
      out.push(
        warn(
          'TESTS_MOCK_UNKNOWN_NODE',
          `tests[${index}] "${name}" simulates "${node}" in ${field}, which is not a node of this automation`,
          {
            hint: `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}nodes: ${ids.join(', ')}`,
            at: { pointer: ptr('tests', index, field, node), subject: 'key' },
            params: {
              test: index,
              name,
              field,
              node,
              ...(suggestion !== undefined && { suggestion }),
              nodes: ids,
            },
          },
        ),
      );
    }
  }
  for (const node of Object.keys(mocks)) {
    if (!cx.byId.has(node) || !Object.hasOwn(failures, node)) continue;
    out.push(
      warn(
        'TESTS_MOCK_CONFLICT',
        `tests[${index}] "${name}" both simulates an output and a failure for "${node}"`,
        {
          hint: `keep one of mocks.${node} and failures.${node}`,
          at: {
            pointer: ptr('tests', index, 'failures', node),
            subject: 'key',
          },
          params: { test: index, name, node },
        },
      ),
    );
  }
  for (const [node, mock] of Object.entries(mocks)) {
    const def = cx.byId.get(node);
    if (def === undefined) continue;
    if (typeof def.forEach === 'string' && !Array.isArray(mock)) {
      out.push(
        warn(
          'TESTS_MOCK_NOT_LIST',
          `tests[${index}] "${name}" mocks "${node}" with ${kindWords(mock)}, but "${node}" runs once per item (forEach) — the mock must be a list with one entry per item`,
          {
            hint: `write mocks.${node} as [<item 0 output>, <item 1 output>, …]`,
            at: { pointer: ptr('tests', index, 'mocks', node) },
            params: { test: index, name, node, kind: kindOf(mock) },
          },
        ),
      );
      continue;
    }
    const shape = cx.types.nodes[node]?.output;
    if (shape === undefined) continue;
    // A stand-in takes the place of a real answer, which may carry more
    // than the type lists.
    const m = expectMismatch(mock, shape, [], 0, { extraMembers: true });
    if (m === null) continue;
    const property = propertyOf(m.path);
    // The mock is the value the test gives; the node's type is what it
    // really returns there.
    out.push(
      warn(
        'TESTS_MOCK_TYPE',
        `tests[${index}] "${name}" mocks "${node}" with ${m.expected} at output${property}, but "${node}" returns ${m.actual} there`,
        {
          hint: `the nodes that read "${node}" expect its real shape — give the mock that shape`,
          at: { pointer: ptr('tests', index, 'mocks', node, ...m.path) },
          params: {
            test: index,
            name,
            node,
            property: property.replace(/^\./, ''),
            expected: m.actual,
            actual: m.expected,
          },
        },
      ),
    );
  }
}

/** The nodes `expect` names that the automation does not have. */
function expectedNodes(
  cx: RuleContext,
  at: TestAt,
  expect: Record<string, unknown>,
  out: Issue[],
): void {
  const { index, name } = at;
  const ids = [...cx.byId.keys()];
  const unknown = (node: string, pointer: string, subject?: 'key') => {
    const suggestion = closestName(node, ids);
    out.push(
      warn(
        'TESTS_EXPECT_NODE_UNKNOWN',
        `tests[${index}] "${name}" names node "${node}", which does not exist`,
        {
          hint: `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}nodes: ${ids.join(', ')}`,
          at: { pointer, ...(subject !== undefined && { subject }) },
          params: {
            test: index,
            name,
            node,
            ...(suggestion !== undefined && { suggestion }),
          },
        },
      ),
    );
  };
  if (isRecord(expect.nodes)) {
    for (const node of Object.keys(expect.nodes)) {
      if (cx.byId.has(node)) continue;
      unknown(node, ptr('tests', index, 'expect', 'nodes', node), 'key');
    }
  }
  if (Array.isArray(expect.effects)) {
    for (const [j, effect] of expect.effects.entries()) {
      if (!isRecord(effect) || typeof effect.node !== 'string') continue;
      // A subautomation's inner effects read `<node>/<inner>`: the node is
      // the part before the first slash.
      const node = effect.node.split('/')[0] ?? '';
      if (cx.byId.has(node)) continue;
      unknown(effect.node, ptr('tests', index, 'expect', 'effects', j, 'node'));
    }
  }
  if (
    isRecord(expect.failure) &&
    typeof expect.failure.node === 'string' &&
    !cx.byId.has(expect.failure.node)
  ) {
    unknown(
      expect.failure.node,
      ptr('tests', index, 'expect', 'failure', 'node'),
    );
  }
}

/** Whether node `id` is in `state` on path `p`. */
function inState(
  flow: FlowFacts,
  p: PathOutcome,
  id: string,
  state: ExpectedNodeState,
): boolean {
  const outcome = flow.outcomeOf(p, id);
  if (state === 'ran') return outcome === 'ran';
  if (state === 'failed') return outcome === 'error';
  return outcome === 'when' || outcome === 'else' || outcome === 'upstream';
}

type Expected = ReadonlyArray<readonly [string, ExpectedNodeState]>;

/** Whether some path among `paths` gives the nodes these states. */
function holdsOn(
  flow: FlowFacts,
  paths: readonly PathOutcome[],
  expected: Expected,
): boolean {
  return paths.some((p) =>
    expected.every(([node, state]) => inState(flow, p, node, state)),
  );
}

/** Why no path among `paths` gives the nodes the states a test expects;
 * null when one does, or when no reason words the conflict. */
function whyNot(
  flow: FlowFacts,
  paths: readonly PathOutcome[],
  expected: Expected,
):
  | { reason: 'always-runs' | 'never-runs'; node: string }
  | { reason: 'never-together'; a: string; b: string }
  | null {
  if (holdsOn(flow, paths, expected)) return null;
  for (const [node, state] of expected) {
    if (holdsOn(flow, paths, [[node, state]])) continue;
    return state === 'skipped'
      ? { reason: 'always-runs', node }
      : { reason: 'never-runs', node };
  }
  // Each alone can happen, not all together: two nodes the test expects to
  // run that never run in one run.
  const running = expected.filter(([, state]) => state !== 'skipped');
  for (const [i, a] of running.entries()) {
    for (const b of running.slice(i + 1)) {
      if (!holdsOn(flow, paths, [a, b])) {
        return { reason: 'never-together', a: a[0], b: b[0] };
      }
    }
  }
  return null;
}

/** The paths a run can take when the test simulates the failures of
 * `failing`, nodes that continue on error: each fails wherever it runs. */
function pathsFailing(
  flow: FlowFacts,
  failing: readonly string[],
): PathOutcome[] {
  const atoms = failing.map((id) => `fail:${id}`);
  return flow.paths.filter((p) =>
    atoms.every(
      (atom) => !Object.hasOwn(p.assignment, atom) || p.assignment[atom],
    ),
  );
}

/**
 * Why no run of the test gives the nodes the states it expects; null when
 * one does, or when no reason words the conflict. `via` names the node
 * whose simulated failure rules the states out, where some run of the
 * automation without the test's failures would give them.
 */
function impossiblePath(
  cx: RuleContext,
  flow: FlowFacts,
  expected: Expected,
  failures: Record<string, unknown>,
):
  | ({ via?: string } & (
      | { reason: 'always-runs' | 'never-runs'; node: string }
      | { reason: 'never-together'; a: string; b: string }
    ))
  | null {
  const failing = Object.keys(failures).filter(
    (id) => cx.byId.get(id)?.onError === 'continue',
  );
  const found = whyNot(flow, pathsFailing(flow, failing), expected);
  if (found === null || !holdsOn(flow, flow.paths, expected)) return found;
  // The automation does it; the test's own simulated failures rule it out
  // — the first that does on its own, else the first of them.
  const via =
    failing.find((id) => !holdsOn(flow, pathsFailing(flow, [id]), expected)) ??
    failing[0];
  return via === undefined ? found : { ...found, via };
}

function pathRules(
  cx: RuleContext,
  at: TestAt,
  expect: Record<string, unknown>,
  out: Issue[],
): void {
  const { index, name, test } = at;
  const flow = cx.flow;
  if (flow === null || flow.truncated || !isRecord(expect.nodes)) return;
  // A run that must fail stops part-way: what its nodes do after the
  // failure is no path.
  if (expect.failure !== undefined) return;
  const expected: Array<readonly [string, ExpectedNodeState]> = [];
  for (const [node, state] of Object.entries(expect.nodes)) {
    if (!cx.byId.has(node)) continue;
    if (state !== 'ran' && state !== 'skipped' && state !== 'failed') continue;
    expected.push([node, state]);
  }
  if (expected.length === 0) return;
  const failures = isRecord(test.failures) ? test.failures : {};
  // Only a node that continues on error fails and lets the run go on,
  // whether the test simulates its failure or not.
  const stops = expected.find(
    ([node, state]) =>
      state === 'failed' && cx.byId.get(node)?.onError !== 'continue',
  );
  // Else a simulated failure that stops the run fails the test before its
  // nodes are judged.
  const stopping = Object.keys(failures).some((id) => {
    const node = cx.byId.get(id);
    return node !== undefined && node.onError !== 'continue';
  });
  const found =
    stops !== undefined
      ? { reason: 'cannot-fail' as const, node: stops[0] }
      : stopping
        ? null
        : impossiblePath(cx, flow, expected, failures);
  if (found === null) return;
  const via = 'via' in found ? found.via : undefined;
  const stateOf = new Map(expected);
  const what =
    found.reason === 'never-together'
      ? `"${found.a}" and "${found.b}" to run`
      : `"${found.node}" ${EXPECTED_STATE_WORDS[stateOf.get(found.node) ?? 'ran']}`;
  const why =
    found.reason === 'never-together'
      ? `"${found.a}" and "${found.b}" never run in the same run`
      : found.reason === 'cannot-fail'
        ? `"${found.node}" stops the run when it fails — only an onError: continue node can fail and let the run go on`
        : found.reason === 'always-runs'
          ? `"${found.node}" runs on every path`
          : `"${found.node}" can never run`;
  out.push(
    warn(
      'TESTS_EXPECT_PATH_IMPOSSIBLE',
      `tests[${index}] "${name}" expects ${what}, which no run of this automation does${via === undefined ? '' : ` while "${via}" fails`}`,
      {
        hint:
          via === undefined
            ? why
            : `${why} — the test simulates a failure of "${via}"`,
        at: {
          pointer:
            found.reason === 'never-together'
              ? ptr('tests', index, 'expect', 'nodes')
              : ptr('tests', index, 'expect', 'nodes', found.node),
        },
        params: {
          test: index,
          name,
          reason: found.reason,
          ...(found.reason === 'never-together'
            ? { a: found.a, b: found.b }
            : { node: found.node }),
          ...(via !== undefined && { via }),
        },
      },
    ),
  );
}

function failureRule(
  cx: RuleContext,
  at: TestAt,
  expect: Record<string, unknown>,
  out: Issue[],
): void {
  const { index, name } = at;
  if (!isRecord(expect.failure) || typeof expect.failure.node !== 'string') {
    return;
  }
  const node: NodeDef | undefined = cx.byId.get(expect.failure.node);
  if (node === undefined) return;
  const cause =
    node.onError === 'continue'
      ? ('continues' as const)
      : cx.flow !== null && !cx.flow.reach(node.id).executed
        ? ('unreachable' as const)
        : undefined;
  if (cause === undefined) return;
  out.push(
    warn(
      'TESTS_EXPECT_FAILURE_IMPOSSIBLE',
      `tests[${index}] "${name}" expects the run to fail at "${node.id}", but ${cause === 'continues' ? `"${node.id}" continues on error, so it never stops the run` : `"${node.id}" can never run`}`,
      {
        hint:
          cause === 'continues'
            ? `expect it under nodes instead: {${node.id}: failed}`
            : 'expect the failure at a node that runs',
        at: { pointer: ptr('tests', index, 'expect', 'failure', 'node') },
        params: { test: index, name, node: node.id, cause },
      },
    ),
  );
}

export function testRules(cx: RuleContext, out: Issue[]): void {
  const count = Array.isArray(cx.doc.tests) ? cx.doc.tests.length : 0;
  if (count > MAX_TESTS) {
    out.push(
      err(
        'TESTS_TOO_MANY',
        `the document has ${count} tests; at most ${MAX_TESTS} are allowed`,
        {
          hint: 'keep one test per behavior or path — merge near-duplicates',
          at: { pointer: '/tests' },
          params: { count, max: MAX_TESTS },
        },
      ),
    );
  }
  const tests = testsOf(cx.doc);
  if (tests.length === 0) return;
  const firstByName = new Map<string, number>();
  let possible: string[] | undefined | null = null;
  for (const at of tests) {
    const { index, name, test } = at;
    unknownFields(at, out);
    const first = firstByName.get(name);
    if (first === undefined) {
      firstByName.set(name, index);
    } else {
      out.push(
        warn(
          'TESTS_NAME_DUPLICATE',
          `tests[${index}] is named "${name}", like tests[${first}]`,
          {
            hint: 'give every test its own name — results are listed by name',
            at: { pointer: ptr('tests', index, 'name') },
            params: { test: index, name, firstIndex: first },
          },
        ),
      );
    }
    standIns(cx, at, out);

    const expect = isRecord(test.expect) ? test.expect : undefined;
    if (expect === undefined) continue;
    expectedNodes(cx, at, expect, out);
    pathRules(cx, at, expect, out);
    failureRule(cx, at, expect, out);

    if (Array.isArray(expect.effects)) {
      possible ??= effectsOf(cx.nodes, cx.children, 0);
      for (const [j, effect] of expect.effects.entries()) {
        if (possible === undefined) break;
        if (!isRecord(effect) || typeof effect.connector !== 'string') continue;
        // An effect expected not to happen cannot be impossible.
        if (effect.absent === true) continue;
        const connector = effect.connector;
        if (possible.includes(connector)) continue;
        const suggestion = closestName(connector, possible);
        out.push(
          warn(
            'TESTS_EFFECT_UNKNOWN',
            `tests[${index}] "${name}" expects a "${connector}" effect, which no node of this automation performs`,
            {
              hint: `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}effects come from: ${possible.join(', ') || '(none — no node of this automation performs an effect)'}`,
              at: {
                pointer: ptr(
                  'tests',
                  index,
                  'expect',
                  'effects',
                  j,
                  'connector',
                ),
              },
              params: {
                test: index,
                name,
                connector,
                ...(suggestion !== undefined && { suggestion }),
                possible,
              },
            },
          ),
        );
      }
    }

    for (const field of ['output', 'outputIncludes'] as const) {
      if (expect[field] === undefined) continue;
      const m = expectMismatch(expect[field], cx.types.output, [], 0, {
        extraMembers: false,
      });
      if (m === null) continue;
      const property = propertyOf(m.path);
      out.push(
        warn(
          'TESTS_EXPECT_TYPE',
          `tests[${index}] "${name}" expects output${property} to be ${m.expected}, but the automation's output${property} is ${m.actual}`,
          {
            hint: 'the test cannot pass as written — fix the expectation or the output',
            at: { pointer: ptr('tests', index, 'expect', field, ...m.path) },
            params: {
              test: index,
              name,
              property: property.replace(/^\./, ''),
              expected: m.expected,
              actual: m.actual,
            },
          },
        ),
      );
    }
  }
}
