/**
 * The 43-locale fixture corpus, exhaustively.
 *
 * `fixtures/<locale>/{positives,negatives}.yml` is FROZEN data (see
 * fixtures/LICENSES.md): generated once from public-dataset slices,
 * validated against the reference engine, and committed as the ground
 * truth the rewritten engine must keep matching. The retired generator is
 * not needed to verify freshness — the corpus is the contract.
 *
 * Assertions:
 *  - every positive is detected (`modified`) AND every pattern its
 *    `expected` list names appears in the outcome's categoryIds — a
 *    positive being caught by the wrong pattern is a regression too;
 *  - every negative passes untouched.
 *
 * One full-coverage scrubber per locale, shared across its cases (the
 * vitest project runs with `isolate: false` so the pre-built scrubbers
 * amortize across the ~67k cases).
 */

/**
 * Fixture cases whose `expected` label the REFERENCE engine itself never
 * satisfied: for these ten Persian address cases the reference detected
 * only a national-ID lookalike in the postcode digits (`sa-national-id` /
 * `cz-birth-number`), never `address` — verified by running the retired
 * engine side by side. The corpus stays frozen, so the label defect is
 * carried here explicitly: these cases must still be DETECTED, but their
 * pattern label is not enforced.
 */
const MISLABELED_EXPECTED: ReadonlySet<string> = new Set([
  'fa/addr-fa-00000',
  'fa/addr-fa-00001',
  'fa/addr-fa-00002',
  'fa/addr-fa-00003',
  'fa/addr-fa-00004',
  'fa/addr-fa-00005',
  'fa/addr-fa-00006',
  'fa/addr-fa-00007',
  'fa/addr-fa-00008',
  'fa/addr-fa-00009',
]);

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PatternRegistry, createScrubber, type Scrubber } from '../../lib/pii';
import { parseYamlOrThrow } from '../../lib/shared/config/yaml';

/** Shape of the frozen fixture files (formerly the generator's output). */
interface FixtureCase {
  id: string;
  input: string;
  expected: Array<{ pattern: string; start: number; end: number }>;
}

interface FixtureFile {
  _meta: { locale: string; counts: { positives: number; negatives: number } };
  positives?: FixtureCase[];
  negatives?: FixtureCase[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, 'fixtures');

// The larger locale files are well past the shared parser's org-config
// default byte cap.
const FIXTURE_MAX_BYTES = 32 * 1024 * 1024;

function loadFixture(
  locale: string,
  kind: 'positives' | 'negatives',
): FixtureFile | null {
  const path = join(FIXTURES_ROOT, locale, `${kind}.yml`);
  if (!existsSync(path)) return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- frozen corpus data validated by shape below
  return parseYamlOrThrow(readFileSync(path, 'utf8'), {
    maxBytes: FIXTURE_MAX_BYTES,
  }) as FixtureFile;
}

const REGISTRY = PatternRegistry.fromDefaults();
const REGISTERED = new Set(REGISTRY.listLocales());

function localesWithFixtures(): string[] {
  if (!existsSync(FIXTURES_ROOT)) return [];
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => REGISTERED.has(name));
}

const LOCALES = localesWithFixtures();

// One full-coverage scrubber per locale, built once and reused across all
// of that locale's cases.
const SCRUBBERS = new Map<string, Scrubber>();
for (const locale of LOCALES) {
  SCRUBBERS.set(
    locale,
    createScrubber({
      mode: 'mask',
      registry: REGISTRY,
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

it('has fixture coverage for every registered locale', () => {
  expect(LOCALES.length).toBe(43);
});

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
      it.each(posCases)('detects $id', (c) => {
        const outcome = scrubber.scrub(c.input);
        expect(outcome.kind).toBe('modified');
        if (outcome.kind !== 'modified') return;
        if (MISLABELED_EXPECTED.has(`${locale}/${c.id}`)) return;
        for (const expectedPattern of new Set(
          c.expected.map((e) => e.pattern),
        )) {
          expect(outcome.categoryIds).toContain(expectedPattern);
        }
      });
    });
  }

  const negCases = negatives?.negatives;
  if (negCases && negCases.length > 0) {
    describe('negatives', () => {
      it.each(negCases)('passes $id', (c) => {
        const outcome = scrubber.scrub(c.input);
        expect(outcome.kind).toBe('pass');
      });
    });
  }
});
