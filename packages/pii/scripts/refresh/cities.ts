/**
 * Refresh `datasets/<locale>/cities.json` from a GeoNames cities-dump file.
 *
 * Reads a local TSV file (downloaded manually by the maintainer from
 * https://download.geonames.org/export/dump/cities15000.zip), filters to
 * the countries each locale serves, projects to the `CityEntry` schema,
 * and writes per-locale JSON.
 *
 * Manual invocation:
 *
 *     bun packages/pii/scripts/refresh/cities.ts --input ~/pii-refresh/cities15000.txt
 *
 * The maintainer downloads the upstream archive once, unzips it, and
 * points this script at the resulting `.txt`. Network access is not used
 * by this script — it is a local file processor only.
 *
 * GeoNames TSV columns (per the upstream README):
 *   0 geonameid
 *   1 name (UTF-8)
 *   2 asciiname
 *   3 alternatenames
 *   4 latitude
 *   5 longitude
 *   6 feature class
 *   7 feature code
 *   8 country code (ISO 3166-1 alpha-2)
 *   9 cc2
 *  10 admin1
 *  11 admin2
 *  12 admin3
 *  13 admin4
 *  14 population
 *  15 elevation
 *  16 dem
 *  17 timezone
 *  18 modification date
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASETS_ROOT = join(__dirname, '..', '..', 'datasets');

const COUNTRY_TO_LOCALES: Record<string, string[]> = {
  // English-speaking
  US: ['en'],
  GB: ['en'],
  CA: ['en'],
  AU: ['en'],
  IE: ['en'],
  NZ: ['en'],
  ZA: ['en'],
  // German-speaking
  DE: ['de'],
  AT: ['de'],
  CH: ['de', 'fr', 'it'],
  LI: ['de'],
  LU: ['de', 'fr'],
  // French-speaking
  FR: ['fr'],
  BE: ['fr', 'nl'],
  MC: ['fr'],
  // Italian-speaking
  IT: ['it'],
  SM: ['it'],
  VA: ['it'],
  // Dutch-speaking
  NL: ['nl'],
  // Spanish-speaking (Latin America + ES)
  ES: ['es'],
  MX: ['es'],
  AR: ['es'],
  CO: ['es'],
  CL: ['es'],
  PE: ['es'],
  VE: ['es'],
  UY: ['es'],
  EC: ['es'],
  BO: ['es'],
  PY: ['es'],
  GT: ['es'],
  HN: ['es'],
  SV: ['es'],
  NI: ['es'],
  CR: ['es'],
  PA: ['es'],
  CU: ['es'],
  DO: ['es'],
  PR: ['es'],
  // Portuguese-speaking
  PT: ['pt'],
  BR: ['pt'],
  AO: ['pt'],
  MZ: ['pt'],
  CV: ['pt'],
  GW: ['pt'],
  ST: ['pt'],
  TL: ['pt'],
  // Swedish-speaking
  SE: ['sv'],
  // Polish-speaking
  PL: ['pl'],
};

interface CityEntry {
  name: string;
  countryCode: string;
  admin1: string | null;
  postcodeSample: string | null;
  population: number;
}

interface Args {
  inputPath: string;
  perLocaleCap: number;
}

function parseArgs(argv: string[]): Args {
  let inputPath = '';
  let perLocaleCap = 800;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') inputPath = argv[++i] ?? '';
    else if (a === '--cap' || a === '-c') perLocaleCap = Number(argv[++i]);
  }
  if (!inputPath) {
    console.error(
      'Usage: bun scripts/refresh/cities.ts --input <path-to-cities15000.txt> [--cap 800]',
    );
    process.exit(1);
  }
  return { inputPath, perLocaleCap };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(args.inputPath, 'utf8');

  // Bucket cities by locale; ranked by population (descending).
  const buckets = new Map<string, CityEntry[]>();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 15) continue;
    const name = cols[1];
    const countryCode = cols[8];
    const admin1 = cols[10] || null;
    const population = Number(cols[14]) || 0;
    if (population < 15000) continue;
    const locales = COUNTRY_TO_LOCALES[countryCode];
    if (!locales) continue;
    for (const locale of locales) {
      let bucket = buckets.get(locale);
      if (!bucket) {
        bucket = [];
        buckets.set(locale, bucket);
      }
      bucket.push({
        name,
        countryCode,
        admin1,
        postcodeSample: null,
        population,
      });
    }
  }

  // Sort each bucket by population and cap.
  for (const [locale, entries] of buckets) {
    entries.sort((a, b) => b.population - a.population);
    const capped = entries.slice(0, args.perLocaleCap);
    const path = join(DATASETS_ROOT, locale, 'cities.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(capped, null, 2) + '\n', 'utf8');
    console.log(
      `[refresh:cities] ${locale}: ${capped.length} cities → ${path}`,
    );
  }
}

main();
