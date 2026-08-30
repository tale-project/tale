import * as logger from '../../utils/logger';
import { backendApiContainer, controlCall } from '../docker/control-call';

interface ResetOwnerOptions {
  email?: string;
  password?: string;
}

/**
 * Owner recovery. The operator is on the host with docker access, so the
 * control door's bearer token IS the authorization — and the token is read
 * INSIDE the container (`sh -c`), so it never crosses the CLI's process
 * boundary or its logs. Same channel as the deploy drain (drain-backend.ts).
 *
 * The new credentials go in as a JSON body on stdin rather than as argv, so
 * a password never lands in the container's process list.
 */
export async function resetOwner(options: ResetOwnerOptions): Promise<void> {
  const { email, password } = options;

  if (!email && !password) {
    throw new Error('At least one of --email or --password is required');
  }

  const container = backendApiContainer();
  logger.step(`Resetting owner credentials via ${container}...`);

  const result = await controlCall('POST', '/api/control/reset-owner', {
    container,
    body: {
      ...(email ? { newEmail: email } : {}),
      ...(password ? { newPassword: password } : {}),
    },
  });
  if (!result.success) {
    throw new Error(
      result.stderr.trim() || 'Failed to reset owner credentials',
    );
  }

  const stdout = result.stdout.trim();
  try {
    const output = JSON.parse(stdout) as {
      email: string;
      updated: { email: boolean; password: boolean };
    };

    logger.blank();
    logger.success('Owner credentials updated successfully');
    logger.blank();

    if (output.updated.email) {
      logger.info(`  Email:    ${output.email}`);
    }
    if (output.updated.password) {
      logger.info('  Password: ********');
    }

    logger.blank();
    logger.info('All existing sessions have been invalidated.');
    logger.info('The owner must log in again with the new credentials.');
  } catch {
    // If JSON parsing fails, just show the raw output
    if (stdout) {
      console.log(stdout);
    }
  }
}
