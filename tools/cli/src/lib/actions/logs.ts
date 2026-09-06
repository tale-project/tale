import {
  type ClassifiedLine,
  chain,
  classifyBackend,
  classifyDockerCompose,
  classifyPlatformContainer,
  classifyVite,
  createStreamClassifier,
} from '@tale/shared/classify';
import { detectCapabilities, makePalette } from '@tale/shared/terminal';

import { isUserInterrupt } from '../../utils/exit-codes';
import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import type { DeploymentColor } from '../compose/types';
import {
  ALL_SERVICES,
  SIDECAR_SERVICES,
  isRotatableService,
  isSidecarService,
  isValidService,
} from '../compose/types';
import { containerExists } from '../docker/container-exists';
import { pipeLines } from '../docker/docker-compose';
import { getCurrentColor } from '../state/get-current-color';

interface LogsOptions {
  service: string;
  color?: DeploymentColor;
  follow: boolean;
  since?: string;
  tail?: number;
  /** Stream literal output with no classification/coloring/filtering. */
  raw?: boolean;
  deployDir: string;
}

/** Access-log health probes are pure noise — dropped from the classified view. */
const HEALTH_LINE = /"GET \/health[^"]*"\s+200|GET \/health .* 200/;

export async function logs(options: LogsOptions): Promise<void> {
  const { service, color, follow, since, tail, raw, deployDir } = options;

  // Validate service name
  if (!isValidService(service) && !isSidecarService(service)) {
    logger.error(`Invalid service: ${service}`);
    logger.info(
      `Available services: ${[...ALL_SERVICES, ...SIDECAR_SERVICES].join(', ')}`,
    );
    throw new Error('Invalid service name');
  }

  // Determine container name
  let containerName: string;

  if (isRotatableService(service)) {
    // Rotatable services carry a color once deployed; `tale dev` runs them
    // colour-less. Resolve in that order so the quickstart's
    // `tale logs platform` works before any deployment exists.
    if (color) {
      containerName = `${getProjectId()}-${service}-${color}`;
    } else {
      const currentColor = await getCurrentColor(deployDir);
      if (currentColor) {
        logger.info(`Auto-detected active color: ${currentColor}`);
        containerName = `${getProjectId()}-${service}-${currentColor}`;
      } else {
        const devContainer = `${getProjectId()}-${service}`;
        if (await containerExists(devContainer)) {
          containerName = devContainer;
        } else {
          logger.error('No active deployment found');
          logger.info('Use --color to specify blue or green explicitly');
          throw new Error('No active deployment');
        }
      }
    }
  } else {
    // Stateful services don't have colors
    if (color) {
      logger.warn(
        `Ignoring --color for stateful service ${service} (stateful services don't use blue/green)`,
      );
    }
    containerName = `${getProjectId()}-${service}`;
  }

  // Check if container exists (docker logs works for both running and stopped containers)
  const exists = await containerExists(containerName);
  if (!exists) {
    logger.error(`Container ${containerName} does not exist`);
    throw new Error('Container not found');
  }

  // Build docker logs command
  const args = ['logs'];

  if (follow) {
    args.push('--follow');
  }

  if (since) {
    args.push('--since', since);
  }

  if (tail !== undefined) {
    args.push('--tail', String(tail));
  }

  args.push(containerName);

  logger.info(`Showing logs for ${containerName}...`);

  // `--raw`: literal passthrough, exactly what `docker logs` prints. The escape
  // hatch for when the classified view hides something or for piping verbatim.
  if (raw) {
    const proc = Bun.spawn(['docker', ...args], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0 && !isUserInterrupt(exitCode)) {
      throw new Error(`docker logs exited with code ${exitCode}`);
    }
    return;
  }

  // Classified view: every line is shown verbatim (it IS a log viewer) but
  // colored by level and with health-probe access spam dropped. Errors/warnings
  // become scannable; a sticky classifier keeps multi-line stack traces red.
  const palette = makePalette(detectCapabilities().color);
  const classify = createStreamClassifier(
    chain(
      classifyDockerCompose,
      classifyBackend,
      classifyVite,
      classifyPlatformContainer,
    ),
  );
  const render = (line: string): void => {
    if (HEALTH_LINE.test(line)) return;
    const c: ClassifiedLine = classify(line);
    if (c.kind === 'error') {
      process.stdout.write(`${palette.red}${line}${palette.reset}\n`);
    } else if (c.kind === 'warn') {
      process.stdout.write(`${palette.yellow}${line}${palette.reset}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  const proc = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await Promise.all([
    pipeLines(proc.stdout, render),
    pipeLines(proc.stderr, render),
    proc.exited,
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0 && !isUserInterrupt(exitCode)) {
    throw new Error(`docker logs exited with code ${exitCode}`);
  }
}
