import { describe, expect, test } from 'bun:test';

import { sessionDockerCapability } from './session-profile.ts';

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
