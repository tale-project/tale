import type { AddressCase } from './types';

/**
 * Real-world German address samples. Sourced from public landmarks, postal
 * code references, and common chat-style address inclusions. Covers Berlin,
 * Hamburg, Munich, Stuttgart and the long-tail forms (hyphenated names,
 * spaced multi-word streets, free-suffix streets like Reeperbahn) that the
 * v1 regex consistently failed on.
 *
 * The user-reported case (Round 1) is asserted in pii_patterns.test.ts as a
 * cross-pattern integration test; this fixture focuses on the address
 * detector in isolation.
 */
export const ADDRESSES_DE: AddressCase[] = [
  // ------------- Simple forms (existing v1 baseline) -------------
  { input: 'Musterstraße 123', expectedMatches: ['Musterstraße 123'] },
  { input: 'Bahnhofstr. 5', expectedMatches: ['Bahnhofstr. 5'] },
  { input: 'Hauptstrasse 12', expectedMatches: ['Hauptstrasse 12'] },
  { input: 'Friedrichstr. 12a', expectedMatches: ['Friedrichstr. 12a'] },

  // ------------- With Umlaut (v1 truncated, v2 fixed via \p{L}) -------------
  {
    input: 'Müllerstraße 8, 80539 München',
    expectedMatches: ['Müllerstraße 8, 80539 München'],
  },
  {
    input: 'Mönckebergstraße 7, 20095 Hamburg',
    expectedMatches: ['Mönckebergstraße 7, 20095 Hamburg'],
  },
  {
    input: 'Universitätstrasse 5, 8006 Zürich',
    expectedMatches: ['Universitätstrasse 5, 8006 Zürich'],
    note: 'CH 4-digit zip, would have truncated to "tstrasse" with \\w-only',
  },

  // ------------- Hyphenated street names (v1 missed) -------------
  {
    input: 'Karl-Marx-Allee 50, 10178 Berlin',
    expectedMatches: ['Karl-Marx-Allee 50, 10178 Berlin'],
  },
  {
    input: 'Karl-Theodor-Straße 12, 80803 München',
    expectedMatches: ['Karl-Theodor-Straße 12, 80803 München'],
  },
  {
    input: 'Rudolf-Diesel-Straße 18, 70378 Stuttgart',
    expectedMatches: ['Rudolf-Diesel-Straße 18, 70378 Stuttgart'],
  },

  // ------------- Spaced multi-word streets (v1 missed) -------------
  {
    input: 'Schönhauser Allee 36, 10435 Berlin',
    expectedMatches: ['Schönhauser Allee 36, 10435 Berlin'],
  },
  {
    input: 'Sendlinger Str. 8, 80331 München',
    expectedMatches: ['Sendlinger Str. 8, 80331 München'],
  },
  {
    input: 'Bahrenfelder Str. 244, 22765 Hamburg',
    expectedMatches: ['Bahrenfelder Str. 244, 22765 Hamburg'],
  },

  // ------------- Free-suffix standalone streets (v1 missed) -------------
  {
    input: 'Reeperbahn 1, 20359 Hamburg',
    expectedMatches: ['Reeperbahn 1, 20359 Hamburg'],
  },
  {
    input: 'Schulterblatt 73, 20357 Hamburg',
    expectedMatches: ['Schulterblatt 73, 20357 Hamburg'],
  },
  { input: 'Limmatquai 138', expectedMatches: ['Limmatquai 138'] },
  {
    input: 'Theresienwiese 1, 80339 München',
    expectedMatches: ['Theresienwiese 1, 80339 München'],
  },

  // ------------- DE inverted (Unter den / Am / In der) -------------
  {
    input: 'Unter den Linden 77, 10117 Berlin',
    expectedMatches: ['Unter den Linden 77, 10117 Berlin'],
  },

  // ------------- Floor / unit continuations -------------
  {
    input: 'Hauptstr. 5, 1. Stock, 50667 Köln',
    expectedMatches: ['Hauptstr. 5, 1. Stock, 50667 Köln'],
  },
  {
    input: 'Hauptweg 7, 2. OG, 10115 Berlin',
    expectedMatches: ['Hauptweg 7, 2. OG, 10115 Berlin'],
  },

  // ------------- Cross-border (AT / CH / LI / LU) -------------
  {
    input: 'Mariahilfer Straße 88, 1070 Wien, Österreich',
    expectedMatches: ['Mariahilfer Straße 88, 1070 Wien, Österreich'],
  },
  {
    input: 'Bergstr. 22a, CH-8001 Zürich, Schweiz',
    expectedMatches: ['Bergstr. 22a, CH-8001 Zürich, Schweiz'],
    note: 'CH- prefix on postcode',
  },
  {
    input: 'Avenue de la Liberté 23, L-1930 Luxembourg, Luxemburg',
    expectedMatches: ['Avenue de la Liberté 23, L-1930 Luxembourg, Luxemburg'],
  },

  // ------------- Postfach (DE/CH common) -------------
  {
    input: 'Postfach 1234, 10115 Berlin',
    expectedMatches: ['Postfach 1234, 10115 Berlin'],
  },
  {
    input: 'Postfach 100120, 80100 München',
    expectedMatches: ['Postfach 100120, 80100 München'],
  },

  // ------------- Embedded in chat prose -------------
  {
    input:
      'Die Lieferung soll an Karl-Marx-Allee 50, 10178 Berlin gehen. Vielen Dank!',
    expectedMatches: ['Karl-Marx-Allee 50, 10178 Berlin'],
    note: 'Closed-terminal tail must NOT eat trailing prose "gehen. Vielen Dank!"',
  },
  {
    input: 'Hi, ich wohne in Reeperbahn 1, 20359 Hamburg seit 2020.',
    expectedMatches: ['Reeperbahn 1, 20359 Hamburg'],
  },
  {
    input:
      'Senden Sie das Paket an Hauptstr. 5, 10115 Berlin und ich werde es Samstag abholen.',
    expectedMatches: ['Hauptstr. 5, 10115 Berlin'],
    note: 'R1-30 D-group: must not eat "und ich werde..."',
  },
  {
    input: 'Hauptstr. 5, 10115 Berlin Hauptbahnhof ist nah.',
    expectedMatches: ['Hauptstr. 5, 10115 Berlin'],
    note: 'R1-30 D-group: city must not extend into "Hauptbahnhof"',
  },
];

/**
 * Negative cases: prose that historically false-positived or could plausibly
 * tempt the detector. Asserted to produce zero matches.
 */
export const ADDRESSES_DE_NEGATIVES: AddressCase[] = [
  { input: 'I had 5 cookies', expectedMatches: [] },
  { input: 'street art is cool 5 days', expectedMatches: [] },
  {
    input: 'Visit us at our place tomorrow',
    expectedMatches: [],
    note: 'place keyword without leading number',
  },
  {
    input: 'Apartment hunting in Berlin is hard',
    expectedMatches: [],
    note: 'Apartment alone, no street',
  },
  {
    input: 'Ich gehe morgen zur Hauptbahnhof.',
    expectedMatches: [],
    note: 'Haupt- root but no straße + number',
  },
  {
    input: 'Die Konferenz war in Halle 5.',
    expectedMatches: [],
  },
  {
    input: 'Anna wohnt in Berlin seit 2010.',
    expectedMatches: [],
    note: 'city + year, no street',
  },
  {
    input: 'Schicken Sie 100 Briefe an Kunden.',
    expectedMatches: [],
  },
  {
    input: 'Das war im Jahr 1990.',
    expectedMatches: [],
  },
  {
    input: 'Bahn fährt um 8 Uhr.',
    expectedMatches: [],
    note: 'standalone Bahn must not become "Bahn 8"',
  },
  {
    input: 'Berlin 2024 wird ein spannendes Jahr.',
    expectedMatches: [],
    note: 'city + year prose',
  },
  {
    input: 'Ich habe 50 Tickets verkauft.',
    expectedMatches: [],
  },
];
