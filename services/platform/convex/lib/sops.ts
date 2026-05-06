'use node';

/**
 * Provider secrets read utility.
 *
 * Hybrid format detection: a SOPS-encrypted JSON file always carries a
 * top-level `"sops"` object describing recipients and metadata. We use
 * that as the read-time signal — if present, decrypt via the `sops` CLI;
 * if absent, return the parsed plaintext JSON as-is. The file format is
 * thus self-describing and stable across processes that may load env
 * differently (Convex isolate vs `tale` CLI vs Python rag/crawler).
 *
 * The `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE` env vars are still required to
 * decrypt encrypted files; encountering an encrypted file without a key
 * configured throws `EncryptedFileWithoutKeyError` rather than letting
 * `ENC[…]` ciphertext flow downstream as a fake apiKey.
 *
 * Results are cached in memory and invalidated when the file's mtime
 * changes. Cache values are the parsed result (post-decrypt for SOPS
 * files, post-parse for plaintext), so format is invariant per cache
 * entry — env toggles don't poison the cache because they don't change
 * the file.
 */

import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

interface CacheEntry {
  data: Record<string, unknown>;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

let plaintextWarnEmitted = false;

export class EncryptedFileWithoutKeyError extends Error {
  constructor(filePath: string) {
    super(
      `Secrets file ${filePath} is SOPS-encrypted but neither SOPS_AGE_KEY ` +
        `nor SOPS_AGE_KEY_FILE is set. Set one in .env to decrypt, or remove ` +
        `the file and re-enter the key in Settings → AI providers to store as plaintext.`,
    );
    this.name = 'EncryptedFileWithoutKeyError';
  }
}

/**
 * True iff a SOPS age key is configured via env. Trim-aware to treat
 * `KEY=""` and `KEY="   "` as unset (matches `secret_box`'s defensive
 * handling). Checks both `SOPS_AGE_KEY` (inline) and `SOPS_AGE_KEY_FILE`
 * (path) — sops itself accepts either, so encryption/decryption work as
 * long as one of them is non-empty.
 */
export function hasSopsKey(): boolean {
  return Boolean(
    process.env.SOPS_AGE_KEY?.trim() || process.env.SOPS_AGE_KEY_FILE?.trim(),
  );
}

function isSopsEncryptedShape(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    'sops' in parsed
  );
}

function emitPlaintextWarnOnce(filePath: string): void {
  if (plaintextWarnEmitted) return;
  plaintextWarnEmitted = true;
  console.warn(
    `[secrets] SOPS_AGE_KEY not set — provider secrets at ${filePath} read as ` +
      `plaintext JSON. To enable encryption: run age-keygen, add SOPS_AGE_KEY=… ` +
      `to .env, then re-save secrets via Settings → AI providers.`,
  );
}

/**
 * Invalidate the cache entry for a given file. Call after any write that
 * changes the file's content; mtime alone may not be enough on filesystems
 * with 1-second resolution if back-to-back writes collide.
 */
export function invalidateSecretsCache(filePath: string): void {
  cache.delete(filePath);
}

export async function decryptSecretsFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.data;
  }

  const raw = await readFile(filePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse secrets file ${filePath} as JSON: ${message}.`,
      { cause: err },
    );
  }

  let data: Record<string, unknown>;
  if (isSopsEncryptedShape(parsed)) {
    if (!hasSopsKey()) {
      throw new EncryptedFileWithoutKeyError(filePath);
    }
    let stdout: string;
    try {
      stdout = execFileSync('sops', ['-d', '--output-type', 'json', filePath], {
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to decrypt secrets file ${filePath}: ${message}. ` +
          'Ensure sops is installed and SOPS_AGE_KEY or SOPS_AGE_KEY_FILE is set correctly.',
        { cause: err },
      );
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown; we validate via providerSecretsSchema downstream
    data = JSON.parse(stdout) as Record<string, unknown>;
  } else {
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        `Secrets file ${filePath} must contain a JSON object at the top level.`,
      );
    }
    emitPlaintextWarnOnce(filePath);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown; the typeof check above rules out null/array; downstream zod validates the shape via providerSecretsSchema
    data = parsed as Record<string, unknown>;
  }

  cache.set(filePath, { data, mtimeMs: fileStat.mtimeMs });
  return data;
}
