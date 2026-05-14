/**
 * Refresh `datasets/<locale>/prose.json` from a Tatoeba sentence dump.
 *
 * Reads a local Tatoeba `sentences.csv` (TSV format: `id\tlang\ttext`)
 * downloaded by the maintainer from
 * https://downloads.tatoeba.org/exports/sentences.tar.bz2, picks
 * candidate sentences per locale, then runs the actual scrubber over
 * each to confirm it contains no PII. Sentences that pass the scrubber
 * become the locale's negative corpus.
 *
 * Manual invocation:
 *
 *     bun packages/pii/scripts/refresh/prose.ts \
 *         --input ~/pii-refresh/sentences.csv \
 *         [--cap 800]
 *
 * The scrubber-as-ground-truth design has a nice property: the negative
 * corpus is *guaranteed* to pass the detector at the moment it's
 * generated. If a future detector change causes a previously-clean
 * sentence to flag, the regeneration will drop it. (`fixtures:verify`
 * still catches the deeper regression because the existing committed
 * negative would now fail its assertion.)
 */

import { createReadStream } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createScrubber } from '../../src';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASETS_ROOT = join(__dirname, '..', '..', 'datasets');

const LOCALE_TO_TATOEBA_LANG: Record<string, string> = {
  en: 'eng',
  de: 'deu',
  fr: 'fra',
  it: 'ita',
  nl: 'nld',
  es: 'spa',
  pt: 'por',
  sv: 'swe',
  pl: 'pol',
  ru: 'rus',
  uk: 'ukr',
  ja: 'jpn',
  ko: 'kor',
  ar: 'ara',
  he: 'heb',
  tr: 'tur',
  el: 'ell',
  hi: 'hin',
  id: 'ind',
  vi: 'vie',
  th: 'tha',
  cs: 'ces',
  fi: 'fin',
  da: 'dan',
  nb: 'nob',
  hu: 'hun',
  ro: 'ron',
  sk: 'slk',
  ca: 'cat',
  fa: 'pes',
  ur: 'urd',
  bn: 'ben',
  ms: 'zlm',
  tl: 'tgl',
  bg: 'bul',
  sr: 'srp',
  hr: 'hrv',
  sl: 'slv',
  lt: 'lit',
  lv: 'lav',
  et: 'est',
  'zh-Hans': 'cmn',
  'zh-Hant': 'cmn',
};

interface ProseEntry {
  text: string;
  source: 'tatoeba';
  upstreamId: string;
}

function parseArgs(argv: string[]): { inputPath: string; cap: number } {
  let inputPath = '';
  let cap = 800;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') inputPath = argv[++i] ?? '';
    else if (a === '--cap' || a === '-c') cap = Number(argv[++i]);
  }
  if (!inputPath) {
    console.error(
      'Usage: bun scripts/refresh/prose.ts --input <path-to-sentences.csv> [--cap 800]',
    );
    process.exit(1);
  }
  return { inputPath, cap };
}

/**
 * Cheap pre-filter — reject obvious PII before the more-expensive
 * scrubber pass. Digits / `@` / common phone-keywords cover the
 * overwhelming majority of address / phone / email content in Tatoeba.
 */
function couldContainPii(text: string): boolean {
  if (/\d/.test(text)) return true;
  if (text.includes('@')) return true;
  if (/\b(tel|phone|email|e-mail)\b/i.test(text)) return true;
  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // One scrubber per locale — full coverage, mask mode. Reused across
  // every candidate sentence for that locale.
  const scrubbers = new Map<string, ReturnType<typeof createScrubber>>();
  for (const locale of Object.keys(LOCALE_TO_TATOEBA_LANG)) {
    scrubbers.set(
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
          ssn: true,
          dateOfBirth: true,
          address: { locales: [locale] },
          nationalId: { locales: [locale] },
        },
      }),
    );
  }

  const buckets = new Map<string, ProseEntry[]>();
  // Reverse map for fast lookup.
  const tatoebaToLocale = new Map<string, string>();
  for (const [locale, lang] of Object.entries(LOCALE_TO_TATOEBA_LANG)) {
    tatoebaToLocale.set(lang, locale);
    buckets.set(locale, []);
  }

  const stream = createReadStream(args.inputPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let processed = 0;
  for await (const line of rl) {
    processed++;
    if (processed % 1_000_000 === 0) {
      console.log(`[refresh:prose] scanned ${processed} sentences`);
    }
    const tab1 = line.indexOf('\t');
    if (tab1 < 0) continue;
    const tab2 = line.indexOf('\t', tab1 + 1);
    if (tab2 < 0) continue;
    const id = line.slice(0, tab1);
    const lang = line.slice(tab1 + 1, tab2);
    const text = line.slice(tab2 + 1);

    const locale = tatoebaToLocale.get(lang);
    if (!locale) continue;
    const bucket = buckets.get(locale);
    const scrubber = scrubbers.get(locale);
    if (!bucket || !scrubber) continue;
    if (bucket.length >= args.cap) continue;
    if (text.length < 15 || text.length > 200) continue;
    if (couldContainPii(text)) continue;

    // Final filter: actual scrubber must pass it.
    const outcome = scrubber.scrub(text);
    if (outcome.kind !== 'pass') continue;

    bucket.push({ text, source: 'tatoeba', upstreamId: id });
  }

  for (const [locale, entries] of buckets) {
    const path = join(DATASETS_ROOT, locale, 'prose.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', 'utf8');
    console.log(
      `[refresh:prose] ${locale}: ${entries.length} sentences → ${path}`,
    );
  }
}

main().catch((err) => {
  console.error('[refresh:prose] fatal:', err);
  process.exit(1);
});
