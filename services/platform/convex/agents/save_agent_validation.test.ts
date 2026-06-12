import { describe, expect, it } from 'vitest';

import { agentJsonSchema } from '../../lib/shared/schemas/agents';
import { stripNulls } from '../lib/strip_nulls';

const BASE_CONFIG = {
  displayName: 'Assistant',
  description: 'General-purpose AI assistant',
  systemInstructions: 'You are a helpful AI assistant.',
  supportedModels: ['anthropic/claude-opus-4.6'],
};

describe('agentJsonSchema validation', () => {
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

  it('accepts config without workflows (undefined)', () => {
    const config = { ...BASE_CONFIG };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflows).toBeUndefined();
    }
  });

  it('rejects null workflows without stripNulls', () => {
    const config = { ...BASE_CONFIG, workflows: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects null visibleInChat without stripNulls', () => {
    const config = { ...BASE_CONFIG, visibleInChat: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts null delegates after stripNulls', () => {
    const config = { ...BASE_CONFIG, workflows: null };
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

  it('accepts qualified model refs in supportedModels', () => {
    const config = {
      ...BASE_CONFIG,
      supportedModels: [
        'openrouter:anthropic/claude-opus-4.6',
        'anthropic/claude-sonnet-4.6',
      ],
    };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects trailing-colon model ref', () => {
    const config = { ...BASE_CONFIG, supportedModels: ['openrouter:'] };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects leading-colon model ref', () => {
    const config = {
      ...BASE_CONFIG,
      supportedModels: [':anthropic/claude-opus-4.6'],
    };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty string in supportedModels', () => {
    const config = { ...BASE_CONFIG, supportedModels: [''] };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // skillBindings + skillBindingsResolved (Skills feature)
  // Parity with delegates/visibleInChat: array shape, null transport handling,
  // and cross-field consistency between bindings and resolved snapshot.
  // -------------------------------------------------------------------------

  it('accepts skillBindings as a kebab-case slug array', () => {
    const config = {
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer', 'pdf-extractor'],
    };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillBindings).toEqual([
        'code-reviewer',
        'pdf-extractor',
      ]);
    }
  });

  it('accepts config with empty skillBindings array', () => {
    const config = { ...BASE_CONFIG, skillBindings: [] };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('accepts config without skillBindings (undefined)', () => {
    const config = { ...BASE_CONFIG };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillBindings).toBeUndefined();
    }
  });

  it('rejects null skillBindings without stripNulls', () => {
    const config = { ...BASE_CONFIG, skillBindings: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts null skillBindings after stripNulls', () => {
    const config = { ...BASE_CONFIG, skillBindings: null };
    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
  });

  it('rejects null skillBindingsResolved without stripNulls', () => {
    const config = { ...BASE_CONFIG, skillBindingsResolved: null };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('accepts null skillBindingsResolved after stripNulls', () => {
    const config = { ...BASE_CONFIG, skillBindingsResolved: null };
    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
  });

  it('rejects skillBindings entries that are not valid skill slugs', () => {
    for (const bad of ['code_reviewer', '-leading', 'trailing-', 'UPPER']) {
      const result = agentJsonSchema.safeParse({
        ...BASE_CONFIG,
        skillBindings: [bad],
      });
      expect(result.success, `expected ${bad} to be rejected`).toBe(false);
    }
  });

  it('rejects more than 10 skillBindings on a single agent', () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `skill-${i}`);
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      skillBindings: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed skillBindingsResolved snapshot', () => {
    const config = {
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer'],
      skillBindingsResolved: [
        {
          slug: 'code-reviewer',
          versionHash: 'a'.repeat(64),
          toolNames: ['rag_search'],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    };
    const result = agentJsonSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillBindingsResolved).toHaveLength(1);
    }
  });

  it('rejects a skillBindingsResolved entry with a too-short versionHash', () => {
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer'],
      skillBindingsResolved: [
        {
          slug: 'code-reviewer',
          versionHash: 'short',
          toolNames: [],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects versionHash that is 64 chars but not lowercase hex', () => {
    const nonHex = 'Z'.repeat(64);
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer'],
      skillBindingsResolved: [
        {
          slug: 'code-reviewer',
          versionHash: nonHex,
          toolNames: [],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('tolerates skillBindingsResolved with slugs not in skillBindings (legacy field, no cross-check)', () => {
    // `skillBindingsResolved` is the legacy transitive-grant snapshot and is
    // no longer read at runtime; we keep loading historical agent JSON that
    // carries it (including drift relative to `skillBindings`).
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer'],
      skillBindingsResolved: [
        {
          slug: 'pdf-extractor',
          versionHash: 'a'.repeat(64),
          toolNames: [],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects skillBindingsResolved.toolNames containing an empty string', () => {
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      skillBindings: ['code-reviewer'],
      skillBindingsResolved: [
        {
          slug: 'code-reviewer',
          versionHash: 'a'.repeat(64),
          toolNames: [''],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('tolerates skillBindings on an image-generation agent (no tool loop)', () => {
    // Image-generation agents bypass the tool loop entirely, so any
    // `skillBindings` on them is inert — schema accepts the field for
    // forward-compat, the runtime never builds a tool set for it.
    const result = agentJsonSchema.safeParse({
      ...BASE_CONFIG,
      primaryBehavior: 'image-generation',
      systemInstructions: 'Generate an image.',
      skillBindings: ['code-reviewer'],
    });
    expect(result.success).toBe(true);
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

  it('filters null elements from arrays', () => {
    const input = { delegates: ['integration-assistant', null] };
    expect(stripNulls(input)).toEqual({ delegates: ['integration-assistant'] });
  });

  it('filters undefined elements from arrays', () => {
    const input = {
      delegates: ['integration-assistant', undefined, 'crm-assistant'],
    };
    expect(stripNulls(input)).toEqual({
      delegates: ['integration-assistant', 'crm-assistant'],
    });
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
      workflows: ['integration-assistant', 'crm-assistant'],
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
      expect(result.data.workflows).toEqual([
        'integration-assistant',
        'crm-assistant',
      ]);
      expect(result.data.visibleInChat).toBe(false);
    }
  });

  it('handles config where optional fields are null (transport artifact)', () => {
    const config = {
      ...BASE_CONFIG,
      visibleInChat: null,
      description: null,
      toolNames: null,
      integrationBindings: null,
      workflows: null,
      knowledgeMode: null,
      webSearchMode: null,
      conversationStarters: null,
      i18n: null,
      skillBindings: null,
      skillBindingsResolved: null,
    };

    const result = agentJsonSchema.safeParse(stripNulls(config));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibleInChat).toBeUndefined();
      expect(result.data.description).toBeUndefined();
      expect(result.data.skillBindings).toBeUndefined();
      expect(result.data.skillBindingsResolved).toBeUndefined();
    }
  });
});
