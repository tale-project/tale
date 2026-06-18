import { Command } from 'commander';

import { resetOwner } from '../lib/actions/reset-owner';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { usageError } from '../utils/fail';
import { action } from '../utils/run-command';

export function createAuthCommand(): Command {
  const authCmd = new Command('auth').description('Authentication management');

  authCmd
    .command('reset-owner')
    .description('Reset the owner email and/or password')
    .option('-e, --email <email>', 'New owner email address')
    .option('-p, --password <password>', 'New owner password')
    .action(
      action(async (options: { email?: string; password?: string }) => {
        let { email, password } = options;

        // Interactive prompts when flags are not provided
        if (
          !email &&
          !password &&
          process.stdin.isTTY &&
          process.stdout.isTTY
        ) {
          const { input, password: passwordPrompt } =
            await import('../utils/prompt');

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
            if (pw !== pwConfirm) throw usageError('Passwords do not match');
            password = pw;
          }
        }

        // Validate AFTER the interactive block so the non-interactive path
        // (no TTY, no flags) is rejected too, not silently passed through.
        if (!email && !password) {
          throw usageError('At least one of --email or --password is required');
        }

        await resolveProjectContext(requireProject());
        await resetOwner({ email, password });
      }),
    );

  return authCmd;
}
