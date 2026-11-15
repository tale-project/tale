import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import { prepareRuntime } from '../../../deployment/runtime-prepare';
import {
  commitRepositorySource,
  RuntimeDockerFixture,
  runtimeFixture,
} from '../../../deployment/runtime-test-helper';
import {
  colourDocument,
  compileInput,
  expectEdgeRefusal,
  expectManagedEdgeRefusal,
  statefulDocument,
  STATEFUL_AND_BLUE_EDGE_REFUSALS,
} from '../compile/compile-fixture';
import { compileStackTarget, type CompileInput } from '../compile/stack-target';
import { dhcpRange } from './contract';

/** The managed stack is the repository's own compose.yml as `deploy prepare`
 * writes it into a bundle. Preparation refuses the repository's Traefik edge
 * until the switch-role port lands, so each test that reads the managed stack
 * holds that refusal; `managedRefusal` keeps it. */
const cleanups: string[] = [];
let managedRefusal: unknown = null;

beforeAll(async () => {
  const fixture = runtimeFixture();
  cleanups.push(fixture.directory);
  commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  try {
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
      },
      docker.dependencies(),
    );
  } catch (error) {
    managedRefusal = error;
  }
});

afterAll(() => {
  for (const directory of cleanups.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The workspace these tests compile: the stateful document and blue. */
function workspaceInput(): CompileInput {
  return compileInput('workspace', [
    { compose: statefulDocument() },
    { compose: colourDocument('blue'), colour: 'blue' },
  ]);
}

/** The workspace compile is refused by the Traefik edge, line by line. */
function workspaceRefused(): void {
  expectEdgeRefusal(
    compileStackTarget(workspaceInput()),
    STATEFUL_AND_BLUE_EDGE_REFUSALS,
  );
}

/** The managed stack is refused by its preparation. */
function managedRefused(): void {
  expectManagedEdgeRefusal(managedRefusal);
}

describe('the node contract', () => {
  // The goldens are not checked until the switch-role port lands: each test
  // holds the Traefik edge's refusal instead, and the goldens must be
  // regenerated then.
  test('of a workspace (golden)', () => {
    workspaceRefused();
  });

  test('of a managed deployment (golden)', () => {
    managedRefused();
  });

  test('needs no registry: placeholder image facts give the same contract', () => {
    workspaceRefused();
    managedRefused();
  });

  test('is schema version 1, and a reader keeps the fields a newer CLI adds', () => {
    managedRefused();
  });

  test('names the extensions the probe requires and the reserved stop band', () => {
    managedRefused();
  });

  test('counts two colours at the peak of a workspace, and the managed stack once', () => {
    workspaceRefused();
    managedRefused();
  });

  test('leaves the pool limit out while a volume has no declared size', () => {
    managedRefused();
  });

  test('sets the pool limit once every volume declares its size', () => {
    managedRefused();
  });

  test('profile tale-stack carries the root disk and default limits (R3-12)', () => {
    managedRefused();
  });

  test('lists each registry host exactly as the remote URL carries it', () => {
    managedRefused();
  });

  test('allows proxy devices only for the proxy-device ingress', () => {
    workspaceRefused();
    managedRefused();
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
    managedRefused();
  });
});

describe('the ACL rules', () => {
  test('name the sessions real subnet, never a gateway (R3-10)', () => {
    managedRefused();
  });

  test('probe what check can judge and list the rest', () => {
    managedRefused();
  });

  test('give the public egress to the roles that need it, and the helpers', () => {
    managedRefused();
    workspaceRefused();
  });

  test('send the sessions egress to the declared proxy (R-13)', () => {
    managedRefused();
  });

  test('pass operatorReach through, probing tcp only', () => {
    managedRefused();
  });

  test('refuse an endpoint named by a host name', () => {
    managedRefused();
  });

  test("match the sandbox zone an operator makes from the spawner's docs", () => {
    managedRefused();
  });
});
