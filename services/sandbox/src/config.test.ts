import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from './config.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './session/runnerd-protocol.ts';

// loadConfig reads these from process.env; snapshot + restore so tests don't
// leak into each other or the runner's environment.
const KEYS = [
  'SANDBOX_RUNTIME',
  'SANDBOX_DOCKER_IN_CONTAINER',
  'SANDBOX_DOCKER_WORKLOADS',
  'SANDBOX_DOCKER_BUILD_CACHE',
  'SANDBOX_DIND_INNER_POOL',
  'SANDBOX_BUILDKITD_IMAGE',
  'SANDBOX_RUNTIME_CLASS',
  'SANDBOX_BACKEND',
  'SANDBOX_AGENT_MEMORY',
  'SANDBOX_AGENT_CPU_SHARES',
  'SANDBOX_HOST_SESSION_ROOT',
  'SANDBOX_DOCKER_DATA_ROOT',
  'SANDBOX_DOCKER_DATA_PATH',
  'SANDBOX_TOKEN',
  'SANDBOX_MAX_REQUEST_BODY_BYTES',
  'SANDBOX_MAX_SESSIONS',
  'SANDBOX_MAX_SESSIONS_PER_ORG',
  'SANDBOX_K8S_CPU_REQUEST',
  'SANDBOX_K8S_MEMORY_REQUEST',
  'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT',
  'SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST',
  'SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT',
  'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT',
  'SANDBOX_K8S_NODE_SELECTOR',
  'SANDBOX_K8S_TOLERATIONS',
  'SANDBOX_K8S_PRIORITY_CLASS',
  'SANDBOX_BUILDKITD_CPUS',
  'SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS',
  'SANDBOX_BUILDKITD_MEMORY',
  'SANDBOX_BUILDKITD_IDLE_CACHE',
  'SANDBOX_BUILDKITD_CACHE_RETENTION',
  'SANDBOX_BUILDKITD_IDLE_MS',
  'SANDBOX_BUILDKITD_MAX_CACHE',
  'SANDBOX_PACKAGE_CACHE_RETENTION',
  'SANDBOX_MIN_FREE_DISK',
  'SANDBOX_CRITICAL_FREE_DISK',
  'SANDBOX_CPU_PRESSURE_PERCENT',
  'SANDBOX_EXEC_STALL_MINUTES',
  'TALE_PLATFORM_SHARED_CONFIG_DIR',
] as const;

let saved: Record<string, string | undefined>;
let cfgDir: string;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Point the deployment-config dir at a fresh empty temp dir so tests don't
  // read a real /app/platform-config and default cleanly to env (no file).
  cfgDir = mkdtempSync(join(tmpdir(), 'tale-cfg-'));
  process.env.TALE_PLATFORM_SHARED_CONFIG_DIR = cfgDir;
  // loadConfig fails closed without the shared HMAC secret (server.test.ts
  // covers that policy); these tests are about every other knob.
  process.env.SANDBOX_TOKEN = 'test-token';
});

afterEach(() => {
  rmSync(cfgDir, { recursive: true, force: true });
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function writeDeployment(obj: unknown): void {
  writeFileSync(join(cfgDir, 'deployment.json'), JSON.stringify(obj));
}

test('deployment session capacity is the only runtime cap', () => {
  expect(loadConfig().session.maxSessions).toBe(8);
  process.env.SANDBOX_MAX_SESSIONS = '24';
  // A stale env entry from an older deployment cannot impose a hidden cap.
  process.env.SANDBOX_MAX_SESSIONS_PER_ORG = '1';
  const config = loadConfig();
  expect(config.session.maxSessions).toBe(24);
  expect(config.session).not.toHaveProperty('maxSessionsPerOrg');
});

test('session Pod requests: absent by default, read as Kubernetes quantities, refused when malformed', () => {
  expect(loadConfig().k8s).not.toHaveProperty('cpuRequest');
  expect(loadConfig().k8s).not.toHaveProperty('memoryRequest');
  process.env.SANDBOX_K8S_CPU_REQUEST = ' 300m ';
  process.env.SANDBOX_K8S_MEMORY_REQUEST = '768Mi';
  expect(loadConfig().k8s).toMatchObject({
    cpuRequest: '300m',
    memoryRequest: '768Mi',
  });
  process.env.SANDBOX_K8S_MEMORY_REQUEST = '768 MB';
  expect(() => loadConfig()).toThrow(/SANDBOX_K8S_MEMORY_REQUEST/);
  process.env.SANDBOX_K8S_MEMORY_REQUEST = '768Mi';
  process.env.SANDBOX_K8S_CPU_REQUEST = 'half';
  expect(() => loadConfig()).toThrow(/SANDBOX_K8S_CPU_REQUEST/);
});

test('session Pod disk bounds: pod-spec defaults unless set, refused when malformed or zero', () => {
  const k8s = loadConfig().k8s;
  expect(k8s.workspaceSizeLimit).toBe('4Gi');
  expect(k8s).not.toHaveProperty('ephemeralStorageRequest');
  expect(k8s).not.toHaveProperty('ephemeralStorageLimit');
  expect(k8s).not.toHaveProperty('dockerStorageSizeLimit');
  process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT = ' ';
  expect(loadConfig().k8s.workspaceSizeLimit).toBe('4Gi');
  process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT = '8Gi';
  process.env.SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST = '0';
  process.env.SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT = ' 3Gi ';
  process.env.SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT = '40Gi';
  expect(loadConfig().k8s).toMatchObject({
    workspaceSizeLimit: '8Gi',
    ephemeralStorageRequest: '0',
    ephemeralStorageLimit: '3Gi',
    dockerStorageSizeLimit: '40Gi',
  });
  // Refused at boot by the backend that reads them.
  process.env.SANDBOX_BACKEND = 'kubernetes';
  for (const name of [
    'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT',
    'SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST',
    'SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT',
    'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT',
  ]) {
    const kept = process.env[name];
    process.env[name] = '20 GB';
    expect(() => loadConfig()).toThrow(name);
    process.env[name] = kept;
  }
  // A zero limit or store size would evict the Pod on its first write.
  for (const name of [
    'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT',
    'SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT',
    'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT',
  ]) {
    const kept = process.env[name];
    process.env[name] = '0Gi';
    expect(() => loadConfig()).toThrow(`${name} must be above zero`);
    process.env[name] = kept;
  }
});

test('a workspace size set alone warns that it does not size the inner Docker store', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  const storeWarnings = () =>
    warn.mock.calls.filter((call) =>
      String(call[0]).includes(
        'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT no longer sizes the inner Docker store',
      ),
    );
  try {
    process.env.SANDBOX_BACKEND = 'kubernetes';
    process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT = '2Gi';
    // Docker inside on by default (sysbox) or by choice (runc).
    process.env.SANDBOX_RUNTIME = 'sysbox';
    loadConfig();
    process.env.SANDBOX_RUNTIME = 'runc';
    process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
    loadConfig();
    expect(storeWarnings()).toHaveLength(2);
    expect(String(storeWarnings()[0]?.[0])).toContain(
      'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT does (default 20Gi)',
    );
    // Quiet when the store is sized, no session can run Docker inside, the
    // backend is Docker, or the workspace size is left alone.
    for (const [name, value] of [
      ['SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT', '8Gi'],
      ['SANDBOX_DOCKER_IN_CONTAINER', 'false'],
      ['SANDBOX_DOCKER_WORKLOADS', 'none'],
      ['SANDBOX_BACKEND', 'docker'],
      ['SANDBOX_K8S_WORKSPACE_SIZE_LIMIT', ' '],
    ] as const) {
      const kept = process.env[name];
      process.env[name] = value;
      loadConfig();
      expect(storeWarnings(), `${name}=${value}`).toHaveLength(2);
      if (kept === undefined) delete process.env[name];
      else process.env[name] = kept;
    }
  } finally {
    warn.mockRestore();
  }
});

test('session Pod placement: absent by default, read from JSON, refused with a clear error', () => {
  const k8s = loadConfig().k8s;
  expect(k8s).not.toHaveProperty('nodeSelector');
  expect(k8s).not.toHaveProperty('tolerations');
  expect(k8s).not.toHaveProperty('priorityClassName');
  process.env.SANDBOX_K8S_NODE_SELECTOR =
    ' {"tale.dev/sandbox":"true","pool":"sandbox-1"} ';
  process.env.SANDBOX_K8S_TOLERATIONS = JSON.stringify([
    { key: 'tale.dev/sandbox', operator: 'Exists', effect: 'NoSchedule' },
    {
      key: 'pool',
      value: 'sandbox',
      effect: 'NoExecute',
      tolerationSeconds: 60,
    },
    { operator: 'Exists' },
  ]);
  process.env.SANDBOX_K8S_PRIORITY_CLASS = ' tale-sandbox-session ';
  expect(loadConfig().k8s).toMatchObject({
    nodeSelector: { 'tale.dev/sandbox': 'true', pool: 'sandbox-1' },
    tolerations: [
      { key: 'tale.dev/sandbox', operator: 'Exists', effect: 'NoSchedule' },
      {
        key: 'pool',
        value: 'sandbox',
        effect: 'NoExecute',
        tolerationSeconds: 60,
      },
      { operator: 'Exists' },
    ],
    priorityClassName: 'tale-sandbox-session',
  });
  // An empty operator reads as Equal and an empty effect as every effect,
  // the apiserver's own reading, so manifests that spell them out still boot.
  process.env.SANDBOX_K8S_TOLERATIONS = JSON.stringify([
    { key: 'pool', operator: '', value: 'sandbox', effect: '' },
  ]);
  expect(loadConfig().k8s.tolerations).toEqual([
    { key: 'pool', value: 'sandbox' },
  ]);
  // An empty object or array places nothing.
  process.env.SANDBOX_K8S_NODE_SELECTOR = '{}';
  process.env.SANDBOX_K8S_TOLERATIONS = '[]';
  expect(loadConfig().k8s).not.toHaveProperty('nodeSelector');
  expect(loadConfig().k8s).not.toHaveProperty('tolerations');
  delete process.env.SANDBOX_K8S_TOLERATIONS;

  const refused: [string, string, RegExp][] = [
    ['SANDBOX_K8S_NODE_SELECTOR', 'tale.dev/sandbox=true', /not valid JSON/],
    ['SANDBOX_K8S_NODE_SELECTOR', '["sandbox"]', /JSON object of node labels/],
    ['SANDBOX_K8S_NODE_SELECTOR', '{"bad key":"x"}', /no Kubernetes label key/],
    ['SANDBOX_K8S_NODE_SELECTOR', '{"a/b/c":"x"}', /no Kubernetes label key/],
    ['SANDBOX_K8S_NODE_SELECTOR', '{"pool":true}', /no Kubernetes label value/],
    ['SANDBOX_K8S_TOLERATIONS', '{"key":"pool"}', /JSON array of tolerations/],
    ['SANDBOX_K8S_TOLERATIONS', '["pool"]', /\[0\] must be a JSON object/],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","efect":"NoSchedule"}]',
      /unknown field efect/,
    ],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","operator":"In"}]',
      /Equal or Exists/,
    ],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","effect":"NoRun"}]',
      /effect must be/,
    ],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","operator":"Exists","value":"x"}]',
      /takes no value/,
    ],
    ['SANDBOX_K8S_TOLERATIONS', '[{"value":"x"}]', /needs operator Exists/],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","effect":"NoSchedule","tolerationSeconds":60}]',
      /only to effect NoExecute/,
    ],
    [
      'SANDBOX_K8S_TOLERATIONS',
      '[{"key":"pool","effect":"NoExecute","tolerationSeconds":1.5}]',
      /whole number of seconds/,
    ],
    ['SANDBOX_K8S_PRIORITY_CLASS', 'Tale_Sessions', /not a PriorityClass name/],
  ];
  process.env.SANDBOX_BACKEND = 'kubernetes';
  for (const [name, value, error] of refused) {
    const kept = process.env[name];
    process.env[name] = value;
    expect(() => loadConfig(), `${name}=${value}`).toThrow(error);
    expect(() => loadConfig(), `${name}=${value}`).toThrow(name);
    if (kept === undefined) delete process.env[name];
    else process.env[name] = kept;
  }
});

test('the builder bounds are optional and validated', () => {
  expect(loadConfig()).not.toHaveProperty('buildkitdCpus');
  expect(loadConfig()).not.toHaveProperty('buildkitdMemoryBytes');
  process.env.SANDBOX_BUILDKITD_CPUS = '6';
  process.env.SANDBOX_BUILDKITD_MEMORY = '12g';
  expect(loadConfig()).toMatchObject({
    buildkitdCpus: 6,
    buildkitdMemoryBytes: 12 * 1024 ** 3,
  });
  process.env.SANDBOX_BUILDKITD_MEMORY = 'lots';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_MEMORY/);
  process.env.SANDBOX_BUILDKITD_MEMORY = '12g';
  process.env.SANDBOX_BUILDKITD_CPUS = 'many';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_CPUS/);
});

test('Docker data filesystem monitoring is opt-in and requires absolute paths', () => {
  expect(loadConfig().dockerDataPath).toBeUndefined();
  process.env.SANDBOX_DOCKER_DATA_ROOT = '/srv/docker';
  expect(loadConfig()).toMatchObject({
    dockerDataRoot: '/srv/docker',
    dockerDataPath: '/var/lib/tale-sandbox/docker-data',
  });
  process.env.SANDBOX_DOCKER_DATA_PATH = 'relative';
  expect(() => loadConfig()).toThrow('SANDBOX_DOCKER_DATA_PATH');
});

test("an idle builder's cache budget is optional and validated", () => {
  expect(loadConfig()).not.toHaveProperty('buildkitdIdleCacheBytes');
  process.env.SANDBOX_BUILDKITD_IDLE_CACHE = '2g';
  expect(loadConfig().buildkitdIdleCacheBytes).toBe(2 * 1024 ** 3);
  process.env.SANDBOX_BUILDKITD_IDLE_CACHE = '0';
  expect(loadConfig().buildkitdIdleCacheBytes).toBe(0);
  process.env.SANDBOX_BUILDKITD_IDLE_CACHE = 'small';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_IDLE_CACHE/);
});

test('how long idle build helpers keep running is optional and validated', () => {
  expect(loadConfig()).not.toHaveProperty('buildkitdIdleMs');
  process.env.SANDBOX_BUILDKITD_IDLE_MS = '300000';
  expect(loadConfig().buildkitdIdleMs).toBe(300_000);
  // The sweep runs once a minute: a shorter window is refused.
  process.env.SANDBOX_BUILDKITD_IDLE_MS = '1000';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_IDLE_MS/);
  process.env.SANDBOX_BUILDKITD_IDLE_MS = 'ten minutes';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_IDLE_MS/);
});

test("a builder's cache cap is optional and at least a gigabyte", () => {
  expect(loadConfig()).not.toHaveProperty('buildkitdMaxCacheBytes');
  process.env.SANDBOX_BUILDKITD_MAX_CACHE = '8g';
  expect(loadConfig().buildkitdMaxCacheBytes).toBe(8 * 1024 ** 3);
  for (const refused of ['0', '512m', 'large']) {
    process.env.SANDBOX_BUILDKITD_MAX_CACHE = refused;
    expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_MAX_CACHE/);
  }
});

test('the free space kept on the session disk is optional and validated', () => {
  expect(loadConfig().session).not.toHaveProperty('minFreeDiskBytes');
  process.env.SANDBOX_MIN_FREE_DISK = '10g';
  expect(loadConfig().session.minFreeDiskBytes).toBe(10 * 1024 ** 3);
  // 0 turns the floor off.
  process.env.SANDBOX_MIN_FREE_DISK = '0';
  expect(loadConfig().session.minFreeDiskBytes).toBe(0);
  process.env.SANDBOX_MIN_FREE_DISK = 'plenty';
  expect(() => loadConfig()).toThrow(/SANDBOX_MIN_FREE_DISK/);
});

test('the CPU pressure admission waits from is 60 % unless set, and 0 turns it off', () => {
  expect(loadConfig().session.cpuPressurePercent).toBe(60);
  process.env.SANDBOX_CPU_PRESSURE_PERCENT = '35.5';
  expect(loadConfig().session.cpuPressurePercent).toBe(35.5);
  process.env.SANDBOX_CPU_PRESSURE_PERCENT = '0';
  expect(loadConfig().session.cpuPressurePercent).toBe(0);
  for (const refused of ['101', '-1', 'busy']) {
    process.env.SANDBOX_CPU_PRESSURE_PERCENT = refused;
    expect(() => loadConfig()).toThrow(/SANDBOX_CPU_PRESSURE_PERCENT/);
  }
});

test('the critical tier of the session disk is optional and validated', () => {
  expect(loadConfig().session).not.toHaveProperty('criticalFreeDiskBytes');
  process.env.SANDBOX_CRITICAL_FREE_DISK = '3g';
  expect(loadConfig().session.criticalFreeDiskBytes).toBe(3 * 1024 ** 3);
  // 0 turns the tier off.
  process.env.SANDBOX_CRITICAL_FREE_DISK = '0';
  expect(loadConfig().session.criticalFreeDiskBytes).toBe(0);
  process.env.SANDBOX_CRITICAL_FREE_DISK = 'soon';
  expect(() => loadConfig()).toThrow(/SANDBOX_CRITICAL_FREE_DISK/);
});

test('how long stopped build caches are kept is optional and validated', () => {
  expect(loadConfig()).not.toHaveProperty('buildkitdCacheRetentionMs');
  const hour = 60 * 60 * 1000;
  process.env.SANDBOX_BUILDKITD_CACHE_RETENTION = '14d';
  expect(loadConfig().buildkitdCacheRetentionMs).toBe(14 * 24 * hour);
  process.env.SANDBOX_BUILDKITD_CACHE_RETENTION = '36h';
  expect(loadConfig().buildkitdCacheRetentionMs).toBe(36 * hour);
  for (const off of ['0', 'off', 'OFF']) {
    process.env.SANDBOX_BUILDKITD_CACHE_RETENTION = off;
    expect(loadConfig().buildkitdCacheRetentionMs).toBe(0);
  }
  process.env.SANDBOX_BUILDKITD_CACHE_RETENTION = 'two weeks';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_CACHE_RETENTION/);
});

test('how long unused package caches are kept is optional and validated', () => {
  expect(loadConfig()).not.toHaveProperty('packageCacheRetentionMs');
  const hour = 60 * 60 * 1000;
  process.env.SANDBOX_PACKAGE_CACHE_RETENTION = '30d';
  expect(loadConfig().packageCacheRetentionMs).toBe(30 * 24 * hour);
  process.env.SANDBOX_PACKAGE_CACHE_RETENTION = '72h';
  expect(loadConfig().packageCacheRetentionMs).toBe(72 * hour);
  for (const off of ['0', 'off']) {
    process.env.SANDBOX_PACKAGE_CACHE_RETENTION = off;
    expect(loadConfig().packageCacheRetentionMs).toBe(0);
  }
  process.env.SANDBOX_PACKAGE_CACHE_RETENTION = '2 weeks';
  expect(() => loadConfig()).toThrow(/SANDBOX_PACKAGE_CACHE_RETENTION/);
});

describe('loadConfig — runtime tier', () => {
  test.each(['docker', 'kubernetes'])(
    'reads an optional inner Docker pool independently of the %s backend',
    (backend) => {
      process.env.SANDBOX_BACKEND = backend;
      expect(loadConfig().dindInnerPool).toBeUndefined();
      process.env.SANDBOX_DIND_INNER_POOL = ' 10.240.0.0/16 ';
      expect(loadConfig().dindInnerPool).toBe('10.240.0.0/16');
      process.env.SANDBOX_DIND_INNER_POOL = ' ';
      expect(loadConfig().dindInnerPool).toBeUndefined();
    },
  );

  test.each([
    '10.0.1.0/16',
    '10.0.0.0/24',
    '8.8.0.0/16',
    '172.32.0.0/16',
    '10.0.0.0/8',
    'fd00::/16',
    '10.0.0.0/16;true',
  ])('refuses an invalid operator inner pool (%s)', (pool) => {
    process.env.SANDBOX_DIND_INNER_POOL = pool;
    expect(() => loadConfig()).toThrow(/SANDBOX_DIND_INNER_POOL/);
  });

  test('defaults to runc, no DinD, no k8s runtimeClass', () => {
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('runc');
    expect(cfg.dockerInContainer).toBe(false);
    expect(cfg.k8s.runtimeClassName).toBeNull();
  });

  test("'runsc' is a back-compat alias for the gvisor tier", () => {
    process.env.SANDBOX_RUNTIME = 'runsc';
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('gvisor');
    expect(cfg.k8s.runtimeClassName).toBe('gvisor');
  });

  test('sysbox / kata resolve their runtimeClass', () => {
    process.env.SANDBOX_RUNTIME = 'sysbox';
    expect(loadConfig().k8s.runtimeClassName).toBe('sysbox-runc');
    process.env.SANDBOX_RUNTIME = 'kata';
    expect(loadConfig().k8s.runtimeClassName).toBe('kata');
  });

  test('unknown tier throws', () => {
    process.env.SANDBOX_RUNTIME = 'bogus';
    expect(() => loadConfig()).toThrow(/SANDBOX_RUNTIME must be one of/);
  });

  test('SANDBOX_RUNTIME_CLASS overrides a non-null class, never conjures one for runc', () => {
    process.env.SANDBOX_RUNTIME = 'kata';
    process.env.SANDBOX_RUNTIME_CLASS = 'kata-qemu';
    expect(loadConfig().k8s.runtimeClassName).toBe('kata-qemu');

    process.env.SANDBOX_RUNTIME = 'runc';
    expect(loadConfig().k8s.runtimeClassName).toBeNull();
  });
});

describe('loadConfig — docker-in-container gating', () => {
  test('runc + DinD is allowed (privileged, trusted-only)', () => {
    process.env.SANDBOX_RUNTIME = 'runc';
    process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('runc');
    expect(cfg.dockerInContainer).toBe(true);
  });

  test('gvisor + DinD is allowed (experimental; warns, does not throw)', () => {
    process.env.SANDBOX_RUNTIME = 'runsc';
    process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('gvisor');
    expect(cfg.dockerInContainer).toBe(true);
  });

  test('sysbox + DinD is accepted', () => {
    process.env.SANDBOX_RUNTIME = 'sysbox';
    process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('sysbox');
    expect(cfg.dockerInContainer).toBe(true);
  });

  test('kata + DinD is accepted', () => {
    process.env.SANDBOX_RUNTIME = 'kata';
    process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
    expect(loadConfig().dockerInContainer).toBe(true);
  });

  // The session cgroup memory is shared with the inner dockerd + nested builds
  // under DinD; 4g OOM-kills a real `docker compose up --build` (e.g. a vite
  // bundle peaks ~7g), so DinD raises the default ceiling to 8g — but it stays
  // a default, overridable by SANDBOX_AGENT_MEMORY.
  describe('DinD memory default', () => {
    test('non-DinD keeps the 4g default', () => {
      process.env.SANDBOX_RUNTIME = 'runc';
      expect(loadConfig().session.agentProfile.memory).toBe('4g');
    });

    test('DinD raises the default to 8g', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
      expect(loadConfig().session.agentProfile.memory).toBe('8g');
      expect(loadConfig().session.agentProfile.memoryWithoutDocker).toBe('4g');
    });

    test('explicit SANDBOX_AGENT_MEMORY wins over the DinD default', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
      process.env.SANDBOX_AGENT_MEMORY = '12g';
      expect(loadConfig().session.agentProfile.memory).toBe('12g');
      expect(loadConfig().session.agentProfile.memoryWithoutDocker).toBe('12g');
    });
  });

  describe('agent CPU weight', () => {
    test('defaults below the control plane and takes an operator weight', () => {
      expect(loadConfig().session.agentProfile.cpuShares).toBe(256);
      process.env.SANDBOX_AGENT_CPU_SHARES = '512';
      expect(loadConfig().session.agentProfile.cpuShares).toBe(512);
    });

    test('refuses a weight the kernel would not take or would read as the default', () => {
      for (const bad of ['0', '1', '262145', '256.5', 'high']) {
        process.env.SANDBOX_AGENT_CPU_SHARES = bad;
        expect(() => loadConfig()).toThrow(/SANDBOX_AGENT_CPU_SHARES/);
      }
    });
  });

  describe('exec stall window', () => {
    test('defaults to 45 minutes and takes whole minutes, 0 turning it off', () => {
      expect(loadConfig().session.execStallMs).toBe(45 * 60_000);
      process.env.SANDBOX_EXEC_STALL_MINUTES = '10';
      expect(loadConfig().session.execStallMs).toBe(10 * 60_000);
      process.env.SANDBOX_EXEC_STALL_MINUTES = '0';
      expect(loadConfig().session.execStallMs).toBe(0);
    });

    test('admits new execs up to 90% of a session’s memory', () => {
      expect(loadConfig().session.execAdmissionMemoryPercent).toBe(90);
    });

    test('refuses a window that is no whole number of minutes up to a day', () => {
      for (const bad of ['-1', '1.5', 'soon', '1441']) {
        process.env.SANDBOX_EXEC_STALL_MINUTES = bad;
        expect(() => loadConfig()).toThrow(/SANDBOX_EXEC_STALL_MINUTES/);
      }
    });
  });

  describe('tier-aware default (unset SANDBOX_DOCKER_IN_CONTAINER)', () => {
    test('sysbox / kata default ON (boundary-keeping → docker just works)', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      expect(loadConfig().dockerInContainer).toBe(true);
      process.env.SANDBOX_RUNTIME = 'kata';
      expect(loadConfig().dockerInContainer).toBe(true);
    });

    test('runc / gvisor default OFF (privileged host-root / flaky → opt-in only)', () => {
      process.env.SANDBOX_RUNTIME = 'runc';
      expect(loadConfig().dockerInContainer).toBe(false);
      process.env.SANDBOX_RUNTIME = 'runsc';
      expect(loadConfig().dockerInContainer).toBe(false);
    });

    test('explicit env overrides the tier default (force off on sysbox)', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      process.env.SANDBOX_DOCKER_IN_CONTAINER = 'false';
      expect(loadConfig().dockerInContainer).toBe(false);
    });

    test('empty-string env is treated as unset → tier default applies', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      process.env.SANDBOX_DOCKER_IN_CONTAINER = '';
      expect(loadConfig().dockerInContainer).toBe(true);
    });
  });
});

describe('loadConfig — shared build cache', () => {
  test('default FOLLOWS DinD: off on runc (DinD off), with image defaults', () => {
    const cfg = loadConfig(); // runc → DinD off → cache off
    expect(cfg.dockerBuildCache).toBe(false);
    expect(cfg.buildkitdImage).toBe('tale-sandbox-buildkitd:latest');
    expect(cfg.buildkitdMirrorImage).toBe(
      'registry:3.1.2@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8',
    );
  });

  test('default FOLLOWS DinD: ON when DinD is on (sysbox), no flag needed', () => {
    process.env.SANDBOX_RUNTIME = 'sysbox'; // DinD default on → cache default on
    const cfg = loadConfig();
    expect(cfg.dockerInContainer).toBe(true);
    expect(cfg.dockerBuildCache).toBe(true);
  });

  test('explicit SANDBOX_DOCKER_BUILD_CACHE=false disables it under DinD', () => {
    process.env.SANDBOX_RUNTIME = 'sysbox';
    process.env.SANDBOX_DOCKER_BUILD_CACHE = 'false';
    const cfg = loadConfig();
    expect(cfg.dockerInContainer).toBe(true);
    expect(cfg.dockerBuildCache).toBe(false);
  });

  test('deployment.json dockerBuildCache overrides the env', () => {
    process.env.SANDBOX_DOCKER_BUILD_CACHE = 'false';
    writeDeployment({
      version: 1,
      sandboxRuntime: { dockerInContainer: true, dockerBuildCache: true },
    });
    expect(loadConfig().dockerBuildCache).toBe(true);
  });

  test('on without DinD is allowed (inert; warns, does not throw)', () => {
    process.env.SANDBOX_RUNTIME = 'runc';
    process.env.SANDBOX_DOCKER_BUILD_CACHE = 'true';
    const cfg = loadConfig();
    expect(cfg.dockerBuildCache).toBe(true);
    expect(cfg.dockerInContainer).toBe(false);
  });

  test('SANDBOX_BUILDKITD_IMAGE overrides the image ref', () => {
    process.env.SANDBOX_BUILDKITD_IMAGE =
      'ghcr.io/acme/tale-sandbox-buildkitd:v9';
    expect(loadConfig().buildkitdImage).toBe(
      'ghcr.io/acme/tale-sandbox-buildkitd:v9',
    );
  });
});

describe('loadConfig — deployment config sandboxRuntime', () => {
  test('overrides the SANDBOX_RUNTIME env', () => {
    process.env.SANDBOX_RUNTIME = 'runc';
    writeDeployment({
      version: 1,
      sandboxRuntime: { tier: 'sysbox', dockerInContainer: true },
    });
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('sysbox');
    expect(cfg.dockerInContainer).toBe(true);
    expect(cfg.k8s.runtimeClassName).toBe('sysbox-runc');
  });

  test('absent section falls back to env', () => {
    process.env.SANDBOX_RUNTIME = 'kata';
    writeDeployment({ version: 1 });
    expect(loadConfig().runtimeTier).toBe('kata');
  });

  test('deployment.json can enable DinD on any tier (runc here)', () => {
    writeDeployment({
      version: 1,
      sandboxRuntime: { tier: 'runc', dockerInContainer: true },
    });
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('runc');
    expect(cfg.dockerInContainer).toBe(true);
  });

  test('malformed deployment config fails closed', () => {
    writeFileSync(join(cfgDir, 'deployment.json'), '{ not json');
    expect(() => loadConfig()).toThrow(/not valid YAML\/JSON/);
  });

  test('deployment.yml is the current form and wins over the retired json', () => {
    writeFileSync(
      join(cfgDir, 'deployment.yml'),
      'version: 1\nsandboxRuntime:\n  tier: sysbox\n',
    );
    writeDeployment({ version: 1, sandboxRuntime: { tier: 'kata' } });
    expect(loadConfig().runtimeTier).toBe('sysbox');
  });
});

describe('session root', () => {
  test('flat host session root (no blue/green colour sub-directory)', () => {
    process.env.SANDBOX_HOST_SESSION_ROOT = '/var/lib/tale-sandbox/sessions';
    const cfg = loadConfig();
    expect(cfg.hostSessionRoot).toBe('/var/lib/tale-sandbox/sessions');
  });

  test('defaults to /var/lib/tale-sandbox/sessions when unset', () => {
    const cfg = loadConfig();
    expect(cfg.hostSessionRoot).toBe('/var/lib/tale-sandbox/sessions');
  });
});

// REGRESSION (body-cap contract drift): the spawner accepted up to 8 MiB while
// runnerd privately capped at 4 MiB, so a stage batch the spawner took could
// be refused daemon-side. The spawner's cap now defaults to, and is clamped
// at, the shared protocol constant.
describe('loadConfig — request body cap follows runnerd', () => {
  test('defaults to RUNNERD_MAX_REQUEST_BODY_BYTES', () => {
    expect(loadConfig().maxRequestBodyBytes).toBe(
      RUNNERD_MAX_REQUEST_BODY_BYTES,
    );
  });

  test('an operator value above the daemon cap is clamped (warns, does not throw)', () => {
    process.env.SANDBOX_MAX_REQUEST_BODY_BYTES = String(
      RUNNERD_MAX_REQUEST_BODY_BYTES * 2,
    );
    expect(loadConfig().maxRequestBodyBytes).toBe(
      RUNNERD_MAX_REQUEST_BODY_BYTES,
    );
  });

  test('a lower operator value is honoured', () => {
    process.env.SANDBOX_MAX_REQUEST_BODY_BYTES = String(256 * 1024);
    expect(loadConfig().maxRequestBodyBytes).toBe(256 * 1024);
  });
});

test('optional build cache has a bounded whole-operation budget', () => {
  expect(loadConfig().buildkitdProvisionTimeoutMs).toBe(5_000);
  process.env.SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS = '500';
  expect(loadConfig().buildkitdProvisionTimeoutMs).toBe(500);
  process.env.SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS = '60001';
  expect(() => loadConfig()).toThrow(/SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS/);
});

test('Docker workloads inherit by default and validate an explicit allowlist', () => {
  expect(loadConfig().dockerWorkloads).toBeUndefined();
  process.env.SANDBOX_DOCKER_WORKLOADS = ' project, project ';
  expect(loadConfig().dockerWorkloads).toEqual(['project']);
  process.env.SANDBOX_DOCKER_WORKLOADS = 'none';
  expect(loadConfig().dockerWorkloads).toEqual([]);
  process.env.SANDBOX_DOCKER_WORKLOADS = 'workflow,project';
  expect(loadConfig().dockerWorkloads).toEqual(['workflow', 'project']);
  process.env.SANDBOX_DOCKER_WORKLOADS = 'browser';
  expect(() => loadConfig()).toThrow(/SANDBOX_DOCKER_WORKLOADS/);
});

test('an unreadable Kubernetes-only setting stops only a Kubernetes spawner', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT = '4g';
    process.env.SANDBOX_K8S_TOLERATIONS = '{"key":"pool"}';
    // The Docker backend ignores both, so a stray value in a shared env file
    // warns instead of refusing the boot.
    expect(loadConfig().k8s.workspaceSizeLimit).toBe('4Gi');
    expect(warn.mock.calls.map(String).join('\n')).toContain(
      'ignoring SANDBOX_K8S_TOLERATIONS',
    );
    process.env.SANDBOX_BACKEND = 'kubernetes';
    expect(() => loadConfig()).toThrow('SANDBOX_K8S_WORKSPACE_SIZE_LIMIT');
  } finally {
    warn.mockRestore();
  }
});
