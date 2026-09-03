import { execSync } from 'node:child_process';

import { daemonReachable } from './daemon-reachable';

/**
 * Host health checks shared by the run-time paths (currently `tale deploy`'s
 * preflight). These used to live in the `tale doctor` command; that command
 * was removed in favor of init/start/deploy handling readiness themselves, but
 * the daemon + sandbox-token checks remain useful inline before a deploy.
 */
interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

function tryRun(cmd: string): string | undefined {
  try {
    return execSync(cmd, {
      stdio: ['ignore', 'pipe', 'ignore'],
      // Bound the probe: a present-but-unreachable daemon makes
      // `docker version`/`docker info` hang indefinitely. Treat a timeout as
      // a failed check rather than freezing the caller.
      timeout: 10_000,
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export async function checkDaemon(): Promise<Check> {
  const status = await daemonReachable();
  if (status.reachable) {
    return { name: 'docker daemon', status: 'ok', detail: status.detail };
  }
  // `daemonReachable()` fails for two very different reasons: the daemon is
  // down, or the docker CLI isn't installed at all (ENOENT). Advise
  // accordingly.
  const cliMissing = !tryRun('docker --version');
  return {
    name: 'docker daemon',
    status: 'fail',
    detail: `not reachable — ${status.detail}`,
    fix: cliMissing
      ? 'Docker CLI not on PATH — install Docker'
      : process.platform === 'linux'
        ? 'Start the Docker daemon (systemctl start docker) or open Docker Desktop'
        : 'Start Docker Desktop',
  };
}

export function checkSandboxToken(env: NodeJS.ProcessEnv): Check {
  // The token is REQUIRED: the spawner refuses to start without it (it holds
  // the host docker socket and sits on the network every session container
  // shares — there is no unsigned mode). `tale deploy` auto-mints it into .env
  // before this check runs, so an unset value here means the .env is broken.
  // A short value is suspicious (probably truncated).
  const raw = env.SANDBOX_TOKEN?.trim();
  if (!raw || raw.length === 0) {
    return {
      name: 'SANDBOX_TOKEN',
      status: 'fail',
      detail:
        'unset — the sandbox spawner refuses to start without the shared HMAC secret',
      fix: 'Set a 64-char hex value (openssl rand -hex 32) or re-run `tale init`',
    };
  }
  if (raw.length < 32) {
    return {
      name: 'SANDBOX_TOKEN',
      status: 'fail',
      detail: `set but suspiciously short (${raw.length} chars) — looks truncated`,
      fix: 'Set a 64-char hex value (or re-run `tale init`)',
    };
  }
  return {
    name: 'SANDBOX_TOKEN',
    status: 'ok',
    detail: `enabled (${raw.length} chars)`,
  };
}
