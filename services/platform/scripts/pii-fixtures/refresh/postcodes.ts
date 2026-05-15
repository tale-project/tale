/**
 * Refresh per-locale postcode coverage from GeoNames postal-codes files.
 *
 * Merges GeoNames `<CC>.txt` postal-code data into the existing
 * `datasets/<locale>/cities.json` files, filling in `postcodeSample` for
 * each city we already track. Drops cities that the upstream data has no
 * postcode for (rare; mostly tiny administrative areas).
 *
 * Manual invocation:
 *
 *     bun services/platform/scripts/pii-fixtures/refresh/postcodes.ts \
 *         --postcode-dir ~/pii-refresh \
 *         [--locales de,fr,it,nl,en]
 *
 * The maintainer downloads each ISO country file (e.g. `DE.zip`) from
 * https://download.geonames.org/export/zip/ and unzips to a local
 * directory; this script reads only from there.
 *
 * GeoNames postcode-file TSV columns:
 *   0 country code  1 postal code  2 place name  3 admin1 name
 *   4 admin1 code   5 admin2 name  6 admin2 code 7 admin3 name
 *   8 admin3 code   9 latitude     10 longitude  11 accuracy
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASETS_ROOT = join(__dirname, '..', '..', 'datasets');

const LOCALE_TO_COUNTRIES: Record<string, string[]> = {
  en: ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'ZA'],
  de: ['DE', 'AT', 'CH', 'LI', 'LU'],
  fr: ['FR', 'BE', 'CH', 'CA', 'LU', 'MC'],
  it: ['IT', 'CH', 'SM', 'VA'],
  nl: ['NL', 'BE'],
  es: ['ES', 'MX', 'AR', 'CO', 'CL', 'PE'],
  pt: ['PT', 'BR'],
  sv: ['SE'],
  pl: ['PL'],
};

interface CityEntry {
  name: string;
  countryCode: string;
  admin1: string | null;
  postcodeSample: string | null;
  population: number;
}

function parseArgs(argv: string[]): { dir: string; locales: string[] } {
  let dir = '';
  let locales = Object.keys(LOCALE_TO_COUNTRIES);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--postcode-dir') dir = argv[++i] ?? '';
    else if (a === '--locales')
      locales = (argv[++i] ?? '').split(',').filter(Boolean);
  }
  if (!dir) {
    console.error(
      'Usage: bun scripts/refresh/postcodes.ts --postcode-dir <dir-of-CC.txt-files> [--locales en,de,...]',
    );
    process.exit(1);
  }
  return { dir, locales };
}

/**
 * Build a map `cityName -> postcode` from one country's GeoNames file.
 * Multiple postcodes exist per city; we keep the first encountered (the
 * GeoNames file is roughly sorted by postcode, so this gives a stable
 * sample). City-name lookup is case-folded to handle GeoNames-specific
 * casing variants.
 */
function buildCityPostcodeMap(filePath: string): Map<string, string> {
  const m = new Map<string, string>();
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const postcode = cols[1];
    const place = cols[2];
    if (!place || !postcode) continue;
    const key = place.toLowerCase();
    if (!m.has(key)) m.set(key, postcode);
  }
  return m;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  for (const locale of args.locales) {
    const citiesPath = join(DATASETS_ROOT, locale, 'cities.json');
    if (!existsSync(citiesPath)) {
      console.warn(`[refresh:postcodes] ${locale}: no cities.json; skipping`);
      continue;
    }
    const cities: CityEntry[] = JSON.parse(readFileSync(citiesPath, 'utf8'));
    const countries = LOCALE_TO_COUNTRIES[locale] ?? [];

    // Load postcode maps for every country this locale serves.
    const perCountry = new Map<string, Map<string, string>>();
    for (const cc of countries) {
      const path = join(args.dir, `${cc}.txt`);
      if (!existsSync(path)) continue;
      perCountry.set(cc, buildCityPostcodeMap(path));
    }

    let filled = 0;
    let unmatched = 0;
    for (const city of cities) {
      const map = perCountry.get(city.countryCode);
      if (!map) {
        unmatched++;
        continue;
      }
      const pc = map.get(city.name.toLowerCase());
      if (pc) {
        city.postcodeSample = pc;
        filled++;
      } else {
        unmatched++;
      }
    }

    writeFileSync(citiesPath, JSON.stringify(cities, null, 2) + '\n', 'utf8');
    console.log(
      `[refresh:postcodes] ${locale}: filled ${filled} postcodes (${unmatched} unmatched) → ${citiesPath}`,
    );
  }
}

main();
