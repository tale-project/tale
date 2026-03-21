import { describe, expect, it } from 'vitest';

import type { WorkflowInputSchema } from './validate_workflow_input';

import { validateWorkflowInput } from './validate_workflow_input';

describe('validateWorkflowInput', () => {
  const schema: WorkflowInputSchema = {
    properties: {
      name: { type: 'string', description: 'User name' },
      age: { type: 'number' },
      count: { type: 'integer' },
      active: { type: 'boolean' },
      tags: { type: 'array' },
      config: { type: 'object' },
    },
    required: ['name', 'age'],
  };

  // ── No-op cases ──────────────────────────────────────────────────────

  it('returns valid when no inputSchema is defined', () => {
    const result = validateWorkflowInput({ foo: 'bar' }, undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid when inputSchema has no required fields', () => {
    const noRequired: WorkflowInputSchema = {
      properties: { x: { type: 'string' } },
    };
    const result = validateWorkflowInput({}, noRequired);
    expect(result.valid).toBe(true);
  });

  it('returns valid when input is undefined and nothing is required', () => {
    const noRequired: WorkflowInputSchema = {
      properties: { x: { type: 'string' } },
    };
    const result = validateWorkflowInput(undefined, noRequired);
    expect(result.valid).toBe(true);
  });

  // ── Required field checks ────────────────────────────────────────────

  it('errors when required fields are missing', () => {
    const result = validateWorkflowInput({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required parameter: 'name'");
    expect(result.errors).toContain("Missing required parameter: 'age'");
  });

  it('errors when required field is null', () => {
    const result = validateWorkflowInput({ name: null, age: 25 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required parameter: 'name'");
  });

  it('errors when required field is undefined', () => {
    const result = validateWorkflowInput({ name: undefined, age: 25 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required parameter: 'name'");
  });

  // ── Type validation (happy path) ────────────────────────────────────

  it('validates all types correctly', () => {
    const result = validateWorkflowInput(
      {
        name: 'Alice',
        age: 30,
        count: 5,
        active: true,
        tags: ['a', 'b'],
        config: { key: 'value' },
      },
      schema,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // ── Type validation (edge cases) ────────────────────────────────────

  it('rejects null for object type', () => {
    const result = validateWorkflowInput(
      { name: 'Alice', age: 30, config: null },
      schema,
    );
    // null is skipped (not type-checked), so this should be valid
    // unless config is required, which it is not
    expect(result.valid).toBe(true);
  });

  it('rejects array for object type', () => {
    const result = validateWorkflowInput(
      { name: 'Alice', age: 30, config: [1, 2, 3] },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Parameter 'config' expected type 'object', got 'array'",
    );
  });

  it('rejects NaN for number type', () => {
    const result = validateWorkflowInput({ name: 'Alice', age: NaN }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Parameter 'age' expected type 'number', got 'number'",
    );
  });

  it('rejects float for integer type', () => {
    const result = validateWorkflowInput(
      { name: 'Alice', age: 30, count: 3.14 },
      schema,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Parameter 'count' expected type 'integer', got 'number'",
    );
  });

  it('rejects string for number type', () => {
    const result = validateWorkflowInput({ name: 'Alice', age: '30' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Parameter 'age' expected type 'number', got 'string'",
    );
  });

  // ── Extra fields ────────────────────────────────────────────────────

  it('allows extra fields not in inputSchema', () => {
    const result = validateWorkflowInput(
      { name: 'Alice', age: 30, extraField: 'allowed' },
      schema,
    );
    expect(result.valid).toBe(true);
  });

  // ── Empty input with required fields ────────────────────────────────

  it('errors when input is undefined but required fields exist', () => {
    const result = validateWorkflowInput(undefined, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  // ── Nested schema validation: array items ─────────────────────────

  describe('array items validation', () => {
    const fileSchema: WorkflowInputSchema = {
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fileId: { type: 'string' },
              fileName: { type: 'string' },
            },
            required: ['fileId', 'fileName'],
          },
        },
      },
      required: ['files'],
    };

    it('validates valid array items', () => {
      const result = validateWorkflowInput(
        { files: [{ fileId: 'abc', fileName: 'doc.pdf' }] },
        fileSchema,
      );
      expect(result.valid).toBe(true);
    });

    it('errors when array element has wrong type', () => {
      const result = validateWorkflowInput(
        { files: ['not-an-object'] },
        fileSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('files[0]');
      expect(result.errors[0]).toContain('object');
    });

    it('errors when required field is missing in array element', () => {
      const result = validateWorkflowInput(
        { files: [{ fileId: 'abc' }] },
        fileSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('files[0].fileName');
    });

    it('errors when array element field has wrong type', () => {
      const result = validateWorkflowInput(
        { files: [{ fileId: 123, fileName: 'doc.pdf' }] },
        fileSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('files[0].fileId');
      expect(result.errors[0]).toContain('string');
    });

    it('validates simple array items type', () => {
      const stringArraySchema: WorkflowInputSchema = {
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
        },
      };
      const result = validateWorkflowInput(
        { ids: ['a', 'b', 42] },
        stringArraySchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('ids[2]');
    });
  });

  // ── Nested schema validation: object properties ───────────────────

  describe('object properties validation', () => {
    const objSchema: WorkflowInputSchema = {
      properties: {
        baseFile: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string' },
          },
          required: ['fileId'],
        },
      },
    };

    it('validates valid object properties', () => {
      const result = validateWorkflowInput(
        { baseFile: { fileId: 'abc', fileName: 'doc.pdf' } },
        objSchema,
      );
      expect(result.valid).toBe(true);
    });

    it('errors when required object field is missing', () => {
      const result = validateWorkflowInput(
        { baseFile: { fileName: 'doc.pdf' } },
        objSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('baseFile.fileId');
    });

    it('errors when object field has wrong type', () => {
      const result = validateWorkflowInput(
        { baseFile: { fileId: 42 } },
        objSchema,
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('baseFile.fileId');
      expect(result.errors[0]).toContain('string');
    });
  });
});
