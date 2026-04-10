import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';
import { findPlatformContainer } from '../docker/find-platform-container';

export interface ResetOwnerOptions {
  email?: string;
  password?: string;
}

export async function resetOwner(options: ResetOwnerOptions): Promise<void> {
  const { email, password } = options;

  if (!email && !password) {
    throw new Error('At least one of --email or --password is required');
  }

  logger.step('Detecting platform container...');
  const container = await findPlatformContainer();
  logger.info(`Using container: ${container}`);

  logger.step('Resetting owner credentials...');

  const args = [
    'exec',
    ...(email ? ['-e', `RESET_EMAIL=${email}`] : []),
    ...(password ? ['-e', `RESET_PASSWORD=${password}`] : []),
    container,
    './reset-owner.sh',
  ];

  const result = await docker(...args);
  if (!result.success) {
    // Extract the meaningful error message from Convex stack traces
    const stderr = result.stderr || '';
    const uncaughtMatch = stderr.match(/Uncaught Error: (.+)/);
    const message =
      uncaughtMatch?.[1] || stderr || 'Failed to reset owner credentials';
    throw new Error(message);
  }

  // Parse the JSON output from the container script
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
