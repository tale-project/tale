import { describe, expect, test } from 'bun:test';

import {
  type DockerEnvProbe,
  type DockerPlatform,
  type InstallStrategyKind,
  planDockerInstall,
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
