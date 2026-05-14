/**
 * Generator dataset schema.
 *
 * The committed snapshots under `packages/pii/datasets/<locale>/` are the
 * generator's only inputs. Every file is Zod-validated on load — a typo
 * in the JSON (or a stale shape after a schema change) crashes the
 * generator with a precise error rather than silently producing
 * malformed fixtures.
 *
 * All shapes here mirror `LocaleDataset` in the original plan: the unified
 * cross-source schema that lets each dataset source feed one normalized
 * pipeline.
 */

import { z } from 'zod';

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const streetEntrySchema = z.object({
  name: z.string().min(1),
  countryCode: countryCodeSchema,
  frequency: z.number().int().nonnegative(),
  source: z.enum(['osm', 'openaddresses', 'manual']),
});
export type StreetEntry = z.infer<typeof streetEntrySchema>;

export const cityEntrySchema = z.object({
  name: z.string().min(1),
  countryCode: countryCodeSchema,
  admin1: z.string().nullable(),
  postcodeSample: z.string().nullable(),
  population: z.number().int().nonnegative(),
});
export type CityEntry = z.infer<typeof cityEntrySchema>;

export const addressEntrySchema = z.object({
  number: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  postcode: z.string().min(1),
  countryCode: countryCodeSchema,
});
export type AddressEntry = z.infer<typeof addressEntrySchema>;

export const proseEntrySchema = z.object({
  text: z.string().min(1),
  source: z.enum(['tatoeba', 'oscar', 'manual']),
  upstreamId: z.string().nullable(),
});
export type ProseEntry = z.infer<typeof proseEntrySchema>;

export const nameEntrySchema = z.object({
  given: z.string().min(1),
  family: z.string().min(1),
  countryCode: countryCodeSchema,
  source: z.enum(['wikidata', 'ssa', 'census', 'manual']),
});
export type NameEntry = z.infer<typeof nameEntrySchema>;

export const nationalIdTestVectorsSchema = z.object({
  /** Valid IDs that the detector should mask. */
  valid: z.array(z.string().min(1)),
  /** Near-misses that the checksum should reject. */
  invalid: z.array(z.string().min(1)),
});
export type NationalIdTestVectors = z.infer<typeof nationalIdTestVectorsSchema>;

export const localeMetaSchema = z.object({
  locale: z.string().min(2),
  sources: z.record(
    z.string(),
    z.object({
      url: z.string().url().or(z.string().min(1)),
      version: z.string().min(1),
      spdx: z.string().min(1),
      attribution: z.string().min(1),
    }),
  ),
  generatedAt: z.string().min(1),
});
export type LocaleMeta = z.infer<typeof localeMetaSchema>;

// -----------------------------------------------------------------------------
// Generator output shapes — what tests at packages/pii/test/fixtures/* read
// -----------------------------------------------------------------------------

export interface ExpectedMatch {
  pattern: string;
  start: number;
  end: number;
}

export interface FixtureCase {
  id: string;
  input: string;
  expected: ExpectedMatch[];
}

export interface FixtureFile {
  _meta: {
    locale: string;
    generator: string;
    seed: number;
    datasets: Record<string, string>;
    counts: { positives: number; negatives: number };
    generatedAt: string;
  };
  positives?: FixtureCase[];
  negatives?: FixtureCase[];
}
