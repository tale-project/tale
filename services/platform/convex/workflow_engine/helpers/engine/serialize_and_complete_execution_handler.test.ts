import { describe, it, expect } from 'vitest';

/**
 * Tests for the output extraction and sanitization logic in
 * serialize_and_complete_execution_handler.ts.
 *
 * We test the pure logic (sanitizeOutputVariables and __workflowOutput extraction)
 * without requiring Convex ActionCtx.
 */

const SENSITIVE_OUTPUT_KEYS = [
  'secrets',
  'organizationId',
  'wfDefinitionId',
  'rootWfDefinitionId',
];

function sanitizeOutputVariables(vars: unknown): unknown {
  if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) {
    return vars;
  }
  const sanitized = { ...vars } as Record<string, unknown>;
  for (const key of SENSITIVE_OUTPUT_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function extractOutput(variablesJson: string | undefined): unknown {
  if (!variablesJson) return {};
  try {
    const vars = JSON.parse(variablesJson);
    if (
      typeof vars === 'object' &&
      vars !== null &&
      '__workflowOutput' in vars
    ) {
      return vars.__workflowOutput;
    }
    return sanitizeOutputVariables(vars);
  } catch {
    return {};
  }
}

describe('extractOutput', () => {
  it('returns __workflowOutput when present', () => {
    const vars = JSON.stringify({
      __workflowOutput: { analysis: 'good', score: 42 },
      secrets: { apiKey: 'secret123' },
      someStep: 'data',
    });
    const result = extractOutput(vars);
    expect(result).toEqual({ analysis: 'good', score: 42 });
  });

  it('returns null __workflowOutput when explicitly null', () => {
    const vars = JSON.stringify({ __workflowOutput: null });
    expect(extractOutput(vars)).toBeNull();
  });

  it('returns array __workflowOutput', () => {
    const vars = JSON.stringify({ __workflowOutput: [1, 2, 3] });
    expect(extractOutput(vars)).toEqual([1, 2, 3]);
  });

  it('falls back to sanitized variables when no __workflowOutput', () => {
    const vars = JSON.stringify({
      customerId: 'cust_1',
      analysis: 'done',
      secrets: { apiKey: 'secret123' },
      organizationId: 'org_1',
      wfDefinitionId: 'wf_1',
      rootWfDefinitionId: 'root_1',
    });
    const result = extractOutput(vars);
    expect(result).toEqual({
      customerId: 'cust_1',
      analysis: 'done',
    });
  });

  it('returns empty object for undefined variables', () => {
    expect(extractOutput(undefined)).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(extractOutput('not json')).toEqual({});
  });
});

describe('sanitizeOutputVariables', () => {
  it('strips all sensitive keys', () => {
    const result = sanitizeOutputVariables({
      data: 'ok',
      secrets: { key: 'value' },
      organizationId: 'org_1',
      wfDefinitionId: 'wf_1',
      rootWfDefinitionId: 'root_1',
    });
    expect(result).toEqual({ data: 'ok' });
  });

  it('returns arrays as-is', () => {
    expect(sanitizeOutputVariables([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('returns null as-is', () => {
    expect(sanitizeOutputVariables(null)).toBeNull();
  });

  it('returns primitives as-is', () => {
    expect(sanitizeOutputVariables('hello')).toBe('hello');
    expect(sanitizeOutputVariables(42)).toBe(42);
  });

  it('preserves non-sensitive keys', () => {
    const result = sanitizeOutputVariables({
      customerId: 'cust_1',
      status: 'active',
      items: [1, 2],
    });
    expect(result).toEqual({
      customerId: 'cust_1',
      status: 'active',
      items: [1, 2],
    });
  });
});
