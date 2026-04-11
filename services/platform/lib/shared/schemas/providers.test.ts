import { describe, expect, it } from 'vitest';

import { providerJsonSchema } from './providers';

describe('providerJsonSchema', () => {
  const baseProvider = {
    displayName: 'Test Provider',
    baseUrl: 'https://api.example.com/v1',
    models: [
      {
        id: 'test/model-1',
        displayName: 'Test Model 1',
        tags: ['chat'],
      },
    ],
  };

  describe('supportsStructuredOutputs', () => {
    it('accepts provider-level supportsStructuredOutputs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        supportsStructuredOutputs: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts per-model supportsStructuredOutputs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        supportsStructuredOutputs: true,
        models: [
          {
            id: 'test/model-1',
            displayName: 'Test Model 1',
            tags: ['chat'],
            supportsStructuredOutputs: false,
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.models[0].supportsStructuredOutputs).toBe(false);
      }
    });

    it('defaults per-model supportsStructuredOutputs to undefined when not set', () => {
      const result = providerJsonSchema.safeParse(baseProvider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.models[0].supportsStructuredOutputs).toBeUndefined();
      }
    });
  });

  describe('model ID uniqueness', () => {
    it('rejects duplicate model IDs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          { id: 'test/model-1', displayName: 'Model A', tags: ['chat'] },
          { id: 'test/model-1', displayName: 'Model B', tags: ['chat'] },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('defaults validation', () => {
    it('rejects defaults referencing unknown model IDs', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        defaults: { chat: 'nonexistent/model' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects defaults referencing model without matching tag', () => {
      const result = providerJsonSchema.safeParse({
        ...baseProvider,
        models: [
          { id: 'test/embed', displayName: 'Embed', tags: ['embedding'] },
        ],
        defaults: { chat: 'test/embed' },
      });
      expect(result.success).toBe(false);
    });
  });
});
