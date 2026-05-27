'use node';

/**
 * Generic typed read/write helper for area-specific JSON config files.
 *
 * Path shape is the uniform org-first layout:
 * `$TALE_CONFIG_DIR/<orgSlug>/<area>.json`. Each org has one file per
 * area, alongside its `agents/`, `providers/`, etc.
 *
 * Wraps `readJsonFile` + `atomicWrite` so callers don't reinvent path
 * resolution, symlink/size guards, or atomic-rename semantics.
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

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { z } from 'zod/v4';

import { atomicWrite, readJsonFile, validateOrgSlug } from '../file_io';

const MAX_FILE_SIZE_BYTES = 256 * 1024;

export interface ConfigStore<T> {
  /**
   * Read the per-org file. Returns `null` when the file is missing.
   * Throws when the file is present but corrupted, oversized, a symlink,
   * or fails Zod validation.
   */
  read(orgSlug: string): Promise<T | null>;
  /** Atomic write of the parsed/serialized config to the per-org path. */
  write(orgSlug: string, value: T): Promise<void>;
  /** Enumerate orgs that have a file for this area. */
  list(): Promise<Array<{ orgSlug: string }>>;
}

function getConfigRoot(area: string): string {
  const configDir = process.env.TALE_CONFIG_DIR;
  if (!configDir) {
    throw new Error(
      `TALE_CONFIG_DIR environment variable is not set. ` +
        `Set TALE_CONFIG_DIR in .env to the root config directory ` +
        `(e.g., TALE_CONFIG_DIR=/path/to/tale/examples) so ${area} ` +
        `can be resolved.`,
    );
  }
  return configDir;
}

function resolveFilePath(area: string, orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const root = getConfigRoot(area);
  const dir = path.join(root, orgSlug);
  const fileName = `${area}.json`;
  const resolved = path.resolve(dir, fileName);
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
        `Failed to read ${orgSlug}/${area}.json: ${result.message}`,
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
      const root = getConfigRoot(area);
      // Each org's file lives at `<root>/<orgSlug>/<area>.json`.
      // Enumerate org subdirs (validated by slug regex) and probe each
      // for the area file. Missing root → return empty rather than
      // throwing — operator hasn't seeded anything yet.
      let entries: string[];
      try {
        entries = await readdir(root);
      } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          return [];
        }
        throw err;
      }
      const results: Array<{ orgSlug: string }> = [];
      for (const name of entries) {
        if (!validateOrgSlug(name)) continue;
        const filePath = path.join(root, name, `${area}.json`);
        const info = await stat(filePath).catch(() => null);
        if (info?.isFile()) results.push({ orgSlug: name });
      }
      return results;
    },
  };
}
