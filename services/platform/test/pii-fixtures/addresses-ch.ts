import type { AddressCase } from './types';

/**
 * Swiss-specific address samples. Switzerland mixes German/French/Italian and
 * uses a 4-digit postal code (vs DE's 5-digit). The dominant Romandie order
 * is `KEYWORD + NAME + NUMBER` (covered by the FR_INV form). Ticino contributes
 * Italian-language addresses (`Via Nassa 5`).
 */
export const ADDRESSES_CH: AddressCase[] = [
  // ------------- German-speaking (Zürich/Bern/Basel) -------------
  {
    input: 'Bahnhofstrasse 23, 8001 Zürich',
    expectedMatches: ['Bahnhofstrasse 23, 8001 Zürich'],
  },
  {
    input: 'Bahnhofstrasse 23, CH-8001 Zürich, Schweiz',
    expectedMatches: ['Bahnhofstrasse 23, CH-8001 Zürich, Schweiz'],
    note: 'CH- prefix on postal code',
  },
  {
    input: 'Limmatquai 138, 8001 Zürich',
    expectedMatches: ['Limmatquai 138, 8001 Zürich'],
    note: 'free-suffix street, no -strasse',
  },
  {
    input: 'Bundesplatz 3, 3005 Bern, Suisse',
    expectedMatches: ['Bundesplatz 3, 3005 Bern, Suisse'],
  },
  {
    input: 'Aeschenvorstadt 50, 4051 Basel',
    expectedMatches: ['Aeschenvorstadt 50, 4051 Basel'],
  },

  // ------------- French-speaking Romandie (inverted) -------------
  {
    input: 'Rue du Rhône 12, 1204 Genève, Suisse',
    expectedMatches: ['Rue du Rhône 12, 1204 Genève, Suisse'],
  },
  {
    input: 'Avenue du Léman 5, 3ème étage, 1003 Lausanne',
    expectedMatches: ['Avenue du Léman 5, 3ème étage, 1003 Lausanne'],
  },
  {
    input: 'Boulevard Georges-Favon 3, 1204 Genève',
    expectedMatches: ['Boulevard Georges-Favon 3, 1204 Genève'],
  },

  // ------------- Italian-speaking Ticino -------------
  {
    input: 'Via Nassa 5, 6900 Lugano',
    expectedMatches: ['Via Nassa 5, 6900 Lugano'],
  },
  {
    input: 'Piazza della Riforma 1, 6900 Lugano, Svizzera',
    expectedMatches: ['Piazza della Riforma 1, 6900 Lugano, Svizzera'],
  },
  {
    input: 'Viale Stazione 4, 6500 Bellinzona',
    expectedMatches: ['Viale Stazione 4, 6500 Bellinzona'],
  },

  // ------------- Embedded in prose -------------
  {
    input: 'Mein Büro: Bahnhofstrasse 23, 8001 Zürich. Bis morgen!',
    expectedMatches: ['Bahnhofstrasse 23, 8001 Zürich'],
  },
];
