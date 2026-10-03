/**
 * Manifest format for the precompiled artifact set.
 *
 * The precompile CLI writes `manifest.json` next to the emitted files so
 * the runtime server can answer every request from one in-memory map
 * without scanning the directory or re-hashing file contents.
 *
 * The manifest is the single source of truth at runtime — `entries` maps
 * pathname → on-disk file + precomputed ETag, and `knownMdPaths` lets the
 * server reject unknown `/<route>.md` URLs in O(1) without a runtime
 * negative cache.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = 1;

export interface ManifestEntry {
  /** Site-relative pathname served by the runtime (e.g. `/llms.txt`). */
  path: string;
  /** Filename inside the precompile directory (POSIX separators). */
  file: string;
  /** Owning plugin id — kept for telemetry / debug. */
  pluginId: string;
  /** Quoted strong-validator ETag (e.g. `"abc1234567890def"`). */
  etag: string;
  /** Response `content-type` header. */
  contentType: string;
  /** Response `cache-control` header. */
  cacheControl: string;
  /** Byte length of the file body. */
  byteLength: number;
}

export interface Manifest {
  version: number;
  generatedAt: string;
  siteUrl: string;
  entries: ManifestEntry[];
  /** Every concrete `/<route>.md` pathname this build emitted. */
  knownMdPaths: string[];
}

export async function writeManifest(
  dir: string,
  manifest: Manifest,
): Promise<void> {
  await writeFile(
    join(dir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
}

export async function readManifest(dir: string): Promise<Manifest> {
  const raw = await readFile(join(dir, MANIFEST_FILE), 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!isManifest(parsed)) {
    throw new Error(
      `Invalid manifest at ${join(dir, MANIFEST_FILE)} — wrong shape`,
    );
  }
  if (parsed.version !== MANIFEST_VERSION) {
    throw new Error(
      `Manifest version mismatch: expected ${MANIFEST_VERSION}, got ${parsed.version}`,
    );
  }
  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function hasStringProp<K extends string>(
  value: object,
  key: K,
): value is Record<K, string> {
  return key in value && typeof Reflect.get(value, key) === 'string';
}

function hasNumberProp<K extends string>(
  value: object,
  key: K,
): value is Record<K, number> {
  return key in value && typeof Reflect.get(value, key) === 'number';
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== 'object' || value === null) return false;
  return (
    hasStringProp(value, 'path') &&
    hasStringProp(value, 'file') &&
    hasStringProp(value, 'pluginId') &&
    hasStringProp(value, 'etag') &&
    hasStringProp(value, 'contentType') &&
    hasStringProp(value, 'cacheControl') &&
    hasNumberProp(value, 'byteLength')
  );
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  if (!hasNumberProp(value, 'version')) return false;
  if (!hasStringProp(value, 'generatedAt')) return false;
  if (!hasStringProp(value, 'siteUrl')) return false;
  const entries = Reflect.get(value, 'entries');
  if (!Array.isArray(entries) || !entries.every(isManifestEntry)) return false;
  const knownMdPaths = Reflect.get(value, 'knownMdPaths');
  return isStringArray(knownMdPaths);
}
