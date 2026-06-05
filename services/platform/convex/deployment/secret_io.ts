'use node';

/**
 * Deployment-secrets I/O helper.
 *
 * Read-existing → merge → return-plaintext for the SOPS-encrypted
 * `deployment.secrets.json`. Secrets are a FLAT, dotted-key map
 * (`dataStores.knowledgePostgres.password`, …) validated against the
 * allowlist in `deploymentSecretsSchema`, so a new config section's secrets
 * merge independently without a deep merge.
 *
 * The data-loss guard around overwriting an unreadable existing file mirrors
 * the providers flow and reuses its `UndecryptableExistingSecretError` /
 * `ForceOverwriteReason` types so the action layer + UI handle both the same
 * way.
 */

import type {
  DeploymentSecretKey,
  DeploymentSecrets,
} from '../../lib/shared/schemas/deployment';
import { EncryptedFileWithoutKeyError, decryptSecretsFile } from '../lib/sops';
import {
  type ForceOverwriteReason,
  UndecryptableExistingSecretError,
} from '../providers/secret_io';
import { parseDeploymentSecrets } from './file_utils';

export { UndecryptableExistingSecretError };
export type { ForceOverwriteReason };

export interface PreparedDeploymentSecrets {
  /** Plaintext JSON ready to encrypt or write directly (trailing newline). */
  plaintext: string;
  /** True when an existing readable file was successfully merged. */
  existed: boolean;
  /** True when force-overwrite skipped an unreadable existing file. */
  forced: boolean;
  /** Why the force-overwrite happened; populated only when `forced` is true. */
  forceReason: ForceOverwriteReason | null;
}

/**
 * Read the existing deployment-secrets file (if any), merge `incoming` over
 * it, and return the plaintext to write. Incoming values override existing;
 * an explicit empty-string value DELETES that key (so the UI can clear a
 * secret). The merged result is re-validated against the secret-key
 * allowlist.
 *
 * Refuses to overwrite an existing-but-undecryptable file unless
 * `options.force` is true (the ciphertext may be the only recoverable copy).
 *
 * @throws {EncryptedFileWithoutKeyError} SOPS-encrypted but no key, no force.
 * @throws {UndecryptableExistingSecretError} exists but decrypt/parse fails, no force.
 */
export async function prepareMergedDeploymentSecrets(
  secretsPath: string,
  incoming: Partial<Record<DeploymentSecretKey, string>>,
  options: { force?: boolean } = {},
): Promise<PreparedDeploymentSecrets> {
  let existing: DeploymentSecrets | null = null;
  let existed = false;
  let forced = false;
  let forceReason: ForceOverwriteReason | null = null;

  try {
    const raw = await decryptSecretsFile(secretsPath);
    existing = parseDeploymentSecrets(raw);
    existed = true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      // No file yet — fresh write; existing stays null.
    } else if (options.force) {
      console.warn(
        `[deployment/secret_io] force-overwriting ${secretsPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
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

  const merged: Record<string, string> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue; // not provided this save → keep existing
    if (value === '') {
      delete merged[key]; // explicit clear
    } else {
      merged[key] = value;
    }
  }

  // Re-validate the merged set against the allowlist before persisting.
  const validated = parseDeploymentSecrets(merged);

  return {
    plaintext: JSON.stringify(validated, null, 2) + '\n',
    existed,
    forced,
    forceReason,
  };
}
