// Build-time helper: walk the on-disk content tree and yield (locale, slug,
// frontmatter, body) for every page. Used by the search-index, llms.txt,
// llms-full.txt, sitemap.xml, and per-page .md scripts so they all share
// one definition of "what pages exist".

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@tale/ui/parse-frontmatter';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', 'docs');

export interface ContentRecord {
  locale: string;
  slug: string;
  frontmatter: Record<string, string | boolean>;
  body: string;
  /** Absolute file path on disk (used for git mtime, etc). */
  filePath: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    // Never content: a dependency or cache directory (`node_modules`,
    // `.vite-temp`) that a concurrent build task may create and remove under
    // the tree while this walk runs.
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = await stat(full);
    } catch (error) {
      // Listed by readdir, gone by stat: a transient directory another task
      // just removed. It held no pages, so the walk moves on — a throw here
      // failed the whole docs build on a race it had nothing to do with.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (info.isDirectory()) {
      yield* walk(full);
    } else if (/\.mdx?$/.test(entry)) {
      yield full;
    }
  }
}

export async function listAllContent(): Promise<ContentRecord[]> {
  const out: ContentRecord[] = [];
  for await (const filePath of walk(CONTENT_ROOT)) {
    const rel = relative(CONTENT_ROOT, filePath);
    const localeSep = rel.indexOf('/');
    if (localeSep === -1) continue;
    const locale = rel.slice(0, localeSep);
    const slug = rel.slice(localeSep + 1).replace(/\.mdx?$/, '');
    const raw = await readFile(filePath, 'utf-8');
    const { frontmatter, content } = parseFrontmatter(raw);
    out.push({ locale, slug, frontmatter, body: content, filePath });
  }
  return out;
}

export { CONTENT_ROOT };
