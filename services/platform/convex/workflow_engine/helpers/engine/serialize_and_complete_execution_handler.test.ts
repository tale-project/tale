import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for the output extraction logic in
 * serialize_and_complete_execution_handler.ts.
 *
 * __workflowOutput is stored under the nested variables namespace
 * (vars.variables.__workflowOutput) by persistExecutionResult.
 *
 * When no __workflowOutput exists, output is null (not sanitized variables).
 * Variables are stored separately — the output field is reserved for
 * explicit output node data only.
 */

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Mirrors the extraction logic that resolves _storageRef via
 * deserializeVariablesInAction before extracting __workflowOutput.
 */
async function extractOutput(
  variablesJson: string | undefined,
  storageGet?: (id: string) => Promise<Blob | null>,
): Promise<unknown> {
  if (!variablesJson) return null;
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
      return null;
    }

    // __workflowOutput is stored under the variables namespace by persistExecutionResult
    const nestedVars = isRecord(vars.variables) ? vars.variables : vars;
    if ('__workflowOutput' in nestedVars) {
      return nestedVars.__workflowOutput;
    }
    return null;
  } catch {
    return null;
  }
}

describe('extractOutput', () => {
  it('returns __workflowOutput from nested variables namespace', async () => {
    const vars = JSON.stringify({
      input: {},
      config: {},
      variables: {
        __workflowOutput: { analysis: 'good', score: 42 },
        someVar: 'data',
      },
    });
    const result = await extractOutput(vars);
    expect(result).toEqual({ analysis: 'good', score: 42 });
  });

  it('returns null __workflowOutput when explicitly null', async () => {
    const vars = JSON.stringify({
      variables: { __workflowOutput: null },
    });
    expect(await extractOutput(vars)).toBeNull();
  });

  it('returns array __workflowOutput', async () => {
    const vars = JSON.stringify({
      variables: { __workflowOutput: [1, 2, 3] },
    });
    expect(await extractOutput(vars)).toEqual([1, 2, 3]);
  });

  it('falls back to top-level __workflowOutput when no nested variables', async () => {
    const vars = JSON.stringify({
      __workflowOutput: { greeting: 'hello' },
    });
    const result = await extractOutput(vars);
    expect(result).toEqual({ greeting: 'hello' });
  });

  it('returns null when no __workflowOutput anywhere', async () => {
    const vars = JSON.stringify({
      input: {},
      config: {},
      variables: {
        customerId: 'cust_1',
        analysis: 'done',
      },
    });
    const result = await extractOutput(vars);
    expect(result).toBeNull();
  });

  it('returns null for undefined variables', async () => {
    expect(await extractOutput(undefined)).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    expect(await extractOutput('not json')).toBeNull();
  });

  it('resolves _storageRef and extracts __workflowOutput from blob storage', async () => {
    const realVariables = {
      variables: {
        __workflowOutput: {
          fileStorageId: 'kg278fznabcg53cpt8jjqzm3n982gq94',
          downloadUrl: 'https://example.com/report.docx',
          fileName: 'contract-comparison-report.docx',
        },
      },
      input: {},
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

  it('resolves _storageRef and returns null when no __workflowOutput', async () => {
    const realVariables = {
      variables: {
        customerId: 'cust_1',
        analysis: 'done',
      },
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

    expect(result).toBeNull();
  });

  it('returns null when _storageRef blob is not found', async () => {
    const storageGet = vi.fn().mockResolvedValue(null);

    const variablesJson = JSON.stringify({
      _storageRef: 'missing_storage_id',
    });

    const result = await extractOutput(variablesJson, storageGet);
    expect(result).toBeNull();
  });
});
