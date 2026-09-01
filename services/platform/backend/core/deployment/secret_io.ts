'use node';

/**
 * Deployment-secrets I/O helper.
 *
 * Reads the existing SOPS-encrypted `deployment.secrets.json` (if any),
 * merges incoming values over it, and hands back plaintext ready to
 * persist. Secrets are a FLAT, dotted-key map
 * (`dataStores.knowledgePostgres.password`, …) validated against the
 * allowlist in `deploymentSecretsSchema`, so a new config section's
 * secrets merge in independently — no deep-merge needed.
 *
 * The refusal-to-overwrite-an-unreadable-file guard, and the
 * `UndecryptableExistingSecretError` / `ForceOverwriteReason` types that
 * carry it, mirror the same primitive used for provider secrets so the
 * Convex action + UI layers can handle both the same way.
 */

import type {
  DeploymentSecretKey,
  DeploymentSecrets,
} from '../../../lib/shared/schemas/deployment';
import { EncryptedFileWithoutKeyError, decryptSecretsFile } from '../lib/sops';
import { parseDeploymentSecrets } from './file_utils';

/**
 * Thrown when an existing secrets file can't be read — decrypt failure,
 * JSON parse failure, or a shape that fails `deploymentSecretsSchema` —
 * and the caller didn't pass `force: true`. The Convex action layer turns
 * this into a `AppError` with `data.kind = 'undecryptable_existing'` so
 * the UI can offer a confirm dialog and retry with `force: true`.
 *
 * `reason` is the inner cause's message, unwrapped. It's what the UI's
 * confirm dialog interpolates into its translated copy, so it must stay
 * free of this wrapper's own path + remediation text.
 */
export class UndecryptableExistingSecretError extends Error {
  readonly path: string;
  readonly reason: string;
  constructor(path: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Existing secrets file ${path} could not be read (${reason}). ` +
        'Save again with the "overwrite anyway" option to discard it, or remove the file manually first.',
    );
    // Object.assign bolts `cause` onto the Error: convex/tsconfig.json's
    // "lib" predates the ES2022 two-argument Error constructor overload,
    // even though the runtime itself supports it.
    Object.assign(this, { cause });
    this.name = 'UndecryptableExistingSecretError';
    this.path = path;
    this.reason = reason;
  }
}

/** Why a force-overwrite happened; populated only when `forced` is true. */
export type ForceOverwriteReason =
  | 'encrypted_no_key'
  | 'undecryptable_existing';

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
      // No file yet — this is a fresh write; existing stays null.
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
    if (value === undefined) continue; // Not provided this save — keep existing.
    if (value === '') {
      delete merged[key]; // Explicit clear.
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
