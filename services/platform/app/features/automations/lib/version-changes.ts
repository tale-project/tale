import type { FlowNodeDiff } from '@tale/ui/flow/diff';

import type {
  AutomationDiff,
  FieldChange,
  NodeDiff,
  TestDiff,
} from '@/lib/engine/core/diff/automation';
import type { ChangeSummary } from '@/lib/engine/core/diff/changes';
import type { AutomationTest, TestExpectation } from '@/lib/engine/core/types';

import { gateIdOf } from './flow-ids';
import { fieldName } from './issue-text';
import { nodeTitle } from './node-face';

/**
 * What changed between two versions, in the words the Versions tab and the
 * compare page say it: the parts a summary flags, what a changed node's box
 * and a changed test's row say, and the versions a comparison offers to
 * compare with.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The parts of a version that changed without a count, in words. */
export function changeFlags(changes: ChangeSummary, t: Translate): string[] {
  return [
    changes.inputs === true && t('versions.flags.inputs'),
    changes.output === true && t('versions.flags.output'),
    changes.description === true && t('versions.flags.description'),
    changes.tests === true && t('versions.flags.tests'),
    changes.other === true && t('versions.flags.other'),
    changes.package === true && t('versions.flags.package'),
  ].filter((flag) => flag !== false);
}

/** A test's fields as the diff names them: `expect` split into its parts. */
type TestField =
  | Exclude<keyof AutomationTest, 'name' | 'expect'>
  | `expect.${keyof TestExpectation}`;

/** Every field of a test as the test form labels it — the types refuse a
 * field without one; `output` and `outputIncludes` are its one Output field,
 * checked one way or the other. */
const TEST_FIELD_KEYS: Readonly<Record<TestField, string>> = {
  description: 'tests.fields.description',
  input: 'tests.fields.input',
  mocks: 'tests.fields.mocks',
  failures: 'tests.fields.failures',
  'expect.output': 'tests.fields.expectOutput',
  'expect.outputIncludes': 'tests.fields.expectOutput',
  'expect.effects': 'tests.fields.expectActions',
  'expect.nodes': 'tests.fields.expectNodes',
  'expect.failure': 'tests.fields.mustFail',
};

function isTestField(field: string): field is TestField {
  return Object.hasOwn(TEST_FIELD_KEYS, field);
}

/**
 * A test's field as the diff names it (`mocks`, `expect.output`, …), in the
 * words the test form labels it with ("Simulated outputs", "Output"). Any
 * other part of `expect` reads as one of the test's Expectations; a key the
 * grammar does not know reads as written.
 */
export function testFieldName(t: Translate, field: string): string {
  if (isTestField(field)) return t(TEST_FIELD_KEYS[field]);
  if (field === 'expect' || field.startsWith('expect.')) {
    return t('tests.fields.expect');
  }
  return field;
}

/** The fields a change names, in words and in the reader's list form:
 * "Prompt and model". A node's fields are named the way its inspector
 * labels them; `nameOf` names another kind of field, such as a test's. */
export function fieldList(
  fields: readonly FieldChange[],
  ctx: { t: Translate; locale: string },
  nameOf: (t: Translate, field: string) => string = fieldName,
): { text: string; count: number } {
  const names = [...new Set(fields.map((field) => nameOf(ctx.t, field.field)))];
  return {
    text: new Intl.ListFormat(ctx.locale, { type: 'conjunction' }).format(
      names,
    ),
    count: names.length,
  };
}

/**
 * What a changed or renamed node's box says at its foot: the fields that
 * changed ("Prompt and model changed"), or that it only reads a renamed
 * node by its new name. Nothing for a node that was only renamed, or added
 * or removed — the box says those itself.
 */
export function nodeChangeSummary(
  node: NodeDiff,
  ctx: { t: Translate; locale: string },
): string | undefined {
  if (node.referencesOnly === true) return ctx.t('compare.summary.references');
  if (node.fields.length === 0) return undefined;
  const { text, count } = fieldList(node.fields, ctx);
  return ctx.t('compare.summary.node', { fields: text, count });
}

/**
 * What a changed test's row says: the fields that changed, in the words the
 * test form labels them with ("Simulated outputs and Output changed").
 * Nothing for a test added or removed — its row shows the whole test.
 */
export function testChangeSummary(
  test: TestDiff,
  ctx: { t: Translate; locale: string },
): string | undefined {
  if (test.fields.length === 0) return undefined;
  const { text, count } = fieldList(test.fields, ctx, testFieldName);
  return ctx.t('compare.summary.node', { fields: text, count });
}

/** How the canvas marks each changed or renamed node of a comparison
 * (`mergeFlowGraphs`); a node only one version has marks itself. */
export function flowNodeChanges(
  diff: AutomationDiff,
  ctx: { t: Translate; locale: string },
): ReadonlyMap<string, FlowNodeDiff> {
  const marks = new Map<string, FlowNodeDiff>();
  for (const node of diff.nodes) {
    if (node.kind !== 'changed' && node.kind !== 'renamed') continue;
    const summary = nodeChangeSummary(node, ctx);
    marks.set(node.id, {
      kind: node.kind,
      ...(summary !== undefined && { summary }),
      ...(node.kind === 'renamed' &&
        node.renamedFrom !== undefined && {
          renamedFrom: nodeTitle(node.renamedFrom),
          beforeId: node.renamedFrom,
        }),
    });
  }
  return marks;
}

/** The condition in front of each renamed node, by its new id: the older
 * id it stands for on a comparison's chart, one box with its node. */
export function renamedGates(
  diff: AutomationDiff,
): ReadonlyMap<string, string> {
  const gates = new Map<string, string>();
  for (const node of diff.nodes) {
    if (node.kind !== 'renamed' || node.renamedFrom === undefined) continue;
    gates.set(gateIdOf(node.id), gateIdOf(node.renamedFrom));
  }
  return gates;
}

/** How many nodes changed only because they read a renamed node, by the
 * renamed node's new id. */
export function referencesUpdatedBy(
  diff: AutomationDiff,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of diff.nodes) {
    if (node.referencesOnly !== true) continue;
    const renamed = new Set(
      node.fields.flatMap((field) =>
        (field.referencesOnly ?? []).map((rename) => rename.to),
      ),
    );
    for (const id of renamed) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** One version a comparison can start from. */
export interface CompareOption {
  version: number;
  /** Why it is offered first: the version before, the live one, or the
   * one the compared version was based on. */
  role: 'previous' | 'live' | 'basedOn' | null;
}

/**
 * The versions to compare `to` with: the one before it, the live one and
 * the one it was based on first (each once, in that order), then every
 * other earlier or later version, newest first. `to` itself is never
 * offered.
 */
/**
 * The version a comparison opens against: the one just before, or — when the
 * retention policy removed that one — the nearest older version that is left.
 * Until the versions are known, and when nothing older is left, it is the one
 * just before: a removed neighbour is then said to be removed, rather than
 * the version being passed off as the first.
 */
export function versionBefore(
  version: number,
  known: readonly number[] | undefined,
): number | undefined {
  const usual = version > 1 ? version - 1 : undefined;
  if (usual === undefined || known === undefined || known.includes(usual)) {
    return usual;
  }
  let nearest: number | undefined;
  for (const candidate of known) {
    if (candidate < version && (nearest === undefined || candidate > nearest)) {
      nearest = candidate;
    }
  }
  return nearest ?? usual;
}

export function compareOptions(
  versions: readonly number[],
  context: { to: number; live: number | null; basedOn: number | null },
): CompareOption[] {
  const present = new Set(versions);
  const first: CompareOption[] = [];
  const offer = (version: number | null, role: CompareOption['role']) => {
    if (
      version === null ||
      version === context.to ||
      !present.has(version) ||
      first.some((option) => option.version === version)
    ) {
      return;
    }
    first.push({ version, role });
  };
  offer(context.to - 1, 'previous');
  offer(context.live, 'live');
  offer(context.basedOn, 'basedOn');
  const rest = [...present]
    .filter(
      (version) =>
        version !== context.to &&
        !first.some((option) => option.version === version),
    )
    .sort((a, b) => b - a)
    .map((version) => ({ version, role: null }));
  return [...first, ...rest];
}
