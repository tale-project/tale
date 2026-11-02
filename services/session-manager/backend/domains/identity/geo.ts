// Offline IP geolocation from Camoufox's local GeoIP database, and the language
// for a country.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';

import { errorText } from '../../lib/error-text.ts';
import { GeoLookupError } from './types.ts';
import type { GeoInfo } from './types.ts';

// Languages that Firefox ships as UI locales and that people commonly browse
// in. Camoufox's own pick draws from every language spoken in the country
// (Swiss German, Lombard or Portuguese for Switzerland), which real Firefox
// users almost never send.
export const FIREFOX_LANGUAGES: ReadonlySet<string> = new Set(
  [
    'ar az be bg bn bs ca cs da de el en es et fa fi fr he',
    'hi hr hu hy id is it ja ka kk km ko lo lt lv mk ms my',
    'nb ne nl pl pt ro ru si sk sl sq sr sv ta tg th tr uk',
    'ur uz vi zh',
  ].flatMap((line) => line.split(' ')),
);
const OFFICIAL = new Set(['official', 'de_facto_official']);
const DEFAULT_LOCALE = 'en-US';

// CLDR's copy of territoryInfo.xml that camoufox-js ships for its own language
// pick; `locale.js` keeps its parser to itself.
const TERRITORY_INFO = 'camoufox-js/dist/data-files/territoryInfo.xml';

export interface TerritoryLanguage {
  /** Without the script: "zh_Hant" is "zh". */
  code: string;
  populationPercent: number;
  official: boolean;
}

/** What `getGeolocation` of camoufox-js answers, as far as it is used here. */
export interface Geolocation {
  locale: { region?: string | undefined };
  timezone: string;
  latitude: number;
  longitude: number;
}

export interface GeoDeps {
  /**
   * The lookup in the GeoIP database. Default: `getGeolocation` of camoufox-js,
   * which downloads the database into `CAMOUFOX_INSTALL_DIR` when it is missing.
   */
  getGeolocation?: (ip: string) => Promise<Geolocation>;
  /** For the language pick; default `Math.random`. */
  random?: () => number;
}

const territoryInfoSchema = z.object({
  territoryInfo: z.object({
    territory: z.array(
      z.object({
        type: z.string(),
        languagePopulation: z
          .array(
            z.object({
              type: z.string(),
              populationPercent: z.string().optional(),
              officialStatus: z.string().optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});

/** Country -> its languages in `FIREFOX_LANGUAGES`, from the text of CLDR's territoryInfo.xml. */
export function parseTerritoryLanguages(
  xml: string,
): Map<string, TerritoryLanguage[]> {
  // The parser takes broken XML for a document with less in it.
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`territoryInfo.xml is not valid XML: ${valid.err.msg}`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    ignoreDeclaration: true,
    // A territory with one language is still a list of one.
    isArray: (name) => name === 'territory' || name === 'languagePopulation',
  });
  const territories = new Map<string, TerritoryLanguage[]>();
  for (const territory of territoryInfoSchema.parse(parser.parse(xml))
    .territoryInfo.territory) {
    const languages: TerritoryLanguage[] = [];
    for (const population of territory.languagePopulation ?? []) {
      const code = population.type.split('_')[0];
      if (!FIREFOX_LANGUAGES.has(code)) continue;
      languages.push({
        code,
        populationPercent: Number(population.populationPercent ?? 0),
        official: OFFICIAL.has(population.officialStatus ?? ''),
      });
    }
    territories.set(territory.type, languages);
  }
  return territories;
}

let territories: ReadonlyMap<string, readonly TerritoryLanguage[]> | undefined;

function territoryLanguages(): ReadonlyMap<
  string,
  readonly TerritoryLanguage[]
> {
  territories ??= parseTerritoryLanguages(
    readFileSync(
      createRequire(import.meta.url).resolve(TERRITORY_INFO),
      'utf8',
    ),
  );
  return territories;
}

function weightedPick(
  languages: readonly TerritoryLanguage[],
  random: () => number,
): TerritoryLanguage {
  const total = languages.reduce(
    (sum, { populationPercent }) => sum + populationPercent,
    0,
  );
  if (total <= 0) return languages[Math.floor(random() * languages.length)];
  let threshold = random() * total;
  for (const language of languages) {
    threshold -= language.populationPercent;
    if (threshold < 0) return language;
  }
  return languages[languages.length - 1];
}

/**
 * `<language>-<country>`, the language drawn by population share among the
 * country's official (or de facto official) languages in `FIREFOX_LANGUAGES`.
 * Without one: the country's most-spoken language in `FIREFOX_LANGUAGES`, else
 * en-US.
 */
export function pickLocale(
  country: string | null,
  random: () => number = Math.random,
): string {
  if (!country) return DEFAULT_LOCALE;
  return chooseLocale(country, territoryLanguages().get(country) ?? [], random);
}

/** `pickLocale` for the languages of a country that are known already. */
export function chooseLocale(
  country: string,
  languages: readonly TerritoryLanguage[],
  random: () => number,
): string {
  if (languages.length === 0) return DEFAULT_LOCALE;
  const official = languages.filter((language) => language.official);
  const chosen =
    official.length > 0
      ? weightedPick(official, random)
      : languages.reduce((best, language) =>
          language.populationPercent > best.populationPercent ? language : best,
        );
  return `${chosen.code}-${country}`;
}

function noLocation(ip: string, cause?: unknown): GeoLookupError {
  const error = new GeoLookupError(
    `the GeoIP database has no location for ${ip}`,
  );
  if (cause !== undefined) error.cause = cause;
  return error;
}

// camoufox-js answers an IP that the database does not know with a TypeError
// (it reads `.country` of null), and a record without a location with a
// LocaleError. Anything else (a failed download, a damaged database) is worth a
// line in the log.
async function isMissingLocation(error: unknown): Promise<boolean> {
  return (
    error instanceof TypeError || error instanceof (await loadLocaleError())
  );
}

// camoufox-js reads the whole database (50 MB) for every lookup, and downloads
// it when it is missing: lookups side by side would hold a copy each (a bulk
// proxy check: hundreds of megabytes) and write the download over one another.
// So one at a time.
let queue: Promise<void> = Promise.resolve();

function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const result = queue.then(job);
  // The next job starts when this one is over, however it ended; the caller
  // gets the outcome from `result`.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Rejects with a `GeoLookupError` when no location can be found for the IP:
 * the database has none, or (logged) it cannot be read.
 */
export async function lookup(ip: string, deps: GeoDeps = {}): Promise<GeoInfo> {
  // camoufox-js only checks the shape of an IP ("999.1.1.1" passes).
  if (isIP(ip) === 0) throw noLocation(ip);
  const getGeolocation = deps.getGeolocation ?? (await loadGetGeolocation());
  let geo: Geolocation;
  try {
    geo = await oneAtATime(() => getGeolocation(ip));
  } catch (error) {
    if (!(await isMissingLocation(error))) {
      console.warn(`GeoIP lookup of ${ip} failed: ${errorText(error)}`);
    }
    throw noLocation(ip, error);
  }
  const country = geo.locale.region ?? null;
  return {
    country,
    locale: pickLocale(country, deps.random),
    timezone: geo.timezone,
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}

/** The country of the IP, or null. Never rejects. */
export async function countryOf(
  ip: string,
  deps: GeoDeps = {},
): Promise<string | null> {
  // The country is informational: never let a lookup problem (or a failed
  // database download) fail a proxy check.
  try {
    return (await lookup(ip, deps)).country;
  } catch (error) {
    console.info(`no GeoIP country for ${ip}: ${errorText(error)}`);
    return null;
  }
}

// camoufox-js reads CAMOUFOX_INSTALL_DIR when `locale.js` is first imported
// (the GeoIP database lives there) and the app sets it at startup, so it is
// imported when it is first needed, not at the top of this file.
async function loadGetGeolocation(): Promise<
  NonNullable<GeoDeps['getGeolocation']>
> {
  const { getGeolocation } = await import('camoufox-js/dist/locale.js');
  return getGeolocation;
}

async function loadLocaleError() {
  const { LocaleError } = await import('camoufox-js/dist/exceptions.js');
  return LocaleError;
}
