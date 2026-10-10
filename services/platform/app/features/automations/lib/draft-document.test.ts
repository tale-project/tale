import { describe, expect, it } from 'vitest';

import { readDocument } from './document';
import {
  applyDocumentPatch,
  applyNodePatch,
  rawDocumentOf,
  type RawDocument,
} from './draft-document';

/**
 * The draft is the stored document, raw. These tests pin what an inspector
 * edit must never do to the parts of a document it does not touch: drop a
 * key this build has no control for, a node it cannot draw, the tests or
 * the canvas metadata.
 */

const stored: RawDocument = {
  version: 1,
  name: 'ops/post-summary',
  description: 'Posts the day in one line.',
  inputs: {
    type: 'object',
    properties: { day: { type: 'string' } },
    required: ['day'],
  },
  nodes: [
    {
      id: 'summary',
      type: 'llm',
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Summarize {{ input.day }}',
    },
    {
      id: 'post',
      type: 'slack.post_message',
      credential: 'slack-ops',
      input: { channel: '#ops', text: '{{ nodes.summary.output.text }}' },
      reviewNote: 'kept by a newer engine',
    },
    { id: 'draft_only', prompt: 'no type yet' },
  ],
  output: { posted: '{{ nodes.post.output.ok }}' },
  tests: [{ name: 'smoke', expect: { output: { posted: true } } }],
  ui: { positions: { summary: { x: 0, y: 0 }, post: { x: 0, y: 0 } } },
  owner: 'a top-level key the validator reports',
};

describe('applyNodePatch', () => {
  const edited = applyNodePatch(stored, 'summary', { prompt: 'Shorter.' });

  it('patches the node it names and nothing else', () => {
    expect(edited.nodes).toEqual([
      {
        id: 'summary',
        type: 'llm',
        model: 'anthropic/claude-haiku-4-5',
        prompt: 'Shorter.',
      },
      (stored.nodes as unknown[])[1],
      (stored.nodes as unknown[])[2],
    ]);
  });

  it("keeps a connector's credential and a key this build does not know", () => {
    const patched = applyNodePatch(stored, 'post', {
      input: { channel: '#ops-daily', text: 'hi' },
    });
    expect((patched.nodes as unknown[])[1]).toEqual({
      id: 'post',
      type: 'slack.post_message',
      credential: 'slack-ops',
      input: { channel: '#ops-daily', text: 'hi' },
      reviewNote: 'kept by a newer engine',
    });
  });

  it('keeps a node without a type, the tests, ui and unknown top-level keys byte for byte', () => {
    const { nodes: _nodes, ...rest } = edited;
    const { nodes: _storedNodes, ...storedRest } = stored;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(storedRest));
    expect((edited.nodes as unknown[])[2]).toBe((stored.nodes as unknown[])[2]);
    expect(edited.tests).toBe(stored.tests);
    expect(edited.ui).toBe(stored.ui);
  });

  it('removes a key patched to undefined, whatever the key', () => {
    const cleared = applyNodePatch(stored, 'post', {
      credential: undefined,
      reviewNote: undefined,
    });
    expect((cleared.nodes as unknown[])[1]).toEqual({
      id: 'post',
      type: 'slack.post_message',
      input: { channel: '#ops', text: '{{ nodes.summary.output.text }}' },
    });
  });

  it('patches the first node of a repeated id, as both executors run it', () => {
    const doubled: RawDocument = {
      name: 'a',
      nodes: [
        { id: 'x', type: 'transform', code: 'return 1;' },
        { id: 'x', type: 'transform', code: 'return 2;' },
      ],
    };
    expect(applyNodePatch(doubled, 'x', { code: 'return 3;' }).nodes).toEqual([
      { id: 'x', type: 'transform', code: 'return 3;' },
      { id: 'x', type: 'transform', code: 'return 2;' },
    ]);
  });

  it('answers the same document for an id it does not have', () => {
    expect(applyNodePatch(stored, 'missing', { prompt: 'x' })).toBe(stored);
    expect(applyNodePatch({ name: 'a' }, 'x', { prompt: 'x' })).toEqual({
      name: 'a',
    });
  });

  it('never changes the document it was given', () => {
    const before = JSON.stringify(stored);
    applyNodePatch(stored, 'summary', { prompt: 'changed', model: undefined });
    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe('applyDocumentPatch', () => {
  it('sets the run input schema and the output', () => {
    const patched = applyDocumentPatch(stored, {
      inputs: { type: 'object' },
      output: '{{ nodes.post.output }}',
    });
    expect(patched.inputs).toEqual({ type: 'object' });
    expect(patched.output).toBe('{{ nodes.post.output }}');
    expect(patched.nodes).toBe(stored.nodes);
    expect(patched.owner).toBe(stored.owner);
  });

  it('removes a field patched to undefined and leaves one it does not name', () => {
    const patched = applyDocumentPatch(stored, { output: undefined });
    expect('output' in patched).toBe(false);
    expect(patched.inputs).toBe(stored.inputs);
  });
});

describe('the reading view of a raw draft', () => {
  it('reads the patched draft with every key the view does not narrow', () => {
    const view = readDocument(
      applyNodePatch(stored, 'summary', { prompt: 'Shorter.' }),
    );
    expect(view?.nodes.map((node) => [node.id, node.type])).toEqual([
      ['summary', 'llm'],
      ['post', 'slack.post_message'],
      ['draft_only', ''],
    ]);
    expect(view?.nodes[1]).toMatchObject({ credential: 'slack-ops' });
  });
});

describe('rawDocumentOf', () => {
  it('is the stored object itself, or null when it is not one', () => {
    expect(rawDocumentOf(stored)).toBe(stored);
    expect(rawDocumentOf(null)).toBeNull();
    expect(rawDocumentOf([])).toBeNull();
    expect(rawDocumentOf('yaml')).toBeNull();
  });
});
