// loadConfig under SANDBOX_BACKEND=incus: the Incus section it builds, what it
// forces (the tier), what it defaults differently (Docker inside), and what
// it says about settings that have no effect there.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from './config.ts';

const INCUS_ENV: Record<string, string> = {
  SANDBOX_BACKEND: 'incus',
  SANDBOX_INCUS_ENDPOINT: 'https://incus.example:8443',
  SANDBOX_INCUS_PROJECT: 'sandbox-pr',
  SANDBOX_INCUS_PROFILE: 'sandbox',
  SANDBOX_INCUS_NETWORK: 'sbx0',
  SANDBOX_INCUS_STORAGE_POOL: 'tank',
  SANDBOX_INCUS_IMAGE: 'tale-sandbox-runtime',
  SANDBOX_INCUS_CLIENT_CERT_FILE: '/run/incus/client.crt',
  SANDBOX_INCUS_CLIENT_KEY_FILE: '/run/incus/client.key',
  SANDBOX_INCUS_SERVER_CERT_FILE: '/run/incus/server.crt',
  SANDBOX_EGRESS_PROXY: 'http://10.20.0.2:3128',
  SANDBOX_MAX_SESSIONS: '32',
};

const OTHER_KEYS = [
  'SANDBOX_RUNTIME',
  'SANDBOX_RUNTIME_CLASS',
  'SANDBOX_DOCKER_IN_CONTAINER',
  'SANDBOX_DOCKER_BUILD_CACHE',
  'SANDBOX_HOST_SESSION_ROOT',
  'SANDBOX_EGRESS_NETWORK',
  'SANDBOX_DOCKER_DATA_ROOT',
  'SANDBOX_DOCKER_DATA_PATH',
  'SANDBOX_AGENT_CPU_SHARES',
  'SANDBOX_AGENT_TMP_SIZE',
  'SANDBOX_AGENT_MEMORY',
  'SANDBOX_K8S_NAMESPACE',
  'SANDBOX_HUB_PORT',
  'SANDBOX_TOKEN',
  'SANDBOX_INCUS_POOL_SIZE',
  'SANDBOX_INCUS_DNS',
  'TALE_PLATFORM_SHARED_CONFIG_DIR',
];

let saved: Record<string, string | undefined>;
let cfgDir: string;
let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  saved = {};
  const keys = new Set([
    ...OTHER_KEYS,
    ...Object.keys(INCUS_ENV),
    ...Object.keys(process.env).filter((name) =>
      name.startsWith('SANDBOX_INCUS_'),
    ),
  ]);
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  cfgDir = mkdtempSync(join(tmpdir(), 'tale-cfg-incus-'));
  process.env.TALE_PLATFORM_SHARED_CONFIG_DIR = cfgDir;
  process.env.SANDBOX_TOKEN = 'test-token';
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  rmSync(cfgDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('SANDBOX_INCUS_') && !(name in saved)) {
      delete process.env[name];
    }
  }
});

function useIncus(extra: Record<string, string> = {}): void {
  Object.assign(process.env, INCUS_ENV, extra);
}

function warnings(): string[] {
  return warn.mock.calls.map((call) => String(call[0]));
}

function mentions(needle: string): string[] {
  return warnings().filter((line) => line.includes(needle));
}

describe('SANDBOX_BACKEND=incus', () => {
  test('builds the Incus section and a session capacity within which the pool fits', () => {
    useIncus({ SANDBOX_INCUS_POOL_SIZE: '4' });
    const cfg = loadConfig();
    expect(cfg.backend).toBe('incus');
    expect(cfg.incus).toMatchObject({
      endpoint: 'https://incus.example:8443',
      project: 'sandbox-pr',
      storagePool: 'tank',
      poolSize: 4,
      dns: ['10.20.0.2'],
    });
    expect(cfg.session.maxSessions).toBe(32);
    expect(cfg.egressProxy).toBe('http://10.20.0.2:3128');
  });

  test('is the unprivileged-container tier whatever tier was asked for', () => {
    useIncus({ SANDBOX_RUNTIME: 'runc' });
    const cfg = loadConfig();
    expect(cfg.runtimeTier).toBe('sysbox');
    expect(mentions("'runc' runtime tier")).toHaveLength(1);
  });

  test('says nothing about the tier when none was asked for', () => {
    useIncus();
    expect(loadConfig().runtimeTier).toBe('sysbox');
    expect(mentions('runtime tier')).toHaveLength(0);
  });

  test('a tier from the deployment config is overridden too', () => {
    useIncus();
    writeFileSync(
      join(cfgDir, 'deployment.json'),
      JSON.stringify({ sandboxRuntime: { tier: 'gvisor' } }),
    );
    expect(loadConfig().runtimeTier).toBe('sysbox');
    expect(mentions("'gvisor' runtime tier")).toHaveLength(1);
  });

  test('still refuses a tier that does not exist', () => {
    useIncus({ SANDBOX_RUNTIME: 'bogus' });
    expect(() => loadConfig()).toThrow('SANDBOX_RUNTIME must be one of');
  });

  test('has no Docker inside unless it is asked for, and then says where it is proven', () => {
    useIncus();
    const off = loadConfig();
    expect(off.dockerInContainer).toBe(false);
    expect(off.dockerBuildCache).toBe(false);
    expect(mentions('one kernel and storage driver')).toHaveLength(0);

    warn.mockClear();
    useIncus({ SANDBOX_DOCKER_IN_CONTAINER: 'true' });
    const on = loadConfig();
    expect(on.dockerInContainer).toBe(true);
    expect(on.session.agentProfile.memory).toBe('8g');
    expect(mentions('one kernel and storage driver')).toHaveLength(1);
  });

  test('never has the shared build cache, and says so when it is asked for', () => {
    useIncus({
      SANDBOX_DOCKER_IN_CONTAINER: 'true',
      SANDBOX_DOCKER_BUILD_CACHE: 'true',
    });
    const cfg = loadConfig();
    expect(cfg.dockerBuildCache).toBe(false);
    expect(mentions('build cache has no effect')).toHaveLength(1);
  });

  test('says what the capacity is when SANDBOX_MAX_SESSIONS is unset', () => {
    useIncus();
    delete process.env.SANDBOX_MAX_SESSIONS;
    const cfg = loadConfig();
    expect(cfg.session.maxSessions).toBe(8);
    expect(mentions('SANDBOX_MAX_SESSIONS is unset')).toHaveLength(1);
  });

  test('refuses a warm pool larger than the capacity', () => {
    useIncus({ SANDBOX_INCUS_POOL_SIZE: '33' });
    expect(() => loadConfig()).toThrow('SANDBOX_INCUS_POOL_SIZE (33)');
  });

  test('refuses a missing setting by name', () => {
    useIncus();
    delete process.env.SANDBOX_INCUS_PROJECT;
    expect(() => loadConfig()).toThrow('SANDBOX_INCUS_PROJECT');
  });

  test('refuses an egress proxy that is named, not addressed', () => {
    useIncus({ SANDBOX_EGRESS_PROXY: 'http://sandbox-egress:3128' });
    expect(() => loadConfig()).toThrow(
      'SANDBOX_EGRESS_PROXY must name an IPv4',
    );
  });

  test('says which settings have no effect on this backend', () => {
    useIncus({
      SANDBOX_HOST_SESSION_ROOT: '/srv/sessions',
      SANDBOX_EGRESS_NETWORK: 'x',
      SANDBOX_DOCKER_DATA_ROOT: '/srv/docker',
      SANDBOX_AGENT_CPU_SHARES: '512',
      SANDBOX_AGENT_TMP_SIZE: '1g',
      SANDBOX_K8S_NAMESPACE: 'x',
    });
    loadConfig();
    for (const name of [
      'SANDBOX_HOST_SESSION_ROOT',
      'SANDBOX_EGRESS_NETWORK',
      'SANDBOX_DOCKER_DATA_ROOT',
      'SANDBOX_AGENT_CPU_SHARES',
      'SANDBOX_AGENT_TMP_SIZE',
      'SANDBOX_K8S_NAMESPACE',
    ]) {
      expect(
        mentions(`${name} is set but has no effect with SANDBOX_BACKEND=incus`),
      ).toHaveLength(1);
    }
  });

  test('keeps the connected-devices hub off, as on Kubernetes', () => {
    useIncus({ SANDBOX_HUB_PORT: '8004' });
    expect(loadConfig().hub).toBeNull();
    expect(mentions('connected devices need the Docker backend')).toHaveLength(
      1,
    );
  });
});

describe('the other backends', () => {
  test('a Docker spawner has no Incus section and says an Incus setting is inert', () => {
    process.env.SANDBOX_BACKEND = 'docker';
    process.env.SANDBOX_INCUS_PROJECT = 'sandbox-pr';
    const cfg = loadConfig();
    expect(cfg.incus).toBeUndefined();
    expect(cfg.runtimeTier).toBe('runc');
    expect(
      mentions(
        'SANDBOX_INCUS_PROJECT is set but has no effect with SANDBOX_BACKEND=docker',
      ),
    ).toHaveLength(1);
  });

  test('the default backend is still Docker', () => {
    delete process.env.SANDBOX_BACKEND;
    expect(loadConfig().backend).toBe('docker');
  });

  test('an unknown backend names all three', () => {
    process.env.SANDBOX_BACKEND = 'nomad';
    expect(() => loadConfig()).toThrow(
      "SANDBOX_BACKEND must be 'docker', 'kubernetes' or 'incus'",
    );
  });

  test('a Kubernetes spawner keeps its tier choices and Docker-inside default', () => {
    process.env.SANDBOX_BACKEND = 'kubernetes';
    process.env.SANDBOX_RUNTIME = 'sysbox';
    const cfg = loadConfig();
    expect(cfg.incus).toBeUndefined();
    expect(cfg.dockerInContainer).toBe(true);
  });
});
