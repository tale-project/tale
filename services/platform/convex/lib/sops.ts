'use node';

/**
 * SOPS decryption utility.
 *
 * Decrypts SOPS-encrypted JSON files using the `sops` CLI binary.
 * Results are cached in memory and invalidated explicitly via `clearCache()`.
 */

import { execSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

/** Dev-only fallback key — matches the public key in the repo's .sops.yaml. */
const DEV_AGE_KEY =
  'AGE-SECRET-KEY-17FH890V3A765GWGYA3E83UEFZNRZL3T4GJ0Q7WSS5GRGEDE9G83SCV3UTH';

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

  // Auto-set dev fallback key if no key is configured
  if (!process.env.SOPS_AGE_KEY && !process.env.SOPS_AGE_KEY_FILE) {
    process.env.SOPS_AGE_KEY = DEV_AGE_KEY;
  }

  let stdout: string;
  try {
    stdout = execSync(`sops -d --output-type json "${filePath}"`, {
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

export function clearSopsCache(filePath?: string): void {
  if (filePath) {
    cache.delete(filePath);
  } else {
    cache.clear();
  }
}
