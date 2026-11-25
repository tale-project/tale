/**
 * `terminology-ui-label` — glossary terms in {feature, role, knowledgeEntity}
 * whose locale form differs from `en` and whose `en` form appears in
 * non-EN text, or whose `_avoid` list names a form that the locale's text
 * uses in any case (a lowercase loanword, a retired translation). A locale
 * that keeps the `en` form (German `Node`) is checked for its `_avoid`
 * names alone (`Knoten`). A match inside a name from the term's `_allow`
 * list for the locale (another vendor's product, such as `Google Workspace`)
 * names something else and is skipped. Swiss German reads the German lists
 * unless it has its own.
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
const WORD_REST = '[\\p{L}\\p{N}_]*';

/**
 * Case-insensitive name from `_avoid` or `_allow`. Brackets confine an
 * ordinary word to a context: `sous [gel]` matches `gel` only right after
 * `sous`, so `gel du code` stays clean, and the match starts where a longer
 * name such as `gel juridique` starts, so it never adds a second finding there.
 * A `*` at either end lets the word go on there, for a German compound or
 * ending: `*knoten*` matches `Knoten`, `Knotens`, `Knotentypen` and
 * `Agentenknoten`, and the match is the whole word. `null` for a name that
 * is empty without its `*`, which would match everywhere, without advancing.
 */
function listedName(entry: string): RegExp | null {
  const scoped = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/u.exec(entry);
  const before = scoped?.[1] ?? '';
  const name = scoped?.[2] ?? entry;
  const after = scoped?.[3] ?? '';
  const [, head = '', word = '', tail = ''] =
    /^(\*?)(.*?)(\*?)$/su.exec(name) ?? [];
  if (word === '') return null;
  return new RegExp(
    `(?<=${WORD_START}${escapeRegex(before)})${head ? WORD_REST : ''}${escapeRegex(word)}${tail ? WORD_REST : ''}(?=${escapeRegex(after)}${WORD_END})`,
    'giu',
  );
}

/** The listed names of a term's `_avoid` or `_allow` setting for a locale. */
function listedNames(names: ReadonlyArray<string> | undefined): RegExp[] {
  return (names ?? []).flatMap((name) => listedName(name) ?? []);
}

/** Where the text uses an allowed name: `[start, end)` per occurrence. */
function allowedSpans(
  allowed: ReadonlyArray<RegExp>,
  text: string,
): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  for (const name of allowed) {
    name.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = name.exec(text)) !== null) {
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  return spans;
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
        .filter((t) => glossary.forLocale(t._lintExclude, locale.id) !== true)
        .map((term) => ({
          term,
          // A locale that keeps the `en` form uses it rightly, and is
          // checked for its `_avoid` names alone.
          re: glossary.shouldEnforce(term, locale.id)
            ? wordBoundary(term.en, 'g')
            : null,
          avoided: listedNames(glossary.forLocale(term._avoid, locale.id)),
          allowed: listedNames(glossary.forLocale(term._allow, locale.id)),
          native: glossary.resolveForm(term, locale.id),
        }))
        .filter(({ re, avoided }) => re !== null || avoided.length > 0);
      if (applicable.length === 0) continue;
      // Most prose lines contain no UI label. This exact literal prefilter
      // skips only those lines; the term loop preserves finding order and
      // reports every overlap and repeated occurrence as before.
      const enForms = applicable.flatMap(({ term, re }) =>
        re ? [escapeRegex(term.en)] : [],
      );
      const anyTerm =
        enForms.length > 0
          ? new RegExp(`\\b(?:${enForms.join('|')})\\b`)
          : null;
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
        if (!anyTerm?.test(fragment.text) && !anyAvoided?.test(fragment.text))
          continue;
        for (const { term, re, avoided, allowed, native } of applicable) {
          const spans = allowedSpans(allowed, fragment.text);
          // Inside an allowed name the word names something else.
          const isAllowed = (match: RegExpExecArray) =>
            spans.some(
              ([start, end]) =>
                start <= match.index && match.index + match[0].length <= end,
            );
          const reported = new Set<number>();
          let m: RegExpExecArray | null;
          if (re) {
            re.lastIndex = 0;
            while ((m = re.exec(fragment.text)) !== null) {
              if (isAllowed(m)) continue;
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
          }
          // One finding where the `en` form already matched the same text.
          for (const name of avoided) {
            name.lastIndex = 0;
            while ((m = name.exec(fragment.text)) !== null) {
              if (reported.has(m.index) || isAllowed(m)) continue;
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
