// Build-time helper: walk `content/` and yield (slug, frontmatter, body) for
// every page. Used by the frontmatter manifest, the search index, the SEO
// artifact build and the prerenderer so they all share one definition of
// "what pages exist".

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@tale/ui/parse-frontmatter';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(SCRIPT_DIR, '..', 'content');

export interface ContentRecord {
  /** URL path relative to `/docs`, e.g. `components/button`. */
  slug: string;
  frontmatter: Record<string, string | boolean>;
  body: string;
  /** Absolute file path on disk. */
  filePath: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    console.warn(`[ui-docs] cannot read ${dir}:`, error);
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = await stat(full);
    } catch (error) {
      // Listed by readdir, gone by stat — a transient directory another task
      // removed. It held no pages, so keep walking.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (info.isDirectory()) yield* walk(full);
    else if (entry.endsWith('.md') && entry !== 'README.md') yield full;
  }
}

export async function listAllContent(
  contentRoot = CONTENT_ROOT,
): Promise<ContentRecord[]> {
  const out: ContentRecord[] = [];
  for await (const filePath of walk(contentRoot)) {
    const slug = relative(contentRoot, filePath).replace(/\.md$/, '');
    // A page must live in a section folder — a bare `content/foo.md` has no
    // place in the nav tree, so it is not a page.
    if (!slug.includes('/')) continue;
    const raw = await readFile(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);
    out.push({ slug, frontmatter, body: content, filePath });
  }
  return sortContentRecords(out);
}

/** Filesystem enumeration order differs between hosts. One canonical order
 *  keeps every generated artifact reproducible. */
export function sortContentRecords(records: ContentRecord[]): ContentRecord[] {
  return records.toSorted((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
}

export { CONTENT_ROOT };
