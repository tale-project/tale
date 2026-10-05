/**
 * Filesystem traversal helpers for the scanner.
 *
 * `walkMessagesDir(dir)` yields every `<locale>.json` file present in the
 * directory (one shallow read; no recursion). `walkDocsRoot(root, locales)`
 * yields every markdown page under `root/<locale>/**` (recursive).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { JsonSource, MarkdownSource } from './types';

/** Yield every present locale JSON in `messagesDir`. */
export function walkMessagesDir(
  messagesDir: string,
  locales: ReadonlyArray<string>,
  sharedFiles: ReadonlyArray<string>,
): JsonSource[] {
  if (!fs.existsSync(messagesDir)) return [];
  const skip = new Set(sharedFiles);
  const out: JsonSource[] = [];
  for (const entry of fs.readdirSync(messagesDir)) {
    if (!entry.endsWith('.yml')) continue;
    if (skip.has(entry)) continue;
    const locale = entry.slice(0, -'.yml'.length);
    if (locales.length > 0 && !locales.includes(locale)) continue;
    out.push({
      kind: 'json',
      path: path.join(messagesDir, entry),
      locale,
    });
  }
  return out;
}

/** Yield every markdown page under each `<docsRoot>/<locale>/` tree. */
export function walkDocsRoot(
  docsRoot: string,
  locales: ReadonlyArray<string>,
): MarkdownSource[] {
  const out: MarkdownSource[] = [];
  for (const locale of locales) {
    const localeDir = path.join(docsRoot, locale);
    if (!fs.existsSync(localeDir)) continue;
    for (const file of walkMarkdownFiles(localeDir)) {
      out.push({ kind: 'markdown', path: file, locale });
    }
  }
  return out;
}

function walkMarkdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, out);
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
