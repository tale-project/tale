// Which backends the loader makes for each kind. (The Kubernetes pair is made
// by the import-footprint test, which reaches no cluster.)

import { describe, expect, test } from 'bun:test';

import { DockerBackend } from './docker/docker-backend.ts';
import { DockerSessionBackend } from './docker/docker-session-backend.ts';
import { IncusBackend } from './incus/incus-backend.ts';
import { IncusSessionBackend } from './incus/incus-session-backend.ts';
import { incusTestConfig } from './incus/incus-test-config.ts';
import { loadBackends } from './index.ts';

describe('loadBackends', () => {
  test('makes the Incus pair for the incus backend', async () => {
    const backends = await loadBackends(incusTestConfig());
    expect(backends.host).toBeInstanceOf(IncusBackend);
    expect(backends.host.kind).toBe('incus');
    const session = backends.createSession();
    expect(session).toBeInstanceOf(IncusSessionBackend);
    expect(session.kind).toBe('incus');
  });

  test('makes the Docker pair for the docker backend', async () => {
    const backends = await loadBackends({
      ...incusTestConfig(),
      backend: 'docker',
    });
    expect(backends.host).toBeInstanceOf(DockerBackend);
    expect(backends.createSession()).toBeInstanceOf(DockerSessionBackend);
  });

  test('the two Incus backends share one runtime: one client, one pool', async () => {
    const cfg = incusTestConfig();
    const backends = await loadBackends(cfg);
    // Made apart, met in the config's runtime.
    expect(backends.host.kind).toBe(backends.createSession().kind);
  });
});
