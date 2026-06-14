import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
        // With an explicit target, only treat THAT directory as an existing
        // project — `findProject` walks up to ancestors, which would make
        // `tale setup <new-subdir>` short-circuit when run inside a project.
        // With no target, the ancestor walk is what we want (re-running inside
        // a project should detect it).
        const existing = directory
          ? existsSync(join(resolve(directory), 'tale.json'))
            ? resolve(directory)
            : null
          : findProject();
        if (existing !== null) {
          logger.info(`Existing Tale project detected at ${existing}.`);
          logger.info(
            'Run "tale start" for a local trial, or "tale deploy" for production.',
          );
          return;
        }

        const result = await init({ directory });
        if (result.status === 'aborted') return;

        logger.blank();
        if (docker.status === 'refused' || docker.status === 'failed') {
          logger.notice(
            'Install Docker (see above), then run the launch command below.',
          );
        }
        // init may scaffold into a named subdirectory; prefix the launch with
        // `cd <dir>` so it runs from the project root. Otherwise `tale start`
        // finds no project there and initializes a second one on top.
        const launch =
          result.mode === 'production' ? 'tale deploy' : 'tale start';
        const goal =
          result.mode === 'production' ? 'go live' : 'launch locally';
        const rel = relative(process.cwd(), result.directory);
        const command = rel ? `cd ${rel} && ${launch}` : launch;
        logger.info(`You're set up. Run "${command}" to ${goal}.`);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
