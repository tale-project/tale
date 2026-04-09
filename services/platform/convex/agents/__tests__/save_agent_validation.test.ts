import { describe, expect, it } from 'vitest';

import { agentJsonSchema } from '../../../lib/shared/schemas/agents';

/**
 * Mirrors the stripNulls function in file_actions.ts.
 * Duplicated here because file_actions uses 'use node' which makes
 * direct imports difficult in edge-runtime test environment.
 */
function stripNulls(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null) {
        out[key] = typeof value === 'object' ? stripNulls(value) : value;
      }
    }
    return out;
  }
  return obj;
}

const BASE_CONFIG = {
  displayName: 'Assistant',
  description: 'General-purpose AI assistant',
  systemInstructions: 'You are a helpful AI assistant.',
  supportedModels: ['anthropic/claude-opus-4.6'],
};

describe('agentJsonSchema validation', () => {
  it('accepts config with delegates array', () => {
    const config = { ...BASE_CONFIG, delegates: ['web-assistant'] };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delegates).toEqual(['web-assistant']);
    }
  });

  it('accepts config with empty delegates array', () => {
    const config = { ...BASE_CONFIG, delegates: [] };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts config with visibleInChat false', () => {
    const config = { ...BASE_CONFIG, visibleInChat: false };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibleInChat).toBe(false);
    }
  });

  it('accepts config with visibleInChat true', () => {
    const config = { ...BASE_CONFIG, visibleInChat: true };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibleInChat).toBe(true);
    }
  });

  it('accepts config without delegates (undefined)', () => {
    const config = { ...BASE_CONFIG };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delegates).toBeUndefined();
    }
  });

  it('rejects null delegates without stripNulls', () => {
    const config = { ...BASE_CONFIG, delegates: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects null visibleInChat without stripNulls', () => {
    const config = { ...BASE_CONFIG, visibleInChat: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts null delegates after stripNulls', () => {
    const config = { ...BASE_CONFIG, delegates: null };
    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
  });

  it('accepts null visibleInChat after stripNulls', () => {
    const config = { ...BASE_CONFIG, visibleInChat: null };
    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
  });

  it('strips unrecognized keys', () => {
    const config = { ...BASE_CONFIG, modelPreset: 'advanced' };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('modelPreset' in result.data).toBe(false);
    }
  });
});

describe('stripNulls', () => {
  it('removes null values from top-level properties', () => {
    const input = { a: 'hello', b: null, c: 42 };
    expect(stripNulls(input)).toEqual({ a: 'hello', c: 42 });
  });

  it('removes null values from nested objects', () => {
    const input = { a: { b: null, c: 'test' } };
    expect(stripNulls(input)).toEqual({ a: { c: 'test' } });
  });

  it('preserves arrays and processes their elements', () => {
    const input = { items: ['a', 'b'] };
    expect(stripNulls(input)).toEqual({ items: ['a', 'b'] });
  });

  it('returns undefined for null input', () => {
    expect(stripNulls(null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(stripNulls(undefined)).toBeUndefined();
  });

  it('preserves false boolean values', () => {
    const input = { visible: false, name: 'test' };
    expect(stripNulls(input)).toEqual({ visible: false, name: 'test' });
  });

  it('preserves zero numeric values', () => {
    const input = { count: 0, name: 'test' };
    expect(stripNulls(input)).toEqual({ count: 0, name: 'test' });
  });

  it('preserves empty string values', () => {
    const input = { description: '', name: 'test' };
    expect(stripNulls(input)).toEqual({ description: '', name: 'test' });
  });

  it('preserves empty arrays', () => {
    const input = { delegates: [], name: 'test' };
    expect(stripNulls(input)).toEqual({ delegates: [], name: 'test' });
  });

  it('handles deeply nested i18n structure', () => {
    const input = {
      displayName: 'Test',
      i18n: {
        de: { conversationStarters: ['Hallo'], displayName: null },
      },
    };
    expect(stripNulls(input)).toEqual({
      displayName: 'Test',
      i18n: {
        de: { conversationStarters: ['Hallo'] },
      },
    });
  });
});

describe('full save round-trip with stripNulls', () => {
  it('handles config with delegation and visibility changes', () => {
    const config = {
      ...BASE_CONFIG,
      delegates: ['web-assistant', 'crm-assistant'],
      visibleInChat: false,
      toolNames: ['rag_search', 'web'],
      knowledgeMode: 'tool',
      includeOrgKnowledge: true,
      structuredResponsesEnabled: true,
      maxSteps: 20,
      timeoutMs: 1200000,
    };

    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delegates).toEqual(['web-assistant', 'crm-assistant']);
      expect(result.data.visibleInChat).toBe(false);
    }
  });

  it('handles config where optional fields are null (transport artifact)', () => {
    const config = {
      ...BASE_CONFIG,
      delegates: null,
      visibleInChat: null,
      description: null,
      toolNames: null,
      integrationBindings: null,
      workflows: null,
      knowledgeMode: null,
      webSearchMode: null,
      conversationStarters: null,
      i18n: null,
    };

    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delegates).toBeUndefined();
      expect(result.data.visibleInChat).toBeUndefined();
      expect(result.data.description).toBeUndefined();
    }
  });
});
