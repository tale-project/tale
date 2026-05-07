// Enumerate the legal routes that ship with the marketing site.
// Reads markdown files from `app/content/legal/{en,de,fr}/*.md` via fs and
// pulls per-page SEO out of the YAML frontmatter so the prerender and
// PDF-generation scripts share one source of truth.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const LEGAL_CONTENT_ROOT = resolve(
  SCRIPT_DIR,
  '..',
  'app',
  'content',
  'legal',
);

const LOCALES = ['en', 'de', 'fr'] as const;
export type LegalLocale = (typeof LOCALES)[number];

export interface LegalRoute {
  locale: LegalLocale;
  slug: string;
  /** Site-relative URL, e.g. `/legal/privacy-policy` or `/de/legal/...`. */
  url: string;
  title: string;
  description: string;
}

interface Frontmatter {
  title: string;
  description: string;
}

function parseFrontmatter(raw: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return { title: '', description: '' };
  const fm: Frontmatter = { title: '', description: '' };
  for (const line of match[1].split(/\r?\n/)) {
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
  }
  return fm;
}

function localeUrlPrefix(locale: LegalLocale): string {
  return locale === 'en' ? '' : `/${locale}`;
}

export async function enumerateLegalRoutes(): Promise<LegalRoute[]> {
  const routes: LegalRoute[] = [];
  for (const locale of LOCALES) {
    const dir = resolve(LEGAL_CONTENT_ROOT, locale);
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const slug = entry.replace(/\.md$/, '');
      const raw = await readFile(resolve(dir, entry), 'utf-8');
      const fm = parseFrontmatter(raw);
      routes.push({
        locale,
        slug,
        url: `${localeUrlPrefix(locale)}/legal/${slug}`,
        title: fm.title,
        description: fm.description,
      });
    }
  }
  return routes;
}
