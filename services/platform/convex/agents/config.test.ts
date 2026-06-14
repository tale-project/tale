import { describe, it, expect } from 'vitest';

import { resolveAgentDisplay, toSerializableConfig } from './config';
import type { AgentJsonConfig } from './file_utils';

const baseConfig: AgentJsonConfig = {
  supportedModels: ['openai:gpt-4o'],
};

describe('resolveAgentDisplay (Auto-router candidate descriptions)', () => {
  // Mirrors the real translator.json: description/displayName/starters live ONLY
  // under i18n, never top-level. The router projection must surface them or the
  // classifier sees a blank "General-purpose assistant." and can't route to it.
  const i18nOnly: AgentJsonConfig = {
    ...baseConfig,
    i18n: {
      en: {
        displayName: 'Translator',
        description: 'Translate documents, text, and images between languages.',
        conversationStarters: ['Translate this document to English'],
      },
      de: {
        displayName: 'Übersetzer',
        description: 'Übersetzt Dokumente, Text und Bilder zwischen Sprachen.',
        conversationStarters: ['Übersetze dieses Dokument ins Englische'],
      },
    },
  };

  it('resolves description + starters from i18n when absent at top level', () => {
    const r = resolveAgentDisplay(i18nOnly);
    expect(r.description).toBe(
      'Translate documents, text, and images between languages.',
    );
    expect(r.displayName).toBe('Translator');
    expect(r.conversationStarters).toEqual([
      'Translate this document to English',
    ]);
  });

  it('prefers the requested locale, falling back to en then top level', () => {
    expect(resolveAgentDisplay(i18nOnly, 'de').description).toBe(
      'Übersetzt Dokumente, Text und Bilder zwischen Sprachen.',
    );
    // Unknown locale → en fallback.
    expect(resolveAgentDisplay(i18nOnly, 'es').description).toBe(
      'Translate documents, text, and images between languages.',
    );
    // No i18n → legacy top-level.
    expect(
      resolveAgentDisplay({ ...baseConfig, description: 'legacy' }).description,
    ).toBe('legacy');
  });
});

describe('toSerializableConfig systemInstructions resolution', () => {
  it('prefers i18n[locale].systemInstructions over all fallbacks', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        en: { systemInstructions: 'English i18n' },
        de: { systemInstructions: 'German i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'de');
    expect(result.instructions).toBe('German i18n');
  });

  it('falls back to i18n.en.systemInstructions when requested locale is missing', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        en: { systemInstructions: 'English i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'fr');
    expect(result.instructions).toBe('English i18n');
  });

  it('falls back to top-level systemInstructions when no i18n entries exist', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
    };
    const result = toSerializableConfig('test', config, undefined, 'de');
    expect(result.instructions).toBe('legacy top-level');
  });

  it('falls back to top-level when i18n has no matching locale and no en entry', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'legacy top-level',
      i18n: {
        de: { systemInstructions: 'German only' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'fr');
    expect(result.instructions).toBe('legacy top-level');
  });

  it('prefers i18n.en over top-level when locale is en', () => {
    // Under i18n-first, any i18n entry wins over top-level.
    const config: AgentJsonConfig = {
      ...baseConfig,
      systemInstructions: 'WRONG (legacy)',
      i18n: {
        en: { systemInstructions: 'English i18n' },
      },
    };
    const result = toSerializableConfig('test', config, undefined, 'en');
    expect(result.instructions).toBe('English i18n');
  });

  it('defaults to empty string when nothing is set', () => {
    const config: AgentJsonConfig = { ...baseConfig };
    const result = toSerializableConfig('test', config, undefined, 'en');
    expect(result.instructions).toBe('');
  });

  it('omitted locale arg uses top-level + i18n.en fallback', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      i18n: { en: { systemInstructions: 'English i18n' } },
    };
    const result = toSerializableConfig('test', config);
    expect(result.instructions).toBe('English i18n');
  });
});

describe('toSerializableConfig <-> serializableAgentConfigValidator shape', () => {
  // These guard the contract between the mapper and the strict Convex
  // arg validator on `runAgentGeneration`. An image-generation agent could
  // round-trip an extra field into the args and crash the action with
  // `ArgumentValidationError: extra field` via `primaryBehavior`.

  it('passes primaryBehavior through to the serialized config', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      primaryBehavior: 'image-generation',
    };
    const result = toSerializableConfig('test', config);
    expect(result.primaryBehavior).toBe('image-generation');
  });

  it('preserves skillBindings as the hard allowlist', () => {
    const config: AgentJsonConfig = {
      ...baseConfig,
      skillBindings: ['pptx', 'csv'],
    };
    const result = toSerializableConfig('test', config);
    expect(result.skillBindings).toEqual(['pptx', 'csv']);
  });
});
