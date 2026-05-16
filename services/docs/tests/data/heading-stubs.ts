/**
 * Stub closing-section heading names per locale.
 *
 * Source: `.claude/skills/docs/SKILL.md` Rule 3 ("Every page has a real
 * closing") and the page-shape playbooks.
 *
 * Consumed by `23-structure-closing.test.ts` (closing section must be named
 * for what it does) and `20-structure-headings.test.ts` (any heading with
 * one of these stub names anywhere on the page fails).
 *
 * A stub heading is one whose name is `Next`, `Next steps`, `See also`,
 * `Resources`, or any locale equivalent. The replacement is a heading named
 * for what the section does: `Build one`, `Where this fits`, `Where this
 * gets used`, `When to reach for it`, `Common shapes`, `What to read next`.
 */

export const HEADING_STUBS: Record<string, ReadonlySet<string>> = {
  en: new Set([
    'Next',
    'Next steps',
    "What's next",
    'What’s next',
    'See also',
    'Resources',
    'Further reading',
    'Related',
    'Related links',
    'More',
    'More info',
    'More information',
    'Additional resources',
  ]),
  de: new Set([
    'Weiter',
    'Weitere Schritte',
    'Nächste Schritte',
    'Naechste Schritte',
    'Siehe auch',
    'Mehr',
    'Mehr Infos',
    'Weiterführende Links',
    'Ressourcen',
    'Verwandte Themen',
  ]),
  fr: new Set([
    'Suite',
    'Suivant',
    'Étapes suivantes',
    'Etapes suivantes',
    'Voir aussi',
    'Pour aller plus loin',
    'Ressources',
    'Liens connexes',
    'En savoir plus',
  ]),
};

/** Locales that fall back to the `de` stub list (Swiss German, etc.). */
export const HEADING_STUBS_FALLBACK: Record<string, string> = {
  'de-CH': 'de',
};

/** Resolve the stub set for any locale, applying fallbacks. */
export function stubsForLocale(locale: string): ReadonlySet<string> {
  const fallback = HEADING_STUBS_FALLBACK[locale];
  if (fallback) return HEADING_STUBS[fallback] ?? new Set();
  return HEADING_STUBS[locale] ?? HEADING_STUBS.en;
}
