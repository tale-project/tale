import { pbkdf2, pbkdf2Sync } from 'node:crypto';

import { stableStringify } from '../utils/stable-stringify';

/**
 * The digest a declared secret is compared by. A declaration names where a
 * secret's value comes from (an environment variable), never the value, so
 * a plan cannot tell a rotated value from the stored one by its hash alone.
 * Instead the platform answers this digest of the value it holds, and the
 * CLI compares it with the digest of the value it would write: equal, the
 * secret is as declared; different, applying writes the new value.
 *
 * A digest is readable by whoever may read the secret's configuration, so it
 * must not make guessing a weak value cheap: PBKDF2-HMAC-SHA-256 with a salt
 * bound to the organization and the secret's identity, so a digest proves
 * nothing about another organization or another secret holding the same
 * value. The platform stores no digest — it computes one from the value it
 * holds whenever it is read — so this function may change: a change reads
 * every declared secret as changed once, and the next apply rewrites them.
 *
 * Server-only (Node's crypto), like `platform-resources`.
 */

const VERSION = 'tale/managed-secret/v1';
export const MANAGED_SECRET_DIGEST_ITERATIONS = 100_000;

/** A secret value as it is stored: one string, or a connector credential's
 * fields by name. */
export type ManagedSecretValue = string | Readonly<Record<string, string>>;

interface ManagedSecretDigestArgs {
  organizationId: string;
  /** The secret's identity: {@link agentSecretDigestScope} or
   * {@link connectorCredentialDigestScope}. */
  scope: string;
  value: ManagedSecretValue;
}

const KEY_BYTES = 32;

/** What is derived, and under which salt. */
function digestInput(args: ManagedSecretDigestArgs) {
  return {
    material:
      typeof args.value === 'string' ? args.value : stableStringify(args.value),
    salt: `${VERSION}\u0000${args.organizationId}\u0000${args.scope}`,
  };
}

const formatDigest = (digest: Buffer) =>
  `pbkdf2-sha256:${digest.toString('hex')}`;

/** The digest, computed on the calling thread: for the CLI, which compares
 * a declaration's few secrets once per run. */
export function managedSecretDigest(args: ManagedSecretDigestArgs): string {
  const { material, salt } = digestInput(args);
  return formatDigest(
    pbkdf2Sync(
      material,
      salt,
      MANAGED_SECRET_DIGEST_ITERATIONS,
      KEY_BYTES,
      'sha256',
    ),
  );
}

/** The same digest, derived on the thread pool: for the platform, whose
 * event loop serves every other request while a declaration is read. */
export function managedSecretDigestAsync(
  args: ManagedSecretDigestArgs,
): Promise<string> {
  const { material, salt } = digestInput(args);
  return new Promise((resolve, reject) => {
    pbkdf2(
      material,
      salt,
      MANAGED_SECRET_DIGEST_ITERATIONS,
      KEY_BYTES,
      'sha256',
      (error, digest) => {
        if (error) reject(error);
        else resolve(formatDigest(digest));
      },
    );
  });
}

/** An agent secret is one per name, and its name is case-sensitive. */
export function agentSecretDigestScope(name: string): string {
  return `agent-secret/${name}`;
}

/** A connector credential is one per connector and name, whatever the
 * name's case. */
export function connectorCredentialDigestScope(
  connector: string,
  name: string,
): string {
  return `connector-credential/${connector}/${name.toLowerCase()}`;
}
