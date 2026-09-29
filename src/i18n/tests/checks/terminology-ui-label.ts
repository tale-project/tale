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
import { wordBoundary } from '../internals/regex';
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
      const applicable = enforcedTerms.filter((t) =>
        glossary.shouldEnforce(t, locale.id),
      );
      if (applicable.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('terminology-ui-label')) continue;
        for (const term of applicable) {
          const re = wordBoundary(term.en, 'g');
          let m: RegExpExecArray | null;
          while ((m = re.exec(fragment.text)) !== null) {
            const native = glossary.resolveForm(term, locale.id);
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
