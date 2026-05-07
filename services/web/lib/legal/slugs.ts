/**
 * Slugs of the legal documents that ship with the marketing site. The
 * source markdown lives at `app/content/legal/{en,de,fr}/<slug>.md`; the
 * `/legal/<slug>` and `/$lang/legal/<slug>` routes resolve content by
 * (locale, slug) at render time, and the build pipeline pre-renders one
 * static HTML page + one PDF per (locale, slug) pair.
 */
export const LEGAL_SLUGS = [
  'privacy-policy',
  'terms-of-service',
  'data-processing-agreement',
  'personalization',
] as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const LEGAL_SLUG_SET: ReadonlySet<string> = new Set(LEGAL_SLUGS);

export function isLegalSlug(value: string): value is LegalSlug {
  return LEGAL_SLUG_SET.has(value);
}
