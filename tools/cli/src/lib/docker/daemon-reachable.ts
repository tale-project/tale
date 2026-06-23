import { exec } from './exec';

interface DaemonStatus {
  reachable: boolean;
  detail: string;
}

/**
 * Probe the Docker daemon through the Docker CLI rather than a socket
 * path. `/var/run/docker.sock` only exists on Linux — Docker Desktop on
 * macOS proxies through a VM and Windows uses a named pipe
 * (`npipe:////./pipe/docker_engine`), and rootless/remote setups route
 * via `DOCKER_HOST`. The CLI resolves the endpoint the same way every
 * other docker call does, so its exit code is the truthful signal on
 * all platforms.
 *
 * `docker version` (not `docker info`): `info --format` exits 0 even
 * when the daemon is down — server errors only surface in stderr.
 * `version --format '{{.Server.Version}}'` exits 1 because the template
 * needs a server response.
 */
export async function daemonReachable(): Promise<DaemonStatus> {
  try {
    const result = await exec(
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      // Bound the probe: a present-but-unresponsive daemon (socket exists,
      // VM/engine not answering) makes `docker version` hang indefinitely,
      // which would freeze any caller (`tale dev` / `tale deploy`).
      { silent: true, timeout: 10 },
    );
    if (result.success) {
      return {
        reachable: true,
        detail: `daemon reachable (server ${result.stdout})`,
      };
    }
    return {
      reachable: false,
      detail:
        result.stderr || `docker version exited with code ${result.exitCode}`,
    };
  } catch (err) {
    // Bun.spawn throws (ENOENT) when the docker CLI is missing entirely.
    return {
      reachable: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
