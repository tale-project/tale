import pkg from '../../../package.json';
import { preconditionError, usageError } from '../../utils/fail';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import {
  type ServiceName,
  ALL_SERVICES,
  isValidService,
} from '../compose/types';
import { ensureEnv, ensureProductionDomain } from '../config/ensure-env';
import { ensureDocker } from '../docker/ensure-docker';
import { requireProject } from '../project/find-project';
import { resolveOrAssignProjectContext } from '../project/project-context';
import { isDevBuild } from '../version/self-update';
import { checkBreakingCutover } from './breaking-cutover-guard';
import { deploy } from './deploy';
import { runDeployPreflight } from './deploy-preflight';

/**
 * Options for {@link runDeploy} — the flag surface of `tale deploy`, also
 * reused by `tale update`'s instance phase. Mirrors the command's CLI options
 * one-to-one.
 */
interface RunDeployOptions {
  /** Also update the stop-gated tier (db, proxy) even while running. */
  stop?: boolean;
  services?: string;
  dryRun?: boolean;
  host?: string;
  override?: boolean;
  overrideAll?: boolean;
  quiet?: boolean;
  yes?: boolean;
  skipBackup?: boolean;
  /** Expert override for the breaking-cutover guard (pre-0.4 instance). */
  acceptDataLoss?: boolean;
}

/**
 * Deploy the current CLI version to the environment: Docker/env preflight,
 * version resolution, then {@link deploy}.
 *
 * The deployed version is always the CLI's own version. Because the
 * version-alignment hook forces the CLI binary to match the workspace's
 * recorded `cliVersion` before any command runs, a bare `tale deploy` can only
 * ever (re)deploy that recorded version — it never needs to write `cliVersion`
 * itself. Moving to a new version is `tale update`'s job.
 */
export async function runDeploy(options: RunDeployOptions): Promise<void> {
  // `--override` and `--override-all` are semantically incompatible: host push
  // runs first, then the catalog factory reseed clobbers whatever --override
  // just wrote. Reject the combination so operators don't reason about a
  // silently-discarded flag.
  if (options.override && options.overrideAll) {
    throw usageError(
      '--override and --override-all cannot be combined: ' +
        '--override-all factory-reseeds from the builtin catalog and ' +
        'would clobber whatever --override just pushed. ' +
        'Pick one: --override (push host workspace to container) ' +
        'OR --override-all (factory-reseed all orgs server-side).',
    );
  }

  const projectDir = requireProject();
  await resolveOrAssignProjectContext(projectDir);

  // Zero-prerequisite: make sure Docker is usable before anything else.
  const docker = await ensureDocker({ assumeYes: options.yes });
  if (docker.status === 'refused' || docker.status === 'failed') {
    throw preconditionError(docker.detail);
  }

  const { success: envSetupSuccess, regeneratedAutoSecrets } = await ensureEnv({
    deployDir: projectDir,
  });
  if (!envSetupSuccess) {
    throw preconditionError(
      `Environment setup failed. Cannot deploy without ${projectDir}/.env.`,
    );
  }
  // If ensureEnv had to mint missing auto-gen secrets headlessly (typical: a
  // new `SANDBOX_TOKEN` for an existing deployment), force-recreate the running
  // services so their in-memory env refreshes to the new value rather than
  // keeping the stale null. Also force-recreate on --override-all so the reseed
  // action runs against the new binary, not a stale container the
  // image/config-unchanged path would have left running.
  const forceRecreate =
    (regeneratedAutoSecrets !== undefined &&
      regeneratedAutoSecrets.length > 0) ||
    (options.overrideAll ?? false);

  // `tale init` leaves a local default (localhost + self-signed). Choose the
  // production domain + TLS here: prompts interactively, honors --host, and is
  // a no-op in CI when HOST is already a public domain.
  await ensureProductionDomain(projectDir, { host: options.host });

  const env = loadEnv(projectDir);

  // Catch fixable problems (daemon down, letsencrypt misconfig) before mutating
  // any container. Throws on a real deploy; warns on --dry-run.
  await runDeployPreflight({
    dryRun: options.dryRun ?? false,
    env: process.env,
  });

  const version = isDevBuild() ? 'latest' : pkg.version;
  if (version === 'latest') {
    logger.info(
      'Dev build detected — deploying `latest` images. Released binaries deploy their pinned version.',
    );
  }

  // Refuse a cross-baseline in-place deploy (a pre-0.4 instance under a
  // >= 0.4 CLI) before pulling images or snapshotting volumes — there is no
  // upgrade path across the 0.4 baseline reset.
  await checkBreakingCutover({
    deployDir: projectDir,
    targetVersion: version,
    acceptDataLoss: options.acceptDataLoss ?? false,
    dryRun: options.dryRun ?? false,
  });

  let services: ServiceName[] | undefined;
  if (options.services) {
    const serviceList = options.services.split(',').map((s) => s.trim());
    const invalid = serviceList.filter((s) => !isValidService(s));
    if (invalid.length > 0) {
      throw usageError(`Invalid service(s): ${invalid.join(', ')}`, [
        `Valid services: ${ALL_SERVICES.join(', ')}`,
      ]);
    }
    services = serviceList.filter(isValidService);
  }

  const hostAlias = options.host ?? process.env.HOST ?? 'localhost';
  await deploy({
    version,
    // --override-all implies --stop so the stop-gated tier rolls and the
    // forceRecreate below restarts services for the reseed entrypoint.
    stop: (options.stop || options.overrideAll) ?? false,
    env,
    hostAlias,
    dryRun: options.dryRun ?? false,
    services,
    override: options.override,
    overrideAll: options.overrideAll,
    quiet: options.quiet,
    assumeYes: options.yes,
    forceRecreate,
    skipBackup: options.skipBackup,
  });
}
