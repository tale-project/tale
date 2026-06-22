import { describe, expect, test } from 'bun:test';

import { parse } from 'yaml';

import { setProjectId } from '../../project/project-context';
import { generateSandboxColorCompose } from './generate-sandbox-color-compose';

// getProjectId() is used for container_name / volume / network names.
setProjectId('tale');

const config = { version: '0.9.0', registry: 'ghcr.io/tale-project/tale' };

interface ParsedService {
  container_name?: string;
  environment?: Record<string, string>;
  depends_on?: Record<string, unknown>;
}
interface ParsedCompose {
  services: Record<string, ParsedService>;
  networks: Record<string, { name?: string }>;
}

describe('generateSandboxColorCompose', () => {
  test('emits colour-suffixed spawner + egress on the shared sandbox net', () => {
    const parsed = parse(
      generateSandboxColorCompose(config, 'green'),
    ) as ParsedCompose;

    // Colour-suffixed service keys (these become the Docker DNS aliases).
    expect(Object.keys(parsed.services).sort()).toEqual([
      'sandbox-egress-green',
      'sandbox-green',
    ]);

    const spawner = parsed.services['sandbox-green'];
    expect(spawner.container_name).toBe('tale-sandbox-green');
    // Spawner targets its OWN colour's egress + advertises its colour.
    expect(spawner.environment?.SANDBOX_EGRESS_PROXY).toBe(
      'http://sandbox-egress-green:3128',
    );
    expect(spawner.environment?.SANDBOX_COLOR).toBe('green');
    expect(spawner.environment?.SANDBOX_EGRESS_NETWORK).toBe(
      'tale-sandbox-net',
    );
    // depends_on points at the colour's egress, not the bare name.
    expect(Object.keys(spawner.depends_on ?? {})).toEqual([
      'sandbox-egress-green',
    ]);

    expect(parsed.services['sandbox-egress-green'].container_name).toBe(
      'tale-sandbox-egress-green',
    );

    // Shared sandbox network (not per-colour) so bifrost/convex stay single-homed.
    expect(parsed.networks.sandbox.name).toBe('tale-sandbox-net');
    expect(parsed.networks.internal.name).toBe('tale_internal');
  });

  test('blue and green generate distinct, non-colliding names', () => {
    const blue = parse(
      generateSandboxColorCompose(config, 'blue'),
    ) as ParsedCompose;
    const green = parse(
      generateSandboxColorCompose(config, 'green'),
    ) as ParsedCompose;
    expect(blue.services['sandbox-blue'].container_name).toBe(
      'tale-sandbox-blue',
    );
    expect(green.services['sandbox-green'].container_name).toBe(
      'tale-sandbox-green',
    );
    expect(
      blue.services['sandbox-blue'].environment?.SANDBOX_EGRESS_PROXY,
    ).toBe('http://sandbox-egress-blue:3128');
  });
});
