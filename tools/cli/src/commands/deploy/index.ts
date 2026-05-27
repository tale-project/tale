import { Command } from 'commander';

import pkg from '../../../package.json';
import { deploy } from '../../lib/actions/deploy';
import {
  type ServiceName,
  ALL_SERVICES,
  STATEFUL_SERVICES,
  isValidService,
} from '../../lib/compose/types';
import { ensureEnv } from '../../lib/config/ensure-env';
import { requireProject } from '../../lib/project/find-project';
import { resolveOrAssignProjectContext } from '../../lib/project/project-context';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description('Deploy the current CLI version to the environment')
    .option(
      '-a, --all',
      `Also update infrastructure (${STATEFUL_SERVICES.join(', ')})`,
      false,
    )
    .option(
      '-s, --services <list>',
      `Specific services to update (comma-separated: ${ALL_SERVICES.join(',')})`,
    )
    .option('--dry-run', 'Preview deployment without making changes', false)
    .option('--host <hostname>', 'Host alias for proxy')
    .option(
      '--override',
      'overwrite container state from the host workspace, including config files the operator has UI-edited (default: preserve UI-edited files; encrypted provider secrets and UI-uploaded skill bundles are always preserved)',
    )
    .option('-q, --quiet', 'Suppress container logs during deployment')
    .option(
      '-y, --yes',
      'Non-interactive: automatically accept any pending migrations',
      false,
    )
    .option(
      '--migrate-volumes',
      '[deprecated] alias for --yes; will be removed in a future release',
      false,
    )
    .action(async (options) => {
      try {
        const projectDir = requireProject();
        await resolveOrAssignProjectContext(projectDir);
        const { success: envSetupSuccess, regeneratedAutoSecrets } =
          await ensureEnv({
            deployDir: projectDir,
          });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        // If ensureEnv had to mint missing auto-gen secrets headlessly
        // (typical: a new `SANDBOX_TOKEN` for an existing deployment),
        // force-recreate the running services so their in-memory env
        // refreshes to the new value rather than keeping the stale null.
        const forceRecreate =
          regeneratedAutoSecrets !== undefined &&
          regeneratedAutoSecrets.length > 0;
        const env = loadEnv(projectDir);

        const version = pkg.version.includes('-dev') ? 'latest' : pkg.version;
        if (version === 'latest') {
          logger.info(
            'Dev build detected — deploying `latest` images. Run `tale upgrade` for a release build.',
          );
        }

        let services: ServiceName[] | undefined;
        if (options.services) {
          const serviceList = options.services
            .split(',')
            .map((s: string) => s.trim());
          const invalid = serviceList.filter((s: string) => !isValidService(s));
          if (invalid.length > 0) {
            logger.error(`Invalid service(s): ${invalid.join(', ')}`);
            logger.info(`Valid services: ${ALL_SERVICES.join(', ')}`);
            process.exit(1);
          }
          services = serviceList as ServiceName[];
        }

        if (options.migrateVolumes && !options.yes) {
          logger.warn(
            '--migrate-volumes is deprecated; use --yes for non-interactive migration acceptance.',
          );
        }
        const hostAlias = options.host ?? process.env.HOST ?? 'tale.local';
        await deploy({
          version,
          updateStateful: options.all,
          env,
          hostAlias,
          dryRun: options.dryRun,
          services,
          override: options.override,
          quiet: options.quiet,
          assumeYes: options.yes || options.migrateVolumes,
          forceRecreate,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
