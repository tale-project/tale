/**
 * Stub closing-section heading names per locale. Used by the docs-structural
 * tests (`services/docs/tests/structure-closing.test.ts`,
 * `structure-headings.test.ts`) to flag headings whose name is a stub
 * (`Next`, `See also`, etc.) instead of a real "Where this fits" closing.
 *
 * Locale-aware: each locale's stub set lists the unwanted names; the
 * fallback table covers regional locales that inherit from a base.
 *
 * Doctrine: `.agents/docs/AGENTS.md` Rule 2 + the page-shape playbook.
 */

const HEADING_STUBS: Record<string, ReadonlySet<string>> = {
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

/** Locales that fall back to a base's stub list (Swiss German → German). */
const HEADING_STUBS_FALLBACK: Record<string, string> = {
  'de-CH': 'de',
};

/** Resolve the stub set for any locale, applying fallbacks. */
export function stubsForLocale(locale: string): ReadonlySet<string> {
  const fallback = HEADING_STUBS_FALLBACK[locale];
  if (fallback) return HEADING_STUBS[fallback] ?? HEADING_STUBS.en;
  return HEADING_STUBS[locale] ?? HEADING_STUBS.en;
}
