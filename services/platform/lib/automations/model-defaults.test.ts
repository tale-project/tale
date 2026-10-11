import { describe, expect, it } from 'vitest';

import type { ChatChoiceEntry } from '../chat/model-choice';
import {
  applyModelDefaults,
  llmModelSteps,
  modelBandOf,
  modelDefaultsMessage,
  pickReplacementModel,
} from './model-defaults';

/** A chat model a provider serves, priced per million output tokens. */
function served(
  id: string,
  provider: string,
  outputCents = 100,
): ChatChoiceEntry {
  return {
    id,
    provider,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    pricing: { inputCentsPerMillion: 10, outputCentsPerMillion: outputCents },
  };
}

const DOCUMENT = {
  version: 1,
  name: 'github/triage-issues',
  nodes: [
    { id: 'fetch', type: 'transform', code: 'return {}' },
    { id: 'score', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
    { id: 'pick', type: 'llm', model: '{{ input.model }}' },
    { id: 'agent', type: 'agent', model: 'anthropic/claude-haiku-4-5' },
    { id: 'again', type: 'llm', model: 'anthropic/claude-haiku-4-5' },
  ],
};

describe('the band of a known model', () => {
  it.each([
    ['anthropic/claude-haiku-4-5', 'draft'],
    ['claude-sonnet-5', 'standard'],
    ['claude-fable-5-1', 'frontier'],
    ['some-unknown-model', undefined],
  ])('reads %s as %s', (model, band) => {
    expect(modelBandOf(model)).toBe(band);
  });
});

describe('the llm steps that name a model', () => {
  it('lists only literal models of llm steps', () => {
    expect(llmModelSteps(DOCUMENT)).toEqual([
      { index: 1, nodeId: 'score', model: 'anthropic/claude-haiku-4-5' },
      { index: 4, nodeId: 'again', model: 'anthropic/claude-haiku-4-5' },
    ]);
    expect(llmModelSteps(null)).toEqual([]);
  });
});

describe('the model a step uses instead', () => {
  const pool = [
    served('gpt-5.6-luna-pro', 'openai', 900),
    served('gemini-3.5-flash-lite', 'google', 40),
    served('mystery-small', 'acme', 5),
  ];

  it("picks the curated model of the declared model's band", () => {
    expect(pickReplacementModel('anthropic/claude-haiku-4-5', pool)?.id).toBe(
      'gemini-3.5-flash-lite',
    );
  });

  it('honours a band the document gives', () => {
    expect(
      pickReplacementModel('anthropic/claude-haiku-4-5', pool, 'standard')?.id,
    ).toBe('gpt-5.6-luna-pro');
  });

  it('falls back to the cheapest servable model when no curated one is served', () => {
    expect(
      pickReplacementModel('anthropic/claude-haiku-4-5', [
        served('mystery-large', 'acme', 900),
        served('mystery-small', 'acme', 5),
      ])?.id,
    ).toBe('mystery-small');
  });

  it('picks nothing from nothing servable', () => {
    expect(pickReplacementModel('anthropic/claude-haiku-4-5', [])).toBeNull();
    expect(
      pickReplacementModel('anthropic/claude-haiku-4-5', [
        { ...served('image-maker', 'acme'), outputsMedia: true },
      ]),
    ).toBeNull();
  });
});

describe('applying the defaults to a document', () => {
  it('replaces every llm step naming a model it is told to replace, and nothing else', () => {
    const { document, changes } = applyModelDefaults(DOCUMENT, (model) =>
      model === 'anthropic/claude-haiku-4-5' ? 'gemini-3.5-flash-lite' : null,
    );
    expect(changes).toEqual([
      {
        nodeId: 'score',
        from: 'anthropic/claude-haiku-4-5',
        to: 'gemini-3.5-flash-lite',
      },
      {
        nodeId: 'again',
        from: 'anthropic/claude-haiku-4-5',
        to: 'gemini-3.5-flash-lite',
      },
    ]);
    const nodes = document.nodes as Array<Record<string, unknown>>;
    expect(nodes.map((node) => node.model)).toEqual([
      undefined,
      'gemini-3.5-flash-lite',
      '{{ input.model }}',
      'anthropic/claude-haiku-4-5',
      'gemini-3.5-flash-lite',
    ]);
    // The shipped document is a copy's source, never edited in place.
    expect(DOCUMENT.nodes[1]?.model).toBe('anthropic/claude-haiku-4-5');
  });

  it('answers the document itself when nothing changes', () => {
    const result = applyModelDefaults(DOCUMENT, () => null);
    expect(result.document).toBe(DOCUMENT);
    expect(result.changes).toEqual([]);
  });

  it('says once per model what it replaced', () => {
    expect(
      modelDefaultsMessage([
        { nodeId: 'score', from: 'claude-haiku-4-5', to: 'gpt-5-mini' },
        { nodeId: 'again', from: 'claude-haiku-4-5', to: 'gpt-5-mini' },
      ]),
    ).toBe("Model claude-haiku-4-5 isn't served here; using gpt-5-mini.");
  });
});
