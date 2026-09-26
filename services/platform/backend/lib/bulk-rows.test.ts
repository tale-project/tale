import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mergeBulkResult, partitionBulkRows } from './bulk-rows.ts';

const row = z.object({ name: z.string().min(1, 'must not be blank') });

describe('partitionBulkRows', () => {
  it('keeps the valid rows and names the field of each refused row at its own index', () => {
    const { valid, refused } = partitionBulkRows(
      [{ name: 'Kettle' }, { name: '' }, { name: 'Toaster' }, 'nonsense'],
      row,
    );
    expect(valid).toEqual([
      { index: 0, item: { name: 'Kettle' } },
      { index: 2, item: { name: 'Toaster' } },
    ]);
    expect(refused.map((entry) => [entry.index, entry.error])).toEqual([
      [1, 'name: must not be blank'],
      [3, expect.stringMatching(/^body: /)],
    ]);
    expect(refused[0]).toMatchObject({
      errorCode: 'INVALID_BODY',
      issues: [{ path: 'name', message: 'must not be blank' }],
      input: { name: '' },
    });
  });
});

describe('mergeBulkResult', () => {
  it('maps the domain answer back to the caller indexes and counts the refusals as failed', () => {
    const { valid, refused } = partitionBulkRows(
      [{ name: 'Kettle' }, { name: '' }, { name: 'Kettle' }],
      row,
    );
    const merged = mergeBulkResult(valid, refused, {
      success: 1,
      failed: 1,
      errors: [{ index: 1, error: 'duplicate', errorCode: 'DUPLICATE' }],
      created: [{ index: 0, id: 'p1' }],
    });
    expect(merged.success).toBe(1);
    expect(merged.failed).toBe(2);
    expect(merged.errors.map((entry) => entry.index)).toEqual([1, 2]);
    expect(merged.errors[1]).toMatchObject({ errorCode: 'DUPLICATE' });
    expect(merged.created).toEqual([{ index: 0, id: 'p1' }]);
  });
});
