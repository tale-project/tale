import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '@/lib/engine/core/types';
import type { TypesView } from '@/lib/shared/schemas/automation-issues';

import {
  automationCompletion,
  automationHover,
  referableNodes,
  type CodeAssistScope,
} from './code-providers';

/**
 * Completion and hover read the document and the check's shapes the way
 * the engine scopes a field: these tests pin which names each field sees,
 * which nodes it may reference, and the members and kinds it offers.
 */

const fetch: NodeDef = {
  id: 'fetch',
  type: 'github.list_issues',
  input: { repo: '{{ input.repo }}' },
};
const score: NodeDef = {
  id: 'score',
  type: 'llm',
  forEach: '{{ nodes.fetch.output.issues }}',
  prompt: 'Score {{ item.title }}',
};
const report: NodeDef = {
  id: 'report',
  type: 'transform',
  input: { scores: '{{ nodes.score.output }}' },
  code: 'return { count: input.scores.length };',
};
const unrelated: NodeDef = {
  id: 'audit',
  type: 'transform',
  code: 'return 1;',
};
const poll: NodeDef = {
  id: 'poll',
  type: 'transform',
  code: 'return { done: true };',
  repeatUntil: '{{ output.done }}',
};

const doc: Automation = {
  name: 'github/triage',
  nodes: [report, score, fetch, unrelated, poll],
};

const issue = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'The issue title.' },
    labels: { type: 'array' as const, items: { type: 'string' as const } },
    assignee: { type: 'string' as const },
  },
  required: ['title', 'labels'],
};

const types: TypesView = {
  inputs: {
    type: 'object',
    properties: { repo: { type: 'string' }, limit: { type: 'number' } },
    required: ['repo'],
  },
  nodes: {
    fetch: {
      output: {
        type: 'object',
        properties: { issues: { type: 'array', items: issue } },
        required: ['issues'],
      },
    },
    score: {
      output: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
      item: issue,
    },
    report: {
      output: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
      },
      input: {
        type: 'object',
        properties: { scores: { type: 'array', items: {} } },
        required: ['scores'],
      },
    },
    poll: {
      output: {
        type: 'object',
        properties: { done: { type: 'boolean' } },
        required: ['done'],
      },
    },
  },
  output: {},
};

function scope(
  node: NodeDef | undefined,
  field: CodeAssistScope['field'],
  extra: Partial<CodeAssistScope> = {},
): CodeAssistScope {
  return { doc, ...(node !== undefined && { node }), field, types, ...extra };
}

function labels(
  s: CodeAssistScope,
  path: readonly (string | number)[] | null,
  region: 'code' | 'template' | 'string' | 'key' = 'template',
): string[] | null {
  const result = automationCompletion(s, { region, path });
  return result === null ? null : result.items.map((item) => item.label);
}

describe('the names a field sees', () => {
  it('offers input and nodes in a template, and item and index under forEach', () => {
    expect(labels(scope(fetch, 'input'), [])).toEqual(['input', 'nodes']);
    expect(labels(scope(score, 'prompt'), [])).toEqual([
      'input',
      'nodes',
      'item',
      'index',
    ]);
  });

  it('never offers item in a condition or in forEach itself', () => {
    const conditional = { ...score, when: '{{ true }}' };
    expect(labels(scope(conditional, 'when'), [])).toEqual(['input', 'nodes']);
    expect(labels(scope(score, 'forEach'), [])).toEqual(['input', 'nodes']);
  });

  it('offers the pass result in repeatUntil', () => {
    expect(labels(scope(poll, 'repeatUntil'), [])).toContain('output');
    expect(labels(scope(poll, 'repeatUntil'), ['output'])).toEqual(['done']);
  });

  it('declares input, nodes, item and index in transform code, as the runtime does', () => {
    expect(labels(scope(report, 'code'), [], 'code')).toEqual([
      'input',
      'nodes',
      'item',
      'index',
    ]);
  });

  it('offers nothing outside an expression', () => {
    expect(labels(scope(fetch, 'input'), [], 'string')).toBeNull();
    expect(labels(scope(fetch, 'input'), [], 'key')).toBeNull();
    expect(labels(scope(fetch, 'input'), null)).toBeNull();
    expect(labels(scope(fetch, 'input'), ['window'])).toBeNull();
  });
});

describe('the nodes a field may reference', () => {
  it('offers only the nodes that run before it, in run order', () => {
    expect(labels(scope(report, 'code'), ['nodes'], 'code')).toEqual([
      'fetch',
      'score',
    ]);
    expect(labels(scope(score, 'prompt'), ['nodes'])).toEqual(['fetch']);
    expect(labels(scope(fetch, 'input'), ['nodes'])).toEqual([]);
  });

  it('never offers the node itself or a node that reads it', () => {
    const offered = labels(scope(score, 'prompt'), ['nodes']) ?? [];
    expect(offered).not.toContain('score');
    expect(offered).not.toContain('report');
  });

  it('lets the document output read every node', () => {
    expect(referableNodes(doc, undefined).map((node) => node.id)).toEqual(
      expect.arrayContaining(['fetch', 'score', 'report', 'audit', 'poll']),
    );
  });

  it('names each node by its title and its output type', () => {
    const result = automationCompletion(scope(report, 'code'), {
      region: 'code',
      path: ['nodes'],
    });
    expect(result?.items[0]).toMatchObject({
      label: 'fetch',
      kind: 'node',
      detail: 'Fetch',
      info: { type: expect.stringContaining('issues') },
    });
  });

  it('reads a node through its output and nothing else', () => {
    expect(labels(scope(report, 'code'), ['nodes', 'fetch'], 'code')).toEqual([
      'output',
    ]);
    expect(
      labels(scope(report, 'code'), ['nodes', 'fetch', 'input'], 'code'),
    ).toBeNull();
    expect(
      labels(scope(fetch, 'input'), ['nodes', 'report', 'output']),
    ).toBeNull();
  });
});

describe('members', () => {
  it('lists the fields of a value with their kinds and whether they may be missing', () => {
    const result = automationCompletion(scope(score, 'prompt'), {
      region: 'template',
      path: ['item'],
    });
    expect(result?.items).toEqual([
      expect.objectContaining({
        label: 'title',
        valueType: 'string',
        optional: false,
        detail: 'string',
        info: expect.objectContaining({ description: 'The issue title.' }),
      }),
      expect.objectContaining({
        label: 'labels',
        valueType: 'array',
        optional: false,
        detail: 'Array<string>',
      }),
      expect.objectContaining({
        label: 'assignee',
        valueType: 'string',
        optional: true,
      }),
    ]);
  });

  it('walks a node output path, through a list', () => {
    expect(
      labels(scope(report, 'code'), ['nodes', 'fetch', 'output'], 'code'),
    ).toEqual(['issues']);
    expect(
      labels(
        scope(report, 'code'),
        ['nodes', 'fetch', 'output', 'issues'],
        'code',
      ),
    ).toEqual(['length']);
    expect(
      labels(
        scope(report, 'code'),
        ['nodes', 'fetch', 'output', 'issues', 0],
        'code',
      ),
    ).toEqual(['title', 'labels', 'assignee']);
  });

  it("reads transform code's input as its own input mapping", () => {
    expect(labels(scope(report, 'code'), ['input'], 'code')).toEqual([
      'scores',
    ]);
    expect(labels(scope(fetch, 'input'), ['input'])).toEqual(['repo', 'limit']);
  });

  it('adds what the last run recorded, shortened', () => {
    const result = automationCompletion(
      scope(report, 'code', {
        sampleOf: (id) =>
          id === 'fetch'
            ? { issues: [{ title: 'x'.repeat(200), labels: [] }] }
            : undefined,
      }),
      { region: 'code', path: ['nodes', 'fetch', 'output', 'issues', 0] },
    );
    const sample = result?.items[0]?.info?.sample ?? '';
    expect(sample.startsWith('"xxx')).toBe(true);
    expect(sample.length).toBe(80);
    expect(sample.endsWith('…')).toBe(true);
  });

  it('offers nothing until the check worked out the shapes', () => {
    expect(
      labels(
        scope(report, 'code', { types: null }),
        ['nodes', 'fetch', 'output'],
        'code',
      ),
    ).toEqual([]);
    expect(
      labels(scope(score, 'prompt', { types: null }), ['item']),
    ).toBeNull();
  });
});

describe('hover', () => {
  it('says what a path holds, as a type, with its description', () => {
    expect(
      automationHover(scope(score, 'prompt'), {
        region: 'template',
        path: ['item', 'title'],
      }),
    ).toEqual({
      title: 'item.title',
      type: 'string',
      description: 'The issue title.',
    });
    expect(
      automationHover(scope(report, 'code'), {
        region: 'code',
        path: ['nodes', 'fetch', 'output', 'issues'],
      }),
    ).toMatchObject({
      title: 'nodes.fetch.output.issues',
      type: expect.stringMatching(/^Array<\{ title: string/),
    });
  });

  it('names a node by its title', () => {
    expect(
      automationHover(scope(report, 'code'), {
        region: 'code',
        path: ['nodes', 'fetch'],
      }),
    ).toMatchObject({
      title: 'Fetch',
      type: expect.stringContaining('output'),
    });
  });

  it('says nothing about a name the field cannot read or a missing member', () => {
    expect(
      automationHover(scope(score, 'forEach'), {
        region: 'template',
        path: ['item'],
      }),
    ).toBeNull();
    expect(
      automationHover(scope(score, 'prompt'), {
        region: 'template',
        path: ['item', 'nope'],
      }),
    ).toBeNull();
    expect(
      automationHover(scope(score, 'prompt'), { region: 'text', path: null }),
    ).toBeNull();
  });
});
