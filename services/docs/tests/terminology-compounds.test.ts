import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { HALF_COMPOUNDS } from './data/half-compounds';
import { assertNoFindings, type Finding } from './lib/findings';
import { parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { runDriftRules } from './lib/rules';
import { discoverLocales, localeOf, walkDocs } from './lib/walk';

/**
 * Half-translated compound terms — patterns like `Pull Anfrage`,
 * `Code Review-Prozess`, `Branch-Zweig`, `Knowledge-Datenbank`. A multi-word
 * technical term must be translated whole or kept whole; the half-form is a
 * translation bug.
 *
 * Source for the patterns: `.agents/terminology/TERMINOLOGY_DE.md` §2
 * anti-pattern 7 and the matching FR §2 entries. The data lives in
 * `data/half-compounds.ts` and is consumed via the generic `runDriftRules`
 * helper.
 *
 * Runs against DE, FR, and de-CH pages. English pages are exempt — they
 * can't half-translate to themselves.
 */

describe('half-translated compounds', () => {
  it('rejects compounds split across English and the target language', () => {
    const findings: Finding[] = [];
    const locales = discoverLocales();
    const target = walkDocs().filter((rel) => localeOf(rel, locales) !== 'en');

    for (const rel of target) {
      const locale = localeOf(rel, locales);
      const raw = fs
        .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
        .replaceAll('\r\n', '\n');
      const { body } = parseFrontmatter(raw);
      findings.push(...runDriftRules(HALF_COMPOUNDS, body, rel, locale));
    }

    assertNoFindings(findings, 'Half-translated compounds');
  });
});
