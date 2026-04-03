'use node';

/**
 * SOPS decryption utility.
 *
 * Decrypts SOPS-encrypted JSON files using the `sops` CLI binary.
 * Results are cached in memory and invalidated when the file's mtime changes.
 */

import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

interface CacheEntry {
  data: Record<string, unknown>;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

export async function decryptSecretsFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.data;
  }

  let stdout: string;
  try {
    stdout = execFileSync('sops', ['-d', '--output-type', 'json', filePath], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to decrypt secrets file ${filePath}: ${message}. ` +
        'Ensure sops is installed and SOPS_AGE_KEY or SOPS_AGE_KEY_FILE is set.',
      { cause: err },
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown; we validate via providerSecretsSchema downstream
  const data = JSON.parse(stdout) as Record<string, unknown>;
  cache.set(filePath, { data, mtimeMs: fileStat.mtimeMs });
  return data;
}
