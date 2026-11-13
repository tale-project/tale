import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { X509CertificateGenerator } from '@peculiar/x509';
import { IncusClient, type IncusFetch } from '@tale/incus/client';

import { readOperatorBlock } from '../../../../../../../services/sandbox/e2e/incus/operator-block';
import {
  colourDocument,
  compileInput,
  statefulDocument,
} from '../compile/compile-fixture';
import {
  compileStackTarget,
  requireStackTarget,
  type IncusDeclaration,
} from '../compile/stack-target';
import {
  applyFirewall,
  bootstrapMarker,
  defaultSessionsZone,
  dockerUserRules,
  makeCertificate,
  planBootstrap,
  planRemoval,
  type BootstrapOptions,
  type CertificatePair,
  type HostCommand,
} from './bootstrap';
import { nodeContract } from './contract';
import type { NodeContract } from './contract-model';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

/**
 * `tale incus bootstrap` against an in-memory administrator socket: the plan
 * comes first, a second run changes nothing, the sandbox zone is the one the
 * spawner's docs give an operator, and `--remove` takes away only what
 * bootstrap made.
 */

interface Request {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

/** The admin socket's view of a single box: global objects by path,
 * project objects by path and project. */
class AdminSocket {
  readonly objects = new Map<string, Record<string, unknown>>();
  readonly requests: Request[] = [];
  readonly pools = new Set(['tale']);
  /** Every instance of every project. */
  instances: Record<string, unknown>[] = [];
  /** Instances per project, for the removal's census. */
  held: Record<string, string[]> = {};

  constructor(public serverCertificate: string) {}

  static key(path: string, project?: string): string {
    return path.startsWith('/1.0/profiles/') ? `${path}@${project}` : path;
  }

  readonly fetch: IncusFetch = async (url, init) => {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const query = Object.fromEntries(parsed.searchParams);
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : undefined;
    this.requests.push({ method: init.method, path, query, body });
    const ok = (metadata: unknown) =>
      new Response(
        JSON.stringify({
          type: 'sync',
          status: 'Success',
          status_code: 200,
          metadata,
        }),
        { status: 200 },
      );
    const missing = () =>
      new Response(
        JSON.stringify({ type: 'error', error: 'not found', error_code: 404 }),
        {
          status: 404,
        },
      );
    if (path === '/1.0')
      return ok({ environment: { certificate: this.serverCertificate } });
    if (path.startsWith('/1.0/storage-pools/')) {
      const [, , , pool, rest] = path.split('/');
      if (!this.pools.has(pool ?? '')) return missing();
      return ok(rest === undefined ? { name: pool, driver: 'zfs' } : []);
    }
    if (path === '/1.0/instances')
      return ok(
        query['all-projects'] === 'true'
          ? this.instances
          : (this.held[query.project ?? 'default'] ?? []),
      );
    if (path === '/1.0/images') return ok([]);
    const record = body as Record<string, unknown> | undefined;
    if (init.method === 'POST') {
      const name =
        path === '/1.0/certificates'
          ? createHash('sha256')
              .update(Buffer.from(String(record?.certificate), 'base64'))
              .digest('hex')
          : String(record?.name);
      this.objects.set(AdminSocket.key(`${path}/${name}`, query.project), {
        ...record,
      });
      return ok({});
    }
    const key = AdminSocket.key(path, query.project);
    const current = this.objects.get(key);
    if (current === undefined) return missing();
    if (init.method === 'GET') return ok(current);
    if (init.method === 'PUT') {
      this.objects.set(key, { ...current, ...record });
      return ok({});
    }
    if (init.method === 'DELETE') {
      this.objects.delete(key);
      return ok({});
    }
    return missing();
  };

  client(): IncusClient {
    return new IncusClient({
      endpoint: 'http://incus.socket',
      project: 'tale-stack',
      tls: { ca: '', cert: '', key: '' },
      signal: () => undefined,
      fetch: this.fetch,
    });
  }

  writes(): Request[] {
    return this.requests.filter((request) => request.method !== 'GET');
  }
}

/** iptables, answered from a policy and a set of present rules. */
function firewall(policy: string, dockerUser = true) {
  const rules = new Set<string>();
  const calls: string[][] = [];
  const run: HostCommand = async (argv) => {
    calls.push([...argv]);
    const [, flag, ...rest] = argv;
    if (flag === '-S' && rest[0] === 'FORWARD')
      return {
        exitCode: 0,
        stdout: `-P FORWARD ${policy}\n-A FORWARD -j DOCKER-USER\n`,
        stderr: '',
      };
    if (flag === '-S')
      return { exitCode: dockerUser ? 0 : 1, stdout: '', stderr: '' };
    const rule = rest.join(' ');
    if (flag === '-C')
      return { exitCode: rules.has(rule) ? 0 : 1, stdout: '', stderr: '' };
    if (flag === '-I') rules.add(rule);
    if (flag === '-D') rules.delete(rule);
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { run, rules, calls };
}

let contract: NodeContract;
let declaration: IncusDeclaration;
let server: CertificatePair;
let clients: CertificatePair[];
const directories: string[] = [];

beforeAll(async () => {
  const input = compileInput('workspace', [
    { compose: statefulDocument() },
    { compose: colourDocument('blue'), colour: 'blue' },
  ]);
  declaration = input.declaration;
  contract = nodeContract(
    declaration,
    requireStackTarget(compileStackTarget(input)),
  );
  server = await makeCertificate({
    name: 'incus-test',
    kind: 'server',
    addresses: ['10.30.0.1', '127.0.0.1'],
  });
  clients = [
    await makeCertificate({ name: 'one', kind: 'client' }),
    await makeCertificate({ name: 'two', kind: 'client' }),
  ];
});

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tale-bootstrap-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'tale.json'),
    `${JSON.stringify({ version: 1, cliVersion: '1.0.0', createdAt: 'now', id: 'tale', runtime: { engine: 'incus', incus: declaration } }, null, 2)}\n`,
  );
  return directory;
}

function options(
  socket: AdminSocket,
  directory: string,
  run: HostCommand,
  overrides: Partial<BootstrapOptions> = {},
): BootstrapOptions {
  let next = 0;
  return {
    admin: socket.client(),
    contract,
    declaration,
    workspace: directory,
    zone: defaultSessionsZone(declaration),
    run,
    environment: {},
    makeCertificate: async () =>
      clients[next++ % clients.length] as CertificatePair,
    ...overrides,
  };
}

/** A client certificate bootstrap did not make: an operator's own. */
async function foreignCertificate(): Promise<CertificatePair> {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=operator',
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
  });
  const key = createPrivateKey({
    key: Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
    format: 'der',
    type: 'pkcs8',
  })
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return { cert: certificate.toString('pem'), key };
}

function fingerprint(pem: string): string {
  return createHash('sha256')
    .update(new X509Certificate(pem).raw)
    .digest('hex');
}

describePosix('tale incus bootstrap', () => {
  test('plans every object on a fresh host, then makes them', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const plan = await planBootstrap(
      options(socket, directory, firewall('ACCEPT').run),
    );
    expect(plan.refusals).toEqual([]);
    expect(socket.writes()).toEqual([]);
    expect(plan.steps.map((step) => `${step.action} ${step.object}`)).toEqual([
      'create network acl tale-tale-stack',
      'create network talebr0',
      'create project tale-stack',
      'create profile tale-stack (project tale-stack)',
      'create network acl tale-tale-stack-sessions',
      'create network talebr0-s',
      'create project tale-stack-sessions',
      'create profile sandbox (project tale-stack-sessions)',
      'create trust tale-tale-stack',
      `write ${join(directory, '.tale', 'incus')}`,
      'create trust tale-tale-stack-sessions',
      `write ${join(directory, '.tale', 'sandbox-incus')}`,
      `write ${join(directory, 'tale.json')}`,
    ]);
    await plan.apply();

    const made = (key: string) => socket.objects.get(key) ?? {};
    expect(made('/1.0/projects/tale-stack').config).toEqual(
      contract.project.config,
    );
    expect(made('/1.0/projects/tale-stack').description).toBe(
      bootstrapMarker('tale'),
    );
    expect(made('/1.0/profiles/tale-stack@tale-stack')).toMatchObject({
      config: contract.profile.config,
      devices: contract.profile.devices,
    });
    expect(made('/1.0/networks/talebr0')).toMatchObject({
      type: 'bridge',
      config: contract.network.config,
    });
    const acl = made('/1.0/network-acls/tale-tale-stack');
    expect((acl.egress as unknown[]).length).toBe(
      contract.acls.rules.filter(
        (r) => r.acl === 'stack' && r.direction === 'egress',
      ).length,
    );
    expect(
      (acl.egress as Record<string, string>[]).find(
        (r) => r.description === 'spawner-to-incus',
      ),
    ).toEqual({
      action: 'allow',
      state: 'enabled',
      description: 'spawner-to-incus',
      source: '10.30.1.11/32,10.30.1.16/28',
      destination: '10.30.0.1/32',
      protocol: 'tcp',
      destination_port: '8443',
    });
    const trust = made(
      `/1.0/certificates/${fingerprint(clients[0]?.cert ?? '')}`,
    );
    expect(trust).toMatchObject({
      type: 'client',
      restricted: true,
      projects: ['tale-stack'],
    });
    expect(
      made(`/1.0/certificates/${fingerprint(clients[1]?.cert ?? '')}`).projects,
    ).toEqual(['tale-stack-sessions']);

    for (const name of ['incus', 'sandbox-incus']) {
      const credentials = join(directory, '.tale', name);
      expect(statSync(credentials).mode & 0o777).toBe(0o700);
      for (const file of ['client.crt', 'client.key', 'server.crt'])
        expect(statSync(join(credentials, file)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(credentials, 'server.crt'), 'utf8')).toBe(
        server.cert,
      );
    }
    const project = JSON.parse(
      readFileSync(join(directory, 'tale.json'), 'utf8'),
    );
    expect(project.runtime).toEqual({
      engine: 'incus',
      incus: { ...declaration, endpoint: 'https://10.30.0.1:8443' },
    });
    expect(project.id).toBe('tale');
  });

  test("writes a managed deployment's credentials into its state directory and no tale.json", async () => {
    const socket = new AdminSocket(server.cert);
    const parent = mkdtempSync(join(tmpdir(), 'tale-bootstrap-managed-'));
    directories.push(parent);
    const stateDirectory = join(parent, 'state');
    const run = firewall('ACCEPT').run;
    const managed = { stateDirectory, workspace: join(parent, 'nowhere') };
    const plan = await planBootstrap(options(socket, parent, run, managed));
    expect(plan.refusals).toEqual([]);
    expect(
      plan.steps
        .filter((step) => step.action === 'write')
        .map((step) => step.object),
    ).toEqual([
      join(stateDirectory, 'incus'),
      join(stateDirectory, 'sandbox-incus'),
    ]);
    await plan.apply();
    for (const name of ['incus', 'sandbox-incus'])
      for (const file of ['client.crt', 'client.key', 'server.crt'])
        expect(statSync(join(stateDirectory, name, file)).mode & 0o777).toBe(
          0o600,
        );
    expect(existsSync(join(parent, 'nowhere'))).toBe(false);
    const again = await planBootstrap(options(socket, parent, run, managed));
    expect(again.steps.filter((step) => step.action !== 'keep')).toEqual([]);
    const removal = await planRemoval(options(socket, parent, run, managed));
    await removal.apply();
    expect(existsSync(join(stateDirectory, 'incus', 'client.key'))).toBe(false);
  });

  test('changes nothing on a second run', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const run = firewall('ACCEPT').run;
    await (await planBootstrap(options(socket, directory, run))).apply();
    const before = socket.writes().length;
    const again = await planBootstrap(options(socket, directory, run));
    expect(again.steps.filter((step) => step.action !== 'keep')).toEqual([]);
    await again.apply();
    expect(socket.writes().length).toBe(before);
  });

  test('corrects what it made, and refuses to change what it did not', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const run = firewall('ACCEPT').run;
    await (await planBootstrap(options(socket, directory, run))).apply();
    const project = socket.objects.get('/1.0/projects/tale-stack') ?? {};
    project.config = {
      ...(project.config as object),
      'restricted.containers.nesting': 'allow',
    };
    const fixed = await planBootstrap(options(socket, directory, run));
    expect(
      fixed.steps.find((step) => step.object === 'project tale-stack')?.action,
    ).toBe('update');
    await fixed.apply();
    expect(
      (
        socket.objects.get('/1.0/projects/tale-stack')?.config as
          | Record<string, string>
          | undefined
      )?.['restricted.containers.nesting'],
    ).toBe('block');

    const corrected = socket.objects.get('/1.0/projects/tale-stack') ?? {};
    corrected.description = 'an operator made this';
    corrected.config = {
      ...(corrected.config as object),
      'restricted.containers.nesting': 'allow',
    };
    const refused = await planBootstrap(options(socket, directory, run));
    expect(refused.refusals.join('\n')).toContain(
      'project tale-stack exists, was not made by bootstrap, and differs from the contract (restricted.containers.nesting=block)',
    );
  });

  test('never renumbers a bridge, and uses the host pool it finds', async () => {
    const socket = new AdminSocket(server.cert);
    socket.objects.set('/1.0/networks/talebr0', {
      name: 'talebr0',
      description: bootstrapMarker('tale'),
      config: { 'ipv4.address': '10.99.0.1/24' },
    });
    socket.pools.clear();
    const plan = await planBootstrap(
      options(socket, workspace(), firewall('ACCEPT').run),
    );
    expect(plan.refusals).toEqual([
      "storage pool tale does not exist; bootstrap uses the host's pool and makes none (incus storage create tale zfs).",
      'network talebr0 has the address 10.99.0.1/24; the contract needs 10.30.0.1/16. Choose another bridge name or subnet in tale.json.',
    ]);
  });

  test('makes the sandbox zone an operator makes from the spawner docs', async () => {
    const socket = new AdminSocket(server.cert);
    await (
      await planBootstrap(options(socket, workspace(), firewall('ACCEPT').run))
    ).apply();
    const block = readOperatorBlock();
    const projectFlags = Object.fromEntries(
      [
        ...(
          /incus project create \S+([\s\S]*?)\n\n/.exec(block)?.[1] ?? ''
        ).matchAll(/-c (\S+?)=(\S+)/g),
      ].map(([, key, value]) => [key, value]),
    );
    expect(Object.keys(projectFlags).length).toBeGreaterThan(0);
    expect(
      socket.objects.get('/1.0/projects/tale-stack-sessions')?.config,
    ).toMatchObject(projectFlags);
    const nic =
      /incus profile device add \S+ eth0 nic ([^\\\n]+)\\?\n\s*([^\n]+)/.exec(
        block,
      );
    const nicKeys = `${nic?.[1] ?? ''} ${nic?.[2] ?? ''}`
      .split(/\s+/)
      .filter((word) => word.includes('='))
      .map((word) => word.split('=')[0]);
    expect(nicKeys).toEqual([
      'network',
      'security.acls',
      'security.port_isolation',
    ]);
    const profile = socket.objects.get(
      '/1.0/profiles/sandbox@tale-stack-sessions',
    );
    const eth0 =
      (profile?.devices as Record<string, Record<string, string>> | undefined)
        ?.eth0 ?? {};
    for (const key of nicKeys) expect(eth0[key ?? '']).toBeDefined();
    expect(eth0).toMatchObject({
      network: 'talebr0-s',
      'security.acls': 'tale-tale-stack-sessions',
      'security.port_isolation': 'true',
    });
    expect(block).toContain('--restricted --projects');
    expect(socket.objects.get('/1.0/networks/talebr0-s')?.config).toMatchObject(
      {
        'ipv4.address': '10.40.0.1/24',
        'ipv6.address': 'none',
        'raw.dnsmasq': 'no-resolv',
      },
    );
  });

  test('refuses a server certificate it cannot pin, and replaces it only when asked', async () => {
    const incusDefault = await makeCertificate({
      name: 'incus',
      kind: 'client',
    });
    const socket = new AdminSocket(incusDefault.cert);
    const directory = workspace();
    const refused = await planBootstrap(
      options(socket, directory, firewall('ACCEPT').run),
    );
    expect(refused.refusals.join('\n')).toContain(
      'The server certificate cannot be pinned: it is no CA certificate (CA:FALSE)',
    );
    const incusDirectory = mkdtempSync(join(tmpdir(), 'tale-incus-dir-'));
    directories.push(incusDirectory);
    writeFileSync(join(incusDirectory, 'server.crt'), incusDefault.cert);
    writeFileSync(join(incusDirectory, 'server.key'), incusDefault.key);
    const replace = await planBootstrap(
      options(socket, directory, firewall('ACCEPT').run, {
        replaceServerCertificate: true,
        incusDirectory,
        makeCertificate,
      }),
    );
    expect(replace.steps.map((step) => step.action)).toEqual(['write']);
    expect(replace.warnings.join('\n')).toContain('systemctl restart incus');
    await replace.apply();
    const written = new X509Certificate(
      readFileSync(join(incusDirectory, 'server.crt')),
    );
    expect(written.ca).toBe(true);
    expect(written.subjectAltName).toContain('IP Address:10.30.0.1');
    expect(
      readFileSync(join(incusDirectory, 'server.crt.tale-bootstrap'), 'utf8'),
    ).toBe(incusDefault.cert);
    expect(statSync(join(incusDirectory, 'server.key')).mode & 0o777).toBe(
      0o600,
    );
    expect(socket.writes()).toEqual([]);
  });

  test("asks for DOCKER-USER rules only where Docker's FORWARD policy drops", async () => {
    const accept = await planBootstrap(
      options(
        new AdminSocket(server.cert),
        workspace(),
        firewall('ACCEPT').run,
      ),
    );
    expect(accept.firewall).toEqual([]);
    const host = firewall('DROP');
    const drop = await planBootstrap(
      options(new AdminSocket(server.cert), workspace(), host.run),
    );
    expect(drop.firewall).toEqual(dockerUserRules(['talebr0', 'talebr0-s']));
    expect(drop.warnings.join('\n')).toContain('The FORWARD policy is DROP');
    // Planning never touches the firewall; applying the plan does not either.
    await drop.apply();
    expect(host.rules.size).toBe(0);
    await applyFirewall(host.run, drop.firewall);
    expect(host.rules.size).toBe(4);
    expect(host.calls.find((call) => call[1] === '-I')).toEqual([
      'iptables',
      '-I',
      'DOCKER-USER',
      '-i',
      'talebr0',
      '-j',
      'ACCEPT',
    ]);
  });

  test("warns when another project stops inside Tale's band", async () => {
    const socket = new AdminSocket(server.cert);
    socket.instances = [
      {
        name: 'db',
        project: 'tale-stack',
        expanded_config: { 'boot.stop.priority': '10' },
      },
      {
        name: 'web',
        project: 'hostkit',
        expanded_config: { 'boot.stop.priority': '50' },
      },
      {
        name: 'late',
        project: 'hostkit',
        expanded_config: { 'boot.stop.priority': '95' },
      },
      { name: 'plain', project: 'other', expanded_config: {} },
    ];
    const plan = await planBootstrap(
      options(socket, workspace(), firewall('ACCEPT').run),
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain(
      "Other projects stop inside Tale's reserved band 10-90: hostkit/web (50)",
    );
    expect(plan.warnings[0]).not.toContain('late');
  });
});

describe('tale incus bootstrap --remove', () => {
  test('removes what bootstrap made, in reverse, and the credentials', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const host = firewall('DROP');
    const plan = await planBootstrap(options(socket, directory, host.run));
    await plan.apply();
    await applyFirewall(host.run, plan.firewall);
    socket.objects.set('/1.0/network-acls/tale-tale-stack-sessions', {
      ...socket.objects.get('/1.0/network-acls/tale-tale-stack-sessions'),
      description: 'kept by an operator',
    });
    const removal = await planRemoval(options(socket, directory, host.run));
    expect(removal.refusals).toEqual([]);
    expect(
      removal.steps.map((step) => `${step.action} ${step.object}`),
    ).toEqual([
      `delete trust ${fingerprint(clients[0]?.cert ?? '').slice(0, 12)}`,
      `delete trust ${fingerprint(clients[1]?.cert ?? '').slice(0, 12)}`,
      'delete profile sandbox (project tale-stack-sessions)',
      'delete project tale-stack-sessions',
      'delete network talebr0-s',
      'keep network acl tale-tale-stack-sessions',
      'delete profile tale-stack (project tale-stack)',
      'delete project tale-stack',
      'delete network talebr0',
      'delete network acl tale-tale-stack',
      `delete ${join(directory, '.tale', 'incus')}`,
      `delete ${join(directory, '.tale', 'sandbox-incus')}`,
    ]);
    expect(removal.firewall).toHaveLength(4);
    await removal.apply();
    expect([...socket.objects.keys()]).toEqual([
      '/1.0/network-acls/tale-tale-stack-sessions',
    ]);
    expect(existsSync(join(directory, '.tale', 'incus', 'client.key'))).toBe(
      false,
    );
  });

  test('refuses while a project still holds instances', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    await (
      await planBootstrap(options(socket, directory, firewall('ACCEPT').run))
    ).apply();
    socket.held['tale-stack'] = ['/1.0/instances/db'];
    const removal = await planRemoval(
      options(socket, directory, firewall('ACCEPT').run),
    );
    expect(removal.refusals).toEqual([
      'project tale-stack still holds 1 instances and 0 volumes; remove the stack first, then run bootstrap --remove again.',
    ]);
  });

  test('keeps credentials a workspace already had', async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const existing = join(directory, '.tale', 'incus');
    mkdirSync(existing, { recursive: true, mode: 0o700 });
    writeFileSync(join(existing, 'client.crt'), clients[1]?.cert ?? '');
    writeFileSync(join(existing, 'client.key'), clients[1]?.key ?? '', {
      mode: 0o600,
    });
    const plan = await planBootstrap(
      options(socket, directory, firewall('ACCEPT').run),
    );
    expect(plan.steps.find((step) => step.object === existing)?.action).toBe(
      'keep',
    );
    await plan.apply();
    expect(readFileSync(join(existing, 'client.crt'), 'utf8')).toBe(
      clients[1]?.cert,
    );
  });

  test("keeps an operator's own credentials and trust entry", async () => {
    const socket = new AdminSocket(server.cert);
    const directory = workspace();
    const operator = await foreignCertificate();
    const existing = join(directory, '.tale', 'incus');
    mkdirSync(existing, { recursive: true, mode: 0o700 });
    writeFileSync(join(existing, 'client.crt'), operator.cert);
    writeFileSync(join(existing, 'client.key'), operator.key, { mode: 0o600 });
    const trust = `/1.0/certificates/${fingerprint(operator.cert)}`;
    socket.objects.set(trust, {
      name: 'operator',
      type: 'client',
      restricted: false,
      projects: [],
      description: '',
    });
    // An unrestricted entry bootstrap did not make is never narrowed.
    const refused = await planBootstrap(
      options(socket, directory, firewall('ACCEPT').run),
    );
    expect(refused.refusals).toEqual([
      'trust operator exists, was not made by bootstrap, and is not restricted to tale-stack alone; change it by hand, or remove it and run bootstrap again.',
    ]);
    socket.objects.set(trust, {
      ...socket.objects.get(trust),
      restricted: true,
      projects: ['tale-stack'],
    });
    await (
      await planBootstrap(options(socket, directory, firewall('ACCEPT').run))
    ).apply();
    const removal = await planRemoval(
      options(socket, directory, firewall('ACCEPT').run),
    );
    const steps = removal.steps.map((step) => `${step.action} ${step.object}`);
    expect(steps).toContain(
      `keep trust ${fingerprint(operator.cert).slice(0, 12)}`,
    );
    expect(steps).toContain(`keep ${existing}`);
    expect(steps).toContain(
      `delete ${join(directory, '.tale', 'sandbox-incus')}`,
    );
    await removal.apply();
    expect(socket.objects.has(trust)).toBe(true);
    expect(readFileSync(join(existing, 'client.key'), 'utf8')).toBe(
      operator.key,
    );
    expect(existsSync(join(existing, 'server.crt'))).toBe(true);
    expect(existsSync(join(directory, '.tale', 'sandbox-incus'))).toBe(false);
  });
});
