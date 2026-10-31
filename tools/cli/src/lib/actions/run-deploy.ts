import pkg from '../../../package.json';
import { preconditionError, usageError } from '../../utils/fail';
import { loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { confirm as promptConfirm, isInteractive } from '../../utils/prompt';
import {
  type ServiceName,
  ALL_SERVICES,
  isValidService,
} from '../compose/types';
import {
  type RunOrigin,
  deploySiteUrl,
  resolveDeployHost,
} from '../config/dev-origin';
import {
  ensureEnv,
  ensureProductionDomain,
  isLocalHostname,
} from '../config/ensure-env';
import { ensureDocker } from '../docker/ensure-docker';
import { requireProject } from '../project/find-project';
import { resolveOrAssignProjectContext } from '../project/project-context';
import { isDevBuild } from '../version/self-update';
import { checkBreakingCutover } from './breaking-cutover-guard';
import { deploy } from './deploy';
import { runDeployPreflight } from './deploy-preflight';
import { confirmOverrideAll } from './reseed-all-orgs';

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
 * Injectable seams (project lookup, Docker, preflight, the deploy itself,
 * prompting) so what a run reads from and writes to `.env`, and what it asks
 * before, is unit-testable without Docker or a terminal. Production passes
 * the defaults below.
 */
export interface RunDeployDeps {
  requireProject: typeof requireProject;
  ensureDocker: typeof ensureDocker;
  runDeployPreflight: typeof runDeployPreflight;
  checkBreakingCutover: typeof checkBreakingCutover;
  deploy: typeof deploy;
  confirm: (message: string) => Promise<boolean>;
  isInteractive: () => boolean;
}

const defaultDeps: RunDeployDeps = {
  requireProject,
  ensureDocker,
  runDeployPreflight,
  checkBreakingCutover,
  deploy,
  confirm: (message) => promptConfirm({ message, default: false }),
  isInteractive,
};

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
export async function runDeploy(
  options: RunDeployOptions,
  deps: RunDeployDeps = defaultDeps,
): Promise<void> {
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
  const dryRun = options.dryRun ?? false;
  // `--host` serves another host for this run only; `.env` keeps its own.
  const runHost =
    options.host === undefined ? undefined : resolveDeployHost(options.host);

  const projectDir = deps.requireProject();
  // `--override-all` is asked for before anything changes: a decline, or no
  // `--yes` without a terminal, must leave the running deployment untouched.
  if (options.overrideAll) {
    await confirmOverrideAll({ dryRun, assumeYes: options.yes }, deps);
  }
  await resolveOrAssignProjectContext(projectDir, { dryRun });

  // Zero-prerequisite: make sure Docker is usable before anything else.
  const docker = await deps.ensureDocker({ assumeYes: options.yes });
  if (docker.status === 'refused' || docker.status === 'failed') {
    throw preconditionError(docker.detail);
  }

  const { success: envSetupSuccess, regeneratedAutoSecrets } = await ensureEnv({
    deployDir: projectDir,
    dryRun,
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
  // production domain + TLS here: prompts interactively, and is a no-op in CI
  // or when HOST is already a public domain. `--host` skips it.
  if (runHost === undefined) {
    await ensureProductionDomain(projectDir, { dryRun });
  }

  const env = loadEnv(projectDir);
  const origin: RunOrigin | undefined =
    runHost === undefined
      ? undefined
      : { host: runHost, siteUrl: deploySiteUrl(runHost, env.SITE_URL) };
  if (origin) {
    const tlsMode = process.env.TLS_MODE || 'selfsigned';
    logger.info(
      `${dryRun ? '[DRY-RUN] Would serve' : 'Serving'} ${origin.siteUrl} (--host ${origin.host}, TLS_MODE=${tlsMode}). ` +
        '.env is not changed: set HOST and SITE_URL there to keep this host.',
    );
    if (tlsMode === 'selfsigned' && !isLocalHostname(origin.host)) {
      logger.warn(
        `${origin.host} gets a self-signed certificate that browsers do not trust. ` +
          "For a Let's Encrypt certificate set TLS_MODE=letsencrypt and TLS_EMAIL in .env.",
      );
    }
  }

  // Catch fixable problems (daemon down, letsencrypt misconfig) before mutating
  // any container, for the host this run serves. Throws on a real deploy;
  // warns on --dry-run.
  await deps.runDeployPreflight({
    dryRun,
    env: origin
      ? { ...process.env, HOST: origin.host, SITE_URL: origin.siteUrl }
      : process.env,
  });

  const version = isDevBuild() ? 'latest' : pkg.version;
  if (version === 'latest') {
    logger.info(
      'Dev build detected — deploying `latest` images. Released binaries deploy their pinned version.',
    );
  }

  // Refuse a cross-baseline in-place deploy (a pre-baseline instance under a
  // post-baseline CLI) before pulling images or snapshotting volumes — there
  // is no upgrade path across BREAKING_BASELINE (0.5.0: Convex → Postgres).
  await deps.checkBreakingCutover({
    deployDir: projectDir,
    targetVersion: version,
    acceptDataLoss: options.acceptDataLoss ?? false,
    dryRun,
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

  const hostAlias = origin?.host ?? process.env.HOST ?? 'localhost';
  await deps.deploy({
    version,
    // --override-all implies --stop so the stop-gated tier rolls and the
    // forceRecreate below restarts services for the reseed entrypoint.
    stop: (options.stop || options.overrideAll) ?? false,
    env: origin ? { ...env, SITE_URL: origin.siteUrl } : env,
    hostAlias,
    origin,
    dryRun,
    services,
    override: options.override,
    overrideAll: options.overrideAll,
    quiet: options.quiet,
    forceRecreate,
    skipBackup: options.skipBackup,
  });
}
