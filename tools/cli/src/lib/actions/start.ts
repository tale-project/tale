import { existsSync } from 'node:fs';
import { join } from 'node:path';

import pkg from '../../../package.json';
import { loadEnv, PROJECT_NAME } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { StatusHeader, isHealthCheckLog } from '../../utils/terminal';
import { generateDevCompose } from '../compose/generators/generate-dev-compose';
import { dockerCompose } from '../docker/docker-compose';
import { findProject } from '../project/find-project';

async function waitForHealthAndOpenBrowser(url: string): Promise<void> {
  const healthUrl = `${url}/api/health`;
  const maxAttempts = 120;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const cmd =
          process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
        Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
        return;
      }
    } catch {
      // Not ready yet
    }
    await Bun.sleep(1000);
  }
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
}

export async function start(options: StartOptions): Promise<void> {
  const projectDir = findProject();
  if (!projectDir) {
    throw new Error('No Tale project found. Run "tale init" to create one.');
  }

  const envPath = join(projectDir, '.env');
  if (!existsSync(envPath)) {
    throw new Error(
      `No .env file found in ${projectDir}. Run "tale init" to set up your environment.`,
    );
  }

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

  const args = ['up', ...(options.detach ? ['-d'] : [])];

  // Start browser opener in background (runs concurrently with docker compose)
  const browserTask = waitForHealthAndOpenBrowser(url);

  if (options.detach) {
    logger.header('Starting Tale (Dev Mode)');
    logger.info(`Project: ${projectDir}`);
    logger.info(`Version: ${version}`);
    logger.info(`URL:     ${url}`);
    logger.blank();
    logger.step('Starting services...');

    const result = await dockerCompose(compose, args, {
      projectName: `${PROJECT_NAME}-dev`,
      cwd: projectDir,
    });

    if (!result.success) {
      logger.error('Failed to start services');
      if (result.stderr) logger.error(result.stderr);
      throw new Error('Start failed');
    }

    await browserTask;
    logger.blank();
    logger.success('Tale is running in the background');
    logger.blank();
    logger.info('Agents and workflows are bind-mounted from your project.');
    logger.info(
      'Edits to agents/, workflows/, and integrations/ will auto-refresh the browser.',
    );
    logger.blank();
    logger.info(`Stop with: docker compose -p ${PROJECT_NAME}-dev down`);
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
    projectName: `${PROJECT_NAME}-dev`,
    cwd: projectDir,
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

      process.stdout.write(line + '\n');
    },
  });

  header.cleanup();

  if (!result.success) {
    logger.error('Failed to start services');
    if (result.stderr) logger.error(result.stderr);
    throw new Error('Start failed');
  }
}
