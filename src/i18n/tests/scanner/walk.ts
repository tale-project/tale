/**
 * Filesystem traversal helpers for the scanner.
 *
 * `walkMessagesDir(dir)` yields every file of every locale catalog present in
 * the directory: a `<locale>.yml`, or each topic file of a `<locale>/`
 * directory. `walkDocsRoot(root, locales)` yields every markdown page under
 * `root/<locale>/**` (recursive).
 */

import fs from 'node:fs';
import path from 'node:path';

import { catalogFiles, listCatalogLocales } from '../internals/catalog';
import type { JsonSource, MarkdownSource } from './types';

/** Yield every file of every present locale catalog in `messagesDir`. */
export function walkMessagesDir(
  messagesDir: string,
  locales: ReadonlyArray<string>,
  sharedFiles: ReadonlyArray<string>,
): JsonSource[] {
  const out: JsonSource[] = [];
  for (const locale of listCatalogLocales(messagesDir, sharedFiles)) {
    if (locales.length > 0 && !locales.includes(locale)) continue;
    for (const file of catalogFiles(messagesDir, locale)) {
      out.push({
        kind: 'json',
        path: file.path,
        locale,
        ...(file.topic !== undefined && { keyPrefix: file.topic }),
      });
    }
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
