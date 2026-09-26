import { describe, expect, it } from 'vitest';

import { mergeImportRowErrors } from './import-row-errors';

describe('mergeImportRowErrors', () => {
  it('maps a server refusal from its sent position to the spreadsheet line and sorts by line', () => {
    // Lines 2 and 5 were sent (3 and 4 were refused by the parser).
    const merged = mergeImportRowErrors(
      {
        rows: [2, 5],
        rowErrors: [{ row: 4, message: 'price: must be a number' }],
      },
      [
        {
          index: 1,
          error: 'exists',
          errorCode: 'DUPLICATE_PRODUCT_NAME',
        },
        {
          index: 0,
          error: 'currency: is not an ISO 4217 currency code',
          errorCode: 'INVALID_BODY',
          issues: [
            { path: 'currency', message: 'is not an ISO 4217 currency code' },
          ],
        },
      ],
    );
    expect(merged).toEqual([
      { row: 2, message: 'currency: is not an ISO 4217 currency code' },
      { row: 4, message: 'price: must be a number' },
      { row: 5, message: 'exists' },
    ]);
  });

  it('falls back to the position when the line is unknown', () => {
    expect(
      mergeImportRowErrors({ rows: [], rowErrors: [] }, [
        { index: 3, error: 'x', errorCode: 'unknown' },
      ]),
    ).toEqual([{ row: 4, message: 'x' }]);
  });
});
