import fs from 'node:fs';
import path from 'node:path';

import { CONTENT_ROOT } from './paths';

/**
 * Filesystem traversal helpers for the docs content tree.
 *
 * Scope rules:
 *   - This module knows about `.md`/`.mdx` files and locale directories.
 *     It does NOT parse markdown — see `markdown.ts` for that.
 *   - Returned paths are content-relative (`en/platform/agents/concepts.md`),
 *     never absolute. Callers join with `CONTENT_ROOT` themselves so the
 *     test failure messages stay short.
 *   - Hidden directories (`.foo`) and non-locale top-level directories are
 *     skipped — keeps the walker from descending into stray scratch files.
 */

/** A two-letter language code with an optional two-letter region subtag, e.g.
 *  `en`, `de`, `de-CH`. */
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/** The three base locales the suite enforces full parity for. Regional
 *  variants (today `de-CH`) are discovered dynamically and held to a softer
 *  rule (presence only, no full mirror requirement). */
export const BASE_LOCALES = ['en', 'de', 'fr'] as const;

export type Locale = string;

/**
 * Walk the content tree recursively and return every `.md`/`.mdx` path as a
 * forward-or-system-slash content-relative string (`en/platform/agents/concepts.md`).
 *
 * Hidden entries (`.git`, `.DS_Store`, …) are skipped. Empty when
 * `CONTENT_ROOT` does not exist — tests check that themselves rather than
 * trusting an empty walk.
 */
export function walkDocs(
  dir: string = CONTENT_ROOT,
  out: string[] = [],
): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDocs(full, out);
      continue;
    }
    if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      out.push(path.relative(CONTENT_ROOT, full));
    }
  }
  return out;
}

/** All top-level locale directories under `docs/` whose name matches
 *  `LOCALE_PATTERN`. Sorted for deterministic test output. */
export function discoverLocales(): Locale[] {
  if (!fs.existsSync(CONTENT_ROOT)) return [];
  const out: Locale[] = [];
  for (const entry of fs.readdirSync(CONTENT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (LOCALE_PATTERN.test(entry.name)) out.push(entry.name);
  }
  out.sort();
  return out;
}

/**
 * Locale of a content-relative path. The first segment of every path produced
 * by `walkDocs` is the locale (`en/...`, `de/...`); when the segment is not a
 * known locale (which should never happen for a well-formed corpus) we fall
 * back to `en` so callers don't crash on a stray file at the content root.
 */
export function localeOf(
  relPath: string,
  locales: Locale[] = discoverLocales(),
): Locale {
  const first = relPath.split(path.sep)[0];
  return locales.includes(first) ? first : 'en';
}

/**
 * Every page under a given locale, returned with the locale prefix stripped so
 * callers can directly diff trees across locales (`platform/agents/concepts.md`).
 */
export function filesInLocale(
  locale: Locale,
  all: string[] = walkDocs(),
): string[] {
  const prefix = locale + path.sep;
  return all
    .filter((f) => f.startsWith(prefix))
    .map((f) => f.slice(prefix.length));
}
