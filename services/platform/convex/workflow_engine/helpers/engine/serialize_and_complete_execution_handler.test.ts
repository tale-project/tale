import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for the output extraction and sanitization logic in
 * serialize_and_complete_execution_handler.ts.
 *
 * We test the pure logic (sanitizeOutputVariables and __workflowOutput extraction)
 * and the storage reference resolution path.
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

/**
 * Mirrors the updated extraction logic that resolves _storageRef via
 * deserializeVariablesInAction before extracting __workflowOutput.
 */
async function extractOutput(
  variablesJson: string | undefined,
  storageGet?: (id: string) => Promise<Blob | null>,
): Promise<unknown> {
  if (!variablesJson) return {};
  try {
    const parsed = JSON.parse(variablesJson);

    let vars: Record<string, unknown>;
    if (parsed._storageRef && storageGet) {
      const blob = await storageGet(parsed._storageRef);
      if (!blob) throw new Error('Storage file not found');
      const text = await blob.text();
      vars = JSON.parse(text);
    } else if (typeof parsed === 'object' && parsed !== null) {
      vars = parsed;
    } else {
      return {};
    }

    if ('__workflowOutput' in vars) {
      return vars.__workflowOutput;
    }
    return sanitizeOutputVariables(vars);
  } catch {
    return {};
  }
}

describe('extractOutput', () => {
  it('returns __workflowOutput when present', async () => {
    const vars = JSON.stringify({
      __workflowOutput: { analysis: 'good', score: 42 },
      secrets: { apiKey: 'secret123' },
      someStep: 'data',
    });
    const result = await extractOutput(vars);
    expect(result).toEqual({ analysis: 'good', score: 42 });
  });

  it('returns null __workflowOutput when explicitly null', async () => {
    const vars = JSON.stringify({ __workflowOutput: null });
    expect(await extractOutput(vars)).toBeNull();
  });

  it('returns array __workflowOutput', async () => {
    const vars = JSON.stringify({ __workflowOutput: [1, 2, 3] });
    expect(await extractOutput(vars)).toEqual([1, 2, 3]);
  });

  it('falls back to sanitized variables when no __workflowOutput', async () => {
    const vars = JSON.stringify({
      customerId: 'cust_1',
      analysis: 'done',
      secrets: { apiKey: 'secret123' },
      organizationId: 'org_1',
      wfDefinitionId: 'wf_1',
      rootWfDefinitionId: 'root_1',
    });
    const result = await extractOutput(vars);
    expect(result).toEqual({
      customerId: 'cust_1',
      analysis: 'done',
    });
  });

  it('returns empty object for undefined variables', async () => {
    expect(await extractOutput(undefined)).toEqual({});
  });

  it('returns empty object for invalid JSON', async () => {
    expect(await extractOutput('not json')).toEqual({});
  });

  it('resolves _storageRef and extracts __workflowOutput from blob storage', async () => {
    const realVariables = {
      __workflowOutput: {
        fileStorageId: 'kg278fznabcg53cpt8jjqzm3n982gq94',
        downloadUrl: 'https://example.com/report.docx',
        fileName: 'contract-comparison-report.docx',
      },
      chunkResults: ['chunk1', 'chunk2'],
    };

    const storageGet = vi.fn().mockResolvedValue(
      new Blob([JSON.stringify(realVariables)], {
        type: 'application/json',
      }),
    );

    const variablesJson = JSON.stringify({
      _storageRef: 'fake_storage_id_123',
    });

    const result = await extractOutput(variablesJson, storageGet);

    expect(storageGet).toHaveBeenCalledWith('fake_storage_id_123');
    expect(result).toEqual({
      fileStorageId: 'kg278fznabcg53cpt8jjqzm3n982gq94',
      downloadUrl: 'https://example.com/report.docx',
      fileName: 'contract-comparison-report.docx',
    });
  });

  it('resolves _storageRef and falls back to sanitized vars when no __workflowOutput', async () => {
    const realVariables = {
      customerId: 'cust_1',
      analysis: 'done',
      secrets: { apiKey: 'secret123' },
    };

    const storageGet = vi.fn().mockResolvedValue(
      new Blob([JSON.stringify(realVariables)], {
        type: 'application/json',
      }),
    );

    const variablesJson = JSON.stringify({
      _storageRef: 'fake_storage_id_456',
    });

    const result = await extractOutput(variablesJson, storageGet);

    expect(result).toEqual({
      customerId: 'cust_1',
      analysis: 'done',
    });
  });

  it('returns empty object when _storageRef blob is not found', async () => {
    const storageGet = vi.fn().mockResolvedValue(null);

    const variablesJson = JSON.stringify({
      _storageRef: 'missing_storage_id',
    });

    const result = await extractOutput(variablesJson, storageGet);
    expect(result).toEqual({});
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
