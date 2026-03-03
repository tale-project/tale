import { describe, it, expect } from 'vitest';

import { validateLlmStep } from './llm';

function validLlmConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Step',
    systemPrompt: 'You are a helpful assistant.',
    ...overrides,
  };
}

describe('validateLlmStep', () => {
  describe('required fields', () => {
    it('passes with valid name and systemPrompt', () => {
      const result = validateLlmStep(validLlmConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when name is missing', () => {
      const result = validateLlmStep(validLlmConfig({ name: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('"name"'))).toBe(true);
    });

    it('fails when systemPrompt is missing', () => {
      const result = validateLlmStep(
        validLlmConfig({ systemPrompt: undefined }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('"systemPrompt"'))).toBe(
        true,
      );
    });

    it('suggests renaming prompt to systemPrompt', () => {
      const result = validateLlmStep(
        validLlmConfig({ systemPrompt: undefined, prompt: 'Hello' }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('not "prompt"'))).toBe(true);
    });
  });

  describe('outputFormat and outputSchema', () => {
    it('passes with json format and valid schema', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('fails when json format has no schema', () => {
      const result = validateLlmStep(validLlmConfig({ outputFormat: 'json' }));
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('requires "outputSchema"')),
      ).toBe(true);
    });

    it('fails when schema provided without json format', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputSchema: {
            type: 'object',
            properties: { x: { type: 'string' } },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.includes('requires "outputFormat": "json"'),
        ),
      ).toBe(true);
    });
  });

  describe('JSON Schema validation', () => {
    it('passes with basic object schema', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              count: { type: 'number' },
              active: { type: 'boolean' },
            },
            required: ['name'],
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('passes with integer type', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { count: { type: 'integer' } },
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('passes with null type', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { value: { type: 'null' } },
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('passes with array-of-types syntax (nullable)', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: {
              reason: { type: ['string', 'null'] },
              timestamp: { type: ['number', 'null'] },
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes with nested object properties', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: {
              address: {
                type: 'object',
                properties: {
                  street: { type: 'string' },
                  city: { type: 'string' },
                },
                required: ['street'],
              },
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('passes with array items', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: {
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it('fails with invalid type', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { x: { type: 'date' } },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid type'))).toBe(true);
    });

    it('fails with invalid type in array-of-types', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { x: { type: ['string', 'date'] } },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid type'))).toBe(true);
    });

    it('fails when type is missing from a property', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { x: { description: 'no type here' } },
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing "type"'))).toBe(
        true,
      );
    });

    it('fails when outputSchema root type is not object', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: { type: 'array', items: { type: 'string' } },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be "object"'))).toBe(
        true,
      );
    });

    it('fails when required is not an array', () => {
      const result = validateLlmStep(
        validLlmConfig({
          outputFormat: 'json',
          outputSchema: {
            type: 'object',
            properties: { x: { type: 'string' } },
            required: 'x',
          },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be an array'))).toBe(
        true,
      );
    });
  });

  describe('llmNode wrapper', () => {
    it('supports config nested under llmNode key', () => {
      const result = validateLlmStep({
        llmNode: validLlmConfig(),
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('tools validation', () => {
    it('fails when tools is not an array', () => {
      const result = validateLlmStep(
        validLlmConfig({ tools: 'customer_read' }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be an array'))).toBe(
        true,
      );
    });

    it('fails with invalid tool names', () => {
      const result = validateLlmStep(
        validLlmConfig({ tools: ['nonexistent_tool'] }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('invalid tool names'))).toBe(
        true,
      );
    });
  });
});
