/**
 * Source adapters — file-system readers for the committed dataset snapshots.
 *
 * Each function reads one file under `packages/pii/datasets/<locale>/`,
 * parses JSON, validates against its Zod schema, and returns a typed
 * array. Missing files are tolerated — return `[]` and the generator's
 * builders skip the category. This is what makes adding a new locale a
 * progressive process: you can ship a locale with only `streets.json` +
 * `cities.json` and add `addresses.json` later.
 *
 * Offline guarantee: every function reads only from the committed
 * `datasets/` directory. No URL fetches; no `process.env`-driven path
 * overrides that could escape into the maintainer's local cache.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  addressEntrySchema,
  cityEntrySchema,
  localeMetaSchema,
  nameEntrySchema,
  nationalIdTestVectorsSchema,
  proseEntrySchema,
  streetEntrySchema,
  type AddressEntry,
  type CityEntry,
  type LocaleMeta,
  type NameEntry,
  type NationalIdTestVectors,
  type ProseEntry,
  type StreetEntry,
} from './schema';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root path of the committed datasets — pinned relative to this file. */
const DATASETS_ROOT = join(__dirname, '..', '..', 'datasets');

function loadOptionalJson<T>(
  locale: string,
  filename: string,
  schema: z.ZodType<T>,
): T | null {
  const path = join(DATASETS_ROOT, locale, filename);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  return schema.parse(JSON.parse(raw));
}

export function readStreets(locale: string): StreetEntry[] {
  return (
    loadOptionalJson(locale, 'streets.json', z.array(streetEntrySchema)) ?? []
  );
}

export function readCities(locale: string): CityEntry[] {
  return (
    loadOptionalJson(locale, 'cities.json', z.array(cityEntrySchema)) ?? []
  );
}

export function readAddresses(locale: string): AddressEntry[] {
  return (
    loadOptionalJson(locale, 'addresses.json', z.array(addressEntrySchema)) ??
    []
  );
}

export function readProse(locale: string): ProseEntry[] {
  return (
    loadOptionalJson(locale, 'prose.json', z.array(proseEntrySchema)) ?? []
  );
}

export function readNames(locale: string): NameEntry[] {
  return loadOptionalJson(locale, 'names.json', z.array(nameEntrySchema)) ?? [];
}

export function readNationalIdVectors(
  locale: string,
): NationalIdTestVectors | null {
  return loadOptionalJson(
    locale,
    'national-ids.json',
    nationalIdTestVectorsSchema,
  );
}

export function readLocaleMeta(locale: string): LocaleMeta | null {
  return loadOptionalJson(locale, '_meta.json', localeMetaSchema);
}

export interface LocaleDataset {
  locale: string;
  streets: StreetEntry[];
  cities: CityEntry[];
  addresses: AddressEntry[];
  prose: ProseEntry[];
  names: NameEntry[];
  nationalIdVectors: NationalIdTestVectors | null;
  meta: LocaleMeta | null;
}

/** One pass — load every committed file for the locale. */
export function loadLocaleDataset(locale: string): LocaleDataset {
  return {
    locale,
    streets: readStreets(locale),
    cities: readCities(locale),
    addresses: readAddresses(locale),
    prose: readProse(locale),
    names: readNames(locale),
    nationalIdVectors: readNationalIdVectors(locale),
    meta: readLocaleMeta(locale),
  };
}
