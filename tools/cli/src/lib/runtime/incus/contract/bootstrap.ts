import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
  type Extension,
} from '@peculiar/x509';
import { IncusApiError } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';

import { preconditionError } from '../../../../utils/fail';
import { SANDBOX_INCUS_DIRECTORY } from '../../../deployment/runtime-sandbox';
import { parseCidr } from '../../../project/runtime-declaration';
import {
  defaultSessionsZone,
  type SessionsZone,
} from '../compile/sessions-zone';
import type { IncusDeclaration } from '../compile/stack-target';
import { managedIncusDirectory, workspaceIncusDirectory } from '../credentials';
import type { ContractRule, NodeContract } from './contract-model';

export { defaultSessionsZone, type SessionsZone };

/**
 * `tale incus bootstrap` (design D-31): make a single box ready for a Tale
 * stack, over the local administrator socket, from the node contract. It is
 * for a self-hoster with one host; ops makes the same objects from the
 * contract with its own tooling.
 *
 * It prints its plan first, then makes what is missing and corrects what it
 * made earlier, so a second run changes nothing:
 *
 * - the stack project, its `tale-stack` profile, the app bridge and its ACL;
 * - the sandbox zone, as `services/sandbox/docs/incus.md` lays it out for an
 *   operator: its bridge, project, ACL, `sandbox` profile;
 * - two restricted certificates (the CLI's, for the stack project; the
 *   spawner's, for the zone's project), trusted by the server, with the
 *   server's own certificate beside each, once it is pinnable;
 * - the workspace's `tale.json` runtime and `.tale/incus/`, `.tale/sandbox-incus/`;
 *   for a managed deployment (`--spec`), its state directory's `incus/` and
 *   `sandbox-incus/`, beside a specification bootstrap never writes.
 *
 * Host state the restricted certificate cannot see is read here, as root:
 * Docker's FORWARD policy (its `DOCKER-USER` accept rules are applied only
 * after asking, design R3-13) and other projects' stop priorities inside
 * Tale's band (design R3-28). `--remove` takes away what bootstrap made, and
 * nothing else: every object it makes carries its description.
 */

/** The description every object bootstrap makes carries. */
export function bootstrapMarker(stack: string): string {
  return `Made by tale incus bootstrap for ${stack}`;
}

export interface BootstrapStep {
  /** `project tale`, `network acl tale-tale`, … */
  object: string;
  action: 'create' | 'update' | 'keep' | 'delete' | 'write' | 'refuse';
  detail: string;
}

export interface BootstrapPlan {
  steps: BootstrapStep[];
  warnings: string[];
  /** The `DOCKER-USER` rules the host needs, applied only after asking. */
  firewall: string[][];
  /** Refusals: the plan cannot be applied while any is listed. */
  refusals: string[];
  apply: () => Promise<void>;
}

/** Runs a host command (iptables) and says how it ended. */
export type HostCommand = (
  argv: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface BootstrapOptions {
  admin: IncusClient;
  contract: NodeContract;
  declaration: IncusDeclaration;
  /** The workspace whose `tale.json` and `.tale/` bootstrap writes. */
  workspace: string;
  /** A managed deployment instead: the state directory whose `incus/` and
   * `sandbox-incus/` bootstrap writes; its specification stays untouched. */
  stateDirectory?: string;
  zone: SessionsZone;
  run: HostCommand;
  environment?: NodeJS.ProcessEnv;
  /** Replace a server certificate the CLI cannot pin with a new one
   * (CA:TRUE, naming the endpoint), in `incusDirectory`. */
  replaceServerCertificate?: boolean;
  incusDirectory?: string;
  /** Make the certificates (a test hands in fixed ones). */
  makeCertificate?: typeof makeCertificate;
}

const WAIT_MS = 120_000;
const SESSION_ROOT_SIZE = '30GiB';
const CREDENTIAL_FILES = ['client.crt', 'client.key', 'server.crt'] as const;

// ---- certificates -----------------------------------------------------------

/** The organisation every certificate bootstrap makes names, so `--remove`
 * tells the credentials it made from ones a workspace already had. */
const BOOTSTRAP_ORGANIZATION = 'tale incus bootstrap';

/** Whether bootstrap made the certificate `pem`. */
function madeByBootstrap(pem: string): boolean {
  return new X509Certificate(pem).subject
    .split('\n')
    .includes(`O=${BOOTSTRAP_ORGANIZATION}`);
}

/** A self-signed certificate and its key, as PEM. */
export interface CertificatePair {
  cert: string;
  key: string;
}

/** A client certificate for a restricted trust entry, or a pinnable server
 * certificate (CA:TRUE, pathlen 0) naming `addresses`. */
export async function makeCertificate(options: {
  name: string;
  kind: 'client' | 'server';
  addresses?: readonly string[];
  days?: number;
}): Promise<CertificatePair> {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-384' },
    true,
    ['sign', 'verify'],
  );
  const extensions: Extension[] =
    options.kind === 'server'
      ? [
          new BasicConstraintsExtension(true, 0, true),
          new KeyUsagesExtension(
            KeyUsageFlags.digitalSignature |
              KeyUsageFlags.keyEncipherment |
              KeyUsageFlags.keyCertSign,
            true,
          ),
          new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
          new SubjectAlternativeNameExtension(
            (options.addresses ?? []).map((value) => ({
              type: /^[\d.]+$/.test(value) ? 'ip' : 'dns',
              value,
            })),
          ),
        ]
      : [
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
          new ExtendedKeyUsageExtension([ExtendedKeyUsage.clientAuth], false),
        ];
  const now = Date.now();
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: createHash('sha256')
      .update(`${options.name}:${now}:${Math.random()}`)
      .digest('hex')
      .slice(0, 16),
    name: `CN=${options.name}, O=${BOOTSTRAP_ORGANIZATION}`,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + (options.days ?? 3650) * 86_400_000),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-384' },
    keys,
    extensions,
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

/** Why a server certificate cannot be pinned for `host`; null when it can. */
function unpinnable(pem: string, host: string): string | null {
  const certificate = new X509Certificate(pem);
  if (!certificate.ca)
    return 'it is no CA certificate (CA:FALSE), and Bun pins only a certificate that is its own trust anchor';
  const names = certificate.subjectAltName ?? '';
  const named = names
    .split(',')
    .map((entry) => entry.trim().replace(/^(IP Address|DNS):/, ''));
  if (!named.includes(host))
    return `it does not name ${host}, the address the CLI and the spawner dial (it names ${named.join(', ') || 'nothing'})`;
  return null;
}

// ---- the Incus calls --------------------------------------------------------

async function read(
  admin: IncusClient,
  path: string,
  query: Record<string, string> = {},
): Promise<Record<string, unknown> | undefined> {
  try {
    const metadata = await admin.sync('GET', path, { query, retry: true });
    return metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>)
      : undefined;
  } catch (error) {
    if (error instanceof IncusApiError && error.status === 404)
      return undefined;
    throw error;
  }
}

async function call(
  admin: IncusClient,
  method: string,
  path: string,
  json: unknown,
  query: Record<string, string> = {},
): Promise<void> {
  await admin.operation(method, path, {
    ...(json === undefined ? {} : { json }),
    query,
    waitMs: WAIT_MS,
  });
}

function stringMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** Whether `actual` holds every key of `wanted` with its value. */
function holds(
  actual: Record<string, string>,
  wanted: Record<string, string>,
): boolean {
  return Object.entries(wanted).every(([key, value]) => actual[key] === value);
}

function differences(
  actual: Record<string, string>,
  wanted: Record<string, string>,
): string {
  return Object.entries(wanted)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

/** An ACL rule as the Incus API takes it. */
function aclRule(rule: ContractRule): Record<string, string> {
  return {
    action: 'allow',
    state: 'enabled',
    description: rule.id,
    ...(rule.source === undefined ? {} : { source: rule.source.join(',') }),
    ...(rule.destination === undefined
      ? {}
      : { destination: rule.destination.join(',') }),
    ...(rule.protocol === undefined ? {} : { protocol: rule.protocol }),
    ...(rule.ports === undefined
      ? {}
      : { destination_port: rule.ports.join(',') }),
  };
}

function sameRules(actual: unknown, wanted: Record<string, string>[]): boolean {
  if (!Array.isArray(actual)) return wanted.length === 0;
  const normal = (rules: Record<string, string>[]): string =>
    JSON.stringify(
      rules
        .map((rule) =>
          Object.fromEntries(
            Object.entries(rule)
              .filter(([, value]) => value !== '')
              .sort(([left], [right]) => left.localeCompare(right)),
          ),
        )
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    );
  return normal(actual.map(stringMap)) === normal(wanted);
}

// ---- the host ------------------------------------------------------------------

/** `DOCKER-USER` accept rules for `bridges` (design R3-13: they work at
 * once; `ip-forward-no-drop` needs a reboot). */
export function dockerUserRules(bridges: readonly string[]): string[][] {
  return bridges.flatMap((bridge) => [
    ['DOCKER-USER', '-i', bridge, '-j', 'ACCEPT'],
    [
      'DOCKER-USER',
      '-o',
      bridge,
      '-m',
      'conntrack',
      '--ctstate',
      'RELATED,ESTABLISHED',
      '-j',
      'ACCEPT',
    ],
  ]);
}

/** The FORWARD chain's policy, and the `DOCKER-USER` rules still missing;
 * null policy when iptables cannot be read. */
async function readForwarding(
  run: HostCommand,
  bridges: readonly string[],
): Promise<{
  policy: string | null;
  missing: string[][];
  dockerUser: boolean;
}> {
  const forward = await run(['iptables', '-S', 'FORWARD']).catch(
    (error: unknown) => {
      console.warn(
        'iptables could not be run:',
        error instanceof Error ? error.message : error,
      );
      return { exitCode: 127, stdout: '', stderr: '' };
    },
  );
  if (forward.exitCode !== 0)
    return { policy: null, missing: [], dockerUser: false };
  const policy = /^-P FORWARD (\S+)$/m.exec(forward.stdout)?.[1] ?? null;
  const dockerUser =
    (await run(['iptables', '-S', 'DOCKER-USER'])).exitCode === 0;
  const missing: string[][] = [];
  if (policy !== 'ACCEPT' && dockerUser)
    for (const rule of dockerUserRules(bridges))
      if ((await run(['iptables', '-C', ...rule])).exitCode !== 0)
        missing.push(rule);
  return { policy, missing, dockerUser };
}

/** Other projects' instances whose stop priority sits in Tale's band
 * (design D-23, R3-28). */
async function stopBandWarnings(
  admin: IncusClient,
  contract: NodeContract,
  ownProjects: readonly string[],
): Promise<string[]> {
  const listed = await admin.sync('GET', '/1.0/instances', {
    query: { 'all-projects': 'true', recursion: '1' },
    retry: true,
  });
  const { from, to } = contract.stopPriorities.reservedBand;
  const inside: string[] = [];
  for (const entry of Array.isArray(listed) ? listed : []) {
    const instance = entry as Record<string, unknown>;
    const project =
      typeof instance.project === 'string' ? instance.project : 'default';
    if (ownProjects.includes(project)) continue;
    const priority = Number(
      stringMap(instance.expanded_config)['boot.stop.priority'] ?? '0',
    );
    if (priority >= from && priority <= to)
      inside.push(`${project}/${String(instance.name)} (${priority})`);
  }
  if (inside.length === 0) return [];
  return [
    `Other projects stop inside Tale's reserved band ${from}-${to}: ${inside.join(', ')}. A host shutdown stops one boot.stop.priority group at a time for up to 30 s each, so Tale's data services can be killed before their signal; move those priorities outside ${from}-${to}, or stop Tale with tale stop before the host shuts down.`,
  ];
}

// ---- the plan ---------------------------------------------------------------------

interface ObjectSpec {
  object: string;
  path: string;
  query?: Record<string, string>;
  /** The body of a create. */
  create: Record<string, unknown>;
  /** Whether the object as read is already what the contract wants. */
  matches: (actual: Record<string, unknown>) => boolean;
  /** The body of an update (PUT) from the object as read. */
  update: (actual: Record<string, unknown>) => Record<string, unknown>;
  detail: string;
  /** A difference bootstrap must not correct on an object it found. */
  refuse?: (actual: Record<string, unknown>) => string | null;
}

function sessionsGateway(subnet: string): { address: string; range: string } {
  const network = parseCidr(subnet);
  const at = (value: number): string =>
    [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
  const half =
    network.first + Math.floor((network.last - network.first + 1) / 2);
  return {
    address: `${at(network.first + 1)}/${network.prefix}`,
    range: `${at(half)}-${at(network.last - 1)}`,
  };
}

function objectSpecs(options: BootstrapOptions): ObjectSpec[] {
  const { contract, zone, declaration } = options;
  const marker = bootstrapMarker(contract.stack);
  const project = contract.project.name;
  const stackRules = contract.acls.rules.filter((rule) => rule.acl === 'stack');
  const zoneRules = contract.acls.rules.filter(
    (rule) => rule.acl === 'sessions',
  );
  const acl = (name: string, rules: ContractRule[]): ObjectSpec => {
    const egress = rules
      .filter((rule) => rule.direction === 'egress')
      .map(aclRule);
    const ingress = rules
      .filter((rule) => rule.direction === 'ingress')
      .map(aclRule);
    return {
      object: `network acl ${name}`,
      path: `/1.0/network-acls/${name}`,
      create: { name, description: marker, egress, ingress },
      matches: (actual) =>
        sameRules(actual.egress, egress) && sameRules(actual.ingress, ingress),
      update: (actual) => ({
        description: actual.description ?? marker,
        config: stringMap(actual.config),
        egress,
        ingress,
      }),
      detail: `${egress.length} egress and ${ingress.length} ingress rules`,
    };
  };
  const projectSpec = (
    name: string,
    config: Record<string, string>,
  ): ObjectSpec => ({
    object: `project ${name}`,
    path: `/1.0/projects/${name}`,
    create: { name, description: marker, config },
    matches: (actual) => holds(stringMap(actual.config), config),
    update: (actual) => ({
      description: actual.description ?? marker,
      config: { ...stringMap(actual.config), ...config },
    }),
    detail: Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join(' '),
  });
  const networkSpec = (
    name: string,
    config: Record<string, string>,
  ): ObjectSpec => ({
    object: `network ${name}`,
    path: `/1.0/networks/${name}`,
    create: { name, type: 'bridge', description: marker, config },
    matches: (actual) => holds(stringMap(actual.config), config),
    update: (actual) => ({
      description: actual.description ?? marker,
      config: { ...stringMap(actual.config), ...config },
    }),
    detail: Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join(' '),
    // Renumbering a bridge others may use is not bootstrap's call.
    refuse: (actual) => {
      const address = stringMap(actual.config)['ipv4.address'];
      return address !== undefined && address !== config['ipv4.address']
        ? `network ${name} has the address ${address}; the contract needs ${config['ipv4.address']}. Choose another bridge name or subnet in tale.json.`
        : null;
    },
  });
  const profileSpec = (
    name: string,
    projectName: string,
    config: Record<string, string>,
    devices: Record<string, Record<string, string>>,
  ): ObjectSpec => ({
    object: `profile ${name} (project ${projectName})`,
    path: `/1.0/profiles/${name}`,
    query: { project: projectName },
    create: { name, description: marker, config, devices },
    matches: (actual) =>
      holds(stringMap(actual.config), config) &&
      Object.entries(devices).every(([device, wanted]) =>
        holds(
          stringMap(
            (actual.devices as Record<string, unknown> | undefined)?.[device],
          ),
          wanted,
        ),
      ),
    update: (actual) => ({
      description: actual.description ?? marker,
      config: { ...stringMap(actual.config), ...config },
      devices: {
        ...(actual.devices as Record<string, unknown> | undefined),
        ...devices,
      },
    }),
    detail: [
      ...Object.entries(config).map(([key, value]) => `${key}=${value}`),
      ...Object.keys(devices).map((device) => `device ${device}`),
    ].join(' '),
  });
  const zoneNetwork = sessionsGateway(declaration.sessions.subnet);
  return [
    acl(contract.acls.stack, stackRules),
    networkSpec(contract.network.name, contract.network.config),
    projectSpec(project, contract.project.config),
    profileSpec(
      contract.profile.name,
      project,
      contract.profile.config,
      contract.profile.devices,
    ),
    // The sandbox zone (services/sandbox/docs/incus.md, the operator block).
    acl(contract.acls.sessions, zoneRules),
    networkSpec(zone.network, {
      'ipv4.address': zoneNetwork.address,
      'ipv4.nat': 'false',
      'ipv4.dhcp.ranges': zoneNetwork.range,
      'ipv6.address': 'none',
      'raw.dnsmasq': 'no-resolv',
    }),
    projectSpec(zone.project, {
      'features.images': 'true',
      'features.profiles': 'true',
      'features.storage.volumes': 'true',
      restricted: 'true',
      'restricted.networks.access': zone.network,
      'restricted.storage-pools.access': contract.storage.pool,
    }),
    profileSpec(
      zone.profile,
      zone.project,
      {},
      {
        eth0: {
          type: 'nic',
          name: 'eth0',
          network: zone.network,
          'security.acls': contract.acls.sessions,
          'security.port_isolation': 'true',
        },
        root: {
          type: 'disk',
          path: '/',
          pool: contract.storage.pool,
          size: SESSION_ROOT_SIZE,
        },
      },
    ),
  ];
}

interface Credentials {
  directory: string;
  pair: CertificatePair;
  generated: boolean;
  trust: { name: string; projects: string[] };
}

function readPair(directory: string): CertificatePair | null {
  const cert = join(directory, 'client.crt');
  const key = join(directory, 'client.key');
  if (!existsSync(cert) || !existsSync(key)) return null;
  return { cert: readFileSync(cert, 'utf8'), key: readFileSync(key, 'utf8') };
}

function writePrivate(
  path: string,
  content: string,
  owner: { uid: number; gid: number } | null,
): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
  if (owner !== null) chownSync(path, owner.uid, owner.gid);
}

/** The owner of the workspace (or of the state directory, or the nearest
 * directory above it that exists), for files root writes into it. */
function workspaceOwner(
  workspace: string,
): { uid: number; gid: number } | null {
  if (process.getuid?.() !== 0) return null;
  let path = workspace;
  while (!existsSync(path) && dirname(path) !== path) path = dirname(path);
  const stat = statSync(path);
  return { uid: stat.uid, gid: stat.gid };
}

/** Where the two credential pairs live: the workspace's `.tale/`, or a
 * managed deployment's state directory. */
function credentialDirectories(options: BootstrapOptions): {
  owner: string;
  stack: string;
  sandbox: string;
} {
  if (options.stateDirectory !== undefined)
    return {
      owner: options.stateDirectory,
      stack: managedIncusDirectory(options.stateDirectory),
      sandbox: join(options.stateDirectory, SANDBOX_INCUS_DIRECTORY),
    };
  return {
    owner: options.workspace,
    stack: workspaceIncusDirectory(
      options.workspace,
      options.environment ?? process.env,
    ),
    sandbox: join(options.workspace, '.tale', SANDBOX_INCUS_DIRECTORY),
  };
}

/** The endpoint the CLI and the spawner dial. */
function endpointOf(declaration: IncusDeclaration): string {
  return declaration.endpoint ?? `https://${declaration.network.gateway}:8443`;
}

/** Plan the bootstrap; nothing changes until `apply`. */
export async function planBootstrap(
  options: BootstrapOptions,
): Promise<BootstrapPlan> {
  const { admin, contract, declaration, zone } = options;
  const marker = bootstrapMarker(contract.stack);
  const steps: BootstrapStep[] = [];
  const refusals: string[] = [];
  const actions: (() => Promise<void>)[] = [];

  // The pool is the host's, made when Incus was installed.
  if (
    (await read(admin, `/1.0/storage-pools/${contract.storage.pool}`)) ===
    undefined
  )
    refusals.push(
      `storage pool ${contract.storage.pool} does not exist; bootstrap uses the host's pool and makes none (incus storage create ${contract.storage.pool} zfs).`,
    );

  for (const spec of objectSpecs(options)) {
    const actual = await read(admin, spec.path, spec.query);
    if (actual === undefined) {
      steps.push({
        object: spec.object,
        action: 'create',
        detail: spec.detail,
      });
      const [collection] = spec.path.split(/\/(?=[^/]+$)/);
      actions.push(() =>
        call(admin, 'POST', collection ?? spec.path, spec.create, spec.query),
      );
      continue;
    }
    const refused = spec.refuse?.(actual) ?? null;
    if (refused !== null) {
      steps.push({ object: spec.object, action: 'refuse', detail: refused });
      refusals.push(refused);
      continue;
    }
    if (spec.matches(actual)) {
      steps.push({
        object: spec.object,
        action: 'keep',
        detail: 'as the contract wants',
      });
      continue;
    }
    if (actual.description !== marker) {
      const detail = `exists, was not made by bootstrap, and differs from the contract (${differences(stringMap(actual.config), stringMap(spec.create.config))}); change it by hand, or remove it and run bootstrap again`;
      steps.push({ object: spec.object, action: 'refuse', detail });
      refusals.push(`${spec.object} ${detail}.`);
      continue;
    }
    steps.push({ object: spec.object, action: 'update', detail: spec.detail });
    actions.push(() =>
      call(admin, 'PUT', spec.path, spec.update(actual), spec.query),
    );
  }

  // The server's certificate: the CLI and the spawner pin it.
  const server = await read(admin, '/1.0');
  const environment = (server?.environment ?? {}) as Record<string, unknown>;
  const serverPem =
    typeof environment.certificate === 'string' ? environment.certificate : '';
  const endpoint = new URL(endpointOf(declaration));
  const why =
    serverPem === ''
      ? 'the server sent none'
      : unpinnable(serverPem, endpoint.hostname);
  const pinned = serverPem;
  if (why !== null && options.replaceServerCertificate === true) {
    // Only the certificate changes this run: Incus reads it at start, and
    // every later step pins it.
    const directory = options.incusDirectory ?? '/var/lib/incus';
    const addresses = [
      ...new Set([endpoint.hostname, '127.0.0.1', declaration.network.gateway]),
    ];
    const make = options.makeCertificate ?? makeCertificate;
    return {
      steps: [
        {
          object: `server certificate ${join(directory, 'server.crt')}`,
          action: 'write',
          detail: `a pinnable one (CA:TRUE) naming ${addresses.join(', ')}; the old one stays as server.crt.tale-bootstrap`,
        },
      ],
      warnings: [
        'Restart Incus (systemctl restart incus) once the certificate is written, then run tale incus bootstrap again.',
      ],
      firewall: [],
      refusals,
      apply: async () => {
        const pair = await make({
          name: `incus-${declaration.project}`,
          kind: 'server',
          addresses,
        });
        for (const file of ['server.crt', 'server.key'])
          if (existsSync(join(directory, file)))
            copyFileSync(
              join(directory, file),
              join(directory, `${file}.tale-bootstrap`),
            );
        writePrivate(join(directory, 'server.key'), pair.key, null);
        writeFileSync(join(directory, 'server.crt'), pair.cert, {
          mode: 0o644,
        });
      },
    };
  }
  if (why !== null)
    refusals.push(
      `The server certificate cannot be pinned: ${why}. Run bootstrap with --replace-server-certificate to give Incus a pinnable one, or install one yourself.`,
    );

  // Two restricted certificates: the CLI's and the spawner's.
  const directories = credentialDirectories(options);
  const owner = workspaceOwner(directories.owner);
  const make = options.makeCertificate ?? makeCertificate;
  const stackDirectory = directories.stack;
  const sandboxDirectory = directories.sandbox;
  const credentials: Credentials[] = [];
  for (const [directory, trust] of [
    [
      stackDirectory,
      {
        name: contract.certificate.name,
        projects: contract.certificate.projects,
      },
    ],
    [
      sandboxDirectory,
      {
        name: `${contract.certificate.name}-sessions`,
        projects: [zone.project],
      },
    ],
  ] as const) {
    const existing = readPair(directory);
    const pair = existing ?? (await make({ name: trust.name, kind: 'client' }));
    credentials.push({
      directory,
      pair,
      generated: existing === null,
      trust: { name: trust.name, projects: [...trust.projects] },
    });
    const entry = await read(
      admin,
      `/1.0/certificates/${fingerprint(pair.cert)}`,
    );
    const projects = Array.isArray(entry?.projects)
      ? (entry.projects as string[]).slice().sort()
      : [];
    if (entry === undefined) {
      steps.push({
        object: `trust ${trust.name}`,
        action: 'create',
        detail: `restricted to ${trust.projects.join(', ')}`,
      });
      actions.push(() =>
        call(admin, 'POST', '/1.0/certificates', {
          name: trust.name,
          type: 'client',
          restricted: true,
          projects: trust.projects,
          description: marker,
          certificate: Buffer.from(new X509Certificate(pair.cert).raw).toString(
            'base64',
          ),
        }),
      );
    } else if (
      entry.restricted !== true ||
      projects.join(',') !== [...trust.projects].sort().join(',')
    ) {
      if (entry.description !== marker) {
        const detail = `exists, was not made by bootstrap, and is not restricted to ${trust.projects.join(', ')} alone; change it by hand, or remove it and run bootstrap again`;
        const object = `trust ${typeof entry.name === 'string' ? entry.name : trust.name}`;
        steps.push({ object, action: 'refuse', detail });
        refusals.push(`${object} ${detail}.`);
        continue;
      }
      steps.push({
        object: `trust ${trust.name}`,
        action: 'update',
        detail: `restricted to ${trust.projects.join(', ')}`,
      });
      actions.push(() =>
        call(admin, 'PUT', `/1.0/certificates/${fingerprint(pair.cert)}`, {
          name: entry.name ?? trust.name,
          type: 'client',
          restricted: true,
          projects: trust.projects,
          description: marker,
        }),
      );
    } else
      steps.push({
        object: `trust ${trust.name}`,
        action: 'keep',
        detail: `restricted to ${trust.projects.join(', ')}`,
      });
    steps.push({
      object: directory,
      action: existing === null ? 'write' : 'keep',
      detail: `${CREDENTIAL_FILES.join(', ')} (0600)`,
    });
  }

  // The workspace declaration names the runtime and the endpoint; a managed
  // deployment's specification is its operator's, and is left as it is. A
  // Docker workspace that declares its migration target (`runtime.next`,
  // design 14) keeps running on Docker: the endpoint goes into
  // `runtime.next`, and `tale runtime migrate` flips the engine once the
  // stack moved.
  const taleJson = join(options.workspace, 'tale.json');
  const project =
    options.stateDirectory === undefined
      ? (JSON.parse(readFileSync(taleJson, 'utf8')) as Record<string, unknown>)
      : null;
  const declared = project?.runtime as
    | { engine?: string; next?: { engine?: string } }
    | undefined;
  const incus = { ...declaration, endpoint: endpointOf(declaration) };
  const migrating =
    declared?.engine !== 'incus' && declared?.next?.engine === 'incus';
  const runtime = migrating
    ? { ...declared, next: { engine: 'incus', incus } }
    : { engine: 'incus', incus };
  const runtimeChanged =
    project !== null &&
    JSON.stringify(project.runtime) !== JSON.stringify(runtime);
  if (project !== null)
    steps.push({
      object: taleJson,
      action: runtimeChanged ? 'write' : 'keep',
      detail: migrating
        ? `runtime.next.engine incus, runtime.next.incus.endpoint ${incus.endpoint} (the workspace runs on ${declared?.engine ?? 'docker'} until tale runtime migrate)`
        : `runtime.engine incus, runtime.incus.endpoint ${incus.endpoint}`,
    });

  // Host state the restricted certificate cannot see.
  const warnings = await stopBandWarnings(admin, contract, [
    contract.project.name,
    zone.project,
  ]);
  const forwarding = await readForwarding(options.run, [
    contract.network.name,
    zone.network,
  ]);
  if (forwarding.policy === null)
    warnings.push(
      'The FORWARD policy could not be read (iptables); if Docker runs here, run tale incus check to see whether the bridges forward.',
    );
  else if (forwarding.policy !== 'ACCEPT' && !forwarding.dockerUser)
    warnings.push(
      `The FORWARD policy is ${forwarding.policy} and there is no DOCKER-USER chain; accept the bridges ${contract.network.name} and ${zone.network} in your firewall.`,
    );

  if (forwarding.missing.length > 0)
    warnings.push(
      `The FORWARD policy is ${forwarding.policy ?? 'unknown'}: Docker drops the bridges' traffic. The DOCKER-USER rules below accept it at once and are asked for separately; they last until the host reboots unless your firewall setup keeps them, and "ip-forward-no-drop": true in /etc/docker/daemon.json is the lasting remedy once the host reboots.`,
    );
  return {
    steps,
    warnings,
    firewall: forwarding.missing,
    refusals,
    apply: async () => {
      for (const action of actions) await action();
      for (const item of credentials) {
        mkdirSync(item.directory, { recursive: true, mode: 0o700 });
        chmodSync(item.directory, 0o700);
        if (owner !== null) {
          chownSync(join(item.directory, '..'), owner.uid, owner.gid);
          chownSync(item.directory, owner.uid, owner.gid);
        }
        if (item.generated) {
          writePrivate(
            join(item.directory, 'client.crt'),
            item.pair.cert,
            owner,
          );
          writePrivate(
            join(item.directory, 'client.key'),
            item.pair.key,
            owner,
          );
        }
        writePrivate(join(item.directory, 'server.crt'), pinned, owner);
      }
      if (project !== null && runtimeChanged) {
        writeFileSync(
          taleJson,
          `${JSON.stringify({ ...project, runtime }, null, 2)}\n`,
        );
      }
    },
  };
}

/** Apply the `DOCKER-USER` rules `rules` (`iptables -I`). */
export async function applyFirewall(
  run: HostCommand,
  rules: readonly string[][],
): Promise<void> {
  for (const rule of rules) {
    const result = await run(['iptables', '-I', ...rule]);
    if (result.exitCode !== 0)
      throw preconditionError(
        `iptables -I ${rule.join(' ')} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
  }
}

/**
 * Plan the removal of what bootstrap made, in the reverse order: the trust
 * entries, the zone, the stack's profile, project, bridge and ACL, the
 * `DOCKER-USER` rules (after asking), and the workspace's credentials. An
 * object, trust entry or certificate pair bootstrap did not make is left
 * alone; a project that still holds instances or volumes is refused, and the
 * images a project holds go with it.
 */
export async function planRemoval(
  options: BootstrapOptions,
): Promise<BootstrapPlan> {
  const { admin, contract, zone } = options;
  const marker = bootstrapMarker(contract.stack);
  const steps: BootstrapStep[] = [];
  const refusals: string[] = [];
  const actions: (() => Promise<void>)[] = [];
  const { stack: stackDirectory, sandbox: sandboxDirectory } =
    credentialDirectories(options);

  // The credentials bootstrap made; a pair a workspace already had stays,
  // with the server certificate pinned beside it.
  const ownCredentials: string[] = [];
  for (const directory of [stackDirectory, sandboxDirectory]) {
    const pair = readPair(directory);
    if (pair === null) continue;
    if (madeByBootstrap(pair.cert)) ownCredentials.push(directory);
    const id = fingerprint(pair.cert);
    const entry = await read(admin, `/1.0/certificates/${id}`);
    if (entry === undefined) continue;
    if (entry.description !== marker) {
      steps.push({
        object: `trust ${id.slice(0, 12)}`,
        action: 'keep',
        detail: 'not made by bootstrap',
      });
      continue;
    }
    steps.push({
      object: `trust ${id.slice(0, 12)}`,
      action: 'delete',
      detail: `the certificate in ${directory}`,
    });
    actions.push(() =>
      call(admin, 'DELETE', `/1.0/certificates/${id}`, undefined),
    );
  }
  for (const project of [zone.project, contract.project.name]) {
    if ((await read(admin, `/1.0/projects/${project}`)) === undefined) continue;
    const held = await admin.sync('GET', '/1.0/instances', {
      query: { project },
    });
    const volumes = await admin
      .sync(
        'GET',
        `/1.0/storage-pools/${contract.storage.pool}/volumes/custom`,
        { query: { project } },
      )
      .catch((error: unknown) => {
        if (error instanceof IncusApiError && error.status === 404) return [];
        throw error;
      });
    const count = (value: unknown): number =>
      Array.isArray(value) ? value.length : 0;
    if (count(held) + count(volumes) > 0)
      refusals.push(
        `project ${project} still holds ${count(held)} instances and ${count(volumes)} volumes; remove the stack first, then run bootstrap --remove again.`,
      );
  }
  const specs = objectSpecs(options).reverse();
  for (const spec of specs) {
    const actual = await read(admin, spec.path, spec.query);
    if (actual === undefined) continue;
    if (actual.description !== marker) {
      steps.push({
        object: spec.object,
        action: 'keep',
        detail: 'not made by bootstrap',
      });
      continue;
    }
    steps.push({ object: spec.object, action: 'delete', detail: '' });
    actions.push(async () => {
      if (spec.object.startsWith('project '))
        await emptyProject(admin, spec.path.split('/').pop() ?? '');
      await call(admin, 'DELETE', spec.path, undefined, spec.query);
    });
  }
  const installed = await readForwarding(options.run, [
    contract.network.name,
    zone.network,
  ]);
  const present = installed.dockerUser
    ? (
        await Promise.all(
          dockerUserRules([contract.network.name, zone.network]).map(
            async (rule) =>
              (await options.run(['iptables', '-C', ...rule])).exitCode === 0
                ? rule
                : null,
          ),
        )
      ).filter((rule): rule is string[] => rule !== null)
    : [];
  for (const directory of [stackDirectory, sandboxDirectory]) {
    const files = CREDENTIAL_FILES.filter((file) =>
      existsSync(join(directory, file)),
    );
    if (files.length === 0) continue;
    steps.push(
      ownCredentials.includes(directory)
        ? { object: directory, action: 'delete', detail: files.join(', ') }
        : {
            object: directory,
            action: 'keep',
            detail: 'credentials bootstrap did not make',
          },
    );
  }
  return {
    steps,
    warnings: [],
    firewall: present,
    refusals,
    apply: async () => {
      for (const action of actions) await action();
      for (const directory of ownCredentials) {
        for (const file of CREDENTIAL_FILES)
          rmSync(join(directory, file), { force: true });
        // The directory goes too once bootstrap's files were all it held.
        if (existsSync(directory) && readdirSync(directory).length === 0)
          rmdirSync(directory);
      }
    },
  };
}

/** Delete the images a project holds (Incus refuses to delete a project
 * that holds any); its instances and volumes were refused before. */
async function emptyProject(
  admin: IncusClient,
  project: string,
): Promise<void> {
  const images = await admin.sync('GET', '/1.0/images', { query: { project } });
  for (const path of Array.isArray(images) ? images : [])
    await call(admin, 'DELETE', String(path), undefined, { project });
}

/** Remove the `DOCKER-USER` rules `rules` (`iptables -D`). */
export async function removeFirewall(
  run: HostCommand,
  rules: readonly string[][],
): Promise<void> {
  for (const rule of rules) await run(['iptables', '-D', ...rule]);
}
