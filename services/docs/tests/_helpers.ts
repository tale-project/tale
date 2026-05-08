import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Helpers shared by the docs test suite. Doc pages live under `/docs/<locale>/...md`
 * at the workspace root; the docs service lives at `services/docs/`. The walker
 * only ever descends into the content tree.
 */
export const DOCS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const CONTENT_ROOT = path.resolve(DOCS_ROOT, '..', '..', 'docs');

const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/** Walk the content tree and return every `.md`/`.mdx` path relative to
 *  `CONTENT_ROOT` (e.g. `en/platform/agents/concepts.md`). */
export function walkDocs(
  dir: string = CONTENT_ROOT,
  out: string[] = [],
): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(CONTENT_ROOT, full);
    if (entry.isDirectory()) walkDocs(full, out);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))
      out.push(rel);
  }
  return out;
}

/** Top-level locale subdirectories under `/docs/`. */
export function discoverLocales(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(CONTENT_ROOT)) return out;
  for (const entry of fs.readdirSync(CONTENT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (LOCALE_PATTERN.test(entry.name)) out.push(entry.name);
  }
  out.sort();
  return out;
}

/** Locale of a content-relative path. The first segment is always the locale
 *  in this layout (`en/...`, `de/...`, etc.). */
export function localeOf(
  relPath: string,
  locales: string[] = discoverLocales(),
): string {
  const first = relPath.split(path.sep)[0];
  return locales.includes(first) ? first : 'en';
}
