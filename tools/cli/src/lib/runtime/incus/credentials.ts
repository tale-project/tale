import { isAbsolute, join, resolve } from 'node:path';

import type { IncusTlsMaterial } from '@tale/incus/client';
import { readIncusTlsMaterial } from '@tale/incus/tls';

import { preconditionError } from '../../../utils/fail';
import { SANDBOX_INCUS_FILES } from '../../deployment/runtime-sandbox';
import { assertCredentialCustody } from '../../deployment/runtime-sandbox-credentials';

/**
 * Where the CLI finds the certificate it presents to the Incus API and the
 * server certificate it pins. Credentials are files, never `tale.json` or
 * `.env`: `.env` reaches every instance as its environment.
 *
 * - a workspace: `<workspace>/.tale/incus/`, or the absolute directory
 *   `TALE_INCUS_DIR` names;
 * - a managed deployment: `<stateDirectory>/incus/`, beside the spawner's
 *   `<stateDirectory>/sandbox-incus/`.
 *
 * Each holds `client.crt`, `client.key` and `server.crt`, the same three
 * names as the spawner's directory, closed to group and other (0600 files in
 * a 0700 directory).
 */

/** The variable that moves a workspace's credentials directory. */
export const INCUS_DIRECTORY_VARIABLE = 'TALE_INCUS_DIR';
/** The directory name under `.tale/` and under a state directory. */
const INCUS_CREDENTIALS_DIRECTORY = 'incus';
const INCUS_CREDENTIAL_FILES = SANDBOX_INCUS_FILES;

/** The credentials directory of the workspace at `projectDir`. */
export function workspaceIncusDirectory(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const override = environment[INCUS_DIRECTORY_VARIABLE];
  if (override === undefined || override === '')
    return join(resolve(projectDir), '.tale', INCUS_CREDENTIALS_DIRECTORY);
  if (!isAbsolute(override))
    throw preconditionError(
      `${INCUS_DIRECTORY_VARIABLE} must name an absolute directory, not ${JSON.stringify(override)}.`,
    );
  return resolve(override);
}

/** The credentials directory of a managed deployment. */
export function managedIncusDirectory(stateDirectory: string): string {
  return join(stateDirectory, INCUS_CREDENTIALS_DIRECTORY);
}

/**
 * The TLS material in `directory`, once its custody holds and the three files
 * make a connection that can be pinned: a server certificate that is its own
 * trust anchor (CA:TRUE), a key that belongs to the client certificate,
 * neither expired.
 */
export async function readIncusCredentials(
  directory: string,
  nowMs: number = Date.now(),
): Promise<IncusTlsMaterial> {
  assertCredentialCustody(directory, {
    label: 'Incus credentials',
    missing: `place ${INCUS_CREDENTIAL_FILES.join(', ')} in it (mode 0600), or set ${INCUS_DIRECTORY_VARIABLE}`,
  });
  try {
    return await readIncusTlsMaterial(
      {
        clientCertFile: join(directory, 'client.crt'),
        clientKeyFile: join(directory, 'client.key'),
        serverCertFile: join(directory, 'server.crt'),
      },
      nowMs,
    );
  } catch (error) {
    // The reader names the spawner's variables; the CLI reads a directory.
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).replace(/^SANDBOX_INCUS_[A-Z_]+_FILE: /, '');
    throw preconditionError(
      `The Incus credentials in ${directory} cannot be used: ${reason}`,
    );
  }
}
