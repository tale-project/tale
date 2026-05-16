import { describe, it, expect } from 'vitest';

import { resolveAgentLocale } from './resolve-agent-locale';

// i18n-first agent: canonical values live under i18n.<locale>.*,
// top-level translatables only as legacy fallback.
const i18nFirstAgent = {
  i18n: {
    en: {
      displayName: 'Chat Agent',
      description: 'English description',
      conversationStarters: ['Hello', 'Help me'],
      systemInstructions: 'You are a helpful English assistant.',
    },
    de: {
      displayName: 'Chat-Assistent',
      conversationStarters: ['Hallo', 'Hilf mir'],
      systemInstructions: 'Du bist ein hilfreicher deutscher Assistent.',
    },
    fr: {
      displayName: 'Agent de chat',
    },
  },
};

// Legacy agent: fields only at top-level, no i18n map.
const legacyAgent = {
  displayName: 'Legacy',
  description: 'Old format',
  conversationStarters: ['Hi'],
  systemInstructions: 'You are legacy.',
};

describe('resolveAgentLocale', () => {
  it('returns i18n[locale] values when fully present', () => {
    const result = resolveAgentLocale(i18nFirstAgent, 'en');
    expect(result.displayName).toBe('Chat Agent');
    expect(result.description).toBe('English description');
    expect(result.conversationStarters).toEqual(['Hello', 'Help me']);
    expect(result.systemInstructions).toBe(
      'You are a helpful English assistant.',
    );
  });

  it('falls back field-by-field to i18n.en when requested locale has partial overrides', () => {
    const result = resolveAgentLocale(i18nFirstAgent, 'de');
    expect(result.displayName).toBe('Chat-Assistent');
    expect(result.description).toBe('English description'); // from en
    expect(result.conversationStarters).toEqual(['Hallo', 'Hilf mir']);
    expect(result.systemInstructions).toBe(
      'Du bist ein hilfreicher deutscher Assistent.',
    );
  });

  it('falls back to i18n.en for unknown locale, never uses i18n.de', () => {
    const result = resolveAgentLocale(i18nFirstAgent, 'es');
    expect(result.displayName).toBe('Chat Agent'); // en, not de
    expect(result.description).toBe('English description');
    expect(result.conversationStarters).toEqual(['Hello', 'Help me']);
    expect(result.systemInstructions).toBe(
      'You are a helpful English assistant.',
    );
  });

  it('falls back to i18n.en when requested locale has no entry', () => {
    const result = resolveAgentLocale(i18nFirstAgent, 'fr');
    expect(result.displayName).toBe('Agent de chat'); // fr override
    expect(result.description).toBe('English description'); // en fallback
    expect(result.conversationStarters).toEqual(['Hello', 'Help me']); // en
    expect(result.systemInstructions).toBe(
      'You are a helpful English assistant.',
    );
  });

  it('resolves legacy agent (no i18n) to top-level fields', () => {
    const result = resolveAgentLocale(legacyAgent, 'de');
    expect(result.displayName).toBe('Legacy');
    expect(result.description).toBe('Old format');
    expect(result.conversationStarters).toEqual(['Hi']);
    expect(result.systemInstructions).toBe('You are legacy.');
  });

  it('falls through to top-level when neither i18n[locale] nor i18n.en have the field', () => {
    const agent = {
      displayName: 'Top-level Name',
      systemInstructions: 'Top-level instructions',
      i18n: {
        de: { displayName: 'DE Name' },
      },
    };
    const result = resolveAgentLocale(agent, 'fr');
    expect(result.displayName).toBe('Top-level Name');
    expect(result.systemInstructions).toBe('Top-level instructions');
  });

  it('returns empty displayName when no source has one', () => {
    const result = resolveAgentLocale({}, 'en');
    expect(result.displayName).toBe('');
  });

  // --- BCP-47 narrowing: de-CH / en-GB map to base language ---

  it('narrows de-CH to i18n.de when only de is populated', () => {
    const agent = { i18n: { de: { displayName: 'Deutsch' } } };
    expect(resolveAgentLocale(agent, 'de-CH').displayName).toBe('Deutsch');
  });

  it('prefers a direct locale match over its narrowed base', () => {
    const agent = {
      i18n: {
        de: { displayName: 'Deutsch' },
        'de-CH': { displayName: 'Schweizerdeutsch' },
      },
    };
    expect(resolveAgentLocale(agent, 'de-CH').displayName).toBe(
      'Schweizerdeutsch',
    );
  });

  it('narrows en-GB to i18n.en', () => {
    const agent = { i18n: { en: { displayName: 'English' } } };
    expect(resolveAgentLocale(agent, 'en-GB').displayName).toBe('English');
  });

  it('falls through to app-default when narrowed base is missing too', () => {
    const agent = { i18n: { en: { displayName: 'EN' } } };
    expect(resolveAgentLocale(agent, 'fr-FR').displayName).toBe('EN');
  });

  // --- Empty-value treatment: "" / whitespace / [] / all-blank arrays
  //     are all considered "missing" and fall through to the next layer. ---

  it('skips empty-string i18n value to the next layer', () => {
    const agent = {
      displayName: 'Top',
      i18n: { en: { displayName: '' } },
    };
    expect(resolveAgentLocale(agent, 'en').displayName).toBe('Top');
  });

  it('skips whitespace-only i18n value to the next layer', () => {
    const agent = {
      displayName: 'Top',
      i18n: { en: { systemInstructions: '   ' } },
    };
    expect(resolveAgentLocale(agent, 'en').systemInstructions).toBeUndefined();
  });

  it('skips empty-array conversationStarters to the next layer', () => {
    const agent = {
      conversationStarters: ['from top'],
      i18n: { en: { conversationStarters: [] as string[] } },
    };
    expect(resolveAgentLocale(agent, 'en').conversationStarters).toEqual([
      'from top',
    ]);
  });

  it('skips all-blank conversationStarters array to the next layer', () => {
    const agent = {
      conversationStarters: ['from top'],
      i18n: { en: { conversationStarters: ['', '  '] } },
    };
    expect(resolveAgentLocale(agent, 'en').conversationStarters).toEqual([
      'from top',
    ]);
  });

  it('uses dirty top-level only when i18n has nothing usable', () => {
    const agent = {
      displayName: 'Top',
      i18n: { en: {} },
    };
    expect(resolveAgentLocale(agent, 'en').displayName).toBe('Top');
  });
});
