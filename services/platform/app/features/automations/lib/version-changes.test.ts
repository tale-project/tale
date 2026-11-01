import { describe, expect, it } from 'vitest';

import { diffAutomationDocuments } from '@/lib/engine/core/diff/automation';
import { changeSummaryOf } from '@/lib/engine/core/diff/changes';

import {
  changeFlags,
  compareOptions,
  flowNodeChanges,
  nodeChangeSummary,
  referencesUpdatedBy,
  renamedGates,
  testChangeSummary,
  testFieldName,
  versionBefore,
} from './version-changes';

/** Echoes a key and its values, so the words a helper picks are visible;
 * i18next's own options (`ns`, `defaultValue`) are left out. */
const t = (key: string, options?: Record<string, unknown>) => {
  const values = Object.entries(options ?? {}).filter(
    ([name]) => name !== 'ns' && name !== 'defaultValue',
  );
  return values.length === 0
    ? key
    : `${key}:${JSON.stringify(Object.fromEntries(values))}`;
};

const ctx = { t, locale: 'en' };

const doc = (
  nodes: Array<Record<string, unknown>>,
  output: string,
  extra: Record<string, unknown> = {},
) => ({ version: 1, name: 'digest', nodes, output, ...extra });

const BEFORE = doc(
  [
    { id: 'collect', type: 'transform', code: "return 'a';" },
    { id: 'answer', type: 'transform', code: 'return nodes.collect.output;' },
    { id: 'notify', type: 'transform', code: "return 'n';" },
  ],
  '{{ nodes.answer.output }}',
);

const AFTER = doc(
  [
    { id: 'collect', type: 'transform', code: "return 'b';" },
    { id: 'reply', type: 'transform', code: 'return nodes.collect.output;' },
    { id: 'archive', type: 'transform', code: "return 'x';" },
  ],
  '{{ nodes.reply.output }}',
  { tests: [{ name: 'greets', input: {}, expect: { output: 'b' } }] },
);

describe('the words of a comparison', () => {
  const diff = diffAutomationDocuments(BEFORE, AFTER);

  it('names the parts a version changed without a count', () => {
    expect(changeFlags(changeSummaryOf(diff), t)).toEqual([
      'versions.flags.tests',
    ]);
    expect(
      changeFlags(
        {
          nodes: { added: 0, removed: 0, changed: 0 },
          inputs: true,
          output: true,
          package: true,
        },
        t,
      ),
    ).toEqual([
      'versions.flags.inputs',
      'versions.flags.output',
      'versions.flags.package',
    ]);
  });

  it('says which fields of a changed node changed', () => {
    const collect = diff.nodes.find((node) => node.id === 'collect');
    expect(collect?.kind).toBe('changed');
    expect(nodeChangeSummary(collect!, ctx)).toBe(
      'compare.summary.node:{"fields":"editor.fields.code","count":1}',
    );
  });

  it('marks a renamed node with its old name and id, and leaves the rest to the canvas', () => {
    const marks = flowNodeChanges(diff, ctx);
    expect(marks.get('reply')).toEqual({
      kind: 'renamed',
      renamedFrom: 'Answer',
      beforeId: 'answer',
    });
    expect(marks.get('collect')).toMatchObject({ kind: 'changed' });
    // Added and removed nodes mark themselves.
    expect(marks.has('archive')).toBe(false);
    expect(marks.has('notify')).toBe(false);
  });

  it("moves a renamed node's condition with it, by gate id", () => {
    expect(renamedGates(diff)).toEqual(
      new Map([['__gate:reply', '__gate:answer']]),
    );
  });

  it('counts the nodes that changed only because they read a renamed node', () => {
    const before = doc(
      [
        { id: 'fetch', type: 'transform', code: "return 'f';" },
        { id: 'use', type: 'transform', code: 'return nodes.fetch.output;' },
      ],
      '{{ nodes.use.output }}',
    );
    const after = doc(
      [
        { id: 'load', type: 'transform', code: "return 'f';" },
        { id: 'use', type: 'transform', code: 'return nodes.load.output;' },
      ],
      '{{ nodes.use.output }}',
    );
    const renamed = diffAutomationDocuments(before, after);
    expect(referencesUpdatedBy(renamed).get('load')).toBe(1);
    const use = renamed.nodes.find((node) => node.id === 'use');
    expect(use?.referencesOnly).toBe(true);
    expect(nodeChangeSummary(use!, ctx)).toBe('compare.summary.references');
  });
});

describe('the words of a changed test', () => {
  const nodes = [{ id: 'collect', type: 'transform', code: "return 'a';" }];
  const withTest = (test: Record<string, unknown>) =>
    doc(nodes, '{{ nodes.collect.output }}', { tests: [test] });

  it('names each field the way the test form labels it, never by its key', () => {
    expect(
      [
        'description',
        'input',
        'mocks',
        'failures',
        'scenarios',
        'expect.output',
        'expect.outputIncludes',
        'expect.effects',
        'expect.nodes',
        'expect.failure',
      ].map((field) => testFieldName(t, field)),
    ).toEqual([
      'tests.fields.description',
      'tests.fields.input',
      'tests.fields.mocks',
      'tests.fields.failures',
      'tests.fields.scenarios',
      'tests.fields.expectOutput',
      'tests.fields.expectOutput',
      'tests.fields.expectActions',
      'tests.fields.expectNodes',
      'tests.fields.mustFail',
    ]);
  });

  it('reads any other expectation as one of the Expectations, and a key the grammar does not know as written', () => {
    expect(testFieldName(t, 'expect')).toBe('tests.fields.expect');
    expect(testFieldName(t, 'expect.later')).toBe('tests.fields.expect');
    expect(testFieldName(t, 'owner')).toBe('owner');
    expect(testFieldName(t, 'constructor')).toBe('constructor');
  });

  it('says which fields of a changed test changed, in words', () => {
    const [test] = diffAutomationDocuments(
      withTest({
        name: 'greets',
        input: {},
        mocks: { collect: 'hi' },
        expect: { output: 'hi' },
      }),
      withTest({
        name: 'greets',
        input: {},
        mocks: { collect: 'hello' },
        expect: { output: 'hello' },
      }),
    ).tests;
    expect(testChangeSummary(test!, ctx)).toBe(
      'compare.summary.node:{"fields":"tests.fields.mocks and tests.fields.expectOutput","count":2}',
    );
  });

  it('names a changed scenario pick by the test’s Scenarios', () => {
    const [test] = diffAutomationDocuments(
      withTest({ name: 'greets', input: {}, scenarios: { collect: 'empty' } }),
      withTest({
        name: 'greets',
        input: {},
        scenarios: { collect: 'refused' },
      }),
    ).tests;
    expect(testChangeSummary(test!, ctx)).toBe(
      'compare.summary.node:{"fields":"tests.fields.scenarios","count":1}',
    );
  });

  it('names the output once when a test checks it the other way', () => {
    const [test] = diffAutomationDocuments(
      withTest({ name: 'greets', input: {}, expect: { output: 'hi' } }),
      withTest({
        name: 'greets',
        input: {},
        expect: { outputIncludes: { text: 'hi' } },
      }),
    ).tests;
    expect(test?.fields.map((field) => field.field)).toEqual([
      'expect.output',
      'expect.outputIncludes',
    ]);
    expect(testChangeSummary(test!, ctx)).toBe(
      'compare.summary.node:{"fields":"tests.fields.expectOutput","count":1}',
    );
  });

  it('says nothing for a test added or removed: its row shows the whole test', () => {
    const tests = diffAutomationDocuments(
      withTest({ name: 'greets', input: {} }),
      withTest({ name: 'welcomes', input: {} }),
    ).tests;
    expect(tests.map((test) => test.kind)).toEqual(['removed', 'added']);
    expect(tests.map((test) => testChangeSummary(test, ctx))).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('versionBefore', () => {
  it('is the version just before, which has none for the first', () => {
    expect(versionBefore(4, [1, 2, 3, 4])).toBe(3);
    expect(versionBefore(1, [1, 2])).toBeUndefined();
  });

  it('is the version just before until the versions are known', () => {
    expect(versionBefore(4, undefined)).toBe(3);
    expect(versionBefore(1, undefined)).toBeUndefined();
  });

  it('is the nearest older version left when the retention policy removed the one before', () => {
    expect(versionBefore(7, [2, 3, 4, 6, 7])).toBe(6);
    expect(versionBefore(7, [2, 3, 4, 7])).toBe(4);
    expect(versionBefore(7, [1, 7])).toBe(1);
  });

  it('keeps the version just before when nothing older is left, so it is said removed, not first', () => {
    expect(versionBefore(7, [7, 8])).toBe(6);
  });
});

describe('compareOptions', () => {
  it('offers the version before, the live one and the base first, then the rest newest first', () => {
    expect(
      compareOptions([1, 2, 3, 4, 5, 6], { to: 5, live: 2, basedOn: 3 }),
    ).toEqual([
      { version: 4, role: 'previous' },
      { version: 2, role: 'live' },
      { version: 3, role: 'basedOn' },
      { version: 6, role: null },
      { version: 1, role: null },
    ]);
  });

  it('offers each version once, never the compared one, nor one gone', () => {
    expect(compareOptions([1, 3], { to: 3, live: 3, basedOn: 2 })).toEqual([
      { version: 1, role: null },
    ]);
    expect(compareOptions([1, 2, 3], { to: 3, live: 2, basedOn: 2 })).toEqual([
      { version: 2, role: 'previous' },
      { version: 1, role: null },
    ]);
  });
});
