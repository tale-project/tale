import { parseFrontmatter } from '@tale/webui/utils/parse-frontmatter';

import { ALL_LOCALES, BASE_LOCALES, type Locale } from '@/lib/i18n/locales';

export interface DocFrontmatter {
  title: string;
  description: string;
  noindex: boolean;
  sidebarTitle?: string;
  icon?: string;
}

export interface DocPage {
  /** URL path relative to the locale root, e.g. `platform/agents/concepts`. */
  slug: string;
  locale: Locale;
  frontmatter: DocFrontmatter;
  body: string;
}

const rawModules: Record<string, string> = import.meta.glob(
  '../../app/content/**/*.{md,mdx}',
  { query: '?raw', import: 'default', eager: true },
);

const ALL_LOCALE_SET: ReadonlySet<string> = new Set(ALL_LOCALES);

function isLocale(value: string): value is Locale {
  return ALL_LOCALE_SET.has(value);
}

function normaliseFrontmatter(
  raw: Record<string, string | boolean>,
): DocFrontmatter {
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    noindex: raw.noindex === true,
    sidebarTitle:
      typeof raw.sidebarTitle === 'string' ? raw.sidebarTitle : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
  };
}

const documents = buildDocumentMap();

function buildDocumentMap(): Map<string, DocPage> {
  const out = new Map<string, DocPage>();
  for (const [path, raw] of Object.entries(rawModules)) {
    const match = /\/content\/([^/]+)\/(.+)\.mdx?$/.exec(path);
    if (!match) continue;
    const [, locale, slug] = match;
    if (!isLocale(locale)) continue;
    const { frontmatter, content } = parseFrontmatter(raw);
    out.set(`${locale}:${slug}`, {
      slug,
      locale,
      frontmatter: normaliseFrontmatter(frontmatter),
      body: content,
    });
  }
  return out;
}

const FALLBACK_CHAIN: Record<Locale, readonly Locale[]> = {
  en: ['en'],
  de: ['de', 'en'],
  fr: ['fr', 'en'],
  'de-AT': ['de-AT', 'de', 'en'],
  'de-CH': ['de-CH', 'de', 'en'],
  'fr-CH': ['fr-CH', 'fr', 'en'],
};

/**
 * Resolve a doc page by (locale, slug). Tries each locale in the fallback
 * chain, then — if the slug refers to a section root — looks up the
 * section's index file. So `getDocPage('en', 'platform')` returns
 * `platform/index.md` and `/platform` URLs naturally land on the section
 * landing page without needing an explicit redirect.
 */
export function getDocPage(locale: Locale, slug: string): DocPage | null {
  const candidates = [slug];
  if (slug !== 'index' && !slug.endsWith('/index')) {
    candidates.push(slug === '' ? 'index' : `${slug}/index`);
  }
  for (const localeKey of FALLBACK_CHAIN[locale]) {
    for (const candidateSlug of candidates) {
      const doc = documents.get(`${localeKey}:${candidateSlug}`);
      if (doc) return doc;
    }
  }
  return null;
}

export function listDocPages(locale: Locale): DocPage[] {
  // Resolve every base-locale slug through the fallback chain so callers see
  // the locale's effective page set including inherited base content.
  const baseSlugs = new Set<string>();
  for (const doc of documents.values()) {
    if (doc.locale === 'en' || doc.locale === locale) baseSlugs.add(doc.slug);
  }
  const out: DocPage[] = [];
  for (const slug of baseSlugs) {
    const doc = getDocPage(locale, slug);
    if (doc) out.push(doc);
  }
  return out;
}

export function listAllPages(): DocPage[] {
  return [...documents.values()];
}

export { BASE_LOCALES };
