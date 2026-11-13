import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, X509Certificate } from 'node:crypto';

import type { IncusClient, IncusFetch } from '@tale/incus/client';
import { FakeIncus } from '@tale/incus/fake';

import {
  colourDocument,
  compileInput,
  statefulDocument,
} from '../compile/compile-fixture';
import {
  compileStackTarget,
  requireStackTarget,
} from '../compile/stack-target';
import { REQUIRED_EXTENSIONS } from '../verbs/probe';
import { makeCertificate, type CertificatePair } from './bootstrap';
import {
  CHECK_SENTENCES,
  checkNode,
  classifyProbe,
  forwardingRemedy,
  helperProbes,
  probeCommand,
  probeOf,
  type CheckOptions,
  type ProbeOutcome,
  type ProbeRequest,
} from './check';
import { nodeContract } from './contract';
import type { NodeContract } from './contract-model';

/**
 * `tale incus check` against the in-memory Incus, set up as the contract
 * wants, then broken one way at a time: each break is refused in the fixed
 * words, and nothing else is.
 */

let certificate: CertificatePair;
let contract: NodeContract;

beforeAll(async () => {
  certificate = await makeCertificate({ name: 'tale-test', kind: 'client' });
  const input = compileInput('workspace', [
    { compose: statefulDocument() },
    { compose: colourDocument('blue'), colour: 'blue' },
  ]);
  contract = nodeContract(
    input.declaration,
    requireStackTarget(compileStackTarget(input)),
  );
});

function ruleById(id: string): NodeContract['acls']['rules'][number] {
  const found = contract.acls.rules.find((rule) => rule.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
}

function fingerprint(pem: string): string {
  return createHash('sha256')
    .update(new X509Certificate(pem).raw)
    .digest('hex');
}

interface Node {
  fake: FakeIncus;
  client: IncusClient;
  /** What the server says of the client certificate. */
  trust: Record<string, unknown> | null;
  /** The bridge's addresses (its state). */
  addresses: { family: string; address: string; netmask: string }[];
}

/** The fake, completed with what a restricted certificate reads beyond it:
 * its own trust entry and the bridge's state. */
function node(): Node {
  const fake = new FakeIncus({
    project: contract.project.name,
    profile: contract.profile.name,
    network: contract.network.name,
    pool: contract.storage.pool,
  });
  fake.extensions = [...REQUIRED_EXTENSIONS];
  fake.projectConfig = { ...contract.project.config };
  fake.profileConfig = { ...contract.profile.config };
  fake.profileDevices = { root: { ...contract.profile.devices.root } };
  const state: Node = {
    fake,
    client: undefined as unknown as IncusClient,
    trust: {
      name: 'tale-tale-stack',
      type: 'client',
      restricted: true,
      projects: [contract.project.name],
    },
    addresses: [{ family: 'inet', address: '10.30.0.1', netmask: '16' }],
  };
  const sync = (metadata: unknown, status = 200) =>
    new Response(
      JSON.stringify(
        status === 200
          ? { type: 'sync', status: 'Success', status_code: 200, metadata }
          : { type: 'error', error: 'not found', error_code: status },
      ),
      { status, headers: { 'content-type': 'application/json' } },
    );
  const served = fake.fetch;
  const fetch: IncusFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === `/1.0/certificates/${fingerprint(certificate.cert)}`)
      return state.trust === null ? sync(null, 404) : sync(state.trust);
    if (path === `/1.0/networks/${contract.network.name}/state`)
      return sync({ addresses: state.addresses });
    return served(url, init);
  };
  // The fake's own client (its websocket exec included), over this fetch.
  Object.assign(fake, { fetch });
  state.client = fake.client();
  return state;
}

function options(
  outcomes?: (requests: readonly ProbeRequest[]) => ProbeOutcome[],
): CheckOptions {
  return {
    clientCertificate: certificate.cert,
    probes: async (requests) =>
      outcomes?.(requests) ?? requests.map(() => 'open' as const),
    publicTarget: { host: '1.1.1.1', port: 443 },
    publicName: 'tale.dev',
  };
}

let current: Node;
beforeEach(() => {
  current = node();
});

async function refusals(
  probes?: (requests: readonly ProbeRequest[]) => ProbeOutcome[],
): Promise<string[]> {
  const report = await checkNode(current.client, contract, options(probes));
  return report.findings
    .filter((finding) => finding.level === 'refusal')
    .map((finding) => finding.sentence);
}

describe('tale incus check', () => {
  test('passes a node that holds the contract', async () => {
    const report = await checkNode(current.client, contract, options());
    expect(report.findings.filter((f) => f.level === 'refusal')).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.probes.map((probe) => probe.rule).sort()).toEqual([
      'names-to-gateway-udp',
      'public-egress',
      'spawner-to-incus',
      'spawner-to-sessions',
    ]);
  });

  test('refuses a project setting that differs', async () => {
    current.fake.projectConfig['restricted.containers.nesting'] = 'allow';
    expect(await refusals()).toEqual([
      CHECK_SENTENCES.setting(
        'project tale-stack',
        'restricted.containers.nesting',
        'allow',
        'block',
      ),
    ]);
  });

  test("refuses a limit below the stack's peak, and accepts one above", async () => {
    current.fake.projectConfig['limits.memory'] = '8GiB';
    expect(await refusals()).toEqual([
      CHECK_SENTENCES.limitLow(
        'project tale-stack',
        'limits.memory',
        '8GiB',
        contract.project.config['limits.memory'] ?? '',
      ),
    ]);
    current.fake.projectConfig['limits.memory'] = '512GiB';
    current.fake.projectConfig['limits.instances'] = '200';
    expect(await refusals()).toEqual([]);
  });

  test('refuses a registry the project does not list, in the probe words', async () => {
    current.fake.projectConfig['restricted.images.servers'] = 'ghcr.io';
    const refused = await refusals();
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain('does not let the stack pull from docker.io');
  });

  test("refuses a profile without the contract's limits or root disk size", async () => {
    current.fake.profileConfig = { 'limits.memory': '2GiB' };
    current.fake.profileDevices = {
      root: { type: 'disk', path: '/', pool: 'tale', size: '5GiB' },
    };
    const refused = await refusals();
    expect(refused).toHaveLength(2);
    expect(refused[0]).toContain(
      'sets limits.processes (55296), so Incus refuses every instance without its own, and profile tale-stack sets none',
    );
    expect(refused[1]).toBe(
      CHECK_SENTENCES.rootDisk('tale-stack', 'has the size 5GiB, not 10GiB'),
    );
    current.fake.profileConfig = {
      'limits.memory': '2GiB',
      'limits.processes': '100',
    };
    expect(await refusals()).toContain(
      CHECK_SENTENCES.setting(
        'profile tale-stack',
        'limits.processes',
        '100',
        '2048',
      ),
    );
  });

  test('refuses a bridge on another address', async () => {
    current.addresses = [
      { family: 'inet', address: '10.99.0.1', netmask: '24' },
    ];
    expect(await refusals()).toEqual([
      CHECK_SENTENCES.networkAddress('talebr0', '10.99.0.1/24', '10.30.0.1/16'),
    ]);
  });

  test('refuses a certificate that is not restricted to the stack project alone', async () => {
    current.trust = { name: 'wide', restricted: false, projects: [] };
    expect(await refusals()).toEqual([
      CHECK_SENTENCES.certificateUnrestricted('wide'),
    ]);
    current.trust = {
      name: 'two',
      restricted: true,
      projects: ['tale-stack', 'other'],
    };
    expect(await refusals()).toEqual([
      CHECK_SENTENCES.certificateProjects(
        'two',
        ['other', 'tale-stack'],
        ['tale-stack'],
      ),
    ]);
  });

  test('stops at a server that does not trust the certificate', async () => {
    current.fake.auth = 'untrusted';
    const report = await checkNode(current.client, contract, options());
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.sentence)).toEqual([
      CHECK_SENTENCES.certificateMissing(),
    ]);
  });

  test('refuses a dropped forward with the DOCKER-USER remedy first', async () => {
    const report = await checkNode(
      current.client,
      contract,
      options((requests) =>
        requests.map((request) =>
          request.host === '1.1.1.1' ? 'timeout' : 'open',
        ),
      ),
    );
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.level === 'refusal');
    expect(finding?.sentence).toContain(
      'A connection from the app bridge to 1.1.1.1:443 timed out (ACL rule public-egress)',
    );
    expect(finding?.remedy).toBe(forwardingRemedy('talebr0'));
    const remedy = finding?.remedy ?? '';
    expect(remedy.indexOf('DOCKER-USER')).toBeLessThan(
      remedy.indexOf('ip-forward-no-drop'),
    );
    expect(remedy).toContain('iptables -I DOCKER-USER -i talebr0 -j ACCEPT');
  });

  test('takes a refused connection as reached only where nothing must answer', async () => {
    const refused = await refusals((requests) =>
      requests.map((request) => (request.kind === 'dns' ? 'open' : 'refused')),
    );
    expect(refused).toHaveLength(2);
    expect(refused[0]).toContain('refused the connection');
    expect(refused[0]).toContain('spawner-to-incus');
    expect(refused[1]).toContain('public-egress');
    expect(refused.join('\n')).not.toContain('spawner-to-sessions');
  });

  test('refuses a gateway that answers no name', async () => {
    expect(
      await refusals((requests) =>
        requests.map((request) =>
          request.kind === 'dns' ? 'refused' : 'open',
        ),
      ),
    ).toEqual([
      CHECK_SENTENCES.unresolved(ruleById('names-to-gateway-udp'), 'tale.dev'),
    ]);
  });

  test('refuses when the probes cannot run, never passes them silently', async () => {
    const report = await checkNode(current.client, contract, {
      ...options(),
      probes: null,
    });
    expect(report.ok).toBe(false);
    const failing = await checkNode(current.client, contract, {
      ...options(),
      probes: async () => {
        throw new Error('every helper address of the block is taken');
      },
    });
    expect(failing.findings.map((f) => f.sentence)).toContain(
      CHECK_SENTENCES.probeNotRun('every helper address of the block is taken'),
    );
  });

  test('warns when the pool lacks room for the declared volumes', async () => {
    current.fake.poolResources = {
      space: { used: 0, total: 1024 ** 3 },
      inodes: { used: 0, total: 0 },
    };
    const report = await checkNode(current.client, contract, options());
    expect(report.ok).toBe(true);
    expect(
      report.findings
        .filter((f) => f.level === 'warning')
        .map((f) => f.sentence),
    ).toContainEqual(
      expect.stringContaining('storage pool tale has 1GiB free'),
    );
  });
});

describe('the probes', () => {
  test('one per probed rule, aimed at what the rule allows', () => {
    const requests = contract.acls.rules
      .map((rule) =>
        probeOf(rule, {
          publicTarget: { host: '1.1.1.1', port: 443 },
          publicName: 'tale.dev',
        }),
      )
      .filter((request) => request !== null);
    expect(requests).toEqual([
      { kind: 'dns', host: '10.30.0.1', port: 53, name: 'tale.dev' },
      { kind: 'tcp', host: '10.30.0.1', port: 8443, listener: true },
      { kind: 'tcp', host: '10.40.0.1', port: 8200, listener: false },
      { kind: 'tcp', host: '1.1.1.1', port: 443, listener: true },
    ]);
  });

  test("read busybox's words", () => {
    const tcp: ProbeRequest = { kind: 'tcp', host: '10.0.0.1', port: 1 };
    expect(classifyProbe(tcp, { exitCode: 0, stdout: '', stderr: '' })).toBe(
      'open',
    );
    expect(
      classifyProbe(tcp, {
        exitCode: 1,
        stdout: '',
        stderr: 'nc: 10.0.0.1 (10.0.0.1:1): Operation timed out',
      }),
    ).toBe('timeout');
    expect(classifyProbe(tcp, { exitCode: 1, stdout: '', stderr: '' })).toBe(
      'refused',
    );
    expect(
      classifyProbe(
        { kind: 'dns', host: '10.0.0.1', port: 53, name: 'x' },
        { exitCode: 1, stdout: '', stderr: '' },
      ),
    ).toBe('unresolved');
    expect(probeCommand(tcp)).toEqual([
      'nc',
      '-z',
      '-v',
      '-w',
      '5',
      '10.0.0.1',
      '1',
    ]);
  });

  test('run in a helper on the app bridge at a free helper address, deleted after', async () => {
    current.fake.aliases.set('tale-proxy-' + 'a'.repeat(32), 'f'.repeat(64));
    current.fake.exec = (call) =>
      call.command[0] === 'nc' && call.command.includes('1.1.1.1') ? 1 : 0;
    const runner = helperProbes(
      { client: current.client, stack: 'tale', stateRoot: '/nonexistent' },
      contract,
      'ghcr.io/tale-project/tale/tale-proxy:1.0.0',
    );
    const outcomes = await runner([
      { kind: 'tcp', host: '10.30.0.1', port: 8443 },
      { kind: 'tcp', host: '1.1.1.1', port: 443 },
    ]);
    expect(outcomes).toEqual(['open', 'refused']);
    const created = current.fake.requests.find(
      (request) =>
        request.method === 'POST' && request.path === '/1.0/instances',
    );
    const body = created?.body as {
      name: string;
      devices: Record<string, Record<string, string>>;
      source: { alias: string };
      config: Record<string, string>;
    };
    expect(body.name).toMatch(/^job-check-[0-9a-f]{8}$/);
    expect(body.source.alias).toBe(`tale-proxy-${'a'.repeat(32)}`);
    expect(body.config['user.tale.role']).toBe('helper');
    expect(body.devices.eth0).toMatchObject({
      network: 'talebr0',
      'ipv4.address': '10.30.1.16/16',
      'ipv4.gateway': '10.30.0.1',
    });
    expect(current.fake.instances.size).toBe(0);
  });

  test('pull the probe image through the mirror declared for its registry', async () => {
    current.fake.exec = () => 0;
    const digest = `sha256:${'b'.repeat(64)}`;
    const runner = helperProbes(
      { client: current.client, stack: 'tale', stateRoot: '/nonexistent' },
      contract,
      `ghcr.io/tale-project/tale/tale-proxy@${digest}`,
      { registryMirrors: { 'ghcr.io': '127.0.0.1:5000' } },
    );
    await runner([{ kind: 'tcp', host: '10.30.0.1', port: 8443 }]);
    const pulled = current.fake.requests.find(
      (request) => request.method === 'POST' && request.path === '/1.0/images',
    );
    expect(
      (pulled?.body as { source?: { server: string; alias: string } })?.source,
    ).toMatchObject({
      server: 'https://127.0.0.1:5000',
      alias: `tale-project/tale/tale-proxy@${digest}`,
    });
  });
});
