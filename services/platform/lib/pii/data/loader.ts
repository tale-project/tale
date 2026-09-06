/**
 * Node-side loader for the pii library's shipped data tree —
 * `configs/platform/system/pii/{patterns,locales}/*.yml`.
 *
 * This is the only module in the library that touches the filesystem; the
 * engine itself is pure and takes the loaded data by value, so tests can
 * feed fixture data without a disk. Every file goes through the shared
 * safe YAML loader (core schema, alias caps, size cap) and then its Zod
 * schema; a file that fails either is a packaging defect and throws with
 * the file path in the message.
 *
 * Caching: parses are memoized per absolute path keyed on (mtimeMs, size),
 * and the assembled result object is reused as long as the file set and
 * every stamp are unchanged — repeat calls cost a readdir plus one stat
 * per file, no re-parse, and return a stable reference. A changed file
 * (dev editing a locale dataset) is re-parsed on the next call.
 *
 * Root resolution goes through the shared system-catalog resolver
 * (`lib/shared/config/system-root.ts`), like the providers and connectors
 * readers: an explicit `root` wins (the pii tree itself); then
 * `$TALE_CONFIG_SYSTEM_DIR/pii` — the deployment contract, since a shipped
 * container bakes the tree in and has no repo checkout to walk up to;
 * otherwise the walk-up from the working directory to the checkout's
 * `configs/platform/system/pii`, which covers vitest, scripts, and a source
 * checkout's dev process.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  resolveSystemConfigRoot,
  SYSTEM_CONFIG_ROOT_REMEDY,
} from '../../../lib/shared/config/system-root';
import { parseYaml } from '../../../lib/shared/config/yaml';
import {
  localeConfigSchema,
  piiPatternFileSchema,
  type LocaleConfig,
  type PiiPatternFile,
} from '../schema';

export interface PiiData {
  readonly patterns: ReadonlyArray<PiiPatternFile>;
  readonly locales: ReadonlyArray<LocaleConfig>;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    // A missing path is the ordinary walk-up miss, not an error.
    return false;
  }
}

interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

interface StampedFile {
  readonly filePath: string;
  readonly stamp: FileStamp;
}

interface CachedParse<T> {
  readonly stamp: FileStamp;
  readonly value: T;
}

interface CachedTree {
  /** Path → stamp set the cached result was assembled from. */
  readonly stamps: ReadonlyMap<string, FileStamp>;
  readonly data: PiiData;
}

// Separate parse caches per file kind keep the memoization fully typed.
const patternParseCache = new Map<string, CachedParse<PiiPatternFile>>();
const localeParseCache = new Map<string, CachedParse<LocaleConfig>>();
const treeCache = new Map<string, CachedTree>();

function listYamlFiles(dir: string): StampedFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name);
      const s = statSync(filePath);
      return { filePath, stamp: { mtimeMs: s.mtimeMs, size: s.size } };
    });
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function parseFile<T>(
  file: StampedFile,
  schema: { parse: (data: unknown) => T },
  cache: Map<string, CachedParse<T>>,
): T {
  const cached = cache.get(file.filePath);
  if (cached && sameStamp(cached.stamp, file.stamp)) {
    return cached.value;
  }
  const text = readFileSync(file.filePath, 'utf8');
  const parsed = parseYaml(text);
  if (!parsed.ok) {
    throw new Error(`[pii] ${file.filePath}: ${parsed.error}`);
  }
  let value: T;
  try {
    value = schema.parse(parsed.data);
  } catch (cause) {
    throw new Error(
      `[pii] ${file.filePath}: schema validation failed — ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  cache.set(file.filePath, { stamp: file.stamp, value });
  return value;
}

export interface LoadPiiDataOptions {
  /**
   * Absolute path of the pii data tree (the directory containing
   * `patterns/` and `locales/`). Defaults to `<system catalog root>/pii`,
   * resolved through `$TALE_CONFIG_SYSTEM_DIR` or the repo walk-up.
   */
  readonly root?: string;
}

/** The pii tree's directory name inside the system catalog. */
const PII_SUBTREE = 'pii';

/**
 * The pii data tree this process reads, or null when no source yields one.
 * Exposed so a boot probe can name the path it checked.
 */
export function resolvePiiDataRoot(root?: string): string | null {
  if (root !== undefined) return root;
  const systemRoot = resolveSystemConfigRoot();
  return systemRoot === null ? null : path.join(systemRoot, PII_SUBTREE);
}

/**
 * Load (or reuse) the shipped pattern definitions and locale datasets.
 * Returns a stable object reference until an underlying file changes.
 */
export function loadPiiData(options: LoadPiiDataOptions = {}): PiiData {
  const root = resolvePiiDataRoot(options.root);
  // An unresolved root and a resolved-but-absent tree (an env var pointing
  // at an image layout that did not bake `pii/`) are the same packaging
  // defect; both name the path and the remedy.
  if (root === null || !isDirectory(root)) {
    throw new Error(
      `[pii] no data tree at ${root ?? '<unresolved>'}: ${SYSTEM_CONFIG_ROOT_REMEDY}`,
    );
  }

  const patternFiles = listYamlFiles(path.join(root, 'patterns'));
  const localeFiles = listYamlFiles(path.join(root, 'locales'));

  const stamps = new Map<string, FileStamp>();
  for (const file of [...patternFiles, ...localeFiles]) {
    stamps.set(file.filePath, file.stamp);
  }

  const cached = treeCache.get(root);
  if (cached && cached.stamps.size === stamps.size) {
    let fresh = true;
    for (const [filePath, stamp] of stamps) {
      const prev = cached.stamps.get(filePath);
      if (!prev || !sameStamp(prev, stamp)) {
        fresh = false;
        break;
      }
    }
    if (fresh) return cached.data;
  }

  const data: PiiData = {
    patterns: patternFiles.map((file) =>
      parseFile(file, piiPatternFileSchema, patternParseCache),
    ),
    locales: localeFiles.map((file) =>
      parseFile(file, localeConfigSchema, localeParseCache),
    ),
  };
  treeCache.set(root, { stamps, data });
  return data;
}
