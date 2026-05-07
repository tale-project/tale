import type { SupportedLocale } from '../i18n/locales';
import { isLegalSlug, type LegalSlug } from './slugs';

interface LegalFrontmatter {
  title: string;
  description: string;
  noindex: boolean;
}

interface LegalDocument {
  slug: LegalSlug;
  locale: SupportedLocale;
  frontmatter: LegalFrontmatter;
  content: string;
}

const SUPPORTED_LOCALES: ReadonlySet<string> = new Set(['en', 'de', 'fr']);

function isSupportedLocale(value: string): value is SupportedLocale {
  return SUPPORTED_LOCALES.has(value);
}

/**
 * Strip the YAML frontmatter delimited by `---` lines from the head of a
 * markdown document. Only the limited shape used by the legal docs is
 * recognized — `key: value` pairs, optionally quoted, with `true` /
 * `false` literals coerced to booleans. Anything else is treated as a
 * string value.
 */
function parseFrontmatter(raw: string): {
  frontmatter: LegalFrontmatter;
  content: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const empty: LegalFrontmatter = {
    title: '',
    description: '',
    noindex: false,
  };
  if (!match) return { frontmatter: empty, content: raw };

  const [, block, body] = match;
  const fm: LegalFrontmatter = { ...empty };
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'title') fm.title = value;
    else if (key === 'description') fm.description = value;
    else if (key === 'noindex') fm.noindex = value === 'true';
  }
  return { frontmatter: fm, content: body.replace(/^\r?\n/, '') };
}

const rawModules: Record<string, string> = import.meta.glob(
  '../../app/content/legal/**/*.md',
  { query: '?raw', import: 'default', eager: true },
);

const documents = buildDocumentMap();

function buildDocumentMap(): Map<string, LegalDocument> {
  const out = new Map<string, LegalDocument>();
  for (const [path, raw] of Object.entries(rawModules)) {
    const match = /\/content\/legal\/([^/]+)\/([^/]+)\.md$/.exec(path);
    if (!match) continue;
    const [, locale, slug] = match;
    if (!isSupportedLocale(locale) || !isLegalSlug(slug)) continue;
    const { frontmatter, content } = parseFrontmatter(raw);
    out.set(`${locale}:${slug}`, {
      slug,
      locale,
      frontmatter,
      content,
    });
  }
  return out;
}

export function getLegalDocument(
  locale: SupportedLocale,
  slug: LegalSlug,
): LegalDocument | null {
  return documents.get(`${locale}:${slug}`) ?? null;
}
