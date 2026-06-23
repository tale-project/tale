import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';
import { findPlatformContainer } from '../docker/find-platform-container';

export async function convexAdmin(): Promise<void> {
  logger.step('Detecting platform container...');

  const container = await findPlatformContainer();
  logger.info(`Using container: ${container}`);
  logger.blank();

  const result = await docker('exec', container, './generate-admin-key.sh');
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to generate admin key');
  }

  console.log(result.stdout);
}

/**
 * Derive just the Convex admin key (no decoration) from the running platform
 * container. Shares the in-container `generate-admin-key.sh` deriver with
 * `tale convex admin` via its `--key-only` mode, so both stay in lockstep.
 *
 * Throws if no platform container is running or the key cannot be derived —
 * callers that surface the key opportunistically (e.g. `tale dev`) should
 * catch and degrade gracefully rather than fail the whole command.
 */
export async function getAdminKey(): Promise<string> {
  const container = await findPlatformContainer();
  const result = await docker(
    'exec',
    container,
    './generate-admin-key.sh',
    '--key-only',
  );
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to generate admin key');
  }
  const key = result.stdout.trim();
  if (!key) {
    throw new Error('generate-admin-key.sh returned an empty key');
  }
  return key;
}
