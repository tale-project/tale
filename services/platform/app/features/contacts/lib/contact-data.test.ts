import { describe, expect, it } from 'vitest';

import { getContactLocaleLabel, getContactSourceLabel } from './contact-data';

describe('getContactSourceLabel', () => {
  it('start-cases a snake_case source enum', () => {
    expect(getContactSourceLabel('manual_import', 'Unknown')).toBe(
      'Manual Import',
    );
  });

  it('start-cases a single-word source enum', () => {
    expect(getContactSourceLabel('shopify', 'Unknown')).toBe('Shopify');
    expect(getContactSourceLabel('conversation', 'Unknown')).toBe(
      'Conversation',
    );
  });

  it('falls back to the unknown label when source is unset', () => {
    expect(getContactSourceLabel(undefined, 'Unknown')).toBe('Unknown');
    expect(getContactSourceLabel(null, 'Unknown')).toBe('Unknown');
    expect(getContactSourceLabel('', 'Unknown')).toBe('Unknown');
  });
});

describe('getContactLocaleLabel', () => {
  it('returns the locale as-is when set', () => {
    expect(getContactLocaleLabel('en')).toBe('en');
    expect(getContactLocaleLabel('pt-BR')).toBe('pt-BR');
  });

  it('renders an em-dash instead of fabricating a default when unset', () => {
    expect(getContactLocaleLabel(undefined)).toBe('—');
    expect(getContactLocaleLabel(null)).toBe('—');
    expect(getContactLocaleLabel('')).toBe('—');
  });
});
