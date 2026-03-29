import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadEnv, PROJECT_NAME } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { generateDevCompose } from '../compose/generators/generate-dev-compose';
import { dockerCompose } from '../docker/docker-compose';
import { findProject } from '../project/find-project';

interface StartOptions {
  version?: string;
  detach?: boolean;
  host?: string;
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
  const version = options.version ?? 'latest';
  const hostAlias = options.host ?? 'tale.local';

  logger.header('Starting Tale (Dev Mode)');
  logger.info(`Project: ${projectDir}`);
  logger.info(`Version: ${version}`);
  logger.info(`Host:    ${hostAlias}`);
  logger.blank();

  const compose = generateDevCompose(
    { version, registry: env.GHCR_REGISTRY },
    hostAlias,
  );

  const args = ['up', ...(options.detach ? ['-d'] : [])];

  logger.step('Starting services...');
  const result = await dockerCompose(compose, args, {
    projectName: `${PROJECT_NAME}-dev`,
    cwd: projectDir,
  });

  if (!result.success) {
    logger.error('Failed to start services');
    if (result.stderr) {
      logger.error(result.stderr);
    }
    throw new Error('Start failed');
  }

  if (options.detach) {
    logger.blank();
    logger.success('Tale is running in the background');
    logger.blank();
    logger.info('Agents and workflows are bind-mounted from your project.');
    logger.info(
      'Edits to agents/ and workflows/ will take effect immediately.',
    );
    logger.blank();
    logger.info(`Stop with: docker compose -p ${PROJECT_NAME}-dev down`);
  }
}
