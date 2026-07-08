import fs from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { assertNoFindings, type Finding } from './lib/findings';
import { extractComponentTags, parseFrontmatter } from './lib/markdown';
import { CONTENT_ROOT } from './lib/paths';
import { BASE_LOCALES, filesInLocale, walkDocs } from './lib/walk';

/**
 * DE/FR mirrors of every English page must use the same component tags in
 * the same order.
 *
 * The docs renderer registers a component vocabulary (`<Frame>`, `<Steps>`,
 * `<Warning>`, … — the list in `lib/markdown.ts`). Components carry page
 * structure the same way headings do, so the ordered sequence of OPENING tag
 * names (e.g. `[Frame, Steps, Step, Frame, Step]`) is part of the structural
 * skeleton `locale-outline.test.ts` already enforces for headings and code
 * fences. A translated page that drops the hero `<Frame>`, merges two
 * `<Step>`s, or swaps a `<Warning>` for a `<Note>` has drifted structurally,
 * not just verbally.
 *
 * The check is structural — same tags, same order — not semantic; captions,
 * titles, and body prose translate freely. Closing tags are not compared:
 * matching openings plus the renderer's own error surface cover nesting.
 * File presence is `locale-tree.test.ts`'s job; pages without an English
 * source are skipped here to avoid double-reporting.
 */

const TRANSLATED_LOCALES = BASE_LOCALES.filter((l) => l !== 'en');

function componentSequence(absPath: string): string[] {
  const raw = fs.readFileSync(absPath, 'utf8').replaceAll('\r\n', '\n');
  const { body } = parseFrontmatter(raw);
  return extractComponentTags(body).map((t) => t.name);
}

/** Index of the first position where the two sequences differ (one may have
 *  ended). Only called on known-unequal sequences. */
function firstDivergence(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

describe('locale component sequence', () => {
  const all = walkDocs();
  const en = filesInLocale('en', all);

  it.each(TRANSLATED_LOCALES)(
    '%s matches English component-tag sequence per page',
    (locale) => {
      const findings: Finding[] = [];
      const localeSet = new Set(filesInLocale(locale, all));

      for (const rel of en) {
        if (!localeSet.has(rel)) continue; // missing-page failure handled elsewhere
        const enSeq = componentSequence(path.join(CONTENT_ROOT, 'en', rel));
        const locSeq = componentSequence(path.join(CONTENT_ROOT, locale, rel));
        if (
          enSeq.length === locSeq.length &&
          enSeq.join('\n') === locSeq.join('\n')
        ) {
          continue;
        }
        const idx = firstDivergence(enSeq, locSeq);
        findings.push({
          file: `${locale}/${rel}`,
          line: 0,
          rule: 'component-sequence-drift',
          detail: `component sequence diverges from en/${rel} at index ${idx}; expected [${enSeq.join(', ')}], got [${locSeq.join(', ')}]`,
        });
      }

      assertNoFindings(
        findings,
        `${locale}/ component-sequence drift vs English`,
      );
    },
  );
});
