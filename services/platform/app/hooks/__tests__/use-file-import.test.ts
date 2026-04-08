import { describe, it, expect } from 'vitest';

import {
  customerMappers,
  productMappers,
  vendorMappers,
} from '../use-file-import';

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
});

describe('productMappers.excel', () => {
  it('parses record with lowercase keys', () => {
    const result = productMappers.excel({
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
    const result = productMappers.excel({ title: 'Gadget', price: 5 });
    expect(result).toMatchObject({ name: 'Gadget' });
  });

  it('returns null when name and title are missing', () => {
    const result = productMappers.excel({ description: 'orphan' });
    expect(result).toBeNull();
  });

  it('defaults stock to 0, price to 0, currency to USD', () => {
    const result = productMappers.excel({ name: 'Minimal' });
    expect(result).toMatchObject({
      stock: 0,
      price: 0,
      currency: 'USD',
    });
  });

  it('resolves imageurl key (normalized from ImageUrl/imageUrl)', () => {
    const result = productMappers.excel({
      name: 'Pic',
      imageurl: 'https://example.com/pic.png',
    });
    expect(result).toMatchObject({
      imageUrl: 'https://example.com/pic.png',
    });
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
