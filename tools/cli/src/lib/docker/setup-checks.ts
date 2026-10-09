import { createServer } from 'node:net';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { exec } from './exec';
import { checkDaemon } from './health-checks';

export interface SetupCheck {
  id: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

/** Probe only: never start Docker, pull images or read a project's secrets. */
async function probeDocker(args: string[]): Promise<string | null> {
  try {
    const result = await exec('docker', args, { silent: true, timeout: 10 });
    return result.success ? result.stdout : null;
  } catch {
    return null;
  }
}

export async function checkCompose(probe = probeDocker): Promise<SetupCheck> {
  const version = await probe(['compose', 'version', '--short']);
  if (!version) {
    return {
      id: 'compose',
      status: 'fail',
      detail: 'Docker Compose is not available.',
      fix: 'Install the Docker Compose plugin or update Docker Desktop, then run docker compose version.',
    };
  }
  const help = await probe(['compose', 'up', '--help']);
  if (!help?.includes('--wait ') || !help.includes('--wait-timeout')) {
    return {
      id: 'compose',
      status: 'fail',
      detail: `Docker Compose ${version} does not support the startup readiness checks.`,
      fix: 'Update Docker Compose or Docker Desktop, then retry tale dev.',
    };
  }
  return {
    id: 'compose',
    status: 'ok',
    detail: `Docker Compose ${version} supports startup readiness checks.`,
  };
}

/** The launch path uses the same check before it downloads any images. */
export async function assertComposeAvailable(): Promise<void> {
  const result = await checkCompose();
  if (result.status === 'fail')
    throw preconditionError(result.detail, result.fix);
}

/**
 * The oldest Docker Engine Tale supports. Tale publishes its images with
 * zstd-compressed layers, which Docker pulls from Engine 23.0 on, and keeps
 * the Compose files and health checks it generates working down to Engine 24.
 */
export const MIN_DOCKER_ENGINE_MAJOR = 24;
const ZSTD_DOCKER_ENGINE_MAJOR = 23;

const engineSchema = z.object({
  Version: z.string().optional(),
  Components: z
    .array(z.object({ Name: z.string(), Version: z.string() }))
    .optional(),
});

/**
 * Judge the server `docker version --format '{{json .Server}}'` describes.
 * Only Docker's own engine, the component named `Engine`, is judged by its
 * version: another engine behind the Docker API, such as Podman, numbers its
 * releases its own way. An engine too old to list components is Docker's.
 */
export function checkDockerEngine(server: unknown): SetupCheck {
  const supported = `Docker Engine ${MIN_DOCKER_ENGINE_MAJOR}.0 or later`;
  const unknown: SetupCheck = {
    id: 'engine',
    status: 'warn',
    detail: 'Could not determine the Docker Engine version.',
    fix: `Run docker version and check that the server is ${supported}.`,
  };
  const result = engineSchema.safeParse(server);
  if (!result.success) return unknown;
  const { Components: components } = result.data;
  const engine = components
    ? components.find((component) => component.Name === 'Engine')
    : { Version: result.data.Version };
  if (!engine) {
    const names = components?.map((component) => component.Name) ?? [];
    return {
      id: 'engine',
      status: 'warn',
      detail: `The Docker server is not Docker Engine (${names.join(', ') || 'no components'}); its version is not checked.`,
      fix: `Tale supports ${supported}: its images have zstd-compressed layers, which the engine must be able to pull.`,
    };
  }
  const version = engine.Version ?? '';
  const major = Number(/^v?(\d+)\./.exec(version)?.[1] ?? Number.NaN);
  if (!Number.isInteger(major)) return unknown;
  if (major < MIN_DOCKER_ENGINE_MAJOR) {
    return {
      id: 'engine',
      status: 'fail',
      detail:
        `Docker Engine ${version} is older than ${MIN_DOCKER_ENGINE_MAJOR}.0, the oldest engine Tale supports.` +
        (major < ZSTD_DOCKER_ENGINE_MAJOR
          ? ` It cannot pull Tale's images: their layers are zstd-compressed, which Docker reads from Engine ${ZSTD_DOCKER_ENGINE_MAJOR}.0 on.`
          : ''),
      fix: `Upgrade Docker so that the server runs ${supported}, then retry.`,
    };
  }
  return { id: 'engine', status: 'ok', detail: `Docker Engine ${version}.` };
}

/** The Docker server's own description, or null when it cannot be read. */
async function readDockerServer(probe = probeDocker): Promise<unknown> {
  const server = await probe(['version', '--format', '{{json .Server}}']);
  try {
    return JSON.parse(server ?? 'null');
  } catch {
    return null;
  }
}

/** Ask the Docker server for its engine version and judge it. */
export async function probeDockerEngine(
  probe = probeDocker,
): Promise<SetupCheck> {
  return checkDockerEngine(await readDockerServer(probe));
}

/**
 * The launch path refuses an engine that cannot run Tale before it downloads
 * any images; an engine whose version cannot be judged passes.
 */
export async function assertDockerEngineSupported(
  probe = probeDocker,
): Promise<void> {
  const result = await probeDockerEngine(probe);
  if (result.status === 'fail')
    throw preconditionError(result.detail, result.fix);
}

async function checkPort(port: number, host: string): Promise<SetupCheck> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        id: `port-${port}`,
        status: 'warn',
        detail:
          error.code === 'EADDRINUSE'
            ? `Port ${port} is in use; it may belong to a running Tale instance.`
            : `Could not check port ${port} (${error.code ?? 'socket error'}).`,
        fix:
          port === 8003
            ? 'Inspect the existing listener. Tale needs sandbox port 8003 even when the HTTPS port changes.'
            : 'Inspect the existing listener or choose another HTTPS port with tale dev --port 8443.',
      });
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() =>
        resolve({
          id: `port-${port}`,
          status: 'ok',
          detail: `Port ${port} is available on this machine.`,
        }),
      );
    });
  });
}

const serverSchema = z.object({ Os: z.string(), Arch: z.string() });

interface SetupDeps {
  probe: typeof probeDocker;
  daemon: typeof checkDaemon;
  port: typeof checkPort;
  env: NodeJS.ProcessEnv;
}

/** Read-only diagnostics work before init and never require a project. */
export async function collectSetupChecks(
  port: number,
  overrides: Partial<SetupDeps> = {},
): Promise<{ ready: boolean; checks: SetupCheck[] }> {
  const deps: SetupDeps = {
    probe: probeDocker,
    daemon: checkDaemon,
    port: checkPort,
    env: process.env,
    ...overrides,
  };
  const [daemon, compose] = await Promise.all([
    deps.daemon(),
    checkCompose(deps.probe),
  ]);
  const checks: SetupCheck[] = [
    {
      id: 'docker',
      status: daemon.status,
      detail: daemon.detail,
      fix: daemon.fix,
    },
    compose,
  ];
  if (port === 8003) {
    checks.push({
      id: 'https-port',
      status: 'fail',
      detail: "HTTPS port 8003 conflicts with Tale's fixed sandbox port.",
      fix: 'Choose another HTTPS port, for example tale dev --port 8443.',
    });
  }

  if (daemon.status === 'ok') {
    const parsed = await readDockerServer(deps.probe);
    const result = serverSchema.safeParse(parsed);
    if (!result.success) {
      checks.push({
        id: 'runtime',
        status: 'warn',
        detail: 'Could not determine the Docker server platform.',
        fix: 'Run docker version and check that the server runs Linux containers.',
      });
    } else if (result.data.Os !== 'linux') {
      checks.push({
        id: 'runtime',
        status: 'fail',
        detail: `Docker is running ${result.data.Os} containers; Tale requires Linux containers.`,
        fix: 'Switch Docker Desktop to Linux containers, then retry tale doctor.',
      });
    } else {
      const arm = ['arm64', 'aarch64'].includes(result.data.Arch);
      checks.push({
        id: 'runtime',
        status: arm ? 'warn' : 'ok',
        detail: arm
          ? 'Linux ARM64: the object store requires linux/amd64 emulation. This check does not test emulation.'
          : `Docker server platform: linux/${result.data.Arch}.`,
        ...(arm
          ? {
              fix: 'Use Docker Desktop with amd64 emulation or configure it on your Linux host before starting Tale.',
            }
          : {}),
      });
    }
    checks.push(checkDockerEngine(parsed));
  }

  // DOCKER_CONTEXT overrides DOCKER_HOST, as it does for Docker itself.
  const endpoint =
    !deps.env.DOCKER_CONTEXT && deps.env.DOCKER_HOST
      ? deps.env.DOCKER_HOST
      : await deps.probe([
          'context',
          'inspect',
          '--format',
          '{{.Endpoints.docker.Host}}',
        ]);
  if (endpoint?.startsWith('unix://') || endpoint?.startsWith('npipe://')) {
    checks.push(
      ...(await Promise.all([
        deps.port(port, '0.0.0.0'),
        ...(port === 8003 ? [] : [deps.port(8003, '127.0.0.1')]),
      ])),
    );
  } else {
    checks.push({
      id: 'ports',
      status: 'warn',
      detail:
        'Local port checks skipped: the Docker endpoint is remote or could not be identified.',
      fix: `Check HTTPS port ${port} and sandbox port 8003 on the Docker host. Local project bind mounts must also exist on that host.`,
    });
  }
  return { ready: checks.every((check) => check.status !== 'fail'), checks };
}
