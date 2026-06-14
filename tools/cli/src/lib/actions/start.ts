import { join, relative } from 'node:path';

import pkg from '../../../package.json';
import { isUserInterrupt } from '../../utils/exit-codes';
import { getProjectId, loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { StatusHeader, isHealthCheckLog } from '../../utils/terminal';
import { findComposeOverride } from '../compose/find-compose-override';
import { DEV_VOLUME_NAMES } from '../compose/generators/constants';
import { generateDevCompose } from '../compose/generators/generate-dev-compose';
import { dockerCompose } from '../docker/docker-compose';
import { ensureDocker } from '../docker/ensure-docker';
import { ensureNetwork, ensureSandboxNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { findChildProject, findProject } from '../project/find-project';
import { resolveOrAssignProjectContext } from '../project/project-context';
import { withLock } from '../state/with-lock';
import { init } from './init';
import { legacyLayoutPreflight } from './legacy-layout-preflight';

async function assertDockerAvailable(): Promise<void> {
  try {
    const result = await exec('docker', ['info'], {
      silent: true,
      timeout: 10,
    });
    if (!result.success) {
      throw new Error(
        `Docker daemon is not running. Start Docker and try again.\n${result.stderr}`,
      );
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw new Error(
        'Docker is not installed. Install it from https://docs.docker.com/get-docker/',
        { cause: err },
      );
    }
    throw err;
  }
}

async function openBrowser(url: string): Promise<void> {
  const commands: string[][] =
    process.platform === 'darwin'
      ? [['open', url]]
      : process.platform === 'win32'
        ? [['cmd', '/c', 'start', '', url]]
        : [
            ['xdg-open', url],
            ['sensible-browser', url],
            ['x-www-browser', url],
          ];

  for (const cmd of commands) {
    try {
      const proc = Bun.spawn(cmd, {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) return;
    } catch (err) {
      // Command not found (ENOENT) is expected as we try each opener in turn;
      // other errors are worth noting at debug level.
      logger.debug(
        `Browser opener ${cmd[0]} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  logger.warn(`Could not open browser automatically. Visit: ${url}`);
}

async function waitForHealthAndOpenBrowser(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const healthUrl = `${url}/health`;
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return false;
    try {
      const fetchSignal = signal
        ? AbortSignal.any([AbortSignal.timeout(2000), signal])
        : AbortSignal.timeout(2000);
      const res = await fetch(healthUrl, { signal: fetchSignal });
      if (res.ok) {
        await openBrowser(url);
        return true;
      }
    } catch (err) {
      if (signal?.aborted) return false;
      // Expected during startup (connection refused / timeout); log at debug
      // level so it's available when diagnosing health-check issues.
      logger.debug(
        `Health check attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await Bun.sleep(1000);
  }
  logger.warn(
    `Services did not become healthy within ${maxAttempts}s. Check logs: docker compose -p ${getProjectId()}-dev logs`,
  );
  return false;
}

const URL_PATTERN = /https?:\/\/\S+/;

function extractUrl(line: string): string | null {
  const match = URL_PATTERN.exec(line);
  return match ? match[0] : null;
}

interface StartOptions {
  detach?: boolean;
  port?: number;
  host?: string;
  /**
   * Non-interactive: auto-accept the legacy-layout migration prompt
   * when a pre-org-first project root is detected. Parallels the
   * `--yes` flag on `tale deploy`.
   */
  assumeYes?: boolean;
  /**
   * Skip the pre-migration volume snapshot the legacy-layout preflight
   * takes before `migrateConfigLayout`. Parallels `tale deploy
   * --skip-backup`; logged loudly because it removes the recovery point.
   */
  skipBackup?: boolean;
}

export async function start(options: StartOptions): Promise<void> {
  let projectDir = findProject();
  if (!projectDir) {
    // `tale init` / `tale setup` scaffold into a named subdirectory, so a
    // common mistake is running `tale start` one level up. Point at the child
    // project rather than silently initializing a second one on top.
    const childProject = findChildProject();
    if (childProject) {
      const rel = relative(process.cwd(), childProject);
      throw new Error(
        `No Tale project in this directory — found one at ./${rel}. ` +
          `Run it from there:\n  cd ${rel} && tale start`,
      );
    }
    logger.warn('No Tale project found. Initializing in current directory...');
    logger.blank();
    await init({ directory: process.cwd() });
    projectDir = findProject();
    if (!projectDir) {
      throw new Error('Initialization failed: tale.json was not created.');
    }
  }

  // Environment setup runs unconditionally so `tale start` after a CLI
  // upgrade that introduces a new auto-secret (e.g. SANDBOX_TOKEN) picks
  // it up before compose starts — matches `tale deploy` semantics so
  // both commands give the same surface behavior.
  const envPath = join(projectDir, '.env');
  const { ensureEnv } = await import('../config/ensure-env');
  const { success: envOk } = await ensureEnv({ deployDir: projectDir });
  if (!envOk) {
    throw new Error(
      `Environment setup failed. Cannot start without ${envPath}.`,
    );
  }

  // Resolve project ID from tale.json before any Docker-resource naming —
  // and before the legacy-layout preflight, whose `migrateConfigLayout`
  // derives the convex container name from `getProjectId()`. Resolving after
  // the preflight would crash with "Project context not initialized" once the
  // preflight reached its container-side phase, leaving the host dirs already
  // moved. This only reads/writes tale.json (no Docker), so it is safe here.
  await resolveOrAssignProjectContext(projectDir);

  // Load env before the preflight so BACKUP_KEEP_COUNT/BACKUP_KEEP_DAYS
  // from the project .env reach the snapshot-rotation defaults.
  const env = loadEnv(projectDir);

  if (options.skipBackup) {
    logger.warn(
      '--skip-backup: pre-migration volume snapshots are disabled for this run.',
    );
  }

  // Detect legacy flat-layout dirs at the project root (`agents/`,
  // `workflows/`, …, `retention/`). Under the org-first layout these
  // belong under `default/<domain>/` — the platform's resolvers won't
  // read anything at the old paths. The preflight prompts the operator
  // (default-No) and runs `migrateConfigLayout` in place on accept; CI
  // runs must pass `--yes`. Replaces the prior hard-fail-with-runbook
  // shape so an upgrade flows in one command. Before migrating it
  // snapshots the dev data volumes (the migration rewrites the convex
  // data volume) unless --skip-backup opted out.
  await legacyLayoutPreflight({
    projectDir,
    assumeYes: options.assumeYes ?? false,
    context: 'start',
    backup: options.skipBackup
      ? 'skip'
      : { volumePrefix: `${getProjectId()}-dev_` },
  });

  // Zero-prerequisite: install/start Docker if needed. ensureDocker already
  // tried to start/install the engine and returns actionable guidance when it
  // can't — surface that and stop, rather than falling through to
  // assertDockerAvailable whose `docker info` would just time out again on an
  // engine we already know is down (the cryptic "Command timed out after 10s").
  const docker = await ensureDocker({ assumeYes: options.assumeYes });
  if (docker.status === 'refused' || docker.status === 'failed') {
    throw new Error(docker.detail);
  }
  // Residual safety net for the "ensureDocker said ready but it isn't" case.
  await assertDockerAvailable();

  // Ensure dev infrastructure under a project-scoped lock so parallel
  // `tale start` / `tale deploy` shells can't race on docker volumes.
  // The lock is released before `docker compose up` starts — holding it
  // for the full foreground lifetime of compose would block every other
  // tale command.
  const devPrefix = `${getProjectId()}-dev_`;
  await withLock(projectDir, 'start', async () => {
    // Pre-create dev volumes and network with explicit project-scoped names.
    // The dev compose file references them as external, so they must exist
    // before `docker compose up`.
    const volumesOk = await ensureVolumes([...DEV_VOLUME_NAMES], devPrefix);
    if (!volumesOk) {
      throw new Error('Failed to create dev volumes');
    }
    const networkOk = await ensureNetwork('internal', devPrefix);
    if (!networkOk) {
      throw new Error('Failed to create dev network');
    }
    // Sandbox bridge has a fixed Docker name (tale-sandbox-net) and lives
    // outside the project-prefixed naming scheme so the spawner can target
    // it directly from `docker run --network`. Internal-only (no internet)
    // and IPv6-disabled (R1.3 v4-allowlist-bypass mitigation).
    const sandboxNetworkOk = await ensureSandboxNetwork();
    if (!sandboxNetworkOk) {
      throw new Error('Failed to create sandbox network');
    }
  });

  const version = pkg.version.includes('-dev') ? 'latest' : pkg.version;
  const port = options.port ?? 443;
  const hostAlias = options.host ?? 'tale.local';
  const portSuffix = port === 443 ? '' : `:${port}`;
  const url = `${env.SITE_URL.replace(/:443$/, '')}${portSuffix}`;

  const compose = generateDevCompose(
    { version, registry: env.GHCR_REGISTRY },
    hostAlias,
    port,
    { projectDir },
  );

  const overrideFile = findComposeOverride(projectDir);
  if (overrideFile) {
    logger.info(`Using compose override: compose.override.yml`);
  }

  const args = ['up', ...(options.detach ? ['-d'] : [])];

  // AbortController to cancel health polling when docker compose exits
  const abortController = new AbortController();

  // Start browser opener in background (runs concurrently with docker compose)
  const browserTask = waitForHealthAndOpenBrowser(url, abortController.signal);

  if (options.detach) {
    logger.header('Starting Tale (Dev Mode)');
    logger.info(`Project: ${projectDir}`);
    logger.info(`Version: ${version}`);
    logger.info(`URL:     ${url}`);
    logger.blank();
    logger.step('Starting services...');

    const result = await dockerCompose(compose, args, {
      projectName: `${getProjectId()}-dev`,
      cwd: projectDir,
      inherit: true,
      overrideFile: overrideFile ?? undefined,
    });

    if (!result.success) {
      abortController.abort();
      if (!isUserInterrupt(result.exitCode)) {
        logger.error('Failed to start services');
        throw new Error('Start failed');
      }
      return;
    }

    const healthy = await browserTask;
    logger.blank();
    if (healthy) {
      logger.success('Tale is running in the background');
    } else {
      logger.warn(
        'Tale is running but services may not be ready yet. Check logs: docker compose -p ' +
          `${getProjectId()}-dev logs`,
      );
    }
    logger.blank();
    logger.info(
      'Per-org config (`<org>/agents/`, `<org>/workflows/`, `<org>/integrations/`, `<org>/branding/`, `<org>/providers/`, `<org>/skills/`)',
    );
    logger.info(
      'is bind-mounted from your project. Edits to those paths auto-refresh the browser.',
    );
    logger.blank();
    logger.info(`Stop with: docker compose -p ${getProjectId()}-dev down`);
    return;
  }

  // Interactive mode: status header + filtered log streaming
  const header = new StatusHeader(version);
  header.setup();

  // State for parsing platform status block
  let capturingStatus = false;
  let statusLineCount = 0;
  const capturedUrls: Record<string, string> = {};

  const result = await dockerCompose(compose, args, {
    projectName: `${getProjectId()}-dev`,
    cwd: projectDir,
    overrideFile: overrideFile ?? undefined,
    onLine(line) {
      // Filter health check logs
      if (isHealthCheckLog(line)) return;

      // Detect platform ready block and capture URLs
      if (line.includes('Tale Platform is running!')) {
        capturingStatus = true;
        statusLineCount = 0;
        return;
      }

      if (capturingStatus) {
        statusLineCount++;

        const extractedUrl = extractUrl(line);
        if (extractedUrl) {
          if (line.includes('Vite') || line.includes('Application')) {
            capturedUrls.app = extractedUrl;
          } else if (line.includes('Convex API')) {
            capturedUrls.api = extractedUrl;
          } else if (line.includes('Actions')) {
            capturedUrls.actions = extractedUrl;
          } else if (line.includes('Dashboard')) {
            capturedUrls.dashboard = extractedUrl;
          }
        }

        // End capture after enough lines or when we have all URLs
        if (
          statusLineCount > 8 ||
          (capturedUrls.app &&
            capturedUrls.api &&
            capturedUrls.actions &&
            capturedUrls.dashboard)
        ) {
          capturingStatus = false;
          header.setReady({
            app: capturedUrls.app ?? url,
            api: capturedUrls.api ?? `${url}/ws_api`,
            actions: capturedUrls.actions ?? `${url}/http_api`,
            dashboard: capturedUrls.dashboard ?? `${url}/convex-dashboard`,
          });
        }
        return;
      }

      header.writeLine(line);
    },
  });

  // Stop health polling now that docker compose has exited
  abortController.abort();
  await browserTask;
  header.cleanup();

  if (!result.success && !isUserInterrupt(result.exitCode)) {
    logger.error('Failed to start services');
    if (result.stderr) logger.error(result.stderr);
    throw new Error('Start failed');
  }
}
