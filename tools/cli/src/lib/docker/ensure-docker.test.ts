import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  type DockerEnvProbe,
  type DockerPlatform,
  type InstallStrategyKind,
  planDockerInstall,
  runGetDockerScript,
  ensureDocker,
} from './ensure-docker';

function probe(
  overrides: Partial<DockerEnvProbe> & { platform: DockerPlatform },
): DockerEnvProbe {
  return {
    hasBrew: false,
    hasWinget: false,
    hasCurl: false,
    hasWget: false,
    hasWsl: false,
    packageManager: null,
    ...overrides,
  };
}

function kinds(p: DockerEnvProbe): InstallStrategyKind[] {
  return planDockerInstall(p).strategies.map((s) => s.kind);
}

describe('planDockerInstall — macOS', () => {
  test('with Homebrew: brew → dmg → manual, no Homebrew bootstrap step', () => {
    const plan = planDockerInstall(probe({ platform: 'macos', hasBrew: true }));
    expect(plan.strategies.map((s) => s.kind)).toEqual([
      'brew',
      'dmg',
      'manual',
    ]);
    const brew = plan.strategies[0];
    expect(brew.steps.some((s) => /Install Homebrew/i.test(s))).toBe(false);
    expect(brew.steps).toContain('brew install --cask docker');
  });

  test('without Homebrew: brew strategy installs Homebrew first, dmg fallback present', () => {
    const plan = planDockerInstall(
      probe({ platform: 'macos', hasBrew: false }),
    );
    expect(plan.strategies.map((s) => s.kind)).toEqual([
      'brew',
      'dmg',
      'manual',
    ]);
    expect(
      plan.strategies[0].steps.some((s) => /Install Homebrew/i.test(s)),
    ).toBe(true);
  });
});

describe('planDockerInstall — Windows', () => {
  test('with winget: winget → desktop-exe → manual, confirms existing WSL2', () => {
    const plan = planDockerInstall(
      probe({ platform: 'windows', hasWinget: true, hasWsl: true }),
    );
    expect(plan.strategies.map((s) => s.kind)).toEqual([
      'winget',
      'desktop-exe',
      'manual',
    ]);
    expect(
      plan.strategies[0].steps.some((s) => /Confirm the WSL2 backend/i.test(s)),
    ).toBe(true);
  });

  test('without winget: falls back to official installer + enables WSL2', () => {
    const plan = planDockerInstall(
      probe({ platform: 'windows', hasWinget: false, hasWsl: false }),
    );
    expect(plan.strategies.map((s) => s.kind)).toEqual([
      'desktop-exe',
      'manual',
    ]);
    expect(
      plan.strategies[0].steps.some((s) => /Enable the WSL2 backend/i.test(s)),
    ).toBe(true);
  });
});

describe('planDockerInstall — Linux', () => {
  test('with curl: get-docker → manual', () => {
    expect(kinds(probe({ platform: 'linux', hasCurl: true }))).toEqual([
      'get-docker',
      'manual',
    ]);
  });

  test('with wget only: still get-docker → manual', () => {
    expect(kinds(probe({ platform: 'linux', hasWget: true }))).toEqual([
      'get-docker',
      'manual',
    ]);
  });

  test('no downloader but a package manager: bootstraps curl, then get-docker', () => {
    const plan = planDockerInstall(
      probe({ platform: 'linux', packageManager: 'apt' }),
    );
    expect(plan.strategies.map((s) => s.kind)).toEqual([
      'get-docker',
      'manual',
    ]);
    expect(
      plan.strategies[0].steps.some((s) => /Install curl via apt/i.test(s)),
    ).toBe(true);
  });

  test('no downloader and no package manager: manual only', () => {
    expect(kinds(probe({ platform: 'linux' }))).toEqual(['manual']);
  });
});

describe('planDockerInstall — invariants', () => {
  test('every plan ends in a manual fallback (never a dead end)', () => {
    const probes: DockerEnvProbe[] = [
      probe({ platform: 'macos' }),
      probe({ platform: 'macos', hasBrew: true }),
      probe({ platform: 'windows' }),
      probe({ platform: 'windows', hasWinget: true }),
      probe({ platform: 'linux' }),
      probe({ platform: 'linux', hasCurl: true }),
      probe({ platform: 'linux', packageManager: 'dnf' }),
    ];
    for (const p of probes) {
      const strategies = planDockerInstall(p).strategies;
      expect(strategies.at(-1)?.kind).toBe('manual');
      expect(strategies.length).toBeGreaterThan(0);
    }
  });
});

function linuxRunner(
  overrides: { failCommand?: string; isRoot?: boolean } = {},
) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    deps: {
      exec: async (command: string, args: string[]) => {
        calls.push({ command, args });
        const failed = command === overrides.failCommand;
        return {
          success: !failed,
          exitCode: failed ? 17 : 0,
          stdout: '',
          stderr: failed ? 'fixture failure' : '',
        };
      },
      commandExists: async (command: string) => command === 'systemctl',
      isRoot: overrides.isRoot ?? false,
    },
  };
}

describe('Linux Docker installation runner', () => {
  test('downloads with wget on wget-only hosts, then executes and cleans the script', async () => {
    const runner = linuxRunner();
    await runGetDockerScript(
      probe({ platform: 'linux', hasWget: true }),
      runner.deps,
    );
    expect(runner.calls.map(({ command }) => command)).toEqual([
      'wget',
      'sudo',
      'sudo',
    ]);
    const script = runner.calls[0].args.at(-1)!;
    expect(runner.calls[1].args).toEqual(['sh', script]);
    expect(runner.calls[2].args).toEqual([
      'systemctl',
      'enable',
      '--now',
      'docker',
    ]);
    expect(existsSync(dirname(script))).toBe(false);
  });

  test('never executes a script when its download fails and cleans the temporary directory', async () => {
    const runner = linuxRunner({ failCommand: 'curl' });
    await expect(
      runGetDockerScript(
        probe({ platform: 'linux', hasCurl: true }),
        runner.deps,
      ),
    ).rejects.toThrow('curl failed (exit 17)');
    expect(runner.calls.map(({ command }) => command)).toEqual(['curl']);
    expect(existsSync(dirname(runner.calls[0].args.at(-1)!))).toBe(false);
  });

  for (const [packageManager, command] of [
    ['apt', 'apt-get'],
    ['dnf', 'dnf'],
    ['pacman', 'pacman'],
    ['zypper', 'zypper'],
  ] as const) {
    test(`bootstraps curl with ${packageManager} before downloading`, async () => {
      const runner = linuxRunner();
      await runGetDockerScript(
        probe({ platform: 'linux', packageManager }),
        runner.deps,
      );
      const curlIndex = runner.calls.findIndex(
        (call) => call.command === 'curl',
      );
      const installIndex = runner.calls.findIndex(
        (call) =>
          call.command === 'sudo' &&
          call.args[0] === command &&
          call.args.includes('curl'),
      );
      expect(installIndex).toBeGreaterThanOrEqual(0);
      expect(installIndex).toBeLessThan(curlIndex);
      expect(runner.calls[installIndex].args).toContain('ca-certificates');
    });
  }

  test('stops before download when installing the downloader fails', async () => {
    const runner = linuxRunner({ failCommand: 'sudo' });
    await expect(
      runGetDockerScript(
        probe({ platform: 'linux', packageManager: 'apt' }),
        runner.deps,
      ),
    ).rejects.toThrow('sudo failed');
    expect(runner.calls).toEqual([
      { command: 'sudo', args: ['apt-get', 'update'] },
    ]);
  });

  test('root does not need sudo and a failed installer never starts the service', async () => {
    const runner = linuxRunner({ isRoot: true, failCommand: 'sh' });
    await expect(
      runGetDockerScript(
        probe({ platform: 'linux', hasCurl: true }),
        runner.deps,
      ),
    ).rejects.toThrow('sh failed');
    expect(runner.calls.map(({ command }) => command)).toEqual(['curl', 'sh']);
  });
});

describe('Linux Docker socket access recovery', () => {
  const refused = {
    cliPresent: true,
    daemonReachable: false,
    detail:
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
  };

  test('an existing installation with denied socket access returns recovery without restarting or reinstalling', async () => {
    const result = await ensureDocker(
      { interactive: false },
      {
        platform: 'linux',
        detectDockerState: async () => refused,
        runStrategy: async () => {
          throw new Error('must not install');
        },
      },
    );
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('sign out and back in');
    expect(result.detail).toContain('newgrp docker');
    expect(result.detail).toContain('docker info');
    expect(result.detail).toContain(
      'https://docs.docker.com/engine/install/linux-postinstall/',
    );
  });

  test('a fresh installation blocked by group permissions keeps the specific recovery instead of claiming install failure', async () => {
    let probes = 0;
    const strategies: InstallStrategyKind[] = [];
    const result = await ensureDocker(
      { interactive: false, assumeYes: true },
      {
        platform: 'linux',
        detectDockerState: async () =>
          ++probes === 1
            ? {
                cliPresent: false,
                daemonReachable: false,
                detail: 'not installed',
              }
            : refused,
        probeDockerEnv: async () => probe({ platform: 'linux', hasCurl: true }),
        runStrategy: async (strategy) => {
          strategies.push(strategy.kind);
          return false;
        },
      },
    );
    expect(result.status).toBe('failed');
    expect(result.detail).toContain('this session cannot access its socket');
    expect(strategies).toEqual(['get-docker']);
  });
});
