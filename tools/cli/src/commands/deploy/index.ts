import { Command } from 'commander';

import pkg from '../../../package.json';
import { deploy } from '../../lib/actions/deploy';
import { runDeployPreflight } from '../../lib/actions/deploy-preflight';
import {
  type ServiceName,
  ALL_SERVICES,
  STATEFUL_SERVICES,
  isValidService,
} from '../../lib/compose/types';
import { ensureEnv, ensureProductionDomain } from '../../lib/config/ensure-env';
import { ensureDocker } from '../../lib/docker/ensure-docker';
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
      'overwrite container config from the host workspace. Without --override, host config files are NOT pushed (the container keeps its current config). With --override, the host workspace overwrites container config, except encrypted *.secrets.json files and .history/ directories, which are always preserved',
    )
    .option('-q, --quiet', 'Suppress container logs during deployment')
    .option(
      '--override-all',
      'After deploy, factory-reseed the builtin catalog into ALL orgs server-side ' +
        '(preserves *.secrets.json, .history/, and uploaded branding/images/). ' +
        'Implies --all (recreates stateful services so the new entrypoint runs).',
      false,
    )
    .option(
      '-y, --yes',
      'Non-interactive: auto-accept destructive confirmation prompts (e.g. --override-all)',
      false,
    )
    .option(
      '--skip-backup',
      'Skip the automatic pre-deploy volume snapshot (recovery from a failed ' +
        'migration then falls back to your own external backups)',
      false,
    )
    .action(async (options) => {
      try {
        // `--override` and `--override-all` are semantically incompatible:
        // host push runs first, then the catalog factory reseed clobbers
        // everything --override would have written (host push effectively
        // becomes a no-op for non-secrets / non-history / non-branding-
        // images). Reject the combination at parse time so operators
        // don't reason about a silently-discarded flag.
        if (options.override && options.overrideAll) {
          logger.error(
            '--override and --override-all cannot be combined: ' +
              '--override-all factory-reseeds from the builtin catalog and ' +
              'would clobber whatever --override just pushed. ' +
              'Pick one: --override (push host workspace to container) ' +
              'OR --override-all (factory-reseed all orgs server-side).',
          );
          process.exit(1);
        }
        const projectDir = requireProject();
        await resolveOrAssignProjectContext(projectDir);

        // Zero-prerequisite: make sure Docker is usable before anything else.
        const docker = await ensureDocker({ assumeYes: options.yes });
        if (docker.status === 'refused' || docker.status === 'failed') {
          logger.error(docker.detail);
          process.exit(1);
        }

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
        // Also force-recreate on --override-all so the reseed action
        // runs against the new binary, not a stale container that the
        // image/config-unchanged path would have left running.
        const forceRecreate =
          (regeneratedAutoSecrets !== undefined &&
            regeneratedAutoSecrets.length > 0) ||
          (options.overrideAll ?? false);

        // `tale init` leaves a local default (localhost + self-signed). Choose
        // the production domain + TLS here: prompts interactively, honors
        // --host, and is a no-op in CI when HOST is already a public domain.
        await ensureProductionDomain(projectDir, { host: options.host });

        const env = loadEnv(projectDir);

        // Catch fixable problems (daemon down, letsencrypt misconfig) before
        // mutating any container. Throws on a real deploy; warns on --dry-run.
        // Pass the env source explicitly (TLS_MODE/HOST/TLS_EMAIL live in
        // process.env, populated by loadEnv above) so preflight doesn't depend
        // on an implicit default.
        await runDeployPreflight({ dryRun: options.dryRun, env: process.env });

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

        const hostAlias = options.host ?? process.env.HOST ?? 'tale.local';
        await deploy({
          version,
          // --override-all implies --all so the convex container restarts
          // with the new entrypoint + new code before the reseed action runs.
          updateStateful: options.all || options.overrideAll,
          env,
          hostAlias,
          dryRun: options.dryRun,
          services,
          override: options.override,
          overrideAll: options.overrideAll,
          quiet: options.quiet,
          assumeYes: options.yes,
          forceRecreate,
          skipBackup: options.skipBackup,
        });
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
