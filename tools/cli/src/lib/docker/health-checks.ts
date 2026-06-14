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
  // Token policy is opt-in — unset = HMAC disabled, valid for dev / internal
  // trust. A short value is suspicious (probably truncated); missing is OK.
  const raw = env.SANDBOX_TOKEN;
  if (!raw || raw.length === 0) {
    return {
      name: 'SANDBOX_TOKEN',
      status: 'warn',
      detail:
        'unset — HMAC auth between Convex and the sandbox spawner is disabled',
      fix: 'Set a 64-char hex value (or re-run `tale init`) to enable signature verification',
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
