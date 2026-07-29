import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { execute, nodeTypes, setCodeRunner, validate } from '../engine';
import { nodeVmRunner } from '../engine/runners/node-vm';
import {
  KNOWLEDGE_SEARCH_NODE_TYPE,
  registerKnowledgeSearchNode,
  setKnowledgeSearchBackend,
  toNodeOutput,
} from './search-node';
import type { KnowledgeResult } from './types';

/**
 * The node has to behave like any other capability the engine knows: a workflow
 * that uses it validates, runs, and produces the same shape whether the answer
 * came from a real corpus or from the mock. That last part is what makes the
 * authoring loop work with no database at all, so it is what these tests are
 * mostly about.
 *
 * Nothing here reaches a corpus. The live backend is a double, and the default
 * — no backend installed — is exercised too.
 */

const WORKFLOW = {
  version: 1,
  name: 'answer-from-knowledge',
  inputs: {
    type: 'object',
    properties: { question: { type: 'string' } },
    required: ['question'],
  },
  nodes: [
    {
      id: 'lookup',
      type: KNOWLEDGE_SEARCH_NODE_TYPE,
      input: { query: '{{ input.question }}', corpus: 'documents', limit: 3 },
    },
    {
      id: 'summarize',
      type: 'transform',
      input: { hits: '{{ nodes.lookup.output.hits }}' },
      code: 'return { titles: input.hits.map(h => h.title) };',
    },
  ],
  output: {
    found: '{{ nodes.lookup.output.count }}',
    titles: '{{ nodes.summarize.output.titles }}',
  },
};

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerKnowledgeSearchNode();
});

afterEach(() => {
  setKnowledgeSearchBackend(null);
});

describe('registration', () => {
  it('joins the engine node-type table', () => {
    const def = nodeTypes().get(KNOWLEDGE_SEARCH_NODE_TYPE);
    expect(def).toBeDefined();
    expect(def?.outputKind).toBe('structured');
  });

  it('records no effect, because searching changes nothing', () => {
    // A read-only node must never be gated behind an approval or counted as a
    // side effect of a run.
    expect(
      nodeTypes().get(KNOWLEDGE_SEARCH_NODE_TYPE)?.connector?.hasEffect,
    ).toBe(false);
  });

  it('can be registered twice without complaint', () => {
    registerKnowledgeSearchNode();
    expect(nodeTypes().has(KNOWLEDGE_SEARCH_NODE_TYPE)).toBe(true);
  });
});

describe('validation', () => {
  it('accepts a workflow that uses the node', async () => {
    const { errors } = await validate(WORKFLOW);
    expect(errors).toEqual([]);
  });

  it('refuses a search with no query', async () => {
    const result = await execute(
      {
        ...WORKFLOW,
        nodes: [
          {
            id: 'lookup',
            type: KNOWLEDGE_SEARCH_NODE_TYPE,
            input: { corpus: 'documents' },
          },
        ],
        output: { count: '{{ nodes.lookup.output.count }}' },
      },
      { input: { question: 'anything' } },
    );
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/query/);
  });

  it('refuses a corpus it does not have', async () => {
    const result = await execute(
      {
        ...WORKFLOW,
        nodes: [
          {
            id: 'lookup',
            type: KNOWLEDGE_SEARCH_NODE_TYPE,
            input: { query: 'x', corpus: 'everything' },
          },
        ],
        output: { count: '{{ nodes.lookup.output.count }}' },
      },
      { input: { question: 'anything' } },
    );
    expect(result.status).toBe('error');
  });
});

describe('the mock keeps the authoring loop working without a database', () => {
  it('runs a whole workflow end to end', async () => {
    const result = await execute(WORKFLOW, {
      input: { question: 'what is the parental leave policy' },
    });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({
      found: 1,
      titles: ['Example document'],
    });
  });

  it('is deterministic, so an acceptance test can state the expected output', async () => {
    const once = await execute(WORKFLOW, { input: { question: 'same words' } });
    const twice = await execute(WORKFLOW, {
      input: { question: 'same words' },
    });
    expect(once.output).toEqual(twice.output);
  });

  it('answers in the shape a real search answers', async () => {
    const result = await execute(
      {
        ...WORKFLOW,
        nodes: [
          {
            id: 'lookup',
            type: KNOWLEDGE_SEARCH_NODE_TYPE,
            input: { query: 'anything' },
          },
        ],
        output: { hits: '{{ nodes.lookup.output.hits }}' },
      },
      { input: { question: 'q' } },
    );
    expect(result.status).toBe('success');
    const output = result.output as { hits: { corpus: string }[] };
    expect(output.hits.map((entry) => entry.corpus)).toEqual([
      'documents',
      'web',
    ]);
  });

  it('says its passages are placeholders, so a mock run cannot pass for a real one', async () => {
    const result = await execute(
      {
        ...WORKFLOW,
        nodes: [
          {
            id: 'lookup',
            type: KNOWLEDGE_SEARCH_NODE_TYPE,
            input: { query: 'salary bands' },
          },
        ],
        output: { text: '{{ nodes.lookup.output.hits[0].text }}' },
      },
      { input: { question: 'q' } },
    );
    expect((result.output as { text: string }).text).toContain('mock');
  });

  it('records no effect for a run that searched', async () => {
    const result = await execute(WORKFLOW, { input: { question: 'q' } });
    expect(result.effects).toEqual([]);
  });
});

describe('the live backend', () => {
  const answer: KnowledgeResult = {
    hits: [
      {
        id: '1',
        corpus: 'documents',
        text: 'Parental leave is 16 weeks.',
        chunkIndex: 4,
        source: { ref: 'handbook.pdf', title: 'Handbook', url: null },
        score: 0.8,
        fusedScore: 0.91,
      },
    ],
    diagnostics: { bm25: true, reranked: false, cached: false, legs: {} },
  };

  it('is used when installed, and its answer keeps the declared shape', async () => {
    setKnowledgeSearchBackend({ search: () => Promise.resolve(answer) });
    const result = await execute(WORKFLOW, {
      input: { question: 'parental leave' },
      mode: 'live',
      connectorHost: () => ({
        config: {},
        http: {
          get: () => Promise.reject(new Error('a search makes no HTTP call')),
          post: () => Promise.reject(new Error('a search makes no HTTP call')),
          put: () => Promise.reject(new Error('a search makes no HTTP call')),
          patch: () => Promise.reject(new Error('a search makes no HTTP call')),
          delete: () =>
            Promise.reject(new Error('a search makes no HTTP call')),
        },
        base64Encode: (value: string) => Buffer.from(value).toString('base64'),
        base64Decode: (value: string) =>
          Buffer.from(value, 'base64').toString('utf8'),
      }),
    });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ found: 1, titles: ['Handbook'] });
  });

  it('refuses a live run rather than fabricating one when nothing is installed', async () => {
    const result = await execute(WORKFLOW, {
      input: { question: 'parental leave' },
      mode: 'live',
      connectorHost: () => ({
        config: {},
        http: {
          get: () => Promise.reject(new Error('unused')),
          post: () => Promise.reject(new Error('unused')),
          put: () => Promise.reject(new Error('unused')),
          patch: () => Promise.reject(new Error('unused')),
          delete: () => Promise.reject(new Error('unused')),
        },
        base64Encode: (value: string) => Buffer.from(value).toString('base64'),
        base64Decode: (value: string) =>
          Buffer.from(value, 'base64').toString('utf8'),
      }),
    });
    expect(result.status).toBe('error');
    expect(result.error?.message).toMatch(/no knowledge backend/);
  });
});

describe('the node output', () => {
  it('reports a degraded search so a workflow can tell', () => {
    const degraded = toNodeOutput({
      hits: [],
      diagnostics: { bm25: false, reranked: false, cached: false, legs: {} },
    });
    expect(degraded.fullText).toBe(false);
    expect(degraded.count).toBe(0);
  });

  it('prefers a rerank score over the fused one when both are present', () => {
    const output = toNodeOutput({
      hits: [
        {
          id: '1',
          corpus: 'documents',
          text: 'x',
          chunkIndex: 0,
          source: { ref: 'a', title: null },
          score: 1,
          fusedScore: 0.4,
          rerankScore: 0.95,
        },
      ],
      diagnostics: { bm25: true, reranked: true, cached: false, legs: {} },
    });
    expect(output.hits[0].score).toBe(0.95);
  });
});
