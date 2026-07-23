'use node';

/**
 * Loader for the shipped AI-provider system config —
 * `configs/platform/system/{providers,models,harnesses}/*.yml`.
 *
 * The directory listing IS the registry: every file in a shipped dir must
 * parse through the safe YAML loader and validate against its Zod schema,
 * a file's name must equal the identity it declares (`openrouter.yml` ⇒
 * `name: openrouter`; `pi.yml` ⇒ `slug: pi`; every entry in
 * `models/anthropic.yml` ⇒ `provider: anthropic`), and an unexpected file —
 * a stray extension, a subdirectory — is an error, never silently skipped.
 * Any violation is a packaging defect and throws with the file path in the
 * message.
 *
 * Caching mirrors the pii data loader: parses are memoized per absolute
 * path keyed on (mtimeMs, size), and each directory's assembled result is
 * reused as long as the file set and every stamp are unchanged — repeat
 * calls cost a readdir plus one stat per file and return a stable
 * reference. A changed file is re-parsed on the next call.
 *
 * Root resolution mirrors the builtin-catalog convention: an explicit
 * `root` (the `system/` directory) wins; then `$TALE_CONFIG_SYSTEM_DIR` (the
 * deployment contract — shipped containers bake the tree in and set this,
 * since a container has no repo checkout to walk up to); otherwise the loader
 * walks up from the working directory to the repo checkout's
 * `configs/platform/system` — which covers vitest, scripts, and a source
 * checkout's convex dev process.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod/v4';

import { parseYaml } from '../../../lib/shared/config/yaml';
import { formatZodError } from '../../../lib/shared/schemas/format-error';
import {
  harnessConnectorSchema,
  modelCatalogFileSchema,
  providerConnectorSchema,
  type HarnessConnector,
  type ModelCatalogEntry,
  type ProviderConnector,
} from '../../../lib/shared/schemas/providers';

/** Repo-relative location of the shipped system config tree. */
const REPO_SYSTEM_ROOT = ['configs', 'platform', 'system'] as const;

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    // A missing path is the ordinary walk-up miss, not an error.
    return false;
  }
}

/** Walk up from `startDir` to the checkout's `configs/platform/system`. */
function findRepoSystemRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ...REPO_SYSTEM_ROOT);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `$TALE_CONFIG_SYSTEM_DIR` when it is set to an absolute path. A set-but-
 * relative value is a misconfiguration and resolves to nothing (mirrors the
 * builtin-catalog convention) rather than being guessed against the cwd. */
function envSystemRoot(): string | undefined {
  const fromEnv = process.env.TALE_CONFIG_SYSTEM_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return undefined;
}

export interface LoadSystemConfigOptions {
  /**
   * Absolute path of the `system/` config directory (the one containing
   * `providers/`, `models/`, `harnesses/`). Defaults to the repo walk-up.
   */
  readonly root?: string;
}

function resolveRoot(options: LoadSystemConfigOptions): string {
  const root =
    options.root ?? envSystemRoot() ?? findRepoSystemRoot(process.cwd());
  if (!root) {
    throw new Error(
      '[providers] no system config tree found: set TALE_CONFIG_SYSTEM_DIR (absolute), pass an explicit root, or run inside a checkout with configs/platform/system',
    );
  }
  return root;
}

interface FileStamp {
  readonly mtimeMs: number;
  readonly size: number;
}

interface StampedFile {
  readonly filePath: string;
  /** File name without the yaml extension — the declared-identity anchor. */
  readonly stem: string;
  readonly stamp: FileStamp;
}

interface CachedParse<T> {
  readonly stamp: FileStamp;
  readonly value: T;
}

interface CachedDir<T> {
  readonly stamps: ReadonlyMap<string, FileStamp>;
  readonly values: readonly T[];
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * List a shipped config dir under the registry-completeness posture:
 * `.yml`/`.yaml` files are returned; dotfiles (editor/OS droppings like
 * `.DS_Store`) are deliberately ignored; anything else in the dir is a
 * packaging error.
 */
function listConfigDir(dir: string): StampedFile[] {
  if (!isDirectory(dir)) {
    throw new Error(`[providers] missing shipped config directory: ${dir}`);
  }
  const files: StampedFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const filePath = path.join(dir, name);
    const stat = statSync(filePath);
    const extension = path.extname(name);
    if (stat.isDirectory() || (extension !== '.yml' && extension !== '.yaml')) {
      throw new Error(
        `[providers] unexpected entry in shipped config directory: ${filePath} — only .yml files belong here`,
      );
    }
    files.push({
      filePath,
      stem: name.slice(0, -extension.length),
      stamp: { mtimeMs: stat.mtimeMs, size: stat.size },
    });
  }
  return files;
}

function parseFile<T>(
  file: StampedFile,
  cache: Map<string, CachedParse<T>>,
  allowArrayRoot: boolean,
  validate: (data: unknown, file: StampedFile) => T,
): T {
  const cached = cache.get(file.filePath);
  if (cached && sameStamp(cached.stamp, file.stamp)) {
    return cached.value;
  }
  const text = readFileSync(file.filePath, 'utf8');
  const parsed = parseYaml(text, { allowArrayRoot });
  if (!parsed.ok) {
    throw new Error(`[providers] ${file.filePath}: ${parsed.error}`);
  }
  let value: T;
  try {
    value = validate(parsed.data, file);
  } catch (cause) {
    // Schema failures render through the shared formatter — the raw zod/v4
    // message is a JSON issue dump, not an operator-facing sentence.
    const detail =
      cause instanceof z.ZodError
        ? formatZodError(cause)
        : cause instanceof Error
          ? cause.message
          : String(cause);
    throw new Error(`[providers] ${file.filePath}: ${detail}`, { cause });
  }
  cache.set(file.filePath, { stamp: file.stamp, value });
  return value;
}

/**
 * Load every file of one shipped dir through its validator, reusing the
 * previously assembled array while the file set and stamps are unchanged.
 */
function loadDir<T>(
  root: string,
  subdir: string,
  parseCache: Map<string, CachedParse<T>>,
  dirCache: Map<string, CachedDir<T>>,
  allowArrayRoot: boolean,
  validate: (data: unknown, file: StampedFile) => T,
): readonly T[] {
  const dir = path.join(root, subdir);
  const files = listConfigDir(dir);

  const stamps = new Map<string, FileStamp>();
  for (const file of files) {
    stamps.set(file.filePath, file.stamp);
  }

  const cached = dirCache.get(dir);
  if (cached && cached.stamps.size === stamps.size) {
    let fresh = true;
    for (const [filePath, stamp] of stamps) {
      const prev = cached.stamps.get(filePath);
      if (!prev || !sameStamp(prev, stamp)) {
        fresh = false;
        break;
      }
    }
    if (fresh) return cached.values;
  }

  const values = files.map((file) =>
    parseFile(file, parseCache, allowArrayRoot, validate),
  );
  dirCache.set(dir, { stamps, values });
  return values;
}

const connectorParseCache = new Map<string, CachedParse<ProviderConnector>>();
const connectorDirCache = new Map<string, CachedDir<ProviderConnector>>();

const catalogParseCache = new Map<
  string,
  CachedParse<readonly ModelCatalogEntry[]>
>();
const catalogDirCache = new Map<
  string,
  CachedDir<readonly ModelCatalogEntry[]>
>();

const harnessParseCache = new Map<string, CachedParse<HarnessConnector>>();
const harnessDirCache = new Map<string, CachedDir<HarnessConnector>>();

/** Load the shipped provider connectors (`providers/<name>.yml`). */
export function loadProviderConnectors(
  options: LoadSystemConfigOptions = {},
): readonly ProviderConnector[] {
  return loadDir(
    resolveRoot(options),
    'providers',
    connectorParseCache,
    connectorDirCache,
    false,
    (data, file) => {
      const connector = providerConnectorSchema.parse(data);
      if (connector.name !== file.stem) {
        throw new Error(
          `connector name "${connector.name}" must match the file name "${file.stem}"`,
        );
      }
      return connector;
    },
  );
}

/**
 * Load the shipped static model catalogs (`models/<provider>.yml`), keyed
 * by provider slug. Every entry's `provider` must equal its file name — a
 * catalog file cannot smuggle entries for another connector.
 */
export function loadStaticCatalogs(
  options: LoadSystemConfigOptions = {},
): ReadonlyMap<string, readonly ModelCatalogEntry[]> {
  const catalogs = loadDir(
    resolveRoot(options),
    'models',
    catalogParseCache,
    catalogDirCache,
    true,
    (data, file) => {
      const entries = modelCatalogFileSchema.parse(data);
      for (const entry of entries) {
        if (entry.provider !== file.stem) {
          throw new Error(
            `model "${entry.id}" declares provider "${entry.provider}" but lives in ${file.stem}.yml`,
          );
        }
      }
      return entries;
    },
  );
  // Entry provider === file stem (checked above) and file stems are unique
  // within a directory, so the first entry's provider can key the map.
  return new Map(
    catalogs.map((entries) => [entries[0].provider, entries] as const),
  );
}

/** Load the shipped harness connectors (`harnesses/<slug>.yml`). */
export function loadHarnesses(
  options: LoadSystemConfigOptions = {},
): readonly HarnessConnector[] {
  return loadDir(
    resolveRoot(options),
    'harnesses',
    harnessParseCache,
    harnessDirCache,
    false,
    (data, file) => {
      const harness = harnessConnectorSchema.parse(data);
      if (harness.slug !== file.stem) {
        throw new Error(
          `harness slug "${harness.slug}" must match the file name "${file.stem}"`,
        );
      }
      return harness;
    },
  );
}
