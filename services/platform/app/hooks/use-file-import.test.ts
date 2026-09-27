import { describe, it, expect } from 'vitest';

import { ImportRowRefusal, parseCSVWithMapper } from '@/lib/utils/file-parsing';

import {
  contactMappers,
  productMappers,
  PRODUCT_REQUIRED_COLUMNS,
} from './use-file-import';

describe('contactMappers.csv', () => {
  it('parses email only, leaving locale unset (#2642)', () => {
    const result = contactMappers.csv(['contact@example.com'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: undefined,
      locale: undefined,
      source: 'manual_import',
    });
  });

  it('parses email with locale (2 fields)', () => {
    const result = contactMappers.csv(['contact@example.com', 'es'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: undefined,
      locale: 'es',
      source: 'manual_import',
    });
  });

  it('parses email with locale containing region (2 fields)', () => {
    const result = contactMappers.csv(['contact@example.com', 'pt-BR'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: undefined,
      locale: 'pt-BR',
      source: 'manual_import',
    });
  });

  it('parses email with locale using underscore separator (2 fields)', () => {
    const result = contactMappers.csv(['contact@example.com', 'zh_Hans'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: undefined,
      locale: 'zh_Hans',
      source: 'manual_import',
    });
  });

  it('parses email with name (2 fields, non-locale value), leaving locale unset', () => {
    const result = contactMappers.csv(['contact@example.com', 'Acme Corp'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: 'Acme Corp',
      locale: undefined,
      source: 'manual_import',
    });
  });

  it('parses email, name, and locale (3 fields)', () => {
    const result = contactMappers.csv(
      ['contact@example.com', 'Acme Corp', 'fr'],
      0,
    );
    expect(result).toEqual({
      email: 'contact@example.com',
      name: 'Acme Corp',
      locale: 'fr',
      source: 'manual_import',
    });
  });

  it('handles empty name in 3-field format', () => {
    const result = contactMappers.csv(['contact@example.com', '', 'de'], 0);
    expect(result).toEqual({
      email: 'contact@example.com',
      name: undefined,
      locale: 'de',
      source: 'manual_import',
    });
  });

  it('returns null for empty email', () => {
    const result = contactMappers.csv(['', 'name'], 0);
    expect(result).toBeNull();
  });

  it('returns null for missing email', () => {
    const result = contactMappers.csv([], 0);
    expect(result).toBeNull();
  });
});

describe('contactMappers.excel', () => {
  it('parses record with lowercase keys', () => {
    const result = contactMappers.excel({
      email: 'contact@example.com',
      name: 'Acme Corp',
      locale: 'fr',
    });
    expect(result).toEqual({
      email: 'contact@example.com',
      name: 'Acme Corp',
      locale: 'fr',
      source: 'file_upload',
    });
  });

  it('leaves locale unset when missing, instead of fabricating "en" (#2642)', () => {
    const result = contactMappers.excel({ email: 'v@example.com' });
    expect(result).toEqual({
      email: 'v@example.com',
      name: undefined,
      locale: undefined,
      source: 'file_upload',
    });
  });

  it('refuses a row without an email instead of dropping it', () => {
    expect(() => contactMappers.excel({ name: 'Acme Corp' })).toThrow(
      expect.objectContaining({ field: 'email', reason: 'blank' }),
    );
  });

  // Regression test for #1323: a contact file whose columns are named
  // differently ("Email Address", "Company", "Language") must still map
  // every field instead of silently dropping the name/locale.
  it('maps aliased header columns (email address / company / language)', () => {
    const result = contactMappers.excel({
      'email address': 'contact@example.com',
      company: 'Acme Corp',
      language: 'de',
    });
    expect(result).toEqual({
      email: 'contact@example.com',
      name: 'Acme Corp',
      locale: 'de',
      source: 'file_upload',
    });
  });

  it('maps "vendor name" alias to name', () => {
    const result = contactMappers.excel({
      email: 'contact@example.com',
      'vendor name': 'Beta LLC',
    });
    expect(result).toMatchObject({ name: 'Beta LLC' });
  });
});

describe('productMappers.record', () => {
  it('parses record with lowercase keys', () => {
    const result = productMappers.record({
      name: 'Widget',
      description: 'A fine widget',
      price: 9.99,
      stock: 100,
      currency: 'EUR',
      category: 'gadgets',
    });
    expect(result).toEqual({
      name: 'Widget',
      description: 'A fine widget',
      imageUrl: undefined,
      price: 9.99,
      stock: 100,
      currency: 'EUR',
      category: 'gadgets',
      status: undefined,
    });
  });

  it('falls back to title when name is missing', () => {
    const result = productMappers.record({ title: 'Gadget', price: 5 });
    expect(result).toMatchObject({ name: 'Gadget' });
  });

  it('refuses a row without a name instead of dropping it', () => {
    expect(() => productMappers.record({ description: 'orphan' })).toThrow(
      expect.objectContaining({ field: 'name', reason: 'blank' }),
    );
  });

  // `notanumber` used to import as a free product with no stock; a row
  // the catalog would refuse is a row error in the door's own voice.
  // The refusal carries field + reason KEYS (translated by the dialog), never
  // an English sentence.
  it.each([
    [{ name: 'X', price: 'notanumber' }, 'price', 'notNumber'],
    [{ name: 'X', stock: 'many' }, 'stock', 'notNumber'],
    [{ name: 'X', price: '-5' }, 'price', 'negative'],
    [{ name: 'X', stock: -3 }, 'stock', 'negative'],
    [{ name: 'X', stock: '1.5' }, 'stock', 'notInteger'],
    [{ name: 'X', price: '1e20' }, 'price', 'tooLarge'],
    [{ name: 'X', currency: 'EURO' }, 'currency', 'notCurrency'],
    [{ price: 1 }, 'name', 'blank'],
  ])('refuses %j as a row error', (record, field, reason) => {
    let thrown: unknown;
    try {
      productMappers.record(record);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ImportRowRefusal);
    expect(thrown).toMatchObject({ field, reason });
  });

  it('accepts a blank price or stock as not given and uppercases the currency', () => {
    expect(
      productMappers.record({
        name: 'X',
        price: '',
        stock: ' ',
        currency: 'chf',
      }),
    ).toMatchObject({ price: 0, stock: 0, currency: 'CHF' });
  });

  it('defaults stock to 0, price to 0, currency to USD', () => {
    const result = productMappers.record({ name: 'Minimal' });
    expect(result).toMatchObject({
      stock: 0,
      price: 0,
      currency: 'USD',
    });
  });

  it('resolves imageurl key (normalized from ImageUrl/imageUrl)', () => {
    const result = productMappers.record({
      name: 'Pic',
      imageurl: 'https://example.com/pic.png',
    });
    expect(result).toMatchObject({
      imageUrl: 'https://example.com/pic.png',
    });
  });
});

describe('productMappers.validateStatus', () => {
  const statuses = ['active', 'draft'] as const;

  it('takes the default for a blank status, in any case for a known one', () => {
    expect(productMappers.validateStatus('', statuses, 'draft')).toBe('draft');
    expect(productMappers.validateStatus(undefined, statuses, 'draft')).toBe(
      'draft',
    );
    expect(productMappers.validateStatus(' Active ', statuses, 'draft')).toBe(
      'active',
    );
  });

  it('refuses an unknown status instead of importing it as the default', () => {
    expect(() =>
      productMappers.validateStatus('flying', statuses, 'draft'),
    ).toThrow(
      expect.objectContaining({
        field: 'status',
        reason: 'notOneOf',
        values: { options: 'active, draft' },
      }),
    );
  });
});

describe('product import column validation (PRODUCT_REQUIRED_COLUMNS)', () => {
  const parse = (csv: string) =>
    parseCSVWithMapper(csv, productMappers.csv, {
      recordMapper: productMappers.record,
      requiredColumns: PRODUCT_REQUIRED_COLUMNS,
    });

  it('imports rows when all required headers are present', () => {
    const result = parse('name,price,stock\nWidget,9.99,100\nGadget,5,0');
    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ name: 'Widget', price: 9.99 });
  });

  it('accepts the title alias in place of name', () => {
    const result = parse('title,price,stock\nGizmo,1.5,3');
    expect(result.errors).toEqual([]);
    expect(result.data[0]).toMatchObject({ name: 'Gizmo' });
  });

  it('fails with a clear error when headers are wrong/misnamed', () => {
    const result = parse('col1,col2,col3\nWidget,9.99,100');
    expect(result.data).toHaveLength(0);
    expect(result.errors[0]).toContain('Missing required column(s)');
    expect(result.errors[0]).toContain('name');
    expect(result.errors[0]).toContain('price');
    expect(result.errors[0]).toContain('stock');
    // Surfaces what was actually found so the user can correct the file.
    expect(result.errors[0]).toContain('col1');
  });

  it('reports only the specific missing required column', () => {
    const result = parse('name,price\nWidget,9.99');
    expect(result.data).toHaveLength(0);
    expect(result.errors[0]).toContain('stock');
    expect(result.errors[0]).not.toContain('Missing required column(s): name');
  });
});

describe('product import row accounting', () => {
  // A row of empty cells (a spreadsheet's trailing lines) is not a record
  // the mapper refuses — it is skipped like an empty line.
  it('skips an all-blank row instead of refusing it', () => {
    const csv = [
      'name,price,stock',
      'Kettle,10,1',
      ',,',
      ' , , ',
      'Mixer,5,2',
    ].join('\n');
    const result = parseCSVWithMapper(csv, productMappers.csv, {
      recordMapper: productMappers.record,
      requiredColumns: PRODUCT_REQUIRED_COLUMNS,
    });
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.data.map((row) => row.name)).toEqual(['Kettle', 'Mixer']);
    expect(result.rows).toEqual([2, 5]);
  });

  it('files a refused row under its spreadsheet line and keeps the rest', () => {
    const csv = [
      'name,price,stock',
      'Kettle,10,1',
      ',10,1',
      'Toaster,notanumber,1',
      'Mixer,5,2',
    ].join('\n');
    const result = parseCSVWithMapper(csv, productMappers.csv, {
      recordMapper: productMappers.record,
      requiredColumns: PRODUCT_REQUIRED_COLUMNS,
    });
    expect(result.errors).toEqual([]);
    expect(result.data.map((row) => row.name)).toEqual(['Kettle', 'Mixer']);
    // Line 1 is the header, so the first data row is line 2.
    expect(result.rows).toEqual([2, 5]);
    expect(result.rowErrors).toEqual([
      { row: 3, field: 'name', reason: 'blank' },
      { row: 4, field: 'price', reason: 'notNumber' },
    ]);
  });
});
