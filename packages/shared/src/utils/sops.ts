/**
 * Provider secrets read utility.
 *
 * Hybrid format detection mirrors the platform implementation in
 * `services/platform/convex/lib/sops.ts`: a SOPS-encrypted JSON file always
 * carries a top-level `"sops"` object describing recipients and metadata. We
 * use that as the read-time signal — if present, decrypt via the `sops` CLI;
 * if absent, return the parsed plaintext JSON as-is.
 *
 * The `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE` env vars are still required to
 * decrypt encrypted files; encountering an encrypted file without a key
 * configured throws {@link EncryptedFileWithoutKeyError} rather than letting
 * `ENC[…]` ciphertext flow downstream as a fake apiKey.
 *
 * Results are cached in memory and invalidated when the file's mtime changes.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

import { z } from 'zod';

const secretsObjectSchema = z.record(z.string(), z.unknown());

export type SecretsObject = z.infer<typeof secretsObjectSchema>;

interface CacheEntry {
  data: SecretsObject;
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

/** True iff a SOPS age key is configured via env (trim-aware). */
function hasSopsKey(): boolean {
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
  if (plaintextWarnEmitted) {
    return;
  }
  plaintextWarnEmitted = true;
  // nosemgrep: javascript-logger-credential-disclosure -- logs the file path, not a secret value
  console.warn(
    `[secrets] SOPS_AGE_KEY not set — provider secrets at ${filePath} read as ` +
      `plaintext JSON. To enable encryption: run age-keygen, add SOPS_AGE_KEY=… ` +
      `to .env, then re-save secrets via Settings → AI providers.`,
  );
}

/**
 * Read a provider secrets file. Decrypts SOPS-encrypted files via the `sops`
 * CLI; returns plaintext JSON files as-is. Caches by mtime.
 */
export function decryptSecretsFile(filePath: string): SecretsObject {
  const fileStat = statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.data;
  }

  const raw = readFileSync(filePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse secrets file ${filePath} as JSON: ${message}.`,
      {
        cause: err,
      },
    );
  }

  let data: SecretsObject;
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
    data = secretsObjectSchema.parse(JSON.parse(stdout));
  } else {
    const validated = secretsObjectSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Secrets file ${filePath} must contain a JSON object at the top level.`,
      );
    }
    emitPlaintextWarnOnce(filePath);
    data = validated.data;
  }

  cache.set(filePath, { data, mtimeMs: fileStat.mtimeMs });
  return data;
}

/** Invalidate the cache entry for a given file. */
export function invalidateSecretsCache(filePath: string): void {
  cache.delete(filePath);
}
