import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  IMPORT_ROW_FIELDS,
  IMPORT_ROW_REASONS,
} from '@/lib/utils/file-parsing';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import {
  importFileErrorMessage,
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
      unreadable: string;
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

describe('importFileErrorMessage (#4841)', () => {
  const tCommon = ((key: string, params?: Record<string, unknown>) =>
    params
      ? `${key} ${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' ')}`
      : key) as unknown as TFunction;

  it('words a missing column from its code, the columns and the headers found', () => {
    expect(
      importFileErrorMessage(tCommon, {
        code: 'missingColumns',
        columns: ['price', 'stock'],
        found: ['name', 'preis'],
      }),
    ).toBe(
      'import.missingColumns count=2 columns=price, stock foundCount=2 found=name, preis',
    );
  });

  it('words a file of another format and a file it could not read', () => {
    expect(importFileErrorMessage(tCommon, { code: 'unsupportedFormat' })).toBe(
      'validation.unsupportedFileType',
    );
    expect(importFileErrorMessage(tCommon, { code: 'unreadable' })).toBe(
      'import.unreadable',
    );
  });

  // The catalogs' ICU, rendered: one missing column or several, beside no
  // header, one, or several. The column names stay the headers the parser
  // accepts, untranslated.
  const SENTENCES = {
    en: [
      'This file is missing the column email. Its columns are e-mail-adresse, name.',
      'This file is missing the columns price, stock. Its only column is name.',
      'This file is missing the columns name, price, stock. Its first row names no columns.',
    ],
    de: [
      'Dieser Datei fehlt die Spalte email. Vorhanden sind die Spalten e-mail-adresse, name.',
      'Dieser Datei fehlen die Spalten price, stock. Vorhanden ist nur die Spalte name.',
      'Dieser Datei fehlen die Spalten name, price, stock. In der ersten Zeile steht kein Spaltenname.',
    ],
    fr: [
      'Ce fichier ne contient pas la colonne email. Il contient les colonnes e-mail-adresse, name.',
      'Ce fichier ne contient pas les colonnes price, stock. Il contient seulement la colonne name.',
      'Ce fichier ne contient pas les colonnes name, price, stock. Sa première ligne ne contient aucun nom de colonne.',
    ],
  } as const;

  it.each(Object.entries(SENTENCES))(
    'renders a missing column in %s',
    (locale, [oneOfTwo, twoOfOne, threeOfNone]) => {
      const t = i18n.getFixedT(locale, 'common');
      expect(
        importFileErrorMessage(t, {
          code: 'missingColumns',
          columns: ['email'],
          found: ['e-mail-adresse', 'name'],
        }),
      ).toBe(oneOfTwo);
      expect(
        importFileErrorMessage(t, {
          code: 'missingColumns',
          columns: ['price', 'stock'],
          found: ['name'],
        }),
      ).toBe(twoOfOne);
      expect(
        importFileErrorMessage(t, {
          code: 'missingColumns',
          columns: ['name', 'price', 'stock'],
          found: [],
        }),
      ).toBe(threeOfNone);
    },
  );

  it.each(Object.entries(LOCALES))(
    'has a %s sentence for a file it could not read and one of another format',
    (locale, bundle) => {
      const t = i18n.getFixedT(locale, 'common');
      const unreadable = importFileErrorMessage(t, { code: 'unreadable' });
      expect(unreadable).toBe(bundle.common.import.unreadable);
      expect(unreadable).toMatch(/\.xlsx .*\.csv/);
      expect(importFileErrorMessage(t, { code: 'unsupportedFormat' })).not.toBe(
        'validation.unsupportedFileType',
      );
    },
  );
});
