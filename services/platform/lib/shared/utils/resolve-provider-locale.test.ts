import { describe, expect, it } from 'vitest';

import {
  resolveModelLocale,
  resolveProviderLocale,
} from './resolve-provider-locale';

const i18nFirstProvider = {
  displayName: 'OpenRouter',
  description: 'Top-level fallback description',
  i18n: {
    en: {
      displayName: 'OpenRouter',
      description: 'English description',
    },
    de: {
      displayName: 'OpenRouter DE',
      description: 'Deutsche Beschreibung',
    },
    fr: {
      // partial: only displayName
      displayName: 'OpenRouter FR',
    },
  },
};

const legacyProvider = {
  displayName: 'Legacy',
  description: 'Old format',
};

describe('resolveProviderLocale', () => {
  it('returns i18n[locale] values when fully present', () => {
    const result = resolveProviderLocale(i18nFirstProvider, 'de');
    expect(result.displayName).toBe('OpenRouter DE');
    expect(result.description).toBe('Deutsche Beschreibung');
  });

  it('falls back field-by-field to i18n.en when locale has partial overrides', () => {
    const result = resolveProviderLocale(i18nFirstProvider, 'fr');
    expect(result.displayName).toBe('OpenRouter FR');
    expect(result.description).toBe('English description');
  });

  it('falls back to i18n.en for unknown locale, never uses i18n.de', () => {
    const result = resolveProviderLocale(i18nFirstProvider, 'es');
    expect(result.displayName).toBe('OpenRouter');
    expect(result.description).toBe('English description');
  });

  it('resolves legacy provider (no i18n) to top-level fields', () => {
    const result = resolveProviderLocale(legacyProvider, 'de');
    expect(result.displayName).toBe('Legacy');
    expect(result.description).toBe('Old format');
  });

  it('falls through to top-level when neither i18n[locale] nor i18n.en have the field', () => {
    const provider = {
      displayName: 'Top-level Name',
      description: 'Top-level Description',
      i18n: {
        de: { displayName: 'DE Name' },
      },
    };
    const result = resolveProviderLocale(provider, 'fr');
    expect(result.displayName).toBe('Top-level Name');
    expect(result.description).toBe('Top-level Description');
  });

  it('returns empty displayName when no source has one', () => {
    const result = resolveProviderLocale({}, 'en');
    expect(result.displayName).toBe('');
    expect(result.description).toBeUndefined();
  });

  // --- BCP-47 narrowing ---

  it('narrows de-CH to i18n.de when only de is populated', () => {
    const provider = { i18n: { de: { displayName: 'Deutsch' } } };
    expect(resolveProviderLocale(provider, 'de-CH').displayName).toBe(
      'Deutsch',
    );
  });

  it('prefers a direct locale match over its narrowed base', () => {
    const provider = {
      i18n: {
        de: { displayName: 'Deutsch' },
        'de-CH': { displayName: 'Schweizerdeutsch' },
      },
    };
    expect(resolveProviderLocale(provider, 'de-CH').displayName).toBe(
      'Schweizerdeutsch',
    );
  });

  it('falls through to app-default when narrowed base is missing too', () => {
    const provider = { i18n: { en: { displayName: 'EN' } } };
    expect(resolveProviderLocale(provider, 'fr-FR').displayName).toBe('EN');
  });

  // --- Empty-value treatment ---

  it('skips empty-string i18n value to the next layer', () => {
    const provider = {
      displayName: 'Top',
      i18n: { en: { displayName: '' } },
    };
    expect(resolveProviderLocale(provider, 'en').displayName).toBe('Top');
  });

  it('skips whitespace-only i18n value to the next layer', () => {
    const provider = {
      description: 'Top',
      i18n: { de: { description: '   ' } },
    };
    expect(resolveProviderLocale(provider, 'de').description).toBe('Top');
  });

  it('uses top-level only when i18n entry exists but is empty', () => {
    const provider = {
      displayName: 'Top',
      i18n: { en: {} },
    };
    expect(resolveProviderLocale(provider, 'en').displayName).toBe('Top');
  });
});

const providerWithModelTranslations = {
  displayName: 'OpenRouter',
  i18n: {
    de: {
      models: {
        'anthropic/claude-opus-4.6': {
          description: 'Leistungsstärkstes Modell',
        },
        'openai/gpt-5.2': {
          displayName: 'GPT-5.2 (DE)',
          description: 'OpenAI Flaggschiff',
        },
      },
    },
    fr: {
      models: {
        'anthropic/claude-opus-4.6': {
          // empty — should fall through to en, then top-level
        },
      },
    },
  },
};

describe('resolveModelLocale', () => {
  const claudeOpus = {
    id: 'anthropic/claude-opus-4.6',
    displayName: 'Claude Opus 4.6',
    description: 'Anthropic flagship',
  };

  const gpt = {
    id: 'openai/gpt-5.2',
    displayName: 'GPT-5.2',
    description: 'OpenAI flagship',
  };

  it('returns the locale-specific model description', () => {
    const result = resolveModelLocale(
      claudeOpus,
      providerWithModelTranslations.i18n,
      'de',
    );
    expect(result.description).toBe('Leistungsstärkstes Modell');
    // displayName not overridden in de.models — falls through to top-level
    expect(result.displayName).toBe('Claude Opus 4.6');
  });

  it('returns both displayName and description when both are overridden', () => {
    const result = resolveModelLocale(
      gpt,
      providerWithModelTranslations.i18n,
      'de',
    );
    expect(result.displayName).toBe('GPT-5.2 (DE)');
    expect(result.description).toBe('OpenAI Flaggschiff');
  });

  it('falls through to top-level for unknown model id', () => {
    const unknown = { id: 'foo/bar', displayName: 'Foo', description: 'Bar' };
    const result = resolveModelLocale(
      unknown,
      providerWithModelTranslations.i18n,
      'de',
    );
    expect(result.displayName).toBe('Foo');
    expect(result.description).toBe('Bar');
  });

  it('falls through to top-level when no provider i18n is present', () => {
    expect(resolveModelLocale(claudeOpus, undefined, 'de')).toEqual({
      displayName: 'Claude Opus 4.6',
      description: 'Anthropic flagship',
    });
  });

  it('narrows de-CH to de for model overrides', () => {
    const result = resolveModelLocale(
      claudeOpus,
      providerWithModelTranslations.i18n,
      'de-CH',
    );
    expect(result.description).toBe('Leistungsstärkstes Modell');
  });

  it('falls through empty model entry to top-level', () => {
    const result = resolveModelLocale(
      claudeOpus,
      providerWithModelTranslations.i18n,
      'fr',
    );
    expect(result.displayName).toBe('Claude Opus 4.6');
    expect(result.description).toBe('Anthropic flagship');
  });

  it('returns empty displayName when neither overrides nor top-level have one', () => {
    const result = resolveModelLocale({ id: 'x/y' }, undefined, 'en');
    expect(result.displayName).toBe('');
    expect(result.description).toBeUndefined();
  });
});
