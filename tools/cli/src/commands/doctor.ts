import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { Command } from 'commander';

import * as logger from '../utils/logger';

/**
 * `tale doctor` — preflight checks for the host environment.
 *
 * Initial scope: sandbox-relevant items only (R1.17 surfaced that the
 * CLI never had a doctor command). Future checks (Postgres / Docker
 * versions, disk headroom, etc.) belong here too but are out of scope
 * for the sandbox-foundation rollout.
 */

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

function tryRun(cmd: string): string | undefined {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function checkDocker(): Check {
  const version = tryRun('docker --version');
  if (!version) {
    return {
      name: 'docker',
      status: 'fail',
      detail: 'docker CLI not on PATH',
      fix: 'Install Docker Engine 24+ or Docker Desktop',
    };
  }
  return { name: 'docker', status: 'ok', detail: version };
}

function checkSocket(): Check {
  if (!existsSync('/var/run/docker.sock')) {
    return {
      name: 'docker socket',
      status: 'fail',
      detail: '/var/run/docker.sock not present',
      fix: 'Start the Docker daemon (systemctl start docker) or open Docker Desktop',
    };
  }
  return {
    name: 'docker socket',
    status: 'ok',
    detail: '/var/run/docker.sock present',
  };
}

function checkRunsc(): Check {
  const runtimes = tryRun(
    "docker info --format '{{json .Runtimes}}' 2>/dev/null",
  );
  const hasRunsc = runtimes ? /\brunsc\b/.test(runtimes) : false;
  if (hasRunsc) {
    return {
      name: 'gVisor runtime (runsc)',
      status: 'ok',
      detail: 'registered with dockerd; set SANDBOX_RUNTIME=runsc to opt in',
    };
  }
  return {
    name: 'gVisor runtime (runsc)',
    status: 'warn',
    detail:
      'not registered with dockerd — sandbox will use plain runc (recommended for demo stage; install runsc before exposing to untrusted external workloads)',
    fix: 'https://gvisor.dev/docs/user_guide/install/ then `sudo runsc install && sudo systemctl restart docker`',
  };
}

function checkUserns(): Check {
  const out = tryRun("docker info --format '{{.SecurityOptions}}' 2>/dev/null");
  if (out && /name=userns/.test(out)) {
    return {
      name: 'dockerd userns-remap',
      status: 'ok',
      detail: 'enabled — container root ≠ host root',
    };
  }
  return {
    name: 'dockerd userns-remap',
    status: 'warn',
    detail:
      'not enabled — sandbox container UID 65534 maps to host UID 65534; combined with a kernel LPE this is a path to host root',
    fix: 'Set "userns-remap": "default" in /etc/docker/daemon.json and restart docker',
  };
}

function checkApparmor(): Check {
  const aa = tryRun('cat /sys/kernel/security/apparmor/profiles 2>/dev/null');
  if (aa && /docker-default/.test(aa)) {
    return {
      name: 'AppArmor docker-default',
      status: 'ok',
      detail: 'profile loaded',
    };
  }
  return {
    name: 'AppArmor docker-default',
    status: 'warn',
    detail:
      'not loaded — sandbox containers rely on Docker built-in seccomp only; consider enabling AppArmor on production hosts',
  };
}

function checkSandboxToken(env: NodeJS.ProcessEnv): Check {
  if (!env.SANDBOX_TOKEN || env.SANDBOX_TOKEN.length < 32) {
    return {
      name: 'SANDBOX_TOKEN',
      status: 'fail',
      detail:
        'missing or too short — required for HMAC auth between Convex and the sandbox spawner',
      fix: 'Re-run `tale init` (or set a 64-char hex value manually)',
    };
  }
  return {
    name: 'SANDBOX_TOKEN',
    status: 'ok',
    detail: `set (${env.SANDBOX_TOKEN.length} chars)`,
  };
}

function statusIcon(s: Check['status']): string {
  return s === 'ok' ? '✓' : s === 'warn' ? '!' : '✗';
}

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description(
      'Preflight checks for sandbox / code_run host requirements (docker, runsc, userns-remap, secrets).',
    )
    .action(async () => {
      const env = process.env;
      const checks: Check[] = [
        checkDocker(),
        checkSocket(),
        checkRunsc(),
        checkUserns(),
        checkApparmor(),
        checkSandboxToken(env),
      ];

      let failed = 0;
      let warned = 0;
      for (const c of checks) {
        const icon = statusIcon(c.status);
        const line = `${icon} ${c.name.padEnd(28)} ${c.detail}`;
        if (c.status === 'ok') logger.info(line);
        else if (c.status === 'warn') {
          logger.warn(line);
          warned += 1;
        } else {
          logger.error(line);
          failed += 1;
        }
        if (c.status !== 'ok' && c.fix) {
          logger.info(`  fix: ${c.fix}`);
        }
      }

      logger.blank();
      if (failed > 0) {
        logger.error(`${failed} check(s) failed; sandbox will not work.`);
        process.exit(1);
      }
      if (warned > 0) {
        logger.warn(
          `${warned} recommendation(s); sandbox will function but is using weaker defaults.`,
        );
        process.exit(0);
      }
      logger.success('All sandbox preflight checks passed.');
    });
}
