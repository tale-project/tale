/**
 * Data-driven fixture test.
 *
 * Iterates every per-locale `positives.json` / `negatives.json` under
 * `test/fixtures/` and asserts the detector's behavior:
 *
 *   - Positive cases: `scrubber.scrub(input).kind` is `'modified'`. The
 *     detector must find at least one PII span. Span-precision assertions
 *     are deliberately loose at this stage (Phase 1 lift-and-shift) —
 *     spans are tightened by adding span-overlap checks in Phase 7.
 *   - Negative cases: `kind === 'pass'`. Detector found nothing.
 *
 * 2,000+ cases per locale fan out via `describe.each` × `it.each` —
 * Vitest handles that scale comfortably and parallel-shards across cores.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FixtureFile } from '../scripts/gen/schema';
import { createScrubber, listLocales, type Scrubber } from '../src';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, 'fixtures');

function loadFixture(
  locale: string,
  kind: 'positives' | 'negatives',
): FixtureFile | null {
  const path = join(FIXTURES_ROOT, locale, `${kind}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function localesWithFixtures(): string[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  const registered = new Set(listLocales());
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => registered.has(name));
}

const LOCALES = localesWithFixtures();

// Pre-build one full-coverage scrubber per locale. Reused across all `it.each`
// cases — building per case would dominate runtime.
const SCRUBBERS = new Map<string, Scrubber>();
for (const locale of LOCALES) {
  SCRUBBERS.set(
    locale,
    createScrubber({
      mode: 'mask',
      patterns: {
        email: true,
        phone: true,
        creditCard: true,
        cvc: true,
        iban: true,
        ipAddress: true,
        macAddress: true,
        jwt: true,
        ssn: true,
        dateOfBirth: true,
        address: { locales: [locale] },
        nationalId: { locales: [locale] },
      },
    }),
  );
}

describe.each(LOCALES)('locale: %s', (locale) => {
  const scrubber = SCRUBBERS.get(locale);
  if (!scrubber) {
    throw new Error(`No scrubber for locale ${locale}`);
  }
  const positives = loadFixture(locale, 'positives');
  const negatives = loadFixture(locale, 'negatives');

  const posCases = positives?.positives;
  if (posCases && posCases.length > 0) {
    describe('positives', () => {
      // Full coverage — no `.slice`. The generator's self-consistency
      // filter guarantees every case is detectable, so the per-case cost
      // is sub-ms and the suite scales linearly with corpus size.
      it.each(posCases)('detects $id', ({ input }) => {
        const outcome = scrubber.scrub(input);
        expect(outcome.kind).toBe('modified');
      });
    });
  }

  const negCases = negatives?.negatives;
  if (negCases && negCases.length > 0) {
    describe('negatives', () => {
      it.each(negCases)('passes $id', ({ input }) => {
        const outcome = scrubber.scrub(input);
        expect(outcome.kind).toBe('pass');
      });
    });
  }
});
