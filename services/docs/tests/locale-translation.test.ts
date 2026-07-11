import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractOpeningProse, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, filesInLocale, walkDocs } from './lib/walk';

/**
 * A DE/FR mirror whose opening paragraph is byte-identical to the English
 * source's is not a translation — it's an English page left in place under a
 * translated slug. `locale-outline` only compares heading-depth sequences, so
 * a full-English mirror passes it as long as the shape matches; this check
 * catches the prose itself.
 *
 * Heuristic, not a full translation check: only the opening paragraph is
 * compared (cheap, and almost every untranslated mirror is untranslated
 * throughout). Openings shorter than `MIN_OPENING_LENGTH` are skipped so a
 * short shared token (a product name, a version string) can't coincidentally
 * match across languages and false-positive.
 *
 * File presence is enforced separately by `locale-tree.test.ts`. This file
 * skips any locale page that has no English source — that's a different bug
 * and would only add noise to the output.
 */

const TRANSLATED_LOCALES = BASE_LOCALES.filter((l) => l !== 'en');
const MIN_OPENING_LENGTH = 40;

function openingOf(absPath: string): string {
  const raw = fs.readFileSync(absPath, 'utf8').replaceAll('\r\n', '\n');
  const { body } = parseFrontmatter(raw);
  return extractOpeningProse(body).replaceAll(/\s+/g, ' ').trim();
}

describe('locale translation', () => {
  const all = walkDocs();
  const en = filesInLocale('en', all);

  it.each(TRANSLATED_LOCALES)(
    "%s pages don't mirror the English opening paragraph verbatim",
    (locale) => {
      const findings: Finding[] = [];
      const localeSet = new Set(filesInLocale(locale, all));

      for (const rel of en) {
        if (!localeSet.has(rel)) continue; // missing-page failure handled elsewhere
        const enOpening = openingOf(path.join(CONTENT_ROOT, 'en', rel));
        if (enOpening.length < MIN_OPENING_LENGTH) continue;
        const locOpening = openingOf(path.join(CONTENT_ROOT, locale, rel));

        if (locOpening === enOpening) {
          findings.push({
            file: `${locale}/${rel}`,
            line: 0,
            rule: 'untranslated-mirror',
            detail: `opening paragraph is byte-identical to en/${rel} — translate natively instead of mirroring the English prose`,
          });
        }
      }

      assertNoFindings(findings, `${locale}/ untranslated-mirror pages`);
    },
  );
});
