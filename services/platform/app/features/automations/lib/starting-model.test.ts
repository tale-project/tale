import { describe, expect, it } from 'vitest';

import { startingModel, type StartingModelRow } from './starting-model';

const SUBSCRIPTION = {
  authMethod: 'subscription-broker',
  constraints: { harness: 'claude-code' },
} as const;

/** A row as `/chat/composer/models` lists it: a priced chat model with
 * tools, served by an API key unless the overrides say otherwise. */
function row(
  id: string,
  providerSlug: string,
  overrides: Partial<StartingModelRow> = {},
): StartingModelRow {
  return {
    id,
    label: id,
    providerSlug,
    providerLabel: providerSlug,
    credential: { authMethod: 'api-key' },
    tags: ['chat'],
    tools: true,
    pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 1000 },
    ...overrides,
  };
}

function priced(outputCentsPerMillion: number): Partial<StartingModelRow> {
  return { pricing: { inputCentsPerMillion: 100, outputCentsPerMillion } };
}

describe('startingModel', () => {
  it('has nothing to start on when nothing is offered', () => {
    expect(startingModel([], undefined)).toBeUndefined();
    expect(
      startingModel([], { modelId: 'claude-sonnet-5', providerSlug: 'a' }),
    ).toBeUndefined();
  });

  it("starts on the chat's Auto pick for everyday work", () => {
    const rows = [
      row('claude-fable-5-1', 'anthropic', priced(2500)),
      row('claude-sonnet-5', 'anthropic', priced(1500)),
      row('claude-haiku-4-5', 'anthropic', priced(500)),
    ];
    expect(startingModel(rows, undefined)).toBe(rows[1]);
  });

  it('falls back to the cheapest model when no curated one is offered', () => {
    const rows = [
      row('house-model-large', 'gateway', priced(900)),
      row('house-model-small', 'gateway', priced(300)),
    ];
    expect(startingModel(rows, undefined)).toBe(rows[1]);
  });

  it('starts on the saved chat pick, on the provider it was picked from', () => {
    const rows = [
      row('claude-sonnet-5', 'anthropic'),
      row('claude-haiku-4-5', 'anthropic'),
      row('claude-haiku-4-5', 'eu-gateway'),
    ];
    expect(
      startingModel(rows, {
        modelId: 'claude-haiku-4-5',
        providerSlug: 'eu-gateway',
      }),
    ).toBe(rows[2]);
    // A pick saved before providers were part of it takes the id's copy.
    expect(startingModel(rows, { modelId: 'claude-haiku-4-5' })).toBe(rows[1]);
  });

  it('goes on to Auto when the saved chat pick is not offered', () => {
    const rows = [
      row('claude-haiku-4-5', 'anthropic'),
      row('claude-sonnet-5', 'anthropic'),
    ];
    expect(
      startingModel(rows, { modelId: 'gpt-6-codex', providerSlug: 'openai' }),
    ).toBe(rows[1]);
  });

  it('picks a directly served model over a subscription one, as Auto routes', () => {
    const rows = [
      row('claude-sonnet-5', 'anthropic', { credential: SUBSCRIPTION }),
      row('house-model', 'gateway'),
    ];
    expect(startingModel(rows, undefined)).toBe(rows[1]);
  });

  it('picks among subscription models when nothing else is offered', () => {
    const rows = [
      row('claude-haiku-4-5', 'anthropic', { credential: SUBSCRIPTION }),
      row('claude-sonnet-5', 'anthropic', { credential: SUBSCRIPTION }),
    ];
    expect(startingModel(rows, undefined)).toBe(rows[1]);
  });

  it('starts on the first offered model when the listing says nothing Auto can read', () => {
    const bare = { tags: [], tools: false } as const;
    const rows = [
      row('claude-sonnet-5', 'anthropic', {
        ...bare,
        credential: SUBSCRIPTION,
      }),
      row('house-model', 'gateway', bare),
      row('other-model', 'gateway', bare),
    ];
    expect(startingModel(rows, undefined)).toBe(rows[1]);
  });
});
