import { Command } from 'commander';

import pkg from '../../../package.json';
import { init } from '../../lib/actions/init';
import { ensureDocker } from '../../lib/docker/ensure-docker';
import { findProject } from '../../lib/project/find-project';
import * as logger from '../../utils/logger';

/**
 * `tale setup` — the single guided entry point the installer hands off to,
 * and what users re-run to get unstuck. It makes the machine ready (Docker)
 * and the project ready (scaffold), then points at the right launch command.
 * Each underlying step is idempotent, so re-running is always safe.
 */
export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Guided first-time setup: install Docker, scaffold a project')
    .argument('[directory]', 'target directory (defaults to current directory)')
    .option('-y, --yes', 'non-interactive: accept Docker install and defaults')
    .action(async (directory: string | undefined, opts: { yes?: boolean }) => {
      try {
        logger.banner(pkg.version);

        const docker = await ensureDocker({ assumeYes: opts.yes });
        if (docker.status === 'ready') {
          logger.success('Docker is ready.');
        } else if (docker.status === 'installed') {
          // ensureDocker already logged the success line.
        } else {
          // refused / failed — keep going so the project still scaffolds; the
          // launch step will surface Docker again.
          logger.warn(docker.detail);
        }

        logger.blank();
        const existing = findProject(directory);
        if (existing !== null) {
          logger.info(`Existing Tale project detected at ${existing}.`);
          logger.info(
            'Run "tale start" for a local trial, or "tale deploy" for production.',
          );
          return;
        }

        const mode = await init({ directory });

        logger.blank();
        if (docker.status === 'refused' || docker.status === 'failed') {
          logger.notice(
            'Install Docker (see above), then run the launch command below.',
          );
        }
        if (mode === 'production') {
          logger.info('You\'re set up. Run "tale deploy" to go live.');
        } else {
          logger.info('You\'re set up. Run "tale start" to launch locally.');
        }
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
