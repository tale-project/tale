'use node';

/**
 * Generic typed read/write helper for area-specific JSON config files
 * under `$TALE_CONFIG_DIR/{area}/{orgSlug}.json`.
 *
 * The area-agnostic substrate behind retention's per-org files. Wrapping
 * `readJsonFile` + `atomicWrite` so callers don't reinvent path
 * resolution, symlink/size guards, or atomic-rename semantics.
 *
 * Initially used only by retention; provider/integration migrations are
 * the obvious next consumers. Keep the API minimal.
 *
 * Known limitations (round-2 / M7):
 *   - **Last-writer-wins.** No file-level locking — two concurrent
 *     `write()` calls for the same orgSlug will race and the later
 *     atomic rename wins. Acceptable today (single operator at a time)
 *     but every area-specific schema should plan for a future
 *     `schemaVersion` field before introducing concurrent writers
 *     (admin UI multi-tab, cron-driven mutators, etc.).
 *   - **No `schemaVersion` field on stored documents.** Migrations will
 *     have to pivot on the absence of the field as "v1" when added.
 *     Track follow-up before any breaking schema change.
 *   - **`readJsonFile` returns a sha256 of the parsed bytes for OCC
 *     scenarios; the current `read()` helper discards it.** Add a
 *     `readWithEtag` overload when concurrent-write protection is
 *     wired into a UI flow.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { z } from 'zod/v4';

import { atomicWrite, readJsonFile, validateOrgSlug } from '../file_io';

const MAX_FILE_SIZE_BYTES = 256 * 1024;
const ORG_FILE_REGEX = /^[a-z0-9][a-z0-9_-]*\.json$/;

export interface ConfigStore<T> {
  /**
   * Read the per-org file. Returns `null` when the file is missing.
   * Throws when the file is present but corrupted, oversized, a symlink,
   * or fails Zod validation.
   */
  read(orgSlug: string): Promise<T | null>;
  /** Atomic write of the parsed/serialized config to the per-org path. */
  write(orgSlug: string, value: T): Promise<void>;
  /** Enumerate `*.json` files in the area dir, returning each org slug. */
  list(): Promise<Array<{ orgSlug: string }>>;
}

function getAreaDir(area: string): string {
  const configDir = process.env.TALE_CONFIG_DIR;
  if (!configDir) {
    throw new Error(
      `TALE_CONFIG_DIR environment variable is not set. ` +
        `Set TALE_CONFIG_DIR in .env to the root config directory ` +
        `(e.g., TALE_CONFIG_DIR=/path/to/tale/examples) so ${area}/ ` +
        `can be resolved.`,
    );
  }
  return path.join(configDir, area);
}

function resolveFilePath(area: string, orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const dir = getAreaDir(area);
  const resolved = path.resolve(dir, `${orgSlug}.json`);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${orgSlug}`);
  }
  return resolved;
}

/**
 * Build a typed `ConfigStore<T>` for a given area + Zod schema. The
 * returned store enforces the schema on every read; writes serialize
 * the parsed value as pretty JSON (matching providers' convention).
 */
export function createFileConfigStore<T>(
  area: string,
  schema: z.ZodType<T>,
): ConfigStore<T> {
  const parse = (content: string): T => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
    const parsed = JSON.parse(content) as unknown;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid ${area} config: ${result.error.message}`);
    }
    return result.data;
  };

  return {
    async read(orgSlug) {
      const filePath = resolveFilePath(area, orgSlug);
      const result = await readJsonFile(filePath, MAX_FILE_SIZE_BYTES, parse);
      if (result.ok) return result.data;
      if (result.error === 'not_found') return null;
      throw new Error(
        `Failed to read ${area}/${orgSlug}.json: ${result.message}`,
      );
    },
    async write(orgSlug, value) {
      const filePath = resolveFilePath(area, orgSlug);
      // Re-parse before write to surface schema errors to the caller
      // rather than silently corrupting the file. Cheap relative to fs.
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(
          `Refusing to write invalid ${area} config: ${parsed.error.message}`,
        );
      }
      const content = JSON.stringify(parsed.data, null, 2) + '\n';
      await atomicWrite(filePath, content);
    },
    async list() {
      const dir = getAreaDir(area);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        // Missing dir is fine — operator hasn't seeded anything yet.
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return [];
        }
        throw err;
      }
      return entries
        .filter((name) => ORG_FILE_REGEX.test(name))
        .map((name) => ({ orgSlug: name.slice(0, -'.json'.length) }));
    },
  };
}
