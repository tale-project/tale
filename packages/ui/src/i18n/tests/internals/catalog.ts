/**
 * A locale's catalog in a messages directory comes in one of two layouts:
 * a single file (`<locale>.yml`) or one file per topic (`<locale>/<topic>.yml`,
 * a topic being one top-level namespace). The checks read both the same way:
 * as one tree of namespaces.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

export type CatalogTree = Record<string, unknown>;

function isTree(value: unknown): value is CatalogTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One file of a catalog, and the namespace its keys sit under (topic files). */
export interface CatalogFile {
  readonly path: string;
  /** The topic a per-topic file holds; its keys are `<topic>.<key>`. */
  readonly topic?: string;
}

/** The directory holding a per-topic catalog, when the locale uses that layout. */
function topicDir(messagesDir: string, name: string): string | undefined {
  const dir = path.join(messagesDir, name);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : undefined;
}

/**
 * The files of the catalog named `name` (`en`, `de-CH`, …), or of a
 * single-file catalog given with its extension (`global.yml`). Empty when it
 * is absent.
 */
export function catalogFiles(messagesDir: string, name: string): CatalogFile[] {
  const base = name.endsWith('.yml') ? name.slice(0, -'.yml'.length) : name;
  const file = path.join(messagesDir, `${base}.yml`);
  if (fs.existsSync(file)) return [{ path: file }];
  const dir = topicDir(messagesDir, base);
  if (dir === undefined) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith('.yml'))
    .sort()
    .map((entry) => ({
      path: path.join(dir, entry),
      topic: entry.slice(0, -'.yml'.length),
    }));
}

/** The topic files of a per-topic catalog, by name; empty for a single file. */
export function catalogTopics(messagesDir: string, name: string): string[] {
  return catalogFiles(messagesDir, name).flatMap((file) =>
    file.topic === undefined ? [] : [file.topic],
  );
}

function readTree(file: string): CatalogTree {
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${file}: ${cause}`, { cause: error });
  }
  if (raw === null || raw === undefined) return {};
  if (!isTree(raw)) {
    throw new Error(
      `Expected a mapping at the top level of ${file}, got ${Array.isArray(raw) ? 'array' : typeof raw}.`,
    );
  }
  return raw;
}

/**
 * The catalog named `name` as one tree of namespaces, whichever layout it
 * uses; `undefined` when it is absent.
 */
export function readCatalog(
  messagesDir: string,
  name: string,
): CatalogTree | undefined {
  const files = catalogFiles(messagesDir, name);
  if (files.length === 0) return undefined;
  const tree: CatalogTree = {};
  for (const file of files) {
    const content = readTree(file.path);
    if (file.topic === undefined) Object.assign(tree, content);
    else tree[file.topic] = content;
  }
  return tree;
}

/**
 * The locales present in a messages directory, as `<locale>.yml` files or
 * `<locale>/` topic directories, without the shared files.
 */
export function listCatalogLocales(
  messagesDir: string,
  sharedFiles: ReadonlyArray<string>,
): string[] {
  if (!fs.existsSync(messagesDir)) return [];
  const shared = new Set(sharedFiles);
  const locales = new Set<string>();
  for (const entry of fs.readdirSync(messagesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.yml')) {
      if (!shared.has(entry.name)) {
        locales.add(entry.name.slice(0, -'.yml'.length));
      }
    } else if (
      entry.isDirectory() &&
      fs
        .readdirSync(path.join(messagesDir, entry.name))
        .some((f) => f.endsWith('.yml'))
    ) {
      locales.add(entry.name);
    }
  }
  return [...locales].sort();
}
