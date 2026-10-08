/**
 * `terminology-ui-label` — glossary terms in {feature, role, knowledgeEntity}
 * whose locale form differs from `en` and whose `en` form appears in
 * non-EN text, or whose `_avoid` list names a form that the locale's text
 * uses in any case (a lowercase loanword, a retired translation).
 *
 * Distinct from `terminology-loanword`: this check is scoped to UI-label
 * categories (the noun shows up as a button/menu/panel label) and produces
 * a sharper "match the shipped UI" error message.
 */

import type { Category } from '../glossary/types';
import { escapeRegex, wordBoundary } from '../internals/regex';
import type { Finding } from './types';
import { createCheck } from './types';

/** A letter or digit of any script continues a word. */
const WORD_START = '(?<![\\p{L}\\p{N}_])';
const WORD_END = '(?![\\p{L}\\p{N}_])';

/**
 * Case-insensitive name. Brackets confine an ordinary word to a context:
 * `sous [gel]` reports `gel` only right after `sous`, so `gel du code` stays
 * clean, and the finding starts where a longer name such as `gel juridique`
 * starts, so it never adds a second finding there.
 */
function avoidedName(entry: string): RegExp {
  const scoped = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/u.exec(entry);
  const before = scoped?.[1] ?? '';
  const name = scoped?.[2] ?? entry;
  const after = scoped?.[3] ?? '';
  return new RegExp(
    `(?<=${WORD_START}${escapeRegex(before)})${escapeRegex(name)}(?=${escapeRegex(after)}${WORD_END})`,
    'giu',
  );
}

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
          // An empty name would match everywhere, without advancing.
          avoided: (term._avoid?.[locale.id] ?? [])
            .filter((name) => name !== '')
            .map(avoidedName),
          native: glossary.resolveForm(term, locale.id),
        }));
      if (applicable.length === 0) continue;
      // Most prose lines contain no UI label. This exact literal prefilter
      // skips only those lines; the term loop preserves finding order and
      // reports every overlap and repeated occurrence as before.
      const anyTerm = new RegExp(
        `\\b(?:${applicable.map(({ term }) => escapeRegex(term.en)).join('|')})\\b`,
      );
      // Non-shipped names match in any case, so they need their own prefilter.
      const avoidedSources = applicable.flatMap(({ avoided }) =>
        avoided.map(({ source }) => source),
      );
      const anyAvoided =
        avoidedSources.length > 0
          ? new RegExp(avoidedSources.join('|'), 'iu')
          : null;
      for (const fragment of ctx.scanner.fragments({ locale: locale.id })) {
        if (fragment.disabled?.has('terminology-ui-label')) continue;
        if (!anyTerm.test(fragment.text) && !anyAvoided?.test(fragment.text))
          continue;
        for (const { term, re, avoided, native } of applicable) {
          const reported = new Set<number>();
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(fragment.text)) !== null) {
            reported.add(m.index);
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
          // One finding where the `en` form already matched the same text.
          for (const name of avoided) {
            name.lastIndex = 0;
            while ((m = name.exec(fragment.text)) !== null) {
              if (reported.has(m.index)) continue;
              reported.add(m.index);
              findings.push({
                file: fragment.pos.file,
                line: fragment.pos.line,
                column: fragment.pos.column + m.index,
                key: fragment.key ?? undefined,
                locale: fragment.locale,
                rule: 'ui-label-non-shipped',
                detail: `"${m[0]}" is not the shipped name of UI-label term "${term.en}"`,
                suggest: `use "${native}"`,
                doctrine: locale.doctrine,
              });
            }
          }
        }
      }
    }
    return findings;
  },
});
