'use node';

/**
 * Vector-database secret I/O helper.
 *
 * Read-existing → merge → return-plaintext, with the same data-loss guard as
 * `providers/secret_io.ts`: refuses to overwrite an existing-but-undecryptable
 * secrets file unless `force` is set (the on-disk ciphertext may be the only
 * recoverable copy). The schema here is just `{ apiKey }` — no per-model keys.
 *
 * The companion action `saveVectorDbSecret` in `file_actions.ts` calls this,
 * then encrypts (or not) and writes via `atomicWriteSecret`.
 */

import type { VectorDbSecrets } from '../../lib/shared/schemas/vectordb';
import { EncryptedFileWithoutKeyError, decryptSecretsFile } from '../lib/sops';
import {
  type ForceOverwriteReason,
  UndecryptableExistingSecretError,
} from '../providers/secret_io';
import { parseVectorDbSecrets } from './file_utils';

export { UndecryptableExistingSecretError } from '../providers/secret_io';

export interface PreparedVectorDbSecret {
  /** Plaintext JSON ready to encrypt or write directly (trailing newline). */
  plaintext: string;
  /** True when an existing readable file was successfully merged. */
  existed: boolean;
  /** True when force-overwrite skipped an unreadable existing file. */
  forced: boolean;
  /** Why the force-overwrite happened (only when `forced`). */
  forceReason: ForceOverwriteReason | null;
}

/**
 * Read the existing secrets file (if any), merge `incoming.apiKey`, and return
 * the plaintext to write.
 *
 * @throws {EncryptedFileWithoutKeyError} when the file is SOPS-encrypted but no
 *   key is configured and `force` is not set.
 * @throws {UndecryptableExistingSecretError} when the file exists but
 *   decrypt/parse/shape validation fails and `force` is not set.
 * @throws {Error} when the merged result has no apiKey at all.
 */
export async function prepareMergedVectorDbSecret(
  secretsPath: string,
  incoming: { apiKey?: string },
  options: { force?: boolean } = {},
): Promise<PreparedVectorDbSecret> {
  let existing: VectorDbSecrets | null = null;
  let existed = false;
  let forced = false;
  let forceReason: ForceOverwriteReason | null = null;

  try {
    const raw = await decryptSecretsFile(secretsPath);
    existing = parseVectorDbSecrets(raw);
    existed = true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // No file yet — fresh write; existing stays null.
    } else if (options.force) {
      console.warn(
        `[vectordb secret_io] force-overwriting ${secretsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      forced = true;
      forceReason =
        err instanceof EncryptedFileWithoutKeyError
          ? 'encrypted_no_key'
          : 'undecryptable_existing';
    } else if (err instanceof EncryptedFileWithoutKeyError) {
      throw err;
    } else {
      throw new UndecryptableExistingSecretError(secretsPath, err);
    }
  }

  const mergedApiKey = incoming.apiKey ?? existing?.apiKey;
  if (!mergedApiKey) {
    throw new Error(
      'A vector-database API key is required. ' +
        'Provide an apiKey or ensure one is already configured.',
    );
  }

  const data = { apiKey: mergedApiKey };
  return {
    plaintext: JSON.stringify(data, null, 2) + '\n',
    existed,
    forced,
    forceReason,
  };
}
