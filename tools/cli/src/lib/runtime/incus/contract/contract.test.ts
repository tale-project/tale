import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { readOperatorBlock } from '../../../../../../../services/sandbox/e2e/incus/operator-block';
import { prepareRuntime } from '../../../deployment/runtime-prepare';
import {
  commitRepositorySource,
  RuntimeDockerFixture,
  runtimeFixture,
} from '../../../deployment/runtime-test-helper';
import {
  colourDocument,
  compileInput,
  DOTENV,
  expectGolden,
  statefulDocument,
} from '../compile/compile-fixture';
import { STOP_GROUPS } from '../compile/placement';
import {
  compileStackTarget,
  requireStackTarget,
  type CompileInput,
  type StackTarget,
} from '../compile/stack-target';
import { REQUIRED_EXTENSIONS } from '../verbs/probe';
import {
  contractOf,
  dhcpRange,
  formatBytes,
  nodeContract,
  type ContractSource,
} from './contract';
import { parseNodeContract, type NodeContract } from './contract-model';

/** The managed production compose, as `deploy prepare` writes it into a
 * bundle (the same fixture the compiler's goldens use). */
let managedCompose: Record<string, unknown>;
const cleanups: string[] = [];

beforeAll(async () => {
  const fixture = runtimeFixture();
  cleanups.push(fixture.directory);
  commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  managedCompose = parse(
    readFileSync(join(fixture.options.bundleDirectory, 'compose.yml'), 'utf8'),
  ) as Record<string, unknown>;
});

afterAll(() => {
  for (const directory of cleanups.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function compiled(input: CompileInput): StackTarget {
  const result = compileStackTarget(input);
  expect(result.refusals).toEqual([]);
  return requireStackTarget(result);
}

function workspaceInput(): CompileInput {
  return compileInput('workspace', [
    { compose: statefulDocument() },
    { compose: colourDocument('blue'), colour: 'blue' },
  ]);
}

function managedInput(overrides: Partial<CompileInput> = {}): CompileInput {
  return compileInput('managed', [{ compose: managedCompose }], overrides);
}

function sourceOf(input: CompileInput): ContractSource {
  return {
    path: input.path,
    stack: input.stack,
    documents: input.documents,
    dotenv: DOTENV,
    declaration: input.declaration,
    processEnvironment: {},
    ...(input.replicas === undefined ? {} : { replicas: input.replicas }),
    ...(input.egressProxy === undefined
      ? {}
      : { egressProxy: input.egressProxy }),
  };
}

function rule(contract: NodeContract, id: string) {
  const found = contract.acls.rules.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
}

describe('the node contract', () => {
  test('of a workspace (golden)', () => {
    const input = workspaceInput();
    expectGolden(
      'node-contract-workspace',
      nodeContract(input.declaration, compiled(input)),
    );
  });

  test('of a managed deployment (golden)', () => {
    const input = managedInput();
    expectGolden(
      'node-contract-managed',
      nodeContract(input.declaration, compiled(input)),
    );
  });

  test('needs no registry: placeholder image facts give the same contract', () => {
    for (const input of [workspaceInput(), managedInput()])
      expect(contractOf(sourceOf(input))).toEqual(
        nodeContract(input.declaration, compiled(input)),
      );
  });

  test('is schema version 1, and a reader keeps the fields a newer CLI adds', () => {
    const contract = contractOf(sourceOf(managedInput()));
    expect(contract.schemaVersion).toBe(1);
    const newer = { ...contract, futureField: { a: 1 } };
    expect(parseNodeContract(JSON.parse(JSON.stringify(newer)))).toEqual(newer);
    expect(() =>
      parseNodeContract({ ...contract, schemaVersion: 2 }),
    ).toThrow();
  });

  test('names the extensions the probe requires and the reserved stop band', () => {
    const contract = contractOf(sourceOf(managedInput()));
    expect(contract.extensions).toEqual([...REQUIRED_EXTENSIONS]);
    expect(contract.stopPriorities.groups).toEqual({ ...STOP_GROUPS });
    expect(contract.stopPriorities.reservedBand).toEqual({ from: 10, to: 90 });
    expect(contract.stopPriorities.dataSignalWithinSeconds).toBe(60);
    expect(contract.stopPriorities.boundHolds).toBe(
      'on a host that runs only Tale',
    );
  });

  test('counts two colours at the peak of a workspace, and the managed stack once', () => {
    const workspace = workspaceInput();
    const target = compiled(workspace);
    const contract = nodeContract(workspace.declaration, target);
    const stateful = target.instances.filter((i) => i.colour === null);
    const colour = target.instances.filter((i) => i.colour === 'blue');
    expect(contract.peak.instances).toBe(
      stateful.length + 2 * colour.length + 2,
    );
    expect(contract.project.config['limits.instances']).toBe(
      String(contract.peak.instances),
    );
    expect(contract.project.config['limits.memory']).toBe(
      formatBytes(contract.peak.memoryBytes),
    );
    const managed = managedInput();
    const managedTarget = compiled(managed);
    expect(
      nodeContract(managed.declaration, managedTarget).peak.instances,
    ).toBe(managedTarget.instances.length + 2);
  });

  test('leaves the pool limit out while a volume has no declared size', () => {
    const contract = contractOf(sourceOf(managedInput()));
    expect(contract.peak.diskBytes).toBeNull();
    expect(
      Object.keys(contract.project.config).some((key) =>
        key.startsWith('limits.disk'),
      ),
    ).toBe(false);
    expect(contract.notes.join('\n')).toContain('limits.disk.pool.tale');
  });

  test('sets the pool limit once every volume declares its size', () => {
    const input = managedInput();
    const target = compiled(input);
    const sized: StackTarget = {
      ...target,
      volumes: target.volumes.map((volume) =>
        Object.assign({}, volume, { size: '1GiB' }),
      ),
    };
    const contract = nodeContract(input.declaration, sized);
    const root = 10 * 1024 ** 3;
    expect(contract.peak.diskBytes).toBe(
      sized.volumes.length * 1024 ** 3 + contract.peak.instances * root,
    );
    expect(contract.project.config['limits.disk.pool.tale']).toBe(
      formatBytes(contract.peak.diskBytes ?? 0),
    );
  });

  test('profile tale-stack carries the root disk and default limits (R3-12)', () => {
    const contract = contractOf(sourceOf(managedInput()));
    expect(contract.profile).toEqual({
      name: 'tale-stack',
      config: { 'limits.memory': '2GiB', 'limits.processes': '2048' },
      devices: {
        root: { type: 'disk', path: '/', pool: 'tale', size: '10GiB' },
      },
    });
  });

  test('lists each registry host exactly as the remote URL carries it', () => {
    const plain = contractOf(sourceOf(managedInput()));
    expect(plain.registries).toEqual(['docker.io', 'ghcr.io']);
    expect(plain.project.config['restricted.images.servers']).toBe(
      'docker.io,ghcr.io',
    );
    const input = managedInput();
    const mirrored = contractOf(
      sourceOf({
        ...input,
        declaration: {
          ...input.declaration,
          registryMirror: 'mirror.gcr.io:443',
        },
      }),
    );
    expect(mirrored.registries).toEqual(['ghcr.io', 'mirror.gcr.io:443']);
  });

  test('allows proxy devices only for the proxy-device ingress', () => {
    expect(
      contractOf(sourceOf(workspaceInput())).project.config[
        'restricted.devices.proxy'
      ],
    ).toBe('allow');
    expect(
      contractOf(sourceOf(managedInput())).project.config[
        'restricted.devices.proxy'
      ],
    ).toBe('block');
  });
});

describe('the bridge', () => {
  test('hands out DHCP leases outside the block and the gateway', () => {
    expect(
      dhcpRange({
        name: 'b',
        subnet: '10.30.0.0/16',
        gateway: '10.30.0.1',
        block: '10.30.1.0/24',
      }),
    ).toBe('10.30.2.0-10.30.255.254');
    expect(
      dhcpRange({
        name: 'b',
        subnet: '10.30.1.0/23',
        gateway: '10.30.1.1',
        block: '10.30.1.0/24',
      }),
    ).toBe('10.30.0.1-10.30.0.255');
    expect(
      dhcpRange({
        name: 'b',
        subnet: '10.30.1.0/24',
        gateway: '10.30.1.1',
        block: '10.30.1.0/24',
      }),
    ).toBeNull();
  });

  test('has no IPv6 and NATs, and carries the stack ACL', () => {
    const contract = contractOf(sourceOf(managedInput()));
    expect(contract.network.config).toMatchObject({
      'ipv4.address': '10.30.0.1/16',
      'ipv4.nat': 'true',
      'ipv6.address': 'none',
      'security.acls': 'tale-tale-stack',
    });
  });
});

describe('the ACL rules', () => {
  test('name the sessions real subnet, never a gateway (R3-10)', () => {
    const contract = contractOf(sourceOf(managedInput()));
    for (const item of contract.acls.rules.filter(
      (entry) =>
        entry.id.startsWith('sessions-') ||
        entry.id.startsWith('stack-from-sessions-'),
    )) {
      const sides = [...(item.source ?? []), ...(item.destination ?? [])];
      expect(sides).toContain('10.40.0.0/24');
      expect(sides).not.toContain('10.40.0.1/32');
    }
  });

  test('probe what check can judge and list the rest', () => {
    const contract = contractOf(sourceOf(managedInput()));
    const probed = contract.acls.rules
      .filter((item) => item.check === 'probe')
      .map((item) => item.id)
      .sort();
    expect(probed).toEqual([
      'names-to-gateway-udp',
      'public-egress',
      'spawner-to-incus',
      'spawner-to-sessions',
    ]);
    expect(rule(contract, 'stack-to-stack').check).toBe('listed');
    expect(rule(contract, 'spawner-to-incus')).toMatchObject({
      source: ['10.30.2.11/32', '10.30.2.16/28'],
      destination: ['10.30.0.1/32'],
      protocol: 'tcp',
      ports: [8443],
    });
    expect(rule(contract, 'spawner-to-sessions')).toMatchObject({
      destination: ['10.40.0.0/24'],
      ports: [8200],
    });
  });

  test('give the public egress to the roles that need it, and the helpers', () => {
    const managed = contractOf(sourceOf(managedInput()));
    expect(rule(managed, 'public-egress').source).toEqual([
      '10.30.2.64/28',
      '10.30.2.80/28',
      '10.30.2.96/28',
      '10.30.2.4/32',
      '10.30.2.10/32',
      '10.30.2.9/32',
      '10.30.2.12/32',
      '10.30.2.16/28',
    ]);
    const workspace = contractOf(sourceOf(workspaceInput()));
    expect(rule(workspace, 'public-egress').source).toContain('10.30.1.128/28');
  });

  test('send the sessions egress to the declared proxy (R-13)', () => {
    const own = contractOf(sourceOf(managedInput()));
    expect(rule(own, 'sessions-to-egress-proxy').destination).toEqual([
      '10.30.2.10/32',
    ]);
    expect(rule(own, 'stack-from-sessions-egress-proxy').ports).toEqual([3128]);
    const declared = contractOf(
      sourceOf(managedInput({ egressProxy: 'http://10.50.0.7:3129' })),
    );
    expect(declared.sessions.egressProxy).toBe('http://10.50.0.7:3129');
    expect(rule(declared, 'sessions-to-egress-proxy')).toMatchObject({
      destination: ['10.50.0.7/32'],
      ports: [3129],
    });
    expect(
      declared.acls.rules.some(
        (item) => item.id === 'stack-from-sessions-egress-proxy',
      ),
    ).toBe(false);
  });

  test('pass operatorReach through, probing tcp only', () => {
    const input = managedInput();
    const contract = contractOf(
      sourceOf({
        ...input,
        declaration: {
          ...input.declaration,
          operatorReach: [
            { destination: '10.60.0.5', protocol: 'tcp', ports: [9000, 443] },
            { destination: '10.61.0.0/24', protocol: 'udp', ports: [53] },
          ],
        },
      }),
    );
    expect(rule(contract, 'operator-reach-1')).toMatchObject({
      destination: ['10.60.0.5/32'],
      ports: [443, 9000],
      check: 'probe',
    });
    expect(rule(contract, 'operator-reach-2').check).toBe('listed');
  });

  test('refuse an endpoint named by a host name', () => {
    const input = managedInput();
    expect(() =>
      contractOf(
        sourceOf({
          ...input,
          declaration: {
            ...input.declaration,
            endpoint: 'https://incus.example:8443',
          },
        }),
      ),
    ).toThrow(/IPv4/);
  });

  test("match the sandbox zone an operator makes from the spawner's docs", () => {
    // services/sandbox/docs/incus.md: the block the sandbox e2e lab runs.
    const block = readOperatorBlock();
    const operator = [
      ...block.matchAll(
        /^incus network acl rule add \S+ (egress|ingress) action=allow (?:destination|source)=\S+ protocol=(tcp|udp) destination_port=(\d+)$/gm,
      ),
    ]
      .map(
        ([, direction, protocol, port]) => `${direction} ${protocol}/${port}`,
      )
      .sort();
    expect(operator.length).toBeGreaterThan(0);
    const contract = contractOf(sourceOf(managedInput()));
    const zone = contract.acls.rules
      .filter((item) => item.acl === 'sessions')
      .flatMap((item) =>
        (item.ports ?? []).map(
          (port) => `${item.direction} ${item.protocol}/${port}`,
        ),
      )
      .sort();
    expect(zone).toEqual(operator);
  });
});
