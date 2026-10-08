/**
 * Input nobody should send, sent on purpose: oversized and empty values,
 * control and bidi characters, emoji clusters, markup and SQL-looking text,
 * malformed ids. A platform answers each with a 4xx naming the problem (or
 * stores it inertly); a 5xx is a finding.
 */

import { type Random, intBetween, pick } from './random.ts';

/** Strings a text field must store inertly or refuse cleanly. */
export const HOSTILE_STRINGS: readonly string[] = [
  '<script>alert(document.cookie)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  '1; SELECT pg_sleep(10)',
  '${7*7}{{7*7}}<%= 7*7 %>',
  '../../../../etc/passwd',
  '%00%0d%0aSet-Cookie:%20pwned=1',
  'line\r\nbreak',
  // Right-to-left override, zero-width joiner, combining marks.
  '‮gnp.exe‬',
  'a‍b​c﻿',
  'Z̴̛͙̈́a̶̞͐l̵̢̛g̸̱͝o̷̧͝',
  '👩‍👩‍👧‍👦🏳️‍🌈🇨🇭'.repeat(20),
  'مرحبا بالعالم — שלום עולם',
  '\u0000nul\u0000byte',
  '\uD800',
  ' '.repeat(50),
  '',
];

/** A string of `length` characters, sometimes multi-byte. */
export function oversized(random: Random, length: number): string {
  const unit = pick(random, ['x', 'é', '漢', '🙂']) ?? 'x';
  // Each emoji is two UTF-16 units; repeat to reach `length` code units.
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/** A hostile string, sometimes padded far past any field's cap. */
export function hostileString(random: Random): string {
  if (random() < 0.2)
    return oversized(random, intBetween(random, 1_000, 120_000));
  return pick(random, HOSTILE_STRINGS) ?? '';
}

/**
 * `text` with lone surrogates replaced, for places that must encode it as
 * UTF-8 before sending (a query string): `encodeURIComponent` throws on a
 * lone surrogate, which would fail the harness rather than probe the server.
 */
export function wellFormed(text: string): string {
  return text.toWellFormed();
}

/** Ids that name nothing — or try to escape the path they sit in. */
const HOSTILE_IDS: readonly string[] = [
  '00000000-0000-0000-0000-000000000000',
  'not-a-real-id',
  "1' OR '1'='1",
  '..%2F..%2Fadmin',
  '%00',
  'null',
  'undefined',
  '-1',
  '9'.repeat(40),
  'a'.repeat(300),
];

export function hostileId(random: Random): string {
  return pick(random, HOSTILE_IDS) ?? 'not-a-real-id';
}

/** Values in the place of an enum that only takes a fixed few. */
const WRONG_ENUMS: readonly unknown[] = [
  'p9',
  'URGENT',
  'flying',
  '',
  42,
  null,
  true,
  ['todo'],
  { $ne: null },
];

export function wrongEnum(random: Random): unknown {
  return pick(random, WRONG_ENUMS) ?? 'p9';
}

/** Bodies that are not the JSON a route expects. */
const MALFORMED_BODIES: readonly string[] = [
  '{"title":',
  '{"title": "x",}',
  'null',
  '[]',
  '"just a string"',
  '{"__proto__": {"admin": true}}',
  '{"constructor": {"prototype": {"admin": true}}}',
  '',
  '\u0000',
];

export function malformedBody(random: Random): string {
  return pick(random, MALFORMED_BODIES) ?? '{';
}
