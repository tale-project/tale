import type { AddressCase } from './types';

/**
 * English-language address samples. Tests the EN_STREET_KW form (NUMBER + NAME
 * + KEYWORD) and the US/UK ZIP-after-city tail variants — both of which the
 * v1 plan-described regex couldn't match (R1-21 found the planned ZIP_CITY
 * tail assumed continental order, contradicting plan's own EN/UK fixtures).
 */
export const ADDRESSES_EN: AddressCase[] = [
  // ------------- Bare street -------------
  { input: '123 Main Street', expectedMatches: ['123 Main Street'] },
  { input: '1234 5th Ave', expectedMatches: ['1234 5th Ave'] },

  // ------------- US: City + State + ZIP tail -------------
  {
    input: '42 Oak Lane, Apt 5B, Brooklyn NY 11201, USA',
    expectedMatches: ['42 Oak Lane, Apt 5B, Brooklyn NY 11201, USA'],
  },
  {
    input: '123 Main St., Boston MA 02101',
    expectedMatches: ['123 Main St., Boston MA 02101'],
  },

  // ------------- UK: City + postcode tail -------------
  {
    input: '10 Downing Street, London SW1A 2AA, United Kingdom',
    expectedMatches: ['10 Downing Street, London SW1A 2AA, United Kingdom'],
  },
];

/**
 * Negatives: prose that two-letter abbreviations (st./rd./dr.) without the
 * dot would have eaten in v1 (`ist` → `i-st`, `wird` → `wi-rd`). v2 forces
 * the trailing dot.
 */
export const ADDRESSES_EN_NEGATIVES: AddressCase[] = [
  { input: 'I had 5 cookies', expectedMatches: [] },
  { input: 'street art is cool', expectedMatches: [] },
  {
    input: 'She lives in 8th heaven',
    expectedMatches: [],
    note: 'ordinal+number but no street keyword',
  },
];
