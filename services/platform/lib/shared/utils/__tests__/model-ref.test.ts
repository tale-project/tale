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

  describe('quantization variants', () => {
    it('extracts the @quantization suffix from a qualified ref', () => {
      expect(parseModelRef('openrouter:z-ai/glm-5.1@fp8')).toEqual({
        providerName: 'openrouter',
        modelId: 'z-ai/glm-5.1',
        quantization: 'fp8',
      });
    });

    it('extracts the @quantization suffix from an unqualified ref', () => {
      expect(parseModelRef('z-ai/glm-5.1@fp4')).toEqual({
        modelId: 'z-ai/glm-5.1',
        quantization: 'fp4',
      });
    });

    it('omits quantization when not present', () => {
      expect(parseModelRef('z-ai/glm-5.1')).toEqual({
        modelId: 'z-ai/glm-5.1',
      });
    });

    it('preserves bedrock-style ids with embedded colons (no @ → no variant)', () => {
      const bedrockId = 'anthropic.claude-3-5-sonnet-20240620-v1:0';
      expect(parseModelRef(`bedrock:${bedrockId}`)).toEqual({
        providerName: 'bedrock',
        modelId: bedrockId,
      });
    });

    it('rejects uppercase variant tokens (kept as part of modelId)', () => {
      expect(parseModelRef('z-ai/glm-5.1@FP8')).toEqual({
        modelId: 'z-ai/glm-5.1@FP8',
      });
    });

    it('rejects empty variant tokens (kept as part of modelId)', () => {
      expect(parseModelRef('z-ai/glm-5.1@')).toEqual({
        modelId: 'z-ai/glm-5.1@',
      });
    });

    it('rejects variant tokens with punctuation (kept as part of modelId)', () => {
      expect(parseModelRef('foo@bar-baz')).toEqual({ modelId: 'foo@bar-baz' });
    });

    it('splits on the LAST @ when multiple are present', () => {
      expect(parseModelRef('foo@bar@fp8')).toEqual({
        modelId: 'foo@bar',
        quantization: 'fp8',
      });
    });

    it('accepts multi-character lowercase alphanumeric tokens', () => {
      expect(parseModelRef('m@bf16')).toEqual({
        modelId: 'm',
        quantization: 'bf16',
      });
      expect(parseModelRef('m@int8')).toEqual({
        modelId: 'm',
        quantization: 'int8',
      });
    });

    it('accepts single-character variant tokens (letter or digit)', () => {
      expect(parseModelRef('m@q')).toEqual({
        modelId: 'm',
        quantization: 'q',
      });
      expect(parseModelRef('m@8')).toEqual({
        modelId: 'm',
        quantization: '8',
      });
    });

    it('rejects variant tokens longer than 16 chars (kept as part of modelId)', () => {
      const longVariant = 'a'.repeat(17);
      expect(parseModelRef(`m@${longVariant}`)).toEqual({
        modelId: `m@${longVariant}`,
      });
    });

    it('extracts a variant from a bedrock-style id with embedded colons', () => {
      expect(
        parseModelRef('bedrock:anthropic.claude-3-5-sonnet-20240620-v1:0@fp8'),
      ).toEqual({
        providerName: 'bedrock',
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        quantization: 'fp8',
      });
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

  it('appends @quantization on a qualified ref', () => {
    expect(
      formatModelRef({
        providerName: 'openrouter',
        modelId: 'z-ai/glm-5.1',
        quantization: 'fp8',
      }),
    ).toBe('openrouter:z-ai/glm-5.1@fp8');
  });

  it('appends @quantization on an unqualified ref', () => {
    expect(
      formatModelRef({ modelId: 'z-ai/glm-5.1', quantization: 'fp4' }),
    ).toBe('z-ai/glm-5.1@fp4');
  });

  it('round-trips a variant ref through parse', () => {
    const input = 'openrouter:z-ai/glm-5.1@fp8';
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

  it('strips both provider prefix and @quantization', () => {
    expect(stripModelRefQualifier('openrouter:z-ai/glm-5.1@fp8')).toBe(
      'z-ai/glm-5.1',
    );
  });

  it('strips @quantization on an unqualified ref', () => {
    expect(stripModelRefQualifier('z-ai/glm-5.1@fp4')).toBe('z-ai/glm-5.1');
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

  it('returns true for variant-qualified refs', () => {
    expect(isValidModelRef('openrouter:z-ai/glm-5.1@fp8')).toBe(true);
    expect(isValidModelRef('z-ai/glm-5.1@fp4')).toBe(true);
  });
});
