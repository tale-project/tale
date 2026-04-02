import { describe, it, expect } from 'vitest';

import { resolveAgentLocale } from '../resolve-agent-locale';

const agent = {
  displayName: 'Chat Agent',
  description: 'English description',
  conversationStarters: ['Hello', 'Help me'],
  i18n: {
    de: {
      displayName: 'Chat-Assistent',
      conversationStarters: ['Hallo', 'Hilf mir'],
    },
    fr: {
      displayName: 'Agent de chat',
    },
  },
};

describe('resolveAgentLocale', () => {
  it('returns top-level fields when locale matches default', () => {
    const result = resolveAgentLocale(agent, 'en', 'en');

    expect(result).toEqual({
      displayName: 'Chat Agent',
      description: 'English description',
      conversationStarters: ['Hello', 'Help me'],
    });
  });

  it('returns full i18n overrides for a translated locale', () => {
    const result = resolveAgentLocale(agent, 'de', 'en');

    expect(result).toEqual({
      displayName: 'Chat-Assistent',
      description: 'English description',
      conversationStarters: ['Hallo', 'Hilf mir'],
    });
  });

  it('falls back field-by-field for partial overrides', () => {
    const result = resolveAgentLocale(agent, 'fr', 'en');

    expect(result).toEqual({
      displayName: 'Agent de chat',
      description: 'English description',
      conversationStarters: ['Hello', 'Help me'],
    });
  });

  it('falls back to top-level for unknown locale', () => {
    const result = resolveAgentLocale(agent, 'es', 'en');

    expect(result).toEqual({
      displayName: 'Chat Agent',
      description: 'English description',
      conversationStarters: ['Hello', 'Help me'],
    });
  });

  it('handles agent with no i18n field', () => {
    const simpleAgent = {
      displayName: 'Simple',
      description: 'No translations',
    };
    const result = resolveAgentLocale(simpleAgent, 'de', 'en');

    expect(result).toEqual({
      displayName: 'Simple',
      description: 'No translations',
      conversationStarters: undefined,
    });
  });
});
