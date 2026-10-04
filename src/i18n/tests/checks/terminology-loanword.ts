/**
 * `terminology-loanword` — translate-bucket terms must translate in
 * non-EN locales. The bucket is `category: 'translateBucket'` in the
 * glossary; the EN form must not appear in the locale text.
 */

import { wordBoundary } from '../internals/regex';
import type { Finding } from './types';
import { createCheck } from './types';

export const terminologyLoanword = createCheck({
  id: 'terminology-loanword',
  scope: 'both',
  defaultMode: 'enforce',
  localeFilter: (locale) => locale.id !== 'en',
  run(ctx) {
    const findings: Finding[] = [];
    const glossary = ctx.glossary();
    const terms = glossary.byCategory('translateBucket');
    for (const locale of ctx.locales) {
      if (locale.id === 'en') continue;
      const enforced = terms.filter((t) =>
        glossary.shouldEnforce(t, locale.id),
      );
      if (enforced.length === 0) continue;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('terminology-loanword')) continue;
        for (const term of enforced) {
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
              rule: 'loanword-untranslated',
              detail: `translate-bucket term left English: "${term.en}"`,
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
