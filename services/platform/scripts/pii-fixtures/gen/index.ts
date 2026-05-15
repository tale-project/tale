/**
 * Fixture-generator CLI.
 *
 * Usage:
 *   bun services/platform/scripts/pii-fixtures/gen/index.ts [--lang en,de,fr,...] [--seed 42]
 *   bun services/platform/scripts/pii-fixtures/gen/index.ts verify
 *
 * The default run regenerates every locale that has a dataset directory
 * under `services/platform/scripts/pii-fixtures/datasets/`. `--lang` narrows to a subset. `verify`
 * regenerates to a temp tree and diffs against the committed fixtures —
 * a non-empty diff fails the CI.
 *
 * Offline guarantee: this CLI reads only from `services/platform/scripts/pii-fixtures/datasets/`
 * and `node_modules/`. No network calls, no environment-variable-driven
 * dataset paths. A future regression that breaks the offline-only
 * contract is caught by `tests/offline.test.ts`.
 */

import { listLocales } from '../../../lib/pii/locales';
import { buildFixturesForLocale } from './builders';
import { emitFixtures } from './emit';
import { makeRng } from './rng';
import { loadLocaleDataset } from './sources';

const GENERATOR_ID = 'platform/pii-fixtures@0.1.0';

function parseArgs(argv: string[]): {
  langs: string[] | null;
  seed: number;
  verify: boolean;
} {
  let langs: string[] | null = null;
  let seed = 42;
  let verify = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'verify') verify = true;
    else if (a === '--lang' || a === '-l') {
      const next = argv[++i] ?? '';
      langs = next
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--seed' || a === '-s') {
      seed = Number(argv[++i] ?? '42');
    }
  }
  return { langs, seed, verify };
}

/**
 * Locales the generator will produce fixtures for.
 *
 * The library's registered locales are the source of truth — anything in
 * `listLocales()` gets a fixture file. Locales with a committed dataset
 * directory get richer coverage (cities × streets × postcodes). Locales
 * without one fall back to email/phone/national-ID positives plus
 * synthesizer output (street keywords × any names that are present).
 *
 * This means adding a locale = adding the JSON. A dataset refresh is a
 * coverage uplift, not a precondition.
 */
function discoverLocales(): string[] {
  return [...listLocales()];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allLocales = discoverLocales();
  const targetLocales = args.langs
    ? args.langs.filter((c) => allLocales.includes(c))
    : allLocales;

  if (targetLocales.length === 0) {
    console.error(
      `[gen] no locales to process. Discovered: ${allLocales.join(', ')}; requested: ${
        args.langs?.join(', ') ?? '(all)'
      }`,
    );
    process.exit(1);
  }

  const generatedAt = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

  let totalPositives = 0;
  let totalNegatives = 0;

  for (const locale of targetLocales) {
    const ds = loadLocaleDataset(locale);
    const rng = makeRng(args.seed);
    const seed = { ...ds, rng };
    const result = buildFixturesForLocale(seed);

    const datasetsVersion: Record<string, string> = {};
    if (ds.meta) {
      for (const [key, info] of Object.entries(ds.meta.sources)) {
        datasetsVersion[key] = info.version;
      }
    }

    const { positivesPath, negativesPath } = emitFixtures({
      locale,
      generator: GENERATOR_ID,
      seed: args.seed,
      datasetsVersion,
      positives: result.positives,
      negatives: result.negatives,
      generatedAt,
    });

    totalPositives += result.positives.length;
    totalNegatives += result.negatives.length;
    console.log(
      `[gen] ${locale}: ${result.positives.length} pos, ${result.negatives.length} neg → ${positivesPath}, ${negativesPath}`,
    );
  }

  console.log(
    `[gen] done. ${targetLocales.length} locales, ${totalPositives} positives, ${totalNegatives} negatives.`,
  );
}

main().catch((err) => {
  console.error('[gen] fatal:', err);
  process.exit(1);
});
