import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SESSION_PROFILE,
  SESSION_MAX_FILE_BYTES_CEILING,
  sessionDockerCapability,
  sessionLimits,
} from './session-profile.ts';
import { TEST_SESSION_CONFIG } from './session-test-config.ts';

const enabled = { dockerInContainer: true };

describe('workload Docker capability', () => {
  test('legacy requests inherit the deployment and an opt-out cannot elevate it', () => {
    expect(sessionDockerCapability(enabled, 'agent')).toBe(true);
    expect(sessionDockerCapability(enabled, 'agent', 'workflow', false)).toBe(
      false,
    );
    expect(
      sessionDockerCapability(
        { dockerInContainer: false },
        'agent',
        'project',
        true,
      ),
    ).toBe(false);
    expect(sessionDockerCapability(enabled, 'default', 'project', true)).toBe(
      false,
    );
  });

  test('restricted deployments refuse omitted workloads and explicit escalation', () => {
    const restricted = { ...enabled, dockerWorkloads: ['project'] as const };
    expect(sessionDockerCapability(restricted, 'agent', 'project')).toBe(true);
    expect(sessionDockerCapability(restricted, 'agent', 'workflow', true)).toBe(
      false,
    );
    expect(sessionDockerCapability(restricted, 'agent', undefined, true)).toBe(
      false,
    );
    expect(
      sessionDockerCapability(
        { ...enabled, dockerWorkloads: [] },
        'agent',
        'project',
        true,
      ),
    ).toBe(false);
  });
});

describe("a session's limits", () => {
  const cfg = { session: TEST_SESSION_CONFIG };
  const GIB = 1024 * 1024 * 1024;

  test("a default session keeps its profile's own unless its creator asks for a file size", () => {
    expect(sessionLimits(cfg, 'default', false)).toBe(DEFAULT_SESSION_PROFILE);
    expect(sessionLimits(cfg, 'default', false, GIB)).toEqual({
      ...DEFAULT_SESSION_PROFILE,
      fsizeBytes: GIB,
    });
    // Nothing else of the profile moves with it.
    expect(DEFAULT_SESSION_PROFILE.fsizeBytes).toBe(100 * 1024 * 1024);
  });

  test("an agent session keeps the deployment's configured cap whatever is asked", () => {
    for (const profile of ['agent', 'agent-light'] as const) {
      expect(sessionLimits(cfg, profile, false, GIB).fsizeBytes).toBe(
        TEST_SESSION_CONFIG.agentProfile.fsizeBytes,
      );
    }
  });

  test("the most a creator may ask is the platform's largest media upload", () => {
    expect(SESSION_MAX_FILE_BYTES_CEILING).toBe(2 * GIB);
  });
});
