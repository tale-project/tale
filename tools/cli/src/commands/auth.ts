import { Command } from 'commander';

import { resetOwner } from '../lib/actions/reset-owner';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import * as logger from '../utils/logger';

export function createAuthCommand(): Command {
  const authCmd = new Command('auth').description('Authentication management');

  authCmd
    .command('reset-owner')
    .description('Reset the owner email and/or password')
    .option('-e, --email <email>', 'New owner email address')
    .option('-p, --password <password>', 'New owner password')
    .action(async (options: { email?: string; password?: string }) => {
      try {
        let { email, password } = options;

        // Interactive prompts when flags are not provided
        if (
          !email &&
          !password &&
          process.stdin.isTTY &&
          process.stdout.isTTY
        ) {
          const { input, password: passwordPrompt } =
            await import('@inquirer/prompts');

          email = await input({
            message: 'New owner email (leave empty to skip):',
          });
          if (!email) email = undefined;

          const pw = await passwordPrompt({
            message: 'New owner password (leave empty to skip):',
            mask: '*',
          });

          if (pw) {
            const pwConfirm = await passwordPrompt({
              message: 'Confirm new password:',
              mask: '*',
            });
            if (pw !== pwConfirm) {
              logger.error('Passwords do not match');
              process.exit(1);
            }
            password = pw;
          }

          if (!email && !password) {
            logger.error('At least one of --email or --password is required');
            process.exit(1);
          }
        }

        await resolveProjectContext(requireProject());
        await resetOwner({ email, password });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return authCmd;
}
