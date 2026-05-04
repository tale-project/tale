import type { AddressCase } from './types';

/**
 * Real-world French address samples. Covers metropolitan Paris (1er-20e),
 * provincial cities (Lyon, Marseille, Bordeaux), DOM-TOM territories, and
 * the Romandie (Swiss French) inverted KEYWORD+NAME+NUMBER form that v1
 * missed entirely.
 */
export const ADDRESSES_FR: AddressCase[] = [
  // ------------- Standard (NUMBER + KEYWORD + NAME) -------------
  { input: '12 rue de la Paix', expectedMatches: ['12 rue de la Paix'] },
  {
    input: '5 avenue des Champs-Élysées',
    expectedMatches: ['5 avenue des Champs-Élysées'],
    note: 'v1 truncated to "5 avenue des Champs-" because of \\w on É',
  },
  {
    input: '12 rue de la Paix, 75001 Paris, France',
    expectedMatches: ['12 rue de la Paix, 75001 Paris, France'],
  },
  {
    input: '8 boulevard Voltaire, 75011 Paris',
    expectedMatches: ['8 boulevard Voltaire, 75011 Paris'],
  },
  {
    input: '42 chemin du Moulin, 13001 Marseille',
    expectedMatches: ['42 chemin du Moulin, 13001 Marseille'],
  },
  {
    input: '15 impasse des Lilas, 69001 Lyon',
    expectedMatches: ['15 impasse des Lilas, 69001 Lyon'],
  },
  {
    input: '12 bis rue de Téhéran, 75008 Paris',
    expectedMatches: ['12 bis rue de Téhéran, 75008 Paris'],
    note: 'bis number variant',
  },

  // ------------- DOM-TOM (5-digit zip starting 97/98) -------------
  {
    input: '5 rue Schoelcher, 97200 Fort-de-France, Martinique',
    expectedMatches: ['5 rue Schoelcher, 97200 Fort-de-France, Martinique'],
  },
  {
    input: '12 rue Victor Hugo, 97400 Saint-Denis, Réunion',
    expectedMatches: ['12 rue Victor Hugo, 97400 Saint-Denis, Réunion'],
  },

  // ------------- Romandie inverted (KEYWORD + NAME + NUMBER) -------------
  {
    input: 'Avenue du Léman 5, 1003 Lausanne, Suisse',
    expectedMatches: ['Avenue du Léman 5, 1003 Lausanne, Suisse'],
    note: 'Romandie default order — v1 caught 0/32 of these',
  },
  {
    input: 'Rue du Rhône 12, 1204 Genève',
    expectedMatches: ['Rue du Rhône 12, 1204 Genève'],
  },
  {
    input: 'Place Fédérale 1, 1700 Fribourg',
    expectedMatches: ['Place Fédérale 1, 1700 Fribourg'],
  },
  {
    input: 'Boulevard Georges-Favon 3, 1204 Genève',
    expectedMatches: ['Boulevard Georges-Favon 3, 1204 Genève'],
  },

  // ------------- Embedded in chat prose -------------
  {
    input:
      'Mes coordonnées : 12 rue de la Paix, 75001 Paris. Cordialement, Jean.',
    expectedMatches: ['12 rue de la Paix, 75001 Paris'],
    note: 'R1-30 D-group: must not eat "Cordialement, Jean."',
  },
  {
    input: "J'habite Avenue du Léman 5, 1003 Lausanne depuis 2010.",
    expectedMatches: ['Avenue du Léman 5, 1003 Lausanne'],
  },
];

/**
 * Negative cases. v2 must not over-match prose that contains keywords or
 * numbers but no real address.
 */
export const ADDRESSES_FR_NEGATIVES: AddressCase[] = [
  { input: 'Le 5 mai 1945, la guerre est finie.', expectedMatches: [] },
  {
    input: 'Il y a 12 chaises dans la salle.',
    expectedMatches: [],
  },
  {
    input: 'Marie habite à Paris depuis 2010.',
    expectedMatches: [],
  },
  {
    input: 'À 5 minutes en métro.',
    expectedMatches: [],
    note: 'number + minutes — Romandie shape blocked by negative lookahead',
  },
  {
    input: 'La rue est calme à 22h.',
    expectedMatches: [],
    note: 'Romandie shape requires uppercase proper noun in NAME',
  },
  {
    input: 'La Place de la Concorde est belle.',
    expectedMatches: [],
    note: 'Place keyword but no terminal number',
  },
  { input: '1968 fut une année historique.', expectedMatches: [] },
  {
    input: 'Avenue de la République à 5 minutes.',
    expectedMatches: [],
    note: 'has KEYWORD + NAME but trailing number is "5 minutes"',
  },
];
