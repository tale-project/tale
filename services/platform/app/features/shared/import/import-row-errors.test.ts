import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  IMPORT_ROW_FIELDS,
  IMPORT_ROW_REASONS,
} from '@/lib/utils/file-parsing';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import {
  importRowErrorLine,
  importRowErrorMessage,
  mergeImportRowErrors,
} from './import-row-errors';

type Bundle = {
  common: {
    import: {
      fields: Record<string, string>;
      reasons: Record<string, string>;
      unpairedQuotes: string;
    };
  };
};

const LOCALES: Record<string, Bundle> = {
  en: enMessages as Bundle,
  de: deMessages as Bundle,
  fr: frMessages as Bundle,
};

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

describe('importRowErrorMessage', () => {
  // The dialog's `t` echoes the key and its params, so the translated
  // sentence and the label it takes are both assertable.
  const tCommon = ((key: string, params?: Record<string, unknown>) =>
    params
      ? `${key} ${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' ')}`
      : key) as unknown as TFunction;

  it('translates a parser refusal from its field and reason keys', () => {
    expect(
      importRowErrorMessage(tCommon, {
        row: 3,
        field: 'price',
        reason: 'notNumber',
      }),
    ).toBe('import.reasons.notNumber field=import.fields.price');
    expect(
      importRowErrorLine(tCommon, {
        row: 3,
        field: 'status',
        reason: 'notOneOf',
        values: { options: 'active, draft' },
      }),
    ).toBe(
      'import.rowError row=3 message=import.reasons.notOneOf options=active, draft field=import.fields.status',
    );
  });

  it('translates a CSV row whose quotes do not pair up', () => {
    expect(importRowErrorLine(tCommon, { row: 4, quotes: 'unpaired' })).toBe(
      'import.rowError row=4 message=import.unpairedQuotes',
    );
  });

  it.each(Object.entries(LOCALES))(
    'has a %s sentence for unpaired quotes, with no placeholder',
    (_locale, bundle) => {
      const sentence = bundle.common.import.unpairedQuotes;
      expect(sentence).toEqual(expect.any(String));
      expect(sentence).not.toMatch(/\{\w+\}/);
    },
  );

  it('keeps a server refusal as the server text', () => {
    expect(
      importRowErrorMessage(tCommon, {
        row: 2,
        message: 'currency: is not an ISO 4217 currency code',
      }),
    ).toBe('currency: is not an ISO 4217 currency code');
  });

  it.each(Object.entries(LOCALES))(
    'has a %s sentence for every field and reason, with no stray placeholder',
    (_locale, bundle) => {
      const fields = bundle.common.import.fields;
      const reasons = bundle.common.import.reasons;
      for (const field of IMPORT_ROW_FIELDS) {
        expect(fields[field], field).toEqual(expect.any(String));
      }
      for (const reason of IMPORT_ROW_REASONS) {
        const sentence = reasons[reason];
        expect(sentence, reason).toEqual(expect.any(String));
        expect(sentence).toContain('{field}');
        const rendered = sentence
          .replace('{field}', 'Price')
          .replace('{options}', 'active, draft');
        expect(rendered).not.toMatch(/\{\w+\}/);
      }
    },
  );
});
