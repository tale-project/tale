import { Command, Option } from 'commander';

import pkg from '../../package.json';
import {
  finishMigration,
  migrateToDocker,
  migrateToIncus,
  productionMigrationOperations,
  type MigrationContext,
} from '../lib/actions/runtime-migrate';
import { requireProject } from '../lib/project/find-project';
import { resolveProjectContext } from '../lib/project/project-context';
import { readProject } from '../lib/project/read-project';
import { createDockerRuntime } from '../lib/runtime/docker/docker-runtime';
import {
  declaredIncusRuntime,
  migrationIncusRuntime,
} from '../lib/runtime/select-runtime';
import { isDevBuild } from '../lib/version/self-update';
import { usageError } from '../utils/fail';
import { loadEnv } from '../utils/load-env';
import { confirm } from '../utils/prompt';
import { action } from '../utils/run-command';

interface MigrateOptions {
  to?: 'incus' | 'docker';
  finish?: boolean;
  smokeUrl?: string;
  yes?: boolean;
}

/**
 * `tale runtime`: the container runtime a workspace runs on (design 14).
 * `migrate` moves a Docker deployment to the Incus runtime `runtime.next`
 * declares, rolls that back, or finishes it.
 */
export function createRuntimeCommand(): Command {
  const command = new Command('runtime').description(
    'Move a workspace deployment between Docker and Incus (experimental)',
  );

  command
    .command('migrate')
    .description(
      'Move the Docker deployment to the Incus runtime tale.json declares in runtime.next (resumable), roll it back with --to docker, or remove the stopped Docker stack with --finish',
    )
    .addOption(
      new Option('--to <engine>', 'The runtime to move to').choices([
        'incus',
        'docker',
      ]),
    )
    .option(
      '--finish',
      'After a completed migration, remove the stopped Docker stack (asks first)',
    )
    .option(
      '--smoke-url <url>',
      "Where the smoke checks reach the new edge (default: SITE_URL); on another host, an address of that host's edge",
    )
    .option('-y, --yes', 'With --finish: remove without asking')
    .action(
      action(async (options: MigrateOptions) => {
        if ((options.to === undefined) === (options.finish !== true))
          throw usageError(
            'Name one: --to incus (migrate), --to docker (roll back) or --finish.',
          );
        const projectDir = requireProject();
        await resolveProjectContext(projectDir);
        const env = loadEnv(projectDir);
        const engine = (await readProject(projectDir)).runtime?.engine;
        const context: MigrationContext = {
          deployDir: env.DEPLOY_DIR,
          cliVersion: isDevBuild() ? 'latest' : pkg.version,
          docker: createDockerRuntime(),
          // After the flip the block is runtime.incus, before it
          // runtime.next.
          incus: () =>
            engine === 'incus'
              ? declaredIncusRuntime(projectDir)
              : migrationIncusRuntime(projectDir),
          operations: productionMigrationOperations({
            env,
            cliVersion: pkg.version,
            ...(options.smokeUrl === undefined
              ? {}
              : { smokeUrl: options.smokeUrl }),
          }),
          healthTimeout: env.HEALTH_CHECK_TIMEOUT,
        };
        if (options.finish === true)
          await finishMigration({
            ...context,
            ...(options.yes === undefined ? {} : { assumeYes: options.yes }),
            confirm: (message) => confirm({ message, default: false }),
          });
        else if (options.to === 'incus') await migrateToIncus(context);
        else await migrateToDocker(context);
      }),
    );

  return command;
}
