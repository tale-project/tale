import { describe, expect, it } from 'vitest';

import {
  getContactAddressLines,
  getContactLocaleLabel,
  getContactSourceLabel,
} from './contact-data';

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

// `address` is a free-form object on the door, so any JSON is a valid stored
// value under any key (#3625).
describe('getContactAddressLines', () => {
  it('reads a flat address as street, city and state, postal code, country', () => {
    expect(
      getContactAddressLines({
        country: 'Switzerland',
        postalCode: '8001',
        state: 'ZH',
        city: 'Zurich',
        street: 'One Test Street',
      }),
    ).toEqual(['One Test Street', 'Zurich, ZH', '8001', 'Switzerland']);
  });

  it('reads a nested object or list as its words in order', () => {
    expect(
      getContactAddressLines({
        street: { line1: 'One Test Street', line2: ['Apt 4', { floor: 2 }] },
        country: 'Switzerland',
      }),
    ).toEqual(['One Test Street, Apt 4, 2', 'Switzerland']);
  });

  it('keeps a lone city or state on its line without a stray comma', () => {
    expect(getContactAddressLines({ city: 'Zurich' })).toEqual(['Zurich']);
    expect(getContactAddressLines({ state: { code: 'ZH' } })).toEqual(['ZH']);
  });

  it('leaves out values with no words: blanks, flags, null, empty containers', () => {
    expect(
      getContactAddressLines({
        street: '  ',
        city: true,
        state: null,
        postalCode: {},
        country: [[], { name: ' ' }],
      }),
    ).toEqual([]);
  });

  it('shows no keys outside the five it reads', () => {
    expect(
      getContactAddressLines({ line1: 'One Test Street', zip: '8001' }),
    ).toEqual([]);
  });

  it('reads nothing from an address that is not an object', () => {
    expect(getContactAddressLines(undefined)).toEqual([]);
    expect(getContactAddressLines(null)).toEqual([]);
    expect(getContactAddressLines('One Test Street')).toEqual([]);
    expect(getContactAddressLines(['One Test Street'])).toEqual([]);
  });

  it('walks a nesting deeper than the call stack without throwing', () => {
    let street: unknown = 'One Test Street';
    for (let depth = 0; depth < 100_000; depth += 1) street = [street];

    expect(getContactAddressLines({ street })).toEqual(['One Test Street']);
  });
});
