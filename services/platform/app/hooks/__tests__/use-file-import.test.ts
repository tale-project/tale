import { describe, it, expect } from 'vitest';

import { customerMappers, vendorMappers } from '../use-file-import';

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

describe('customerMappers.csv', () => {
  it('parses email with locale (2 fields)', () => {
    const result = customerMappers.csv(['user@example.com', 'fr'], 0);
    expect(result).toEqual({
      email: 'user@example.com',
      name: undefined,
      locale: 'fr',
      status: 'churned',
      source: 'manual_import',
    });
  });

  it('parses email with name (2 fields, non-locale value)', () => {
    const result = customerMappers.csv(['user@example.com', 'John Doe'], 0);
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'John Doe',
      locale: 'en',
      status: 'churned',
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
      status: 'churned',
      source: 'manual_import',
    });
  });
});
