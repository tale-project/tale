// @vitest-environment node

import { randomJson, seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import { shippedDocuments } from '../../selftest/corpus';
import { sourcesOf } from '../syntax/sources';
import type { NodeDef } from '../types';
import {
  type AutomationDiff,
  diffAutomationDocuments,
  MAX_VALUE_CHANGES,
} from './automation';

type Doc = Record<string, unknown>;

/** A small document: `fetch` reads the input, `score` reads `fetch`,
 * `reply` reads `score` and runs when it is positive. */
function base(): Doc {
  return {
    version: 1,
    name: 'support/triage',
    description: 'Sorts the inbox.',
    inputs: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Whose inbox' },
        limit: { type: 'number', default: 25 },
      },
      required: ['owner'],
      additionalProperties: false,
    },
    nodes: [
      {
        id: 'fetch',
        type: 'gmail.list_messages',
        input: { owner: '{{ input.owner }}', limit: '{{ input.limit }}' },
      },
      {
        id: 'score',
        type: 'transform',
        input: { items: '{{ nodes.fetch.output.messages }}' },
        code: 'return { n: input.items.length };',
      },
      {
        id: 'reply',
        type: 'llm',
        model: 'anthropic/claude-haiku-4-5',
        when: '{{ nodes.score.output.n > 0 }}',
        prompt: 'Answer {{ nodes.score.output.n }} messages.',
      },
    ],
    output: { count: '{{ nodes.score.output.n }}' },
    tests: [
      {
        name: 'empty inbox',
        input: { owner: 'acme' },
        expect: { output: { count: 0 } },
      },
      { name: 'one message', input: { owner: 'acme', limit: 1 } },
    ],
  };
}

function nodesOf(doc: Doc): Array<Record<string, unknown>> {
  const nodes = doc.nodes;
  if (!Array.isArray(nodes)) throw new Error('no nodes');
  return nodes as Array<Record<string, unknown>>;
}

function node(doc: Doc, id: string): Record<string, unknown> {
  const found = nodesOf(doc).find((each) => each.id === id);
  if (found === undefined) throw new Error(`no node ${id}`);
  return found;
}

function edited(edit: (doc: Doc) => void): Doc {
  const doc = base();
  edit(doc);
  return doc;
}

function brief(diff: AutomationDiff) {
  return diff.nodes.map((each) => ({
    id: each.id,
    kind: each.kind,
    ...(each.renamedFrom !== undefined && { from: each.renamedFrom }),
    fields: each.fields.map((field) => field.field),
  }));
}

describe('diffAutomationDocuments', () => {
  it('finds nothing between a document and itself, whatever the key order', () => {
    const a = base();
    const reordered = {
      ...Object.fromEntries(Object.entries(a).toReversed()),
      nodes: nodesOf(a).map((each) =>
        Object.fromEntries(Object.entries(each).toReversed()),
      ),
    };
    for (const other of [a, structuredClone(a), reordered]) {
      const diff = diffAutomationDocuments(a, other);
      expect(diff.identical).toBe(true);
      expect(diff).toMatchObject({
        first: false,
        counts: { added: 0, removed: 0, changed: 0, renamed: 0 },
        nodes: [],
        inputs: [],
        output: null,
        description: null,
        tests: [],
        other: [],
        package: [],
        ignored: [],
      });
    }
  });

  it('reads the first version as everything added', () => {
    const diff = diffAutomationDocuments(null, base());
    expect(diff.first).toBe(true);
    expect(diff.identical).toBe(false);
    expect(diff.counts).toEqual({
      added: 3,
      removed: 0,
      changed: 0,
      renamed: 0,
    });
    expect(diff.nodes.map((each) => [each.id, each.kind])).toEqual([
      ['fetch', 'added'],
      ['score', 'added'],
      ['reply', 'added'],
    ]);
    expect(diff.tests.map((each) => [each.name, each.kind])).toEqual([
      ['empty inbox', 'added'],
      ['one message', 'added'],
    ]);
    expect(diff.output?.kind).toBe('added');
    expect(diff.description?.kind).toBe('added');
    expect(diff.other.map((each) => each.field)).toEqual(['version', 'name']);
    expect(diff.inputs.map((each) => [each.property, each.kind])).toEqual([
      [null, 'added'],
      ['owner', 'added'],
      ['limit', 'added'],
    ]);
  });

  it('is symmetric: what one way adds the other way removes', () => {
    const a = base();
    const b = edited((doc) => {
      nodesOf(doc).splice(0, 1);
      nodesOf(doc).push({
        id: 'notify',
        type: 'slack.post',
        input: { text: 'hi' },
      });
      node(doc, 'reply').prompt = 'Answer briefly.';
    });
    const forward = diffAutomationDocuments(a, b);
    const backward = diffAutomationDocuments(b, a);
    expect(forward.counts).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      renamed: 0,
    });
    expect(backward.counts).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      renamed: 0,
    });
    expect(brief(forward)).toEqual([
      { id: 'fetch', kind: 'removed', fields: [] },
      { id: 'reply', kind: 'changed', fields: ['prompt'] },
      { id: 'notify', kind: 'added', fields: [] },
    ]);
    expect(brief(backward)).toEqual([
      { id: 'fetch', kind: 'added', fields: [] },
      { id: 'reply', kind: 'changed', fields: ['prompt'] },
      { id: 'notify', kind: 'removed', fields: [] },
    ]);
    const prompt = forward.nodes[1]?.fields[0];
    expect(prompt).toMatchObject({
      kind: 'changed',
      display: 'template',
      before: 'Answer {{ nodes.score.output.n }} messages.',
      after: 'Answer briefly.',
    });
  });

  it('places a removed node where it stood and keeps the later order', () => {
    const b = edited((doc) => {
      // `score` goes; `reply` moves to the front, which is no change.
      const [fetch, , reply] = nodesOf(doc);
      doc.nodes = [
        reply,
        { ...fetch, input: { owner: 'x' } },
        { id: 'audit', type: 'transform', code: 'return 1;' },
      ];
    });
    expect(brief(diffAutomationDocuments(base(), b))).toEqual([
      { id: 'fetch', kind: 'changed', fields: ['input'] },
      { id: 'score', kind: 'removed', fields: [] },
      { id: 'audit', kind: 'added', fields: [] },
    ]);
  });

  it('shows each node field the way the syntax layer reads it', () => {
    const fields: Record<string, [unknown, unknown, string]> = {
      type: ['transform', 'llm', 'scalar'],
      when: ['{{ input.a }}', '{{ input.b }}', 'condition'],
      elseOf: ['fetch', 'score', 'scalar'],
      forEach: ['{{ input.a }}', '{{ input.b }}', 'template'],
      repeatUntil: ['{{ output.ok }}', '{{ output.done }}', 'condition'],
      maxRepeats: [3, 5, 'scalar'],
      onError: ['fail', 'continue', 'scalar'],
      input: [{ a: '{{ input.a }}' }, { a: '{{ input.b }}' }, 'json'],
      code: ['return 1;', 'return 2;', 'code'],
      prompt: ['Hi {{ input.a }}', 'Hello {{ input.a }}', 'template'],
      system: ['Be brief.', 'Be kind.', 'template'],
      model: ['a/one', 'a/two', 'scalar'],
      modelProvider: ['openrouter', 'anthropic', 'scalar'],
      outputSchema: [{ type: 'object' }, { type: 'array' }, 'json'],
      harness: ['claude-code', 'codex', 'scalar'],
      skills: [['a'], ['a', 'b'], 'list'],
      connectors: [['gmail'], [], 'list'],
      tools: [['web_search'], ['task_read'], 'list'],
      secrets: [['A'], ['B'], 'list'],
      files: [{ brief: '{{ input.a }}' }, { brief: 'x' }, 'json'],
      automation: ['billing/dunning', 'billing/dunning@3', 'scalar'],
      credential: ['github-main', 'github-backup', 'scalar'],
      notes: ['one\ntwo', 'one\nthree', 'text'],
    };
    for (const [field, [was, is, display]] of Object.entries(fields)) {
      const a = edited((doc) => {
        node(doc, 'score')[field] = was;
      });
      const b = edited((doc) => {
        node(doc, 'score')[field] = is;
      });
      const diff = diffAutomationDocuments(a, b);
      expect({ field, fields: diff.nodes[0]?.fields }).toMatchObject({
        field,
        fields: [{ field, kind: 'changed', display, before: was, after: is }],
      });
    }
  });

  it('agrees with the syntax layer on which fields hold which expressions', () => {
    const every: NodeDef = {
      id: 'all',
      type: 'agent',
      input: { a: '{{ input.a }}' },
      files: { f: '{{ input.a }}' },
      prompt: '{{ input.a }}',
      system: '{{ input.a }}',
      code: 'return input.a;',
      when: '{{ input.a }}',
      forEach: '{{ input.list }}',
      repeatUntil: '{{ output.done }}',
    };
    const asDisplay: Record<string, string> = {
      body: 'code',
      condition: 'condition',
      template: 'template',
    };
    const sources = sourcesOf(every);
    expect(sources.map((source) => source.field).toSorted()).toEqual([
      'code',
      'files',
      'forEach',
      'input',
      'prompt',
      'repeatUntil',
      'system',
      'when',
    ]);
    for (const source of sources) {
      const was = { name: 'x', nodes: [every] };
      const value = every[source.field as keyof NodeDef];
      const is = {
        name: 'x',
        nodes: [
          {
            ...every,
            [source.field]:
              typeof value === 'string' ? `${value} ` : { changed: true },
          },
        ],
      };
      const [change] = diffAutomationDocuments(was, is).nodes[0]?.fields ?? [];
      // An object field holds its templates as data; a string field is
      // shown as the kind of expression it holds.
      expect([source.field, change?.display]).toEqual([
        source.field,
        typeof value === 'string' ? asDisplay[source.kind] : 'json',
      ]);
    }
  });

  it('lists what changed inside a data field through the shared value diff', () => {
    const b = edited((doc) => {
      node(doc, 'fetch').input = {
        owner: '{{ input.owner }}',
        limit: 5,
        label: 'x',
      };
    });
    const [change] = diffAutomationDocuments(base(), b).nodes[0]?.fields ?? [];
    expect(change?.values?.map((each) => [each.pointer, each.kind])).toEqual([
      ['/label', 'added'],
      ['/limit', 'type-changed'],
    ]);
    expect(change?.truncated).toBeUndefined();
  });

  it('caps the value changes of one field', () => {
    const big = Object.fromEntries(
      Array.from({ length: MAX_VALUE_CHANGES + 50 }, (_, index) => [
        `k${index}`,
        index,
      ]),
    );
    const a = edited((doc) => {
      node(doc, 'fetch').input = big;
    });
    const b = edited((doc) => {
      node(doc, 'fetch').input = Object.fromEntries(
        Object.entries(big).map(([key, value]) => [key, value + 1]),
      );
    });
    const [change] = diffAutomationDocuments(a, b).nodes[0]?.fields ?? [];
    expect(change?.values).toHaveLength(MAX_VALUE_CHANGES);
    expect(change?.truncated).toBe(true);
  });

  it('reads a new type under the same id as a change, not a swap', () => {
    const b = edited((doc) => {
      node(doc, 'score').type = 'llm';
      node(doc, 'score').prompt = 'Count them.';
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(diff.counts).toEqual({
      added: 0,
      removed: 0,
      changed: 1,
      renamed: 0,
    });
    expect(diff.nodes[0]).toMatchObject({
      id: 'score',
      kind: 'changed',
      type: 'llm',
      typeBefore: 'transform',
    });
    expect(diff.nodes[0]?.fields.map((each) => each.field)).toEqual([
      'type',
      'prompt',
    ]);
  });

  it('ignores ui, the document’s and a node’s own, and says so', () => {
    const b = edited((doc) => {
      doc.ui = { positions: { fetch: { x: 1, y: 2 } } };
      node(doc, 'reply').ui = { collapsed: true };
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(diff.identical).toBe(true);
    expect(diff.nodes).toEqual([]);
    expect(diff.ignored).toEqual(['ui']);
  });

  it('lists the name, the version and keys the grammar does not know as other', () => {
    const b = edited((doc) => {
      doc.name = 'support/triage-2';
      doc.version = 2;
      doc.owner = 'ops';
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(
      diff.other.map((each) => [each.field, each.kind, each.display]),
    ).toEqual([
      ['version', 'changed', 'scalar'],
      ['name', 'changed', 'scalar'],
      ['owner', 'added', 'scalar'],
    ]);
  });

  it('keeps the first of two nodes sharing an id and compares the rest as data', () => {
    const twice = edited((doc) => {
      nodesOf(doc).push({ id: 'fetch', type: 'transform', code: 'return 1;' });
    });
    const changed = edited((doc) => {
      nodesOf(doc).push({ id: 'fetch', type: 'transform', code: 'return 2;' });
    });
    const diff = diffAutomationDocuments(twice, changed);
    expect(diff.nodes).toEqual([]);
    expect(diff.other.map((each) => [each.field, each.kind])).toEqual([
      ['nodes', 'changed'],
    ]);
    expect(diff.identical).toBe(false);
  });

  it('compares the output and the description', () => {
    const b = edited((doc) => {
      doc.output = '{{ nodes.score.output }}';
      delete doc.description;
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(diff.output).toMatchObject({
      field: 'output',
      kind: 'changed',
      display: 'json',
      after: '{{ nodes.score.output }}',
    });
    expect(diff.description).toMatchObject({
      field: 'description',
      kind: 'removed',
      display: 'text',
      before: 'Sorts the inbox.',
    });
    const template = diffAutomationDocuments(
      b,
      edited((doc) => {
        doc.output = '{{ nodes.reply.output }}';
      }),
    );
    expect(template.output?.display).toBe('template');
  });
});

describe('the run input, property by property', () => {
  it('names a property added, removed, retyped or newly required', () => {
    const b = edited((doc) => {
      doc.inputs = {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Whose inbox' },
          limit: { type: 'string', default: '25' },
          since: { type: 'number' },
        },
        required: ['owner', 'since'],
        additionalProperties: false,
      };
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(
      diff.inputs.map((each) => ({
        property: each.property,
        kind: each.kind,
        required: each.required,
        types: [each.typeBefore, each.typeAfter],
        values: each.values.map((value) => [value.pointer, value.kind]),
      })),
    ).toEqual([
      {
        property: 'limit',
        kind: 'changed',
        required: undefined,
        types: ['number', 'string'],
        values: [
          ['/default', 'type-changed'],
          ['/type', 'changed'],
        ],
      },
      {
        property: 'since',
        kind: 'added',
        required: { before: false, after: true },
        types: [undefined, 'number'],
        values: [],
      },
    ]);
  });

  it('reads a property that only became optional as a change', () => {
    const b = edited((doc) => {
      (doc.inputs as Doc).required = [];
    });
    expect(diffAutomationDocuments(base(), b).inputs).toEqual([
      expect.objectContaining({
        property: 'owner',
        kind: 'changed',
        required: { before: true, after: false },
        values: [],
      }),
    ]);
  });

  it('keeps the schema around the properties as one entry', () => {
    const b = edited((doc) => {
      (doc.inputs as Doc).additionalProperties = true;
    });
    expect(diffAutomationDocuments(base(), b).inputs).toEqual([
      expect.objectContaining({
        property: null,
        kind: 'changed',
        values: [
          expect.objectContaining({
            pointer: '/additionalProperties',
            kind: 'changed',
          }),
        ],
      }),
    ]);
  });

  it('does not see the order of properties or of required names', () => {
    const b = edited((doc) => {
      const inputs = doc.inputs as Doc;
      const properties = inputs.properties as Doc;
      inputs.properties = { limit: properties.limit, owner: properties.owner };
      inputs.required = ['owner'];
    });
    expect(diffAutomationDocuments(base(), b).identical).toBe(true);
  });

  it('compares a schema of another shape as data', () => {
    const b = edited((doc) => {
      (doc.inputs as Doc).properties = 'owner';
    });
    const [entry] = diffAutomationDocuments(base(), b).inputs;
    expect(entry).toMatchObject({ property: null, kind: 'changed' });
    expect(entry?.values.map((each) => each.pointer)).toEqual(['/properties']);
  });
});

describe('tests, found by name', () => {
  it('does not see the order of tests', () => {
    const b = edited((doc) => {
      doc.tests = (doc.tests as unknown[]).toReversed();
    });
    expect(diffAutomationDocuments(base(), b).identical).toBe(true);
  });

  it('names the fields of a changed test, expect split into its parts', () => {
    const b = edited((doc) => {
      const [first] = doc.tests as Doc[];
      if (first === undefined) throw new Error('no test');
      first.expect = { output: { count: 1 }, nodes: { reply: 'skipped' } };
      first.mocks = { fetch: { messages: [] } };
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(
      diff.tests.map((each) => [
        each.name,
        each.kind,
        each.fields.map((field) => field.field),
      ]),
    ).toEqual([
      ['empty inbox', 'changed', ['mocks', 'expect.output', 'expect.nodes']],
    ]);
  });

  it('reads a renamed test as one removed and one added', () => {
    const b = edited((doc) => {
      const [first] = doc.tests as Doc[];
      if (first === undefined) throw new Error('no test');
      first.name = 'nothing waiting';
    });
    expect(
      diffAutomationDocuments(base(), b).tests.map((each) => [
        each.name,
        each.kind,
      ]),
    ).toEqual([
      ['empty inbox', 'removed'],
      ['nothing waiting', 'added'],
    ]);
  });

  it('finds an unnamed test by position and a repeated name by occurrence', () => {
    const a = edited((doc) => {
      doc.tests = [
        { input: 1 },
        { name: 'x', input: 1 },
        { name: 'x', input: 2 },
      ];
    });
    const b = edited((doc) => {
      doc.tests = [
        { input: 9 },
        { name: 'x', input: 1 },
        { name: 'x', input: 3 },
      ];
    });
    expect(
      diffAutomationDocuments(a, b).tests.map((each) => [each.name, each.kind]),
    ).toEqual([
      ['#1', 'changed'],
      ['x (2)', 'changed'],
    ]);
  });
});

describe('package data', () => {
  it('compares each field given, null and absent alike', () => {
    const diff = diffAutomationDocuments(base(), base(), {
      beforePackage: { settings: { folder: 'Setup' }, taskContract: null },
      afterPackage: {
        settings: { folder: 'Config' },
        presentation: { title: 'T' },
      },
    });
    expect(diff.identical).toBe(false);
    expect(
      diff.package.map((each) => [each.field, each.kind, each.display]),
    ).toEqual([
      ['presentation', 'added', 'json'],
      ['settings', 'changed', 'json'],
    ]);
  });

  it('says nothing about package data nobody passed', () => {
    expect(diffAutomationDocuments(base(), base()).package).toEqual([]);
  });
});

describe('renamed nodes', () => {
  /** `base()` with `score` renamed to `count` and every reference to it
   * following. */
  function renamed(): Doc {
    return edited((doc) => {
      node(doc, 'score').id = 'count';
      node(doc, 'reply').when = '{{ nodes.count.output.n > 0 }}';
      node(doc, 'reply').prompt = 'Answer {{ nodes.count.output.n }} messages.';
      doc.output = { count: '{{ nodes.count.output.n }}' };
    });
  }

  it('reads a node back under another id as renamed', () => {
    const diff = diffAutomationDocuments(base(), renamed());
    expect(diff.counts).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      renamed: 1,
    });
    expect(diff.nodes[0]).toMatchObject({
      id: 'count',
      kind: 'renamed',
      renamedFrom: 'score',
      type: 'transform',
      fields: [],
      beforeIndex: 1,
      afterIndex: 1,
    });
  });

  it('folds the nodes and the output that only follow the rename under it', () => {
    const diff = diffAutomationDocuments(base(), renamed());
    const reply = diff.nodes[1];
    expect(reply).toMatchObject({
      id: 'reply',
      kind: 'changed',
      referencesOnly: true,
    });
    expect(
      reply?.fields.map((each) => [each.field, each.referencesOnly]),
    ).toEqual([
      ['when', [{ from: 'score', to: 'count' }]],
      ['prompt', [{ from: 'score', to: 'count' }]],
    ]);
    expect(diff.output?.referencesOnly).toEqual([
      { from: 'score', to: 'count' },
    ]);
  });

  it('keeps a reader that also changed on its own as changed', () => {
    const b = renamed();
    node(b, 'reply').prompt = 'Answer all {{ nodes.count.output.n }} messages.';
    const diff = diffAutomationDocuments(base(), b);
    const reply = diff.nodes[1];
    expect(reply?.referencesOnly).toBeUndefined();
    expect(
      reply?.fields.map((each) => [each.field, each.referencesOnly]),
    ).toEqual([
      ['when', [{ from: 'score', to: 'count' }]],
      ['prompt', undefined],
    ]);
    expect(diff.counts).toEqual({
      added: 0,
      removed: 0,
      changed: 1,
      renamed: 1,
    });
  });

  it('reads a node renamed and edited as removed and added', () => {
    const b = renamed();
    node(b, 'count').code = 'return { n: 0 };';
    expect(diffAutomationDocuments(base(), b).counts).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      renamed: 0,
    });
  });

  it('follows two renames where one node reads the other', () => {
    const b = edited((doc) => {
      node(doc, 'fetch').id = 'list';
      node(doc, 'score').id = 'count';
      node(doc, 'count').input = { items: '{{ nodes.list.output.messages }}' };
      node(doc, 'reply').when = '{{ nodes.count.output.n > 0 }}';
      node(doc, 'reply').prompt = 'Answer {{ nodes.count.output.n }} messages.';
      doc.output = { count: '{{ nodes.count.output.n }}' };
    });
    const diff = diffAutomationDocuments(base(), b);
    expect(diff.counts).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      renamed: 2,
    });
    expect(brief(diff)).toEqual([
      { id: 'list', kind: 'renamed', from: 'fetch', fields: [] },
      { id: 'count', kind: 'renamed', from: 'score', fields: ['input'] },
      { id: 'reply', kind: 'changed', fields: ['when', 'prompt'] },
    ]);
    expect(diff.nodes[1]?.fields[0]?.referencesOnly).toEqual([
      { from: 'fetch', to: 'list' },
    ]);
  });

  it('follows elseOf to the new id', () => {
    const a = edited((doc) => {
      nodesOf(doc).push({
        id: 'skip',
        type: 'transform',
        elseOf: 'reply',
        code: 'return 0;',
      });
    });
    const b = edited((doc) => {
      node(doc, 'reply').id = 'answer';
      nodesOf(doc).push({
        id: 'skip',
        type: 'transform',
        elseOf: 'answer',
        code: 'return 0;',
      });
    });
    const diff = diffAutomationDocuments(a, b);
    expect(brief(diff)).toEqual([
      { id: 'answer', kind: 'renamed', from: 'reply', fields: [] },
      { id: 'skip', kind: 'changed', fields: ['elseOf'] },
    ]);
    expect(diff.nodes[1]?.referencesOnly).toBe(true);
  });

  it('never rewrites a mention that is not a reference', () => {
    const a = edited((doc) => {
      node(doc, 'reply').prompt =
        'See nodes.score in {{ nodes.score.output.n }}';
    });
    const b = edited((doc) => {
      node(doc, 'score').id = 'count';
      // The plain text outside the template follows too: that is an edit.
      node(doc, 'reply').prompt =
        'See nodes.count in {{ nodes.count.output.n }}';
      node(doc, 'reply').when = '{{ nodes.count.output.n > 0 }}';
      doc.output = { count: '{{ nodes.count.output.n }}' };
    });
    const reply = diffAutomationDocuments(a, b).nodes[1];
    expect(reply?.id).toBe('reply');
    expect(reply?.referencesOnly).toBeUndefined();
    expect(
      reply?.fields.find((each) => each.field === 'prompt')?.referencesOnly,
    ).toBeUndefined();
  });

  it('can be turned off', () => {
    expect(
      diffAutomationDocuments(base(), renamed(), { detectRenames: false })
        .counts,
    ).toEqual({ added: 1, removed: 1, changed: 1, renamed: 0 });
  });
});

describe('properties over the shipped documents', () => {
  const documents = shippedDocuments();
  const random = seeded(20_261_009);

  /** A copy of `doc` with one random edit. */
  function mutate(doc: Doc): Doc {
    const copy = structuredClone(doc);
    const nodes = nodesOf(copy);
    const roll = random();
    const at = Math.floor(random() * nodes.length);
    const target = nodes[at];
    if (target === undefined) return copy;
    if (roll < 0.25) nodes.splice(at, 1);
    else if (roll < 0.5) {
      nodes.splice(at, 0, {
        id: `extra_${at}`,
        type: 'transform',
        code: 'return 1;',
      });
    } else if (roll < 0.75) {
      const keys = Object.keys(target).filter((key) => key !== 'id');
      const key = keys[Math.floor(random() * keys.length)] ?? 'note';
      target[key] = randomJson(random);
    } else {
      copy.output = randomJson(random);
    }
    return copy;
  }

  it('is deterministic and symmetric for random edits', () => {
    for (const { document } of documents) {
      for (let round = 0; round < 8; round += 1) {
        const other = mutate(document);
        const forward = diffAutomationDocuments(document, other);
        expect(diffAutomationDocuments(document, other)).toEqual(forward);
        const backward = diffAutomationDocuments(other, document);
        expect({
          added: backward.counts.removed,
          removed: backward.counts.added,
          changed: backward.counts.changed,
          renamed: backward.counts.renamed,
        }).toEqual(forward.counts);
        expect(backward.identical).toBe(forward.identical);
      }
    }
  });
});
