/**
 * Acceptance tests that cannot pass as written.
 *
 *  - TESTS_EFFECT_UNKNOWN — an expected effect names a connector no node
 *    performs: effects come from connector nodes that write, from `llm` and
 *    `agent` nodes, and from the automations subautomation nodes call (as
 *    deep as a run nests them). Silent when a called automation could not
 *    be resolved — its effects are not known.
 *  - TESTS_EXPECT_TYPE — an expected output value has a kind the output can
 *    never have there (a number where the output is text, a key the output
 *    never carries). An expected null is never judged: a skipped node's
 *    output is null whatever its type, and the types describe nodes that
 *    ran.
 */

import { isRecord } from '../../../../utils/type-utils';
import { warn } from '../../errors';
import { nodeTypes } from '../../slots';
import { ptr } from '../../syntax/pointer';
import { renderPath } from '../../syntax/walk';
import type { Issue } from '../../types';
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
  expected: string;
  actual: string;
}

/** The first place an expected value certainly differs in kind from the
 * output's shape; null when every place may match. */
function expectMismatch(
  value: unknown,
  shape: Shape,
  path: Array<string | number>,
  depth: number,
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
      const m = expectMismatch(item, element, [...path, i], depth + 1);
      if (m !== null) return m;
    }
    return null;
  }
  if (kind === 'object' && isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const found = lookup(shape, key);
      if (found.kind === 'missing' && found.closed) {
        if (item === null) continue;
        return {
          path: [...path, key],
          expected: toTs(shapeOfValue(item)),
          actual: 'undefined',
        };
      }
      if (found.kind !== 'found') continue;
      const m = expectMismatch(item, found.shape, [...path, key], depth + 1);
      if (m !== null) return m;
    }
  }
  return null;
}

export function testRules(cx: RuleContext, out: Issue[]): void {
  const tests = testsOf(cx.doc);
  if (tests.length === 0) return;
  let possible: string[] | undefined | null = null;
  for (const { index, name, test } of tests) {
    const expect = isRecord(test.expect) ? test.expect : undefined;
    if (expect === undefined) continue;

    if (Array.isArray(expect.effects)) {
      possible ??= effectsOf(cx.nodes, cx.children, 0);
      for (const [j, effect] of expect.effects.entries()) {
        if (possible === undefined) break;
        if (!isRecord(effect) || typeof effect.connector !== 'string') continue;
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

    if (expect.output === undefined) continue;
    const m = expectMismatch(expect.output, cx.types.output, [], 0);
    if (m === null) continue;
    const property = renderPath(m.path.map((key) => ({ key })));
    out.push(
      warn(
        'TESTS_EXPECT_TYPE',
        `tests[${index}] "${name}" expects output${property} to be ${m.expected}, but the automation's output${property} is ${m.actual}`,
        {
          hint: 'the test cannot pass as written — fix the expectation or the output',
          at: { pointer: ptr('tests', index, 'expect', 'output', ...m.path) },
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
