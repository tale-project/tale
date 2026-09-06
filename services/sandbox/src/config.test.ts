import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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
  'SANDBOX_DOCKER_BUILD_CACHE',
  'SANDBOX_BUILDKITD_IMAGE',
  'SANDBOX_RUNTIME_CLASS',
  'SANDBOX_BACKEND',
  'SANDBOX_AGENT_MEMORY',
  'SANDBOX_HOST_SESSION_ROOT',
  'SANDBOX_TOKEN',
  'SANDBOX_MAX_REQUEST_BODY_BYTES',
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
    });

    test('explicit SANDBOX_AGENT_MEMORY wins over the DinD default', () => {
      process.env.SANDBOX_RUNTIME = 'sysbox';
      process.env.SANDBOX_DOCKER_IN_CONTAINER = 'true';
      process.env.SANDBOX_AGENT_MEMORY = '12g';
      expect(loadConfig().session.agentProfile.memory).toBe('12g');
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
    expect(cfg.buildkitdMirrorImage).toBe('registry:2');
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
