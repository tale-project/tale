import { describe, expect, it } from 'vitest';

import type { AgentJsonConfig } from '../../../convex/agents/file_utils';
import { isNormalized, normalizeAgentConfig } from './normalize-agent-config';

const minimalConfig = (
  overrides: Partial<AgentJsonConfig> = {},
): AgentJsonConfig => ({
  supportedModels: ['openai:gpt-4'],
  ...overrides,
});

describe('normalizeAgentConfig', () => {
  it('returns legacy-only config unchanged (I-4 conservative)', () => {
    const input = minimalConfig({
      displayName: 'Legacy',
      description: 'Old',
      systemInstructions: 'Be helpful.',
      conversationStarters: ['Hi'],
    });
    const result = normalizeAgentConfig(input);
    expect(result).toEqual(input);
    expect(isNormalized(result)).toBe(true);
  });

  it('leaves i18n-only config intact when no legacy top-level', () => {
    const input = minimalConfig({
      i18n: {
        en: { displayName: 'Name', systemInstructions: 'Do work.' },
        de: { displayName: 'Name DE' },
      },
    });
    const result = normalizeAgentConfig(input);
    expect(result).toEqual(input);
    expect(isNormalized(result)).toBe(true);
  });

  it('retires top-level fields when i18n[defaultLocale] has content (I-1)', () => {
    const input = minimalConfig({
      displayName: 'Top',
      description: 'Top desc',
      systemInstructions: 'Top inst.',
      conversationStarters: ['Top1'],
      i18n: {
        en: {
          displayName: 'EN',
          description: 'EN desc',
          systemInstructions: 'EN inst.',
          conversationStarters: ['EN1'],
        },
      },
    });
    const result = normalizeAgentConfig(input);
    expect(result.displayName).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.systemInstructions).toBeUndefined();
    expect(result.conversationStarters).toBeUndefined();
    expect(result.i18n?.en).toEqual(input.i18n!.en);
    expect(isNormalized(result)).toBe(true);
  });

  it('preserves top-level when only non-default locale has i18n', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: { de: { displayName: 'DE' } },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.displayName).toBe('Top');
    expect(result.i18n?.de?.displayName).toBe('DE');
    expect(isNormalized(result, 'en')).toBe(true);
  });

  it('retires per-field when i18n[default] only has some fields (partial)', () => {
    const input = minimalConfig({
      displayName: 'Top',
      systemInstructions: 'Top inst.',
      i18n: { en: { displayName: 'EN' } },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.displayName).toBeUndefined();
    expect(result.systemInstructions).toBe('Top inst.');
  });

  it('strips empty-string displayName in i18n; preserves legacy top-level', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: { en: { displayName: '' } },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.displayName).toBe('Top');
    expect(result.i18n).toBeUndefined();
  });

  it('strips whitespace-only strings (I-2)', () => {
    const input = minimalConfig({
      displayName: '   ',
      i18n: { en: { systemInstructions: '\n\t ' } },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.displayName).toBeUndefined();
    expect(result.i18n).toBeUndefined();
  });

  it('filters blank entries from conversationStarters arrays', () => {
    const input = minimalConfig({
      i18n: {
        en: {
          displayName: 'Name',
          conversationStarters: ['one', '  ', '', 'two'],
        },
      },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.i18n?.en?.conversationStarters).toEqual(['one', 'two']);
  });

  it('strips all-blank conversationStarters to undefined', () => {
    const input = minimalConfig({
      conversationStarters: ['', '  '],
      i18n: {
        en: { displayName: 'Name', conversationStarters: ['', '   '] },
      },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.conversationStarters).toBeUndefined();
    expect(result.i18n?.en?.conversationStarters).toBeUndefined();
  });

  it('removes locale node whose fields all strip to empty', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: {
        en: { displayName: 'EN' },
        de: { displayName: '', description: '   ' },
      },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.i18n?.de).toBeUndefined();
    expect(result.i18n?.en?.displayName).toBe('EN');
  });

  it('removes entire i18n when every locale becomes empty', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: { en: { displayName: '' }, de: {} },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.i18n).toBeUndefined();
    expect(result.displayName).toBe('Top');
  });

  it('respects a non-en defaultLocale (org locale parameterization)', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: {
        en: { displayName: 'EN' },
        de: { displayName: 'DE' },
      },
    });
    // Org default = de: clear top-level because i18n.de is populated.
    const deResult = normalizeAgentConfig(input, 'de');
    expect(deResult.displayName).toBeUndefined();
    expect(deResult.i18n?.en?.displayName).toBe('EN');
    expect(deResult.i18n?.de?.displayName).toBe('DE');

    // Same input, org default = en: same outcome (i18n.en is populated).
    const enResult = normalizeAgentConfig(input, 'en');
    expect(enResult.displayName).toBeUndefined();
  });

  it('keeps top-level when org default locale has no i18n entry', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: { en: { displayName: 'EN' } },
    });
    const deResult = normalizeAgentConfig(input, 'de');
    // i18n.de does not exist → top-level preserved as resolver fallback.
    expect(deResult.displayName).toBe('Top');
    expect(deResult.i18n?.en?.displayName).toBe('EN');
  });

  it('is idempotent across diverse inputs (I-3)', () => {
    const inputs: AgentJsonConfig[] = [
      minimalConfig({ displayName: 'Legacy' }),
      minimalConfig({
        i18n: {
          en: { displayName: 'EN', conversationStarters: ['a', '', 'b'] },
          de: { displayName: ' ' },
        },
      }),
      minimalConfig({
        displayName: 'Top',
        systemInstructions: 'Top inst.',
        i18n: { en: { systemInstructions: 'EN inst.' } },
      }),
      minimalConfig({
        conversationStarters: ['top only'],
      }),
    ];
    for (const input of inputs) {
      const once = normalizeAgentConfig(input);
      const twice = normalizeAgentConfig(once);
      expect(twice).toEqual(once);
      expect(isNormalized(once)).toBe(true);
    }
  });

  it('does not mutate the input', () => {
    const input = minimalConfig({
      displayName: 'Top',
      i18n: { en: { displayName: 'EN' } },
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeAgentConfig(input, 'en');
    expect(input).toEqual(snapshot);
  });

  it('tolerates unsupported i18n locale keys (preserves them)', () => {
    const input = minimalConfig({
      i18n: {
        en: { displayName: 'EN' },
        it: { displayName: 'Ciao' },
      },
    });
    const result = normalizeAgentConfig(input, 'en');
    expect(result.i18n?.it?.displayName).toBe('Ciao');
  });
});

describe('isNormalized', () => {
  it('rejects empty-string placeholders in i18n', () => {
    expect(
      isNormalized(minimalConfig({ i18n: { en: { displayName: '' } } })),
    ).toBe(false);
  });

  it('rejects whitespace-only placeholders in i18n', () => {
    expect(
      isNormalized(minimalConfig({ i18n: { en: { displayName: '  ' } } })),
    ).toBe(false);
  });

  it('rejects legacy + i18n[default] co-existence', () => {
    expect(
      isNormalized(
        minimalConfig({
          displayName: 'Top',
          i18n: { en: { displayName: 'EN' } },
        }),
        'en',
      ),
    ).toBe(false);
  });

  it('accepts legacy-only', () => {
    expect(isNormalized(minimalConfig({ displayName: 'Top' }))).toBe(true);
  });

  it('accepts i18n-only', () => {
    expect(
      isNormalized(minimalConfig({ i18n: { en: { displayName: 'EN' } } })),
    ).toBe(true);
  });

  it('rejects empty i18n object', () => {
    expect(isNormalized(minimalConfig({ i18n: {} }))).toBe(false);
  });
});
