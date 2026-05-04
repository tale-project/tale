import type { AddressCase } from './types';

/**
 * Dutch address samples. The R1 review found NL coverage was 0/5 — Dutch
 * suffixes (`straat/gracht/plein/laan/dijk/singel/kade`) were absent from
 * `DE_SUFFIX_GLUED`, and `1012 LG Amsterdam` postcode shape was not in the
 * ZIPCITY_TAIL alternation. Both gaps fixed in P2 (FN-01).
 */
export const ADDRESSES_NL: AddressCase[] = [
  // ------------- Bare street with glued NL suffix -------------
  { input: 'Herengracht 23', expectedMatches: ['Herengracht 23'] },
  { input: 'Vondelstraat 44', expectedMatches: ['Vondelstraat 44'] },
  { input: 'Westersingel 7', expectedMatches: ['Westersingel 7'] },
  { input: 'Museumplein 1', expectedMatches: ['Museumplein 1'] },
  { input: 'Spuistraat 12', expectedMatches: ['Spuistraat 12'] },

  // ------------- Full NL postcode (DDDD AA) -------------
  {
    input: 'Vondelstraat 44, 1054 GE Amsterdam',
    expectedMatches: ['Vondelstraat 44, 1054 GE Amsterdam'],
  },
  {
    input: 'Kalverstraat 10, 1012 PA Amsterdam, Nederland',
    expectedMatches: ['Kalverstraat 10, 1012 PA Amsterdam, Nederland'],
  },
  {
    input: 'Westersingel 7, 3014 GL Rotterdam',
    expectedMatches: ['Westersingel 7, 3014 GL Rotterdam'],
  },
];

export const ADDRESSES_NL_NEGATIVES: AddressCase[] = [
  { input: 'Het is een mooie laan', expectedMatches: [] },
  { input: 'Loop maar over de gracht', expectedMatches: [] },
  { input: 'De plein is groot', expectedMatches: [] },
];
