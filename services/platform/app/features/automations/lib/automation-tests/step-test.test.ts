import { describe, expect, it } from 'vitest';

import type { Automation } from '@/lib/engine/core/types';

import { recalledPins, rememberPins, stepTestNeeds } from './step-test';

const DOC: Pick<Automation, 'nodes'> = {
  nodes: [
    { id: 'fetch', type: 'http.get', input: { url: '{{ input.url }}' } },
    {
      id: 'rates',
      type: 'transform',
      code: 'return { chf: 1 };',
    },
    {
      id: 'score',
      type: 'llm',
      when: '{{ nodes.rates.output.chf > 0 }}',
      forEach: '{{ nodes.fetch.output.items }}',
      prompt: 'Score {{ item.title }}',
    },
    {
      id: 'shape',
      type: 'transform',
      input: { scores: '{{ nodes.score.output }}' },
      // A code step's own `input` is its resolved input, not the run's.
      code: 'return input.scores;',
    },
    { id: 'quiet', type: 'transform', elseOf: 'score', code: 'return null;' },
  ],
};

describe('what testing one node alone needs', () => {
  it('asks for data for each node it reads, its conditions included', () => {
    expect(stepTestNeeds(DOC, 'score')).toMatchObject({
      reads: ['fetch', 'rates'],
      readsInput: false,
      perItem: true,
    });
  });

  it('asks for the run input only when a template reads it', () => {
    expect(stepTestNeeds(DOC, 'fetch')).toMatchObject({
      reads: [],
      readsInput: true,
      perItem: false,
    });
    expect(stepTestNeeds(DOC, 'shape')).toMatchObject({
      reads: ['score'],
      readsInput: false,
    });
  });

  it('leaves out the else partner, and knows no node the document lacks', () => {
    expect(stepTestNeeds(DOC, 'quiet')?.reads).toEqual([]);
    expect(stepTestNeeds(DOC, 'missing')).toBeNull();
  });

  it('keeps the data a node was tested with for the session', () => {
    expect(recalledPins('org/flow/score')).toBeUndefined();
    rememberPins('org/flow/score', {
      pins: { fetch: { items: [] } },
      input: {},
      item: 2,
    });
    expect(recalledPins('org/flow/score')).toEqual({
      pins: { fetch: { items: [] } },
      input: {},
      item: 2,
    });
  });
});
