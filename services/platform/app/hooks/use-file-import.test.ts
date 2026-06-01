import { describe, it, expect } from 'vitest';

import { parseCSVWithMapper } from '@/lib/utils/file-parsing';

import {
  customerMappers,
  productMappers,
  PRODUCT_REQUIRED_COLUMNS,
  vendorMappers,
} from './use-file-import';

describe('vendorMappers.csv', () => {
  it('parses email only', () => {
    const result = vendorMappers.csv(['vendor@example.com'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: undefined,
      locale: 'en',
      source: 'manual_import',
    });
  });

  it('parses email with locale (2 fields)', () => {
    const result = vendorMappers.csv(['vendor@example.com', 'es'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: undefined,
      locale: 'es',
      source: 'manual_import',
    });
  });

  it('parses email with locale containing region (2 fields)', () => {
    const result = vendorMappers.csv(['vendor@example.com', 'pt-BR'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: undefined,
      locale: 'pt-BR',
      source: 'manual_import',
    });
  });

  it('parses email with locale using underscore separator (2 fields)', () => {
    const result = vendorMappers.csv(['vendor@example.com', 'zh_Hans'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: undefined,
      locale: 'zh_Hans',
      source: 'manual_import',
    });
  });

  it('parses email with name (2 fields, non-locale value)', () => {
    const result = vendorMappers.csv(['vendor@example.com', 'Acme Corp'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: 'Acme Corp',
      locale: 'en',
      source: 'manual_import',
    });
  });

  it('parses email, name, and locale (3 fields)', () => {
    const result = vendorMappers.csv(
      ['vendor@example.com', 'Acme Corp', 'fr'],
      0,
    );
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: 'Acme Corp',
      locale: 'fr',
      source: 'manual_import',
    });
  });

  it('handles empty name in 3-field format', () => {
    const result = vendorMappers.csv(['vendor@example.com', '', 'de'], 0);
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: undefined,
      locale: 'de',
      source: 'manual_import',
    });
  });

  it('returns null for empty email', () => {
    const result = vendorMappers.csv(['', 'name'], 0);
    expect(result).toBeNull();
  });

  it('returns null for missing email', () => {
    const result = vendorMappers.csv([], 0);
    expect(result).toBeNull();
  });
});

describe('vendorMappers.excel', () => {
  it('parses record with lowercase keys', () => {
    const result = vendorMappers.excel({
      email: 'vendor@example.com',
      name: 'Acme Corp',
      locale: 'fr',
    });
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: 'Acme Corp',
      locale: 'fr',
      source: 'file_upload',
    });
  });

  it('defaults locale to en when missing', () => {
    const result = vendorMappers.excel({ email: 'v@example.com' });
    expect(result).toEqual({
      email: 'v@example.com',
      name: undefined,
      locale: 'en',
      source: 'file_upload',
    });
  });

  it('returns null when email is missing', () => {
    const result = vendorMappers.excel({ name: 'Acme Corp' });
    expect(result).toBeNull();
  });

  // Regression test for #1323: a vendor file whose columns are named
  // differently ("Email Address", "Company", "Language") must still map
  // every field instead of silently dropping the name/locale.
  it('maps aliased header columns (email address / company / language)', () => {
    const result = vendorMappers.excel({
      'email address': 'vendor@example.com',
      company: 'Acme Corp',
      language: 'de',
    });
    expect(result).toEqual({
      email: 'vendor@example.com',
      name: 'Acme Corp',
      locale: 'de',
      source: 'file_upload',
    });
  });

  it('maps "vendor name" alias to name', () => {
    const result = vendorMappers.excel({
      email: 'vendor@example.com',
      'vendor name': 'Beta LLC',
    });
    expect(result).toMatchObject({ name: 'Beta LLC' });
  });
});

describe('customerMappers.excel', () => {
  it('parses record with lowercase keys', () => {
    const result = customerMappers.excel({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'es',
    });
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'es',
      status: 'active',
      source: 'file_upload',
    });
  });

  it('defaults locale to en when missing', () => {
    const result = customerMappers.excel({ email: 'user@example.com' });
    expect(result).toEqual({
      email: 'user@example.com',
      name: undefined,
      locale: 'en',
      status: 'active',
      source: 'file_upload',
    });
  });

  it('returns null when email is missing', () => {
    const result = customerMappers.excel({ name: 'John Doe' });
    expect(result).toBeNull();
  });

  // Regression test for #1312: aliased header columns must still map.
  it('maps aliased header columns (e-mail / full name / lang)', () => {
    const result = customerMappers.excel({
      'e-mail': 'user@example.com',
      'full name': 'John Doe',
      lang: 'fr',
    });
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'fr',
      status: 'active',
      source: 'file_upload',
    });
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

  it('returns null when name and title are missing', () => {
    const result = productMappers.record({ description: 'orphan' });
    expect(result).toBeNull();
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

describe('customerMappers.csv', () => {
  it('parses email with locale (2 fields)', () => {
    const result = customerMappers.csv(['user@example.com', 'fr'], 0);
    expect(result).toEqual({
      email: 'user@example.com',
      name: undefined,
      locale: 'fr',
      status: 'active',
      source: 'manual_import',
    });
  });

  it('parses email with name (2 fields, non-locale value)', () => {
    const result = customerMappers.csv(['user@example.com', 'John Doe'], 0);
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'en',
      status: 'active',
      source: 'manual_import',
    });
  });

  it('parses email, name, and locale (3 fields)', () => {
    const result = customerMappers.csv(
      ['user@example.com', 'John Doe', 'es'],
      0,
    );
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'es',
      status: 'active',
      source: 'manual_import',
    });
  });
});
