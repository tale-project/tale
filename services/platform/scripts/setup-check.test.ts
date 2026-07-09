import { describe, expect, it } from 'vitest';

import {
  allHardChecksPassed,
  parseSemver,
  runSetupChecks,
  type SetupCheckDeps,
} from './setup-check';

/**
 * Unit tests for the pure pre-flight check core. Every probe is injected, so
 * these tests never touch the network, spawn a process, or read the runtime
 * version — the fakes below stand in for the real implementations wired up in
 * `main()`. No `mock.module`; the seam is the `SetupCheckDeps` parameter.
 */

/** Build a deps object where every tool reports a healthy version and every
 *  port is free. Individual tests override one field to exercise a failure. */
function passingDeps(overrides: Partial<SetupCheckDeps> = {}): SetupCheckDeps {
  return {
    bunVersion: '1.3.10',
    commandVersion: async (cmd) => {
      if (cmd === 'bunx') return 'convex 1.17.0';
      return null;
    },
    portInUse: async () => false,
    ...overrides,
  };
}

function find(results: Awaited<ReturnType<typeof runSetupChecks>>, q: string) {
  const hit = results.find((r) => r.name.includes(q));
  if (!hit) throw new Error(`no check matching "${q}" in results`);
  return hit;
}

describe('parseSemver', () => {
  it('pulls the version out of typical tool output', () => {
    expect(parseSemver('Python 3.12.4')).toEqual({
      major: 3,
      minor: 12,
      patch: 4,
    });
    expect(parseSemver('1.3.10')).toEqual({ major: 1, minor: 3, patch: 10 });
    expect(parseSemver('uv 0.5')).toEqual({ major: 0, minor: 5, patch: 0 });
  });

  it('returns null when nothing parses', () => {
    expect(parseSemver(null)).toBeNull();
    expect(parseSemver('no digits here')).toBeNull();
  });
});

describe('runSetupChecks', () => {
  it('passes every check when all tools are present and ports are free', async () => {
    const results = await runSetupChecks(passingDeps());

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(allHardChecksPassed(results)).toBe(true);
    // No remediation is offered when a check passes.
    expect(results.every((r) => r.remediation === undefined)).toBe(true);
  });

  it('fails the matching check when a tool is missing', async () => {
    const results = await runSetupChecks(
      passingDeps({
        // The Convex CLI is unreachable; every other probe still passes.
        commandVersion: async () => null,
      }),
    );

    const convexCli = find(results, 'Convex CLI');
    expect(convexCli.ok).toBe(false);
    expect(convexCli.hard).toBe(true);
    expect(convexCli.remediation).toContain('bun install');

    // The missing tool is the only failure; everything else still passes.
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(allHardChecksPassed(results)).toBe(false);
  });

  it('fails a port check when the port is busy', async () => {
    const results = await runSetupChecks(
      passingDeps({
        // Convex's 3210 is taken; the app's 3000 is free.
        portInUse: async (port) => port === 3210,
      }),
    );

    const convexPort = find(results, '3210');
    expect(convexPort.ok).toBe(false);
    expect(convexPort.detail).toBe('in use');
    expect(convexPort.remediation).toContain('lsof');

    const appPort = find(results, '3000');
    expect(appPort.ok).toBe(true);

    expect(allHardChecksPassed(results)).toBe(false);
  });

  it('fails Bun when the version is below 1.3', async () => {
    const results = await runSetupChecks(passingDeps({ bunVersion: '1.2.9' }));

    const bun = find(results, 'Bun');
    expect(bun.ok).toBe(false);
    expect(bun.remediation).toContain('bun upgrade');
    expect(allHardChecksPassed(results)).toBe(false);
  });

  it('warns when local Convex module storage is bloated', async () => {
    const results = await runSetupChecks(
      passingDeps({
        convexModuleStats: () => ({
          count: 5_000,
          totalBytes: 10 * 1024 ** 3,
        }),
      }),
    );

    const modules = find(results, 'Convex module storage');
    expect(modules.ok).toBe(false);
    expect(modules.hard).toBe(false);
    expect(modules.remediation).toContain('contributor-setup');
    expect(allHardChecksPassed(results)).toBe(true);
  });
});
