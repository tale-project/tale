import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import {
  extractCodeFences,
  extractOutline,
  parseFrontmatter,
} from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, filesInLocale, walkDocs } from './lib/walk';

/**
 * DE/FR mirrors of every English page must share the English page's
 * structural skeleton:
 *
 *   - Same heading-depth sequence (e.g. `[2, 3, 2, 3, 2]`).
 *   - Same number of fenced code blocks.
 *
 * Restructuring an English page means restructuring DE and FR in the same
 * PR. The check is structural — same shape — not semantic. If the German
 * page genuinely needs an extra paragraph that the English page doesn't, no
 * heading changes are needed and this test passes; if it needs an extra
 * sub-section, English needs it too.
 *
 * File presence is enforced separately by `locale-tree.test.ts`. This file
 * skips any locale page that has no English source — that's a different bug
 * and would only add noise to the outline output.
 */

const TRANSLATED_LOCALES = BASE_LOCALES.filter((l) => l !== 'en');

function outlineOf(absPath: string): { outline: number[]; fences: number } {
  const raw = fs.readFileSync(absPath, 'utf8').replaceAll('\r\n', '\n');
  const { body } = parseFrontmatter(raw);
  return {
    outline: extractOutline(body),
    fences: extractCodeFences(body).length,
  };
}

describe('locale outline', () => {
  const all = walkDocs();
  const en = filesInLocale('en', all);

  it.each(TRANSLATED_LOCALES)(
    '%s matches English heading outline and fenced-code-block count per page',
    (locale) => {
      const findings: Finding[] = [];
      const localeSet = new Set(filesInLocale(locale, all));

      for (const rel of en) {
        if (!localeSet.has(rel)) continue; // missing-page failure handled elsewhere
        const enInfo = outlineOf(path.join(CONTENT_ROOT, 'en', rel));
        const locInfo = outlineOf(path.join(CONTENT_ROOT, locale, rel));

        if (
          JSON.stringify(enInfo.outline) !== JSON.stringify(locInfo.outline)
        ) {
          findings.push({
            file: `${locale}/${rel}`,
            line: 0,
            rule: 'outline-drift',
            detail: `heading outline differs from en/${rel}; expected [${enInfo.outline.join(',')}], got [${locInfo.outline.join(',')}]`,
          });
        }
        if (enInfo.fences !== locInfo.fences) {
          findings.push({
            file: `${locale}/${rel}`,
            line: 0,
            rule: 'fence-count-drift',
            detail: `fenced-code-block count differs from en/${rel}; expected ${enInfo.fences}, got ${locInfo.fences}`,
          });
        }
      }

      assertNoFindings(findings, `${locale}/ structural drift vs English`);
    },
  );
});
