import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from './config.ts';

// loadConfig reads these from process.env; snapshot + restore so tests don't
// leak into each other or the runner's environment.
const KEYS = [
  'SANDBOX_RUNTIME',
  'SANDBOX_DOCKER_IN_CONTAINER',
  'SANDBOX_RUNTIME_CLASS',
  'SANDBOX_BACKEND',
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

describe('loadConfig — runtime tier', () => {
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

  test('DinD flag off by default even on sysbox', () => {
    process.env.SANDBOX_RUNTIME = 'sysbox';
    expect(loadConfig().dockerInContainer).toBe(false);
  });
});

describe('loadConfig — deployment.json sandboxRuntime', () => {
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

  test('malformed deployment.json fails closed', () => {
    writeFileSync(join(cfgDir, 'deployment.json'), '{ not json');
    expect(() => loadConfig()).toThrow(/not valid JSON/);
  });
});
