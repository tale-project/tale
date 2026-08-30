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

/** Build a deps object where the runtime is healthy and every port is free.
 *  Individual tests override one field to exercise a failure. */
function passingDeps(overrides: Partial<SetupCheckDeps> = {}): SetupCheckDeps {
  return {
    bunVersion: '1.3.10',
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

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(allHardChecksPassed(results)).toBe(true);
    // No remediation is offered when a check passes.
    expect(results.every((r) => r.remediation === undefined)).toBe(true);
  });

  it('fails a port check when the port is busy', async () => {
    const results = await runSetupChecks(
      passingDeps({
        // The backend's 3005 is taken; the app's 3000 is free.
        portInUse: async (port) => port === 3005,
      }),
    );

    const backendPort = find(results, '3005');
    expect(backendPort.ok).toBe(false);
    expect(backendPort.detail).toBe('in use');
    expect(backendPort.remediation).toContain('lsof');

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
});
