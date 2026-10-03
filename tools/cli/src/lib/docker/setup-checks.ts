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
    const server = await deps.probe([
      'version',
      '--format',
      '{{json .Server}}',
    ]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(server ?? 'null');
    } catch {
      parsed = null;
    }
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
