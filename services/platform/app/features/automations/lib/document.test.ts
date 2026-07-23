import { describe, expect, it } from 'vitest';

import { DOC_EXAMPLE } from '@/lib/engine/api/docs';

import {
  readDocument,
  readPositions,
  readReviewNotes,
  reviewNotesByNode,
} from './document';

/**
 * A stored document arrives as `v.any()`. These tests pin the narrowing to the
 * two things that matter: a good document survives it intact, and a damaged one
 * still yields whatever can honestly be drawn instead of failing the page.
 */

describe('readDocument', () => {
  it('round-trips the engine worked example', () => {
    const workflow = readDocument(DOC_EXAMPLE.workflow);
    expect(workflow?.name).toBe('order-report');
    expect(workflow?.nodes.map((node) => node.id)).toEqual([
      'calc',
      'summary',
      'summary_empty',
    ]);
    expect(workflow?.nodes[1].when).toBe('{{ nodes.calc.output.count > 0 }}');
    expect(workflow?.nodes[1].model).toBe('anthropic/claude-haiku-4-5');
  });

  it('is null only when the value is not an object at all', () => {
    expect(readDocument('not a document')).toBeNull();
    expect(readDocument(null)).toBeNull();
    expect(readDocument({})).toEqual({ name: '', nodes: [] });
  });

  it('drops a node that cannot be drawn instead of rendering a blank box', () => {
    const workflow = readDocument({
      name: 'partial',
      nodes: [
        { id: 'ok', type: 'transform', code: 'return 1;' },
        { type: 'transform' },
        { id: 'no_type' },
        'nonsense',
      ],
    });
    expect(workflow?.nodes.map((node) => node.id)).toEqual(['ok']);
  });

  it('keeps only the control-flow values the engine would accept', () => {
    const workflow = readDocument({
      name: 'a',
      nodes: [
        {
          id: 'n',
          type: 'transform',
          onError: 'shrug',
          maxRepeats: 'many',
          when: 5,
        },
      ],
    });
    expect(workflow?.nodes[0]).toEqual({ id: 'n', type: 'transform' });
  });
});

describe('readPositions', () => {
  it('reads hand-placed positions from the canvas metadata', () => {
    const workflow = readDocument({
      name: 'a',
      nodes: [{ id: 'n', type: 'transform', code: 'return 1;' }],
      ui: { positions: { n: { x: 10, y: 20 }, bad: { x: 'left' } } },
    });
    expect(readPositions(workflow)).toEqual({ n: { x: 10, y: 20 } });
  });

  it('reads no positions from a document that placed none', () => {
    expect(readPositions(readDocument(DOC_EXAMPLE.workflow))).toEqual({});
  });
});

describe('readReviewNotes', () => {
  it('reads the converter notes a document carries', () => {
    const workflow = readDocument({
      name: 'a',
      nodes: [{ id: 'n', type: 'transform', code: 'return 1;' }],
      ui: {
        needsReview: [
          { node: 'n', reason: 'the model was chosen for you' },
          { node: 'n', reason: 'a per-item branch could not be flattened' },
          { reason: 'no node named' },
        ],
      },
    });
    const notes = readReviewNotes(workflow);
    expect(notes).toHaveLength(2);
    expect(reviewNotesByNode(notes).get('n')).toHaveLength(2);
  });

  it('reports no flagged node when the document carries none', () => {
    expect(readReviewNotes(readDocument(DOC_EXAMPLE.workflow))).toEqual([]);
  });
});
