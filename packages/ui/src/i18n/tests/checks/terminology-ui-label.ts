/**
 * `terminology-ui-label` — glossary terms in {feature, role, knowledgeEntity}
 * whose locale form differs from `en` and whose `en` form appears in
 * non-EN text.
 *
 * Distinct from `terminology-loanword`: this check is scoped to UI-label
 * categories (the noun shows up as a button/menu/panel label) and produces
 * a sharper "match the shipped UI" error message.
 */

import type { Category } from '../glossary/types';
import { escapeRegex, wordBoundary } from '../internals/regex';
import type { Finding } from './types';
import { createCheck } from './types';

const ENFORCED_CATEGORIES: ReadonlyArray<Category> = [
  'feature',
  'role',
  'knowledgeEntity',
];

export const terminologyUiLabel = createCheck({
  id: 'terminology-ui-label',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.id !== 'en',
  run(ctx) {
    const findings: Finding[] = [];
    const glossary = ctx.glossary();

    const enforcedTerms = [];
    for (const category of ENFORCED_CATEGORIES) {
      for (const term of glossary.byCategory(category))
        enforcedTerms.push(term);
    }

    for (const locale of ctx.locales) {
      if (locale.id === 'en') continue;
      const applicable = enforcedTerms
        .filter((t) => glossary.shouldEnforce(t, locale.id))
        .map((term) => ({
          term,
          re: wordBoundary(term.en, 'g'),
          native: glossary.resolveForm(term, locale.id),
        }));
      if (applicable.length === 0) continue;
      // Most prose lines contain no UI label. This exact literal prefilter
      // skips only those lines; the term loop preserves finding order and
      // reports every overlap and repeated occurrence as before.
      const anyTerm = new RegExp(
        `\\b(?:${applicable.map(({ term }) => escapeRegex(term.en)).join('|')})\\b`,
      );
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('terminology-ui-label')) continue;
        if (!anyTerm.test(fragment.text)) continue;
        for (const { term, re, native } of applicable) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(fragment.text)) !== null) {
            findings.push({
              file: fragment.pos.file,
              line: fragment.pos.line,
              column: fragment.pos.column + m.index,
              key: fragment.key ?? undefined,
              locale: fragment.locale,
              rule: 'ui-label-mismatch',
              detail: `UI-label term "${term.en}" must match shipped string`,
              suggest: `use "${native}"`,
              doctrine: locale.doctrine,
            });
          }
        }
      }
    }
    return findings;
  },
});
