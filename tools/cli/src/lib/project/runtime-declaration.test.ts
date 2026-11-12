import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError, ExitCode } from '../../utils/fail';
import { init, runtimeFromFlags } from '../actions/init';
import { readProject } from './read-project';
import {
  guardDeclaredEngine,
  incusDeclarationSchema,
  incusNotAvailableYet,
  runtimeDeclarationSchema,
} from './runtime-declaration';
import { writeProject } from './write-project';

const incus = {
  project: 'tale-acme',
  pool: 'tank',
  network: {
    name: 'tale-acme',
    subnet: '10.30.0.0/23',
    gateway: '10.30.0.1',
    block: '10.30.0.0/24',
  },
  sessions: { subnet: '10.31.0.0/24' },
  ingress: { mode: 'proxy-device' as const },
};

function caught(work: () => unknown): CliError {
  try {
    work();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('the Incus declaration', () => {
  test.each([
    ['the required fields', incus],
    [
      'every optional field',
      {
        ...incus,
        endpoint: 'https://10.30.0.1:8443',
        ingress: { mode: 'proxy-device', listen: '203.0.113.10' },
        registryMirror: 'mirror.gcr.io:443',
        rootSize: '20GiB',
        volumes: {
          'db-data': {
            size: '100GiB',
            config: { 'snapshots.expiry': '7d', 'zfs.blocksize': '16KiB' },
          },
        },
        operatorReach: [
          { destination: '10.40.0.5', protocol: 'tcp', ports: [443, 8443] },
          { destination: '10.41.0.0/24', protocol: 'udp', ports: [53] },
        ],
      },
    ],
    ['a routed ingress', { ...incus, ingress: { mode: 'routed' } }],
    [
      'a /25 block (a managed deployment)',
      { ...incus, network: { ...incus.network, block: '10.30.1.0/25' } },
    ],
    [
      'a gateway outside the block',
      {
        ...incus,
        network: { ...incus.network, gateway: '10.30.1.1' },
      },
    ],
  ])('accepts %s', (_name, value) => {
    expect(incusDeclarationSchema.safeParse(value).success).toBe(true);
  });

  test.each([
    ['no project', { ...incus, project: undefined }],
    ['an uppercase project', { ...incus, project: 'Tale' }],
    [
      'a bridge name longer than an interface name',
      { ...incus, network: { ...incus.network, name: 'tale-acme-stack-1' } },
    ],
    [
      'a subnet with host bits',
      { ...incus, network: { ...incus.network, subnet: '10.30.0.1/23' } },
    ],
    [
      'a block that is neither a /24 nor a /25',
      { ...incus, network: { ...incus.network, block: '10.30.0.0/26' } },
    ],
    [
      'a block outside the subnet',
      { ...incus, network: { ...incus.network, block: '10.32.0.0/24' } },
    ],
    [
      'a gateway outside the subnet',
      { ...incus, network: { ...incus.network, gateway: '10.99.0.1' } },
    ],
    [
      'a gateway on an address the plan assigns',
      { ...incus, network: { ...incus.network, gateway: '10.30.0.5' } },
    ],
    [
      'a sessions subnet that overlaps the stack',
      { ...incus, sessions: { subnet: '10.30.1.0/24' } },
    ],
    [
      'a listen address on a routed ingress',
      { ...incus, ingress: { mode: 'routed', listen: '203.0.113.10' } },
    ],
    ['an unknown ingress', { ...incus, ingress: { mode: 'userspace' } }],
    ['an http endpoint', { ...incus, endpoint: 'http://10.30.0.1:8443' }],
    [
      'an endpoint with a path',
      { ...incus, endpoint: 'https://10.30.0.1:8443/1.0' },
    ],
    [
      'a registry mirror as a URL',
      { ...incus, registryMirror: 'https://mirror.gcr.io' },
    ],
    ['a size without a unit', { ...incus, rootSize: '20' }],
    [
      'a volume setting outside snapshots.* and zfs.*',
      {
        ...incus,
        volumes: { 'db-data': { config: { 'security.shifted': 'false' } } },
      },
    ],
    [
      'an operator destination without ports',
      {
        ...incus,
        operatorReach: [
          { destination: '10.40.0.5', protocol: 'tcp', ports: [] },
        ],
      },
    ],
    ['an unknown key', { ...incus, cluster: 'yes' }],
  ])('refuses %s', (_name, value) => {
    expect(incusDeclarationSchema.safeParse(value).success).toBe(false);
  });
});

describe("tale.json's runtime", () => {
  test.each([
    ['nothing (Docker)', {}],
    ['Docker', { engine: 'docker' }],
    ['Incus with its block', { engine: 'incus', incus }],
  ])('accepts %s', (_name, value) => {
    expect(runtimeDeclarationSchema.safeParse(value).success).toBe(true);
  });

  test.each([
    ['an unknown engine', { engine: 'podman' }],
    ['Incus without its block', { engine: 'incus' }],
    ['a block without the engine', { incus }],
    ['a block beside Docker', { engine: 'docker', incus }],
    [
      'a /25 block, which cannot hold two colours',
      {
        engine: 'incus',
        incus: {
          ...incus,
          network: { ...incus.network, block: '10.30.1.0/25' },
        },
      },
    ],
    ['an unknown key', { engine: 'docker', next: { engine: 'incus' } }],
  ])('refuses %s', (_name, value) => {
    expect(runtimeDeclarationSchema.safeParse(value).success).toBe(false);
  });
});

describe('TALE_RUNTIME', () => {
  test('is ignored when unset or empty', () => {
    expect(() => guardDeclaredEngine('docker', {})).not.toThrow();
    expect(() =>
      guardDeclaredEngine('incus', { TALE_RUNTIME: '' }),
    ).not.toThrow();
  });

  test('passes when it names the declared engine', () => {
    expect(() =>
      guardDeclaredEngine('incus', { TALE_RUNTIME: 'incus' }),
    ).not.toThrow();
  });

  test('refuses a mismatch and never selects the engine', () => {
    const error = caught(() =>
      guardDeclaredEngine('docker', { TALE_RUNTIME: 'incus' }),
    );
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('expects the incus runtime');
    expect(error.message).toContain('declares docker');
  });

  test('refuses an engine this CLI does not know', () => {
    expect(
      caught(() => guardDeclaredEngine('docker', { TALE_RUNTIME: 'podman' }))
        .message,
    ).toContain('does not know');
  });
});

test('the Incus refusal says "not available yet" for both paths', () => {
  for (const path of ['workspace', 'managed deployment'] as const) {
    const error = incusNotAvailableYet(path);
    expect(error.info.code).toBe(ExitCode.Precondition);
    expect(error.message).toContain('not available yet');
    expect(error.message).toContain(path);
  }
});

describe('tale.json on disk', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tale-runtime-declaration-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const base = {
    version: 1,
    cliVersion: '0.5.95',
    createdAt: '2026-11-12T00:00:00.000Z',
    id: 'acme-a3f1b2',
  };

  test('reads a declared runtime and writes it back unchanged', async () => {
    const path = join(dir, 'tale.json');
    writeFileSync(
      path,
      JSON.stringify({ ...base, runtime: { engine: 'incus', incus } }),
    );
    const project = await readProject(dir);
    expect(project.runtime).toEqual({ engine: 'incus', incus });
    await writeProject(path, project);
    expect(JSON.parse(readFileSync(path, 'utf8')).runtime).toEqual({
      engine: 'incus',
      incus,
    });
  });

  test('refuses to read a runtime it cannot read, naming the field', async () => {
    writeFileSync(
      join(dir, 'tale.json'),
      JSON.stringify({ ...base, runtime: { engine: 'incus', incus: {} } }),
    );
    const error = await readProject(dir).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('runtime.incus.project');
  });

  test('refuses to write a runtime the next command would refuse', async () => {
    const path = join(dir, 'tale.json');
    await expect(
      writeProject(path, {
        ...base,
        runtime: { engine: 'incus' } as never,
      }),
    ).rejects.toThrow('runtime.incus');
  });
});

describe('tale init runtime flags', () => {
  test('write nothing without --runtime, so a re-init keeps its block', () => {
    expect(runtimeFromFlags()).toBeUndefined();
    expect(runtimeFromFlags({ incus: {} })).toBeUndefined();
  });

  test('declare Docker explicitly', () => {
    expect(runtimeFromFlags({ engine: 'docker' })).toEqual({
      engine: 'docker',
    });
  });

  test('write the Incus block, with the gateway, block and ingress defaults', () => {
    expect(
      runtimeFromFlags({
        engine: 'incus',
        incus: {
          endpoint: 'https://10.30.0.1:8443',
          project: 'tale-acme',
          pool: 'tank',
          network: 'tale-acme',
          subnet: '10.30.0.0/24',
          sessionsSubnet: '10.31.0.0/24',
        },
      }),
    ).toEqual({
      engine: 'incus',
      incus: {
        endpoint: 'https://10.30.0.1:8443',
        project: 'tale-acme',
        pool: 'tank',
        network: {
          name: 'tale-acme',
          subnet: '10.30.0.0/24',
          gateway: '10.30.0.1',
          block: '10.30.0.0/24',
        },
        sessions: { subnet: '10.31.0.0/24' },
        ingress: { mode: 'proxy-device' },
      },
    });
  });

  test('refuse Incus flags without --runtime incus', () => {
    const error = caught(() =>
      runtimeFromFlags({ engine: 'docker', incus: { project: 'tale-acme' } }),
    );
    expect(error.info.code).toBe(ExitCode.Usage);
    expect(error.message).toContain('--incus-project needs --runtime incus');
  });

  test('name every missing flag', () => {
    const error = caught(() =>
      runtimeFromFlags({ engine: 'incus', incus: { project: 'tale-acme' } }),
    );
    expect(error.info.code).toBe(ExitCode.Usage);
    for (const flag of [
      '--incus-pool',
      '--incus-network',
      '--incus-subnet',
      '--incus-sessions-subnet',
    ])
      expect(error.message).toContain(flag);
  });

  test('need --incus-block when the subnet is not a /24', () => {
    expect(
      caught(() =>
        runtimeFromFlags({
          engine: 'incus',
          incus: {
            project: 'tale-acme',
            pool: 'tank',
            network: 'tale-acme',
            subnet: '10.30.0.0/23',
            sessionsSubnet: '10.31.0.0/24',
          },
        }),
      ).message,
    ).toContain('--incus-block');
  });

  test('refuse values the declaration refuses, naming the field', () => {
    const error = caught(() =>
      runtimeFromFlags({
        engine: 'incus',
        incus: {
          project: 'tale-acme',
          pool: 'tank',
          network: 'tale-acme',
          subnet: '10.30.0.0/24',
          sessionsSubnet: '10.30.0.0/24',
        },
      }),
    );
    expect(error.info.code).toBe(ExitCode.Usage);
    expect(error.message).toContain('runtime.incus.sessions.subnet');
  });
});

describe('tale init keeps the runtime it finds', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tale-runtime-init-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const flags = {
    engine: 'incus' as const,
    incus: {
      project: 'tale-acme',
      pool: 'tank',
      network: 'tale-acme',
      subnet: '10.30.0.0/24',
      sessionsSubnet: '10.31.0.0/24',
    },
  };
  const project = () =>
    JSON.parse(readFileSync(join(dir, 'tale.json'), 'utf8'));

  test('a re-init without --runtime keeps the block, and the project id', async () => {
    await init({ directory: dir, noEnv: true, runtime: flags });
    const first = project();
    expect(first.runtime).toEqual(runtimeFromFlags(flags));
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.tale/');
    await init({ directory: dir, force: true, noEnv: true });
    expect(project().runtime).toEqual(first.runtime);
    expect(project().id).toBe(first.id);
  });

  test('a block this CLI cannot read stops a re-init before it writes anything', async () => {
    await init({ directory: dir, noEnv: true, runtime: flags });
    const declared = { ...project(), runtime: { engine: 'podman' } };
    writeFileSync(join(dir, 'tale.json'), JSON.stringify(declared));
    rmSync(join(dir, 'default'), { recursive: true });
    await expect(
      init({ directory: dir, force: true, noEnv: true }),
    ).rejects.toThrow('runtime.engine');
    expect(project()).toEqual(declared);
    expect(existsSync(join(dir, 'default'))).toBe(false);
  });
});
