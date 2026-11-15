// Which backends the loader makes for each kind. (The Kubernetes pair is made
// by the import-footprint test, which reaches no cluster.)

import { describe, expect, test } from 'bun:test';

import { DockerBackend } from './docker/docker-backend.ts';
import { DockerSessionBackend } from './docker/docker-session-backend.ts';
import { IncusBackend } from './incus/incus-backend.ts';
import { endpointView } from './incus/incus-endpoints.ts';
import {
  getIncusEndpointSet,
  MultiIncusBackend,
  MultiIncusSessionBackend,
} from './incus/incus-multi-backend.ts';
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

  test('makes the multi-host pair for SANDBOX_INCUS_ENDPOINTS, one pair of backends per host', async () => {
    const base = incusTestConfig();
    const host = (name: string) => ({
      name,
      endpoint: `https://${name}:8443`,
      clientCertFile: `/run/incus/${name}/client.crt`,
      clientKeyFile: `/run/incus/${name}/client.key`,
      serverCertFile: `/run/incus/${name}/server.crt`,
      project: 'sandbox-pr',
      profile: 'sandbox',
      network: 'sbx0',
      storagePool: 'tank',
      image: 'tale-sandbox-runtime',
      maxSessions: 5,
      poolSize: 0,
      egressProxy: base.egressProxy,
      dns: ['10.9.0.2'],
      drained: false,
    });
    const cfg = incusTestConfig({
      endpoints: [host('node-1'), host('node-2')],
      stateDir: '/var/lib/tale-sandbox/incus',
    });
    const backends = await loadBackends(cfg);
    expect(backends.host).toBeInstanceOf(MultiIncusBackend);
    expect(backends.createSession()).toBeInstanceOf(MultiIncusSessionBackend);
    const set = getIncusEndpointSet(cfg);
    expect(set.endpoints.map((e) => e.name)).toEqual(['node-1', 'node-2']);
    // Nothing is read or written before init: made, the set touches no disk.
    expect(set.recordComplete).toBe(false);
    for (const endpoint of set.endpoints) {
      expect(endpoint.host).toBeInstanceOf(IncusBackend);
      expect(endpoint.session).toBeInstanceOf(IncusSessionBackend);
    }
    // Each host's view is its own: its connection, its cap, no list.
    const view = endpointView(cfg, host('node-2'));
    expect(view.incus?.endpoint).toBe('https://node-2:8443');
    expect(view.incus?.endpointName).toBe('node-2');
    expect(view.incus?.endpoints).toBeUndefined();
    expect(view.session.maxSessions).toBe(5);
  });

  test('the two Incus backends share one runtime: one client, one pool', async () => {
    const cfg = incusTestConfig();
    const backends = await loadBackends(cfg);
    // Made apart, met in the config's runtime.
    expect(backends.host.kind).toBe(backends.createSession().kind);
  });
});
