import * as logger from '../../utils/logger';
import { pipeLines } from './docker-compose';
import { getContainerHealth } from './get-container-health';
import { isContainerRunning } from './is-container-running';

interface HealthCheckOptions {
  timeout: number;
  interval?: number;
  requestTimeoutMs?: number;
  streamLogs?: boolean;
}

function extractServiceName(containerName: string): string {
  // "tale-platform-blue" → "platform-blue", "tale-db" → "db"
  const parts = containerName.split('-');
  return parts.length > 1 ? parts.slice(1).join('-') : containerName;
}

function startLogTail(containerName: string): {
  kill: () => void;
  done: Promise<void>;
} {
  const proc = Bun.spawn(
    ['docker', 'logs', '--follow', '--tail', '0', containerName],
    { stdout: 'pipe', stderr: 'pipe' },
  );

  const service = extractServiceName(containerName);
  const onLine = (line: string) => {
    logger.containerLog(service, line);
  };

  const done = Promise.all([
    pipeLines(proc.stdout, onLine).catch(() => {}),
    pipeLines(proc.stderr, onLine).catch(() => {}),
  ]).then(() => {});

  // Use 'exit' event for cleanup — it's sync-only but proc.kill() is sync.
  // Unlike SIGINT/SIGTERM handlers, this does NOT override default exit behavior.
  const onExit = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };
  process.on('exit', onExit);

  return {
    kill() {
      onExit();
      process.removeListener('exit', onExit);
    },
    done,
  };
}

export async function waitForHealthy(
  containerName: string,
  options: HealthCheckOptions,
): Promise<boolean> {
  const { timeout, interval = 2000, streamLogs = false } = options;
  const startTime = Date.now();
  const timeoutMs = timeout * 1000;

  logger.info(
    `Waiting for ${containerName} to become healthy (timeout: ${timeout}s)`,
  );

  let tail: ReturnType<typeof startLogTail> | null = null;

  try {
    if (streamLogs) {
      tail = startLogTail(containerName);
    }

    while (Date.now() - startTime < timeoutMs) {
      const isRunning = await isContainerRunning(containerName);
      if (!isRunning) {
        logger.warn(`Container ${containerName} is not running`);
        await Bun.sleep(interval);
        continue;
      }

      const health = await getContainerHealth(containerName);

      if (health === 'healthy') {
        logger.success(`${containerName} is healthy`);
        return true;
      }

      logger.debug(`${containerName} health status: ${health}`);
      await Bun.sleep(interval);
    }

    logger.error(
      `Timeout: ${containerName} did not become healthy within ${timeout}s`,
    );
    return false;
  } finally {
    if (tail) {
      tail.kill();
      await Promise.allSettled([tail.done]);
    }
  }
}
