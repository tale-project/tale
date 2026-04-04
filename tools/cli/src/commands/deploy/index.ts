import { Command } from 'commander';

import { deploy } from '../../lib/actions/deploy';
import {
  type ServiceName,
  ALL_SERVICES,
  isValidService,
} from '../../lib/compose/types';
import { ensureEnv } from '../../lib/config/ensure-env';
import { requireProject } from '../../lib/project/find-project';
import { selectVersion } from '../../lib/registry/select-version';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description('Deploy a version to the environment')
    .argument('[version]', 'Version to deploy (e.g., v1.0.0 or 1.0.0)')
    .option('-a, --all', 'Also update infrastructure (db, proxy)', false)
    .option(
      '-s, --services <list>',
      `Specific services to update (comma-separated: ${ALL_SERVICES.join(',')})`,
    )
    .option('--dry-run', 'Preview deployment without making changes', false)
    .option('--host <hostname>', 'Host alias for proxy')
    .option(
      '--fresh',
      'force re-seed builtin agent/workflow/integration configs',
    )
    .action(async (versionArg: string | undefined, options) => {
      try {
        const projectDir = requireProject();
        const { success: envSetupSuccess } = await ensureEnv({
          deployDir: projectDir,
        });
        if (!envSetupSuccess) {
          process.exit(1);
        }
        const env = loadEnv(projectDir);

        let version = versionArg?.replace(/^v/, '');
        if (!version) {
          const selected = await selectVersion(env.GHCR_REGISTRY);
          if (!selected) {
            process.exit(1);
          }
          version = selected;
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

        const hostAlias = options.host ?? process.env.HOST ?? 'tale.local';
        await deploy({
          version,
          updateStateful: options.all,
          env,
          hostAlias,
          dryRun: options.dryRun,
          services,
          fresh: options.fresh,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
