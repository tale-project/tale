// The environment the lab gives a spawner is the one loadConfig accepts: a
// variable misspelled here would only show up in CI, an hour in.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { loadConfig } from '../../src/config.ts';
import type { LabConfig } from './lab-config.ts';
import { newToken, spawnerEnv } from './spawner.ts';

const LAB: LabConfig = {
  stateDir: '/mnt/tale-incus-e2e',
  endpoint: 'https://127.0.0.1:8443',
  project: 'sandbox-pr',
  profile: 'sandbox',
  network: 'sbx0',
  pool: 'tank',
  acl: 'sandbox-egress',
  image: 'tale-sandbox-runtime',
  imageSource: '127.0.0.1:5000/tale-sandbox-runtime:e2e',
  clientCertFile: '/mnt/tale-incus-e2e/pki/client.crt',
  clientKeyFile: '/mnt/tale-incus-e2e/pki/client.key',
  serverCertFile: '/mnt/tale-incus-e2e/pki/server.crt',
  defaultServerCertFile: '/mnt/tale-incus-e2e/pki/incus-default-server.crt',
  otherServerCertFile: '/mnt/tale-incus-e2e/pki/other-server.crt',
  egressProxy: 'http://10.20.0.2:3128',
  bridgeAddress: '10.20.0.1',
  egressAddress: '10.20.0.2',
  gatewayAddress: '10.20.0.3',
  backendAddress: '10.20.0.4',
  egressInstance: 'egress',
};

let saved: Record<string, string | undefined>;
let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SANDBOX_') || key.startsWith('TALE_')) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  warn = spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SANDBOX_') || key.startsWith('TALE_')) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value !== undefined) process.env[key] = value;
  }
});

function configOf(env: Record<string, string | undefined> = {}, port = 18003) {
  const built = spawnerEnv(
    LAB,
    { name: 'test', port, token: newToken(), env },
    '/tmp/home',
  );
  // Only the spawner's own variables: the process's HOME, TMPDIR and PATH are
  // shared with every other test file of the run.
  for (const [key, value] of Object.entries(built)) {
    if (key.startsWith('SANDBOX_') || key.startsWith('TALE_')) {
      process.env[key] = value;
    }
  }
  return loadConfig();
}

describe('spawnerEnv', () => {
  test("is accepted by loadConfig, and selects the lab's node", () => {
    const cfg = configOf();
    expect(cfg.backend).toBe('incus');
    expect(cfg.port).toBe(18003);
    expect(cfg.session.maxSessions).toBe(6);
    expect(cfg.egressProxy).toBe(LAB.egressProxy);
    expect(cfg.incus).toMatchObject({
      endpoint: LAB.endpoint,
      project: LAB.project,
      profile: LAB.profile,
      network: LAB.network,
      storagePool: LAB.pool,
      image: LAB.image,
      imageSource: {
        server: 'https://127.0.0.1:5000',
        alias: 'tale-sandbox-runtime:e2e',
      },
      clientCertFile: LAB.clientCertFile,
      clientKeyFile: LAB.clientKeyFile,
      serverCertFile: LAB.serverCertFile,
      poolSize: 0,
    });
  });

  test("takes the suite's settings on top, and drops what is undefined", () => {
    const cfg = configOf({
      SANDBOX_INCUS_POOL_SIZE: '2',
      SANDBOX_MAX_SESSIONS: '4',
      SANDBOX_INCUS_WORKSPACE_SIZE: undefined,
    });
    expect(cfg.incus?.poolSize).toBe(2);
    expect(cfg.session.maxSessions).toBe(4);
  });

  test('carries a token of 48 hex digits, a new one each time', () => {
    const first = newToken();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(newToken()).not.toBe(first);
  });
});
