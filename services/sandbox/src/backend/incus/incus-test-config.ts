// A spawner config that selected the Incus backend, for unit tests. Mirrors
// what loadConfig() produces for a minimal Incus deployment; not used by
// production code.

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { IncusConfig, SpawnerConfig } from '../../types.ts';

export const INCUS_TEST_ADDRESS = '10.9.0.2';

export const INCUS_TEST_DEFAULTS: IncusConfig = {
  endpoint: 'https://incus.test:8443',
  project: 'sandbox-pr',
  profile: 'sandbox',
  network: 'sbx0',
  storagePool: 'tank',
  image: 'tale-sandbox-runtime',
  clientCertFile: '/run/incus/client.crt',
  clientKeyFile: '/run/incus/client.key',
  serverCertFile: '/run/incus/server.crt',
  poolSize: 0,
  workspaceSize: '10GiB',
  shmDevice: true,
  dns: [INCUS_TEST_ADDRESS],
  dockerConfig: {
    'security.nesting': 'true',
    'security.syscalls.intercept.mknod': 'true',
    'security.syscalls.intercept.setxattr': 'true',
  },
  allowUnfilteredNetwork: false,
  apiTimeoutMs: 15_000,
};

export function incusTestConfig(
  incus: Partial<IncusConfig> = {},
  overrides: Partial<SpawnerConfig> = {},
): SpawnerConfig {
  return {
    instance: '',
    hub: null,
    deviceConfigPath: null,
    backend: 'incus',
    port: 8003,
    sandboxToken: 'incus-test-token',
    runtimeImage: 'tale-sandbox-runtime:test',
    // The Incus backend's tier: an unprivileged, idmap-isolated container.
    runtimeTier: 'sysbox',
    dockerInContainer: false,
    dockerBuildCache: false,
    buildkitdImage: 'tale-sandbox-buildkitd:test',
    buildkitdMirrorImage: 'registry:2',
    transparentEgress: true,
    k8s: {
      namespace: 'tale-sandbox',
      runtimeClassName: null,
      workspaceSizeLimit: '4Gi',
    },
    incus: { ...INCUS_TEST_DEFAULTS, ...incus },
    maxTimeoutMs: 300_000,
    hostSessionRoot: '/var/lib/tale-sandbox/sessions',
    cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
    egressNetwork: 'tale-sandbox-net',
    egressProxy: `http://${INCUS_TEST_ADDRESS}:3128`,
    stdoutMaxBytes: 5_242_880,
    stderrMaxBytes: 5_242_880,
    maxRequestBodyBytes: 262_144,
    session: { ...TEST_SESSION_CONFIG, createHealthTimeoutMs: 5_000 },
    ...overrides,
  };
}

/** What loadConfig makes of a deployment that allows Docker inside: the
 * agent profile gets the bigger memory, and keeps 4g for a session without. */
export function dockerCapableOverrides(): Partial<SpawnerConfig> {
  return {
    dockerInContainer: true,
    session: {
      ...TEST_SESSION_CONFIG,
      agentProfile: {
        ...TEST_SESSION_CONFIG.agentProfile,
        memory: '8g',
        memoryWithoutDocker: '4g',
      },
    },
  };
}
