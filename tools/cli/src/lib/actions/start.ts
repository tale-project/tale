import { existsSync } from 'node:fs';
import { join } from 'node:path';

import pkg from '../../../package.json';
import { isUserInterrupt } from '../../utils/exit-codes';
import { getProjectId, loadEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { StatusHeader, isHealthCheckLog } from '../../utils/terminal';
import { findComposeOverride } from '../compose/find-compose-override';
import { DEV_VOLUME_NAMES } from '../compose/generators/constants';
import { generateDevCompose } from '../compose/generators/generate-dev-compose';
import { dockerCompose } from '../docker/docker-compose';
import { ensureNetwork } from '../docker/ensure-network';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { findProject } from '../project/find-project';
import { resolveOrAssignProjectContext } from '../project/project-context';
import { withLock } from '../state/with-lock';
import { MIGRATIONS } from '../upgrade/registry';
import { runPendingMigrations } from '../upgrade/runner';
import { init } from './init';

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
  fresh?: boolean;
  /** Non-interactive acceptance of any pending migrations (mirrors deploy). */
  assumeYes?: boolean;
}

export async function start(options: StartOptions): Promise<void> {
  let projectDir = findProject();
  if (!projectDir) {
    logger.warn('No Tale project found. Initializing in current directory...');
    logger.blank();
    await init({ directory: process.cwd() });
    projectDir = findProject();
    if (!projectDir) {
      throw new Error('Initialization failed: tale.json was not created.');
    }
  }

  const envPath = join(projectDir, '.env');
  if (!existsSync(envPath)) {
    logger.warn('No .env file found. Running environment setup...');
    logger.blank();
    const { ensureEnv } = await import('../config/ensure-env');
    const { success } = await ensureEnv({ deployDir: projectDir });
    if (!success) {
      throw new Error(
        'Environment setup failed. Cannot start without .env file.',
      );
    }
  }

  await assertDockerAvailable();

  // Resolve project ID from tale.json before any Docker-resource naming.
  // Auto-assign an ID for legacy projects so users don't have to run
  // `tale upgrade` as a separate step before `tale start` works.
  await resolveOrAssignProjectContext(projectDir);

  // Detect and apply any pending migrations, then ensure dev infrastructure,
  // all under a project-scoped lock so parallel `tale start` / `tale deploy`
  // shells can't race on docker volumes or migrations.json. The lock is
  // released before `docker compose up` starts — holding it for the full
  // foreground lifetime of compose would block every other tale command.
  const devPrefix = `${getProjectId()}-dev_`;
  await withLock(projectDir, 'start', async () => {
    const migrationResult = await runPendingMigrations(
      MIGRATIONS,
      { projectId: getProjectId(), projectDir },
      {
        context: 'start',
        assumeYes: options.assumeYes,
        async performStops(stops) {
          // `stops` is the union of compose project names (e.g. legacy
          // 'tale-dev') and individual container names (e.g.
          // '${projectId}-dev-platform-blue'). Try each as a compose project
          // first, then fall back to `docker stop` for container names.
          // Failures here MUST surface — a silently-swallowed stop can let
          // the migration copy a live volume, corrupting data.
          for (const name of stops) {
            const composeDown = await exec(
              'docker',
              ['compose', '-p', name, 'down', '--remove-orphans'],
              { silent: true },
            );
            if (composeDown.success) continue;
            const stopResult = await exec(
              'docker',
              ['stop', '-t', '30', name],
              {
                silent: true,
              },
            );
            if (stopResult.success) continue;
            // Neither channel worked. If the container genuinely doesn't
            // exist, `docker stop` produces a specific stderr we can match;
            // any other failure is a hard abort so we don't proceed to
            // `cp -a` against a live volume.
            const stderr = `${stopResult.stderr ?? ''}`.toLowerCase();
            const looksMissing =
              stderr.includes('no such container') ||
              stderr.includes('not found');
            if (!looksMissing) {
              throw new Error(
                `Failed to stop '${name}' before migration: ${stopResult.stderr?.trim() || 'unknown error'}`,
              );
            }
          }
        },
      },
    );
    if (!migrationResult.proceed) {
      logger.info('Aborting start until migrations are approved.');
      process.exit(2);
    }

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
  });

  const env = loadEnv(projectDir);
  const version = pkg.version.includes('-dev') ? 'latest' : pkg.version;
  const port = options.port ?? 443;
  const hostAlias = options.host ?? 'tale.local';
  const portSuffix = port === 443 ? '' : `:${port}`;
  const url = `${env.SITE_URL.replace(/:443$/, '')}${portSuffix}`;

  const compose = generateDevCompose(
    { version, registry: env.GHCR_REGISTRY },
    hostAlias,
    port,
    { fresh: options.fresh },
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
      'Agents, workflows, integrations, and branding are bind-mounted from your project.',
    );
    logger.info(
      'Edits to agents/, workflows/, integrations/, and branding/ will auto-refresh the browser.',
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
