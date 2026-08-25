import { describe, expect, it } from 'vitest';

import { DOC_EXAMPLE } from '@/lib/engine/api/docs';

import { readDocument, readPositions } from './document';

/**
 * A stored document arrives as `v.any()`. These tests pin the narrowing to the
 * two things that matter: a good document survives it intact, and a damaged one
 * still yields whatever can honestly be drawn instead of failing the page.
 */

describe('readDocument', () => {
  it('round-trips the engine worked example', () => {
    const automation = readDocument(DOC_EXAMPLE.automation);
    expect(automation?.name).toBe('order-report');
    expect(automation?.nodes.map((node) => node.id)).toEqual([
      'calc',
      'summary',
      'summary_empty',
    ]);
    expect(automation?.nodes[1].when).toBe('{{ nodes.calc.output.count > 0 }}');
    expect(automation?.nodes[1].model).toBe('anthropic/claude-haiku-4-5');
  });

  it('is null only when the value is not an object at all', () => {
    expect(readDocument('not a document')).toBeNull();
    expect(readDocument(null)).toBeNull();
    expect(readDocument({})).toEqual({ name: '', nodes: [] });
  });

  it('drops a node that cannot be drawn instead of rendering a blank box', () => {
    const automation = readDocument({
      name: 'partial',
      nodes: [
        { id: 'ok', type: 'transform', code: 'return 1;' },
        { type: 'transform' },
        { id: 'no_type' },
        'nonsense',
      ],
    });
    expect(automation?.nodes.map((node) => node.id)).toEqual(['ok']);
  });

  it('keeps only the control-flow values the engine would accept', () => {
    const automation = readDocument({
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
    expect(automation?.nodes[0]).toEqual({ id: 'n', type: 'transform' });
  });

  it('round-trips an agent node with its equipment', () => {
    // The wizard writes harness/skills/connectors/tools/secrets/files and the
    // model picker writes the (model, modelProvider) pair onto the agent node;
    // the canvas reads THIS document and a later prompt edit saves it back, so
    // dropping any of these here loses the grant — or the provider pin — on
    // first save.
    const node = {
      id: 'agent',
      type: 'agent',
      prompt: 'do the thing',
      harness: 'claude-code',
      model: 'claude-fable-5',
      modelProvider: 'anthropic',
      skills: ['docx', 'pdf'],
      connectors: ['github'],
      tools: ['task_create', 'document_create'],
      secrets: ['GLITCHTIP_TOKEN'],
      files: { 'brief.md': { content: 'hi' } },
    };
    const automation = readDocument({ name: 'a', nodes: [node] });
    expect(automation?.nodes[0]).toEqual(node);
  });

  it('drops non-string members of equipment lists, never guesses', () => {
    const automation = readDocument({
      name: 'a',
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          skills: ['docx', 7, null, 'pdf'],
          tools: 'not-an-array',
        },
      ],
    });
    expect(automation?.nodes[0]).toEqual({
      id: 'agent',
      type: 'agent',
      skills: ['docx', 'pdf'],
    });
  });
});

describe('readPositions', () => {
  it('reads hand-placed positions from the canvas metadata', () => {
    const automation = readDocument({
      name: 'a',
      nodes: [{ id: 'n', type: 'transform', code: 'return 1;' }],
      ui: { positions: { n: { x: 10, y: 20 }, bad: { x: 'left' } } },
    });
    expect(readPositions(automation)).toEqual({ n: { x: 10, y: 20 } });
  });

  it('reads no positions from a document that placed none', () => {
    expect(readPositions(readDocument(DOC_EXAMPLE.automation))).toEqual({});
  });
});
