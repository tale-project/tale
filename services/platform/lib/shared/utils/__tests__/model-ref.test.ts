import { describe, it, expect } from 'vitest';

import {
  formatModelRef,
  isValidModelRef,
  parseModelRef,
  stripModelRefQualifier,
} from '../model-ref';

describe('parseModelRef', () => {
  it('parses a plain model id as unqualified', () => {
    expect(parseModelRef('anthropic/claude-opus-4.6')).toEqual({
      modelId: 'anthropic/claude-opus-4.6',
    });
  });

  it('parses a qualified ref', () => {
    expect(parseModelRef('openrouter:anthropic/claude-opus-4.6')).toEqual({
      providerName: 'openrouter',
      modelId: 'anthropic/claude-opus-4.6',
    });
  });

  it('normalizes uppercase provider prefix to lowercase', () => {
    expect(parseModelRef('OpenRouter:anthropic/claude-opus-4.6')).toEqual({
      providerName: 'openrouter',
      modelId: 'anthropic/claude-opus-4.6',
    });
  });

  it('splits only on the first colon (preserves colons inside modelId)', () => {
    expect(
      parseModelRef('bedrock:anthropic.claude-3-5-sonnet-20240620-v1:0'),
    ).toEqual({
      providerName: 'bedrock',
      modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    });
  });

  it('treats input with colons but invalid prefix (contains .) as unqualified', () => {
    const bedrockId = 'anthropic.claude-3-5-sonnet-20240620-v1:0';
    expect(parseModelRef(bedrockId)).toEqual({ modelId: bedrockId });
  });

  it('trims outer whitespace', () => {
    expect(parseModelRef('  openrouter:model-x  ')).toEqual({
      providerName: 'openrouter',
      modelId: 'model-x',
    });
  });

  it('throws on empty string', () => {
    expect(() => parseModelRef('')).toThrow(/non-empty/);
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseModelRef('   ')).toThrow(/non-empty/);
  });

  it('throws on leading colon', () => {
    expect(() => parseModelRef(':model-x')).toThrow(
      /cannot start or end with ":"/,
    );
  });

  it('throws on trailing colon', () => {
    expect(() => parseModelRef('openrouter:')).toThrow(
      /cannot start or end with ":"/,
    );
  });

  it('throws on a bare colon', () => {
    expect(() => parseModelRef(':')).toThrow(/cannot start or end with ":"/);
  });

  it('accepts provider names with digits, dashes, underscores', () => {
    expect(parseModelRef('anthropic-direct_v2:claude-opus')).toEqual({
      providerName: 'anthropic-direct_v2',
      modelId: 'claude-opus',
    });
  });

  it('rejects prefix with dots (treats whole as unqualified)', () => {
    expect(parseModelRef('foo.bar:baz')).toEqual({ modelId: 'foo.bar:baz' });
  });

  it('rejects prefix longer than 64 chars (treats whole as unqualified)', () => {
    const longPrefix = 'a'.repeat(65);
    expect(parseModelRef(`${longPrefix}:model`)).toEqual({
      modelId: `${longPrefix}:model`,
    });
  });
});

describe('formatModelRef', () => {
  it('formats qualified ref', () => {
    expect(
      formatModelRef({
        providerName: 'openrouter',
        modelId: 'anthropic/claude-opus-4.6',
      }),
    ).toBe('openrouter:anthropic/claude-opus-4.6');
  });

  it('formats unqualified ref', () => {
    expect(formatModelRef({ modelId: 'anthropic/claude-opus-4.6' })).toBe(
      'anthropic/claude-opus-4.6',
    );
  });

  it('round-trips through parse', () => {
    const input = 'openrouter:anthropic/claude-opus-4.6';
    expect(formatModelRef(parseModelRef(input))).toBe(input);
  });
});

describe('stripModelRefQualifier', () => {
  it('strips qualified prefix', () => {
    expect(stripModelRefQualifier('openrouter:anthropic/claude-opus-4.6')).toBe(
      'anthropic/claude-opus-4.6',
    );
  });

  it('leaves unqualified id unchanged', () => {
    expect(stripModelRefQualifier('anthropic/claude-opus-4.6')).toBe(
      'anthropic/claude-opus-4.6',
    );
  });
});

describe('isValidModelRef', () => {
  it('returns true for valid refs', () => {
    expect(isValidModelRef('anthropic/claude-opus-4.6')).toBe(true);
    expect(isValidModelRef('openrouter:anthropic/claude-opus-4.6')).toBe(true);
  });

  it('returns false for invalid refs', () => {
    expect(isValidModelRef('')).toBe(false);
    expect(isValidModelRef('   ')).toBe(false);
    expect(isValidModelRef(':foo')).toBe(false);
    expect(isValidModelRef('foo:')).toBe(false);
  });
});
