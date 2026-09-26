import { describe, expect, it } from 'vitest';

import { getContactLocaleLabel, getContactSourceLabel } from './contact-data';

describe('getContactSourceLabel', () => {
  const tContacts = (key: string) => `t:${key}`;

  it('names the worded sources through the contacts namespace', () => {
    expect(getContactSourceLabel('manual_import', tContacts, 'Unknown')).toBe(
      't:filter.source.manual',
    );
    expect(getContactSourceLabel('api_import', tContacts, 'Unknown')).toBe(
      't:filter.source.api',
    );
    expect(getContactSourceLabel('conversation', tContacts, 'Unknown')).toBe(
      't:filter.source.conversation',
    );
  });

  it('spells vendors the way they spell themselves', () => {
    expect(getContactSourceLabel('hubspot', tContacts, 'Unknown')).toBe(
      'HubSpot',
    );
    expect(getContactSourceLabel('woocommerce', tContacts, 'Unknown')).toBe(
      'WooCommerce',
    );
    expect(getContactSourceLabel('sap', tContacts, 'Unknown')).toBe('SAP');
  });

  it('start-cases a source it has no label for yet', () => {
    expect(getContactSourceLabel('new_vendor', tContacts, 'Unknown')).toBe(
      'New Vendor',
    );
  });

  it('falls back to the unknown label when source is unset', () => {
    expect(getContactSourceLabel(undefined, tContacts, 'Unknown')).toBe(
      'Unknown',
    );
    expect(getContactSourceLabel(null, tContacts, 'Unknown')).toBe('Unknown');
    expect(getContactSourceLabel('', tContacts, 'Unknown')).toBe('Unknown');
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
