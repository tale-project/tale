'use node';

/**
 * Provider secrets I/O helper.
 *
 * Encapsulates the read-existing → merge → return-plaintext step of saving
 * provider secrets, so the data-loss guard around overwriting an unreadable
 * existing file is unit-testable independently of the Convex action wrapper
 * (which needs `convex-test` and a real auth context to exercise).
 *
 * The companion action `saveProviderSecret` in `file_actions.ts` calls this
 * helper, then encrypts (or not) and writes via `atomicWriteSecret`.
 */

import type { ProviderSecrets } from '../../lib/shared/schemas/providers';
import { EncryptedFileWithoutKeyError, decryptSecretsFile } from '../lib/sops';
import { parseProviderSecrets } from './file_utils';

/**
 * Thrown when an existing secrets file exists but cannot be read (decrypt
 * failure, JSON parse failure, or zod-shape failure) and the caller did not
 * pass `force: true`. The Convex action layer maps this to a `ConvexError`
 * with `data.kind = 'undecryptable_existing'` so the UI can offer a confirm
 * dialog and re-invoke with `force: true`.
 */
export class UndecryptableExistingSecretError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Existing secrets file ${path} could not be read (${reason}). ` +
        'Save again with the "overwrite anyway" option to discard it, or remove the file manually first.',
      { cause },
    );
    this.name = 'UndecryptableExistingSecretError';
    this.path = path;
  }
}

export interface PreparedSecrets {
  /** Plaintext JSON ready to encrypt or write directly (with trailing newline). */
  plaintext: string;
  /** True when an existing readable file was successfully merged. */
  existed: boolean;
  /** True when force-overwrite skipped an unreadable existing file. */
  forced: boolean;
}

/**
 * Read the existing provider-secrets file (if any), merge with `incoming`,
 * and return the plaintext to write.
 *
 * Refuses to overwrite an existing-but-undecryptable file unless
 * `options.force` is true. The on-disk ciphertext may be the only
 * recoverable copy; the operator must affirmatively opt in to discard it.
 *
 * @throws {EncryptedFileWithoutKeyError} when the file is SOPS-encrypted but
 *   no key is configured and `force` is not set.
 * @throws {UndecryptableExistingSecretError} when the file exists but
 *   decrypt/parse/shape validation fails and `force` is not set.
 * @throws {Error} when the merged result has no apiKey at all.
 */
export async function prepareMergedSecrets(
  secretsPath: string,
  incoming: { apiKey?: string; modelKeys?: Record<string, string> },
  options: { force?: boolean } = {},
): Promise<PreparedSecrets> {
  let existing: ProviderSecrets | null = null;
  let existed = false;
  let forced = false;

  try {
    const raw = await decryptSecretsFile(secretsPath);
    existing = parseProviderSecrets(raw);
    existed = true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // No file yet — fresh write; existing stays null.
    } else if (options.force) {
      console.warn(
        `[secret_io] force-overwriting ${secretsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      forced = true;
    } else if (err instanceof EncryptedFileWithoutKeyError) {
      throw err;
    } else {
      throw new UndecryptableExistingSecretError(secretsPath, err);
    }
  }

  const mergedApiKey = incoming.apiKey ?? existing?.apiKey;
  if (!mergedApiKey) {
    throw new Error(
      'A provider-level API key is required. ' +
        'Provide an apiKey or ensure one is already configured.',
    );
  }

  const mergedModelKeys: Record<string, string> = {
    ...existing?.modelKeys,
    ...incoming.modelKeys,
  };
  // Empty-string values signal deletion.
  for (const [key, value] of Object.entries(mergedModelKeys)) {
    if (!value) delete mergedModelKeys[key];
  }

  const data: Record<string, unknown> = { apiKey: mergedApiKey };
  if (Object.keys(mergedModelKeys).length > 0) {
    data.modelKeys = mergedModelKeys;
  }

  return {
    plaintext: JSON.stringify(data, null, 2) + '\n',
    existed,
    forced,
  };
}
