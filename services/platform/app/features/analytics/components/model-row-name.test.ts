import { describe, expect, it } from 'vitest';

import { modelRowNames, providedModelName } from './model-row-name';

describe('modelRowNames', () => {
  it('names an id two providers serve with each, and a model one provider serves alone', () => {
    const nameOf = modelRowNames([
      { model: 'deepseek-x', provider: 'openrouter' },
      { model: 'deepseek-x', provider: 'deepinfra' },
      { model: 'gpt-5', provider: 'openai' },
    ]);

    expect(nameOf({ model: 'deepseek-x', provider: 'openrouter' })).toBe(
      'openrouter · deepseek-x',
    );
    expect(nameOf({ model: 'deepseek-x', provider: 'deepinfra' })).toBe(
      'deepinfra · deepseek-x',
    );
    expect(nameOf({ model: 'gpt-5', provider: 'openai' })).toBe('gpt-5');
  });

  it('keeps the id of a row without a provider, and names the provider of the row beside it', () => {
    // An empty provider (a chat-health turn that stored none) is no provider,
    // like `null` (a verdict recorded before verdicts named providers).
    for (const none of [null, '']) {
      const nameOf = modelRowNames([
        { model: 'luna', provider: 'openrouter' },
        { model: 'luna', provider: none },
      ]);

      expect(nameOf({ model: 'luna', provider: none })).toBe('luna');
      expect(nameOf({ model: 'luna', provider: 'openrouter' })).toBe(
        'openrouter · luna',
      );
    }
  });
});

describe('providedModelName', () => {
  it('names the provider whenever it is known', () => {
    expect(providedModelName('gpt-5', 'openai')).toBe('openai · gpt-5');
  });

  it('names the model alone where no provider is known', () => {
    expect(providedModelName('gpt-5')).toBe('gpt-5');
    expect(providedModelName('gpt-5', null)).toBe('gpt-5');
    expect(providedModelName('gpt-5', '')).toBe('gpt-5');
  });
});
