import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { incusSizeBytes } from '@tale/incus/units';
import { parse as parseYaml } from 'yaml';

import { preconditionError } from '../../../../utils/fail';
import { getReplicaCounts } from '../../../../utils/load-env';
import { buildColorCompose } from '../../../compose/generators/generate-color-compose';
import { buildStatefulCompose } from '../../../compose/generators/generate-stateful-compose';
import type { DeploymentColor } from '../../../compose/types';
import { resolveConfigurationSource } from '../../../deployment/configuration-source';
import { parseDeclarationText } from '../../../deployment/declaration-text';
import { resolveDeploymentSpec } from '../../../deployment/model';
import type { ImageFacts } from '../../../oci/image-facts';
import { setProjectId } from '../../../project/project-context';
import { readProject } from '../../../project/read-project';
import { parseCidr } from '../../../project/runtime-declaration';
import {
  addressPlan,
  SLOT_ROLES,
  type AddressPlan,
  type SingletonRole,
  type SlotRole,
} from '../compile/address-plan';
import {
  interpolate,
  interpolationSource,
  parseDotenv,
  type InterpolationPath,
} from '../compile/interpolate';
import {
  INFRASTRUCTURE_FORMATS,
  PROFILE_LIMITS,
  STOP_GROUPS,
} from '../compile/placement';
import {
  compileStackTarget,
  requireStackTarget,
  type CompileInput,
  type IncusDeclaration,
  type StackTarget,
} from '../compile/stack-target';
import { PATCHED_INIT, sortKeys, SWITCHED_ROLES } from '../compile/translate';
import { registryHosts } from '../verbs/images';
import { REQUIRED_EXTENSIONS, STACK_PROFILE } from '../verbs/probe';
import {
  CONTRACT_KIND,
  CONTRACT_SCHEMA_VERSION,
  type ContractRule,
  type NodeContract,
} from './contract-model';

/**
 * The node contract of a stack (design D-31), computed from its Incus
 * declaration and its compiled target: what the project, the bridge, the
 * ACLs, the pool and the trust must be before the stack can run.
 *
 * The contract reads only what the target says about resources (instances,
 * their limits and addresses, volumes, registries, ingress) and never what
 * an image says about itself (entrypoints, users, digests). So a contract
 * needs no registry: `contractCompileInput` compiles with placeholder image
 * facts, and `contract.test.ts` holds that the contract from them equals the
 * contract from facts shaped like the real images.
 */

/** The profile's root disk when the declaration names no size. */
const DEFAULT_ROOT_SIZE = '10GiB';
/** Helpers that may run beside the stack at its peak: a one-shot job and
 * check's probe (design D-30). */
const PEAK_HELPERS = 2;
/** Image versions the project holds at once while it upgrades. */
const PEAK_IMAGE_VERSIONS = 2;
/** The roles that reach the public internet (design D-31, R-04). */
const PUBLIC_SINGLETONS: readonly SingletonRole[] = [
  'proxy',
  'sandbox-egress',
  'sandbox-llm-gateway',
  'bgutil-provider',
];
const PUBLIC_SLOT_ROLES: readonly SlotRole[] = SLOT_ROLES;
/** Where a session reaches the stack (design D-31): role → port. */
const SESSION_PORTS = {
  switch: SWITCHED_ROLES['backend-api'],
  'sandbox-llm-gateway': 8080,
} as const;
const SESSION_RUNNER_PORT = 8200;
const DNS_PORT = 53;
const STACK_EGRESS_PORT = 3128;
const HTTP_PORTS = [80, 443];
/** How long data services wait for their signal on a Tale-only host's
 * shutdown: two groups before theirs, 30 s each (design R3-05). */
const DATA_SIGNAL_SECONDS = 60;

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** The OCI facts the contract compiles with: what every Tale image of the
 * line declares about itself, none of which moves a resource. */
function contractImageFacts(reference: string): ImageFacts {
  const at = reference.indexOf('@');
  const repository = (at === -1 ? reference : reference.slice(0, at)).replace(
    /:[^/:]+$/,
    '',
  );
  const digest =
    at === -1
      ? `sha256:${createHash('sha256').update(reference).digest('hex')}`
      : reference.slice(at + 1);
  const labels = {
    'dev.tale.init': PATCHED_INIT,
    'dev.tale.infra-formats': [
      ...new Set(Object.values(INFRASTRUCTURE_FORMATS)),
    ].join(' '),
  };
  return {
    reference: `${repository}@${digest}`,
    digest,
    manifestDigest: digest,
    configDigest: digest,
    os: 'linux',
    architecture: 'amd64',
    variant: null,
    labels,
    revision: null,
    automationWriterProtocol: null,
    init: PATCHED_INIT,
    entrypoint: ['/contract-placeholder'],
    cmd: null,
    env: [],
    user: null,
    workingDir: null,
    stopSignal: null,
    healthcheck: null,
    volumes: [],
  };
}

export interface ContractSource {
  path: InterpolationPath;
  stack: string;
  documents: CompileInput['documents'];
  /** The deployment's `.env`. */
  dotenv: string;
  declaration: IncusDeclaration;
  /** The workspace path reads the process environment as Compose does. */
  processEnvironment?: Readonly<Record<string, string | undefined>>;
  egressProxy?: string;
  /** Replicas per colour role (a workspace's `TALE_*_REPLICAS`). */
  replicas?: Readonly<Record<SlotRole, number>>;
}

/**
 * A compile input for the contract: the documents, `.env` and declaration of
 * the stack, with placeholder image facts for every image they name (after
 * interpolation) and for the sessions' runtime image.
 */
function contractCompileInput(source: ContractSource): CompileInput {
  const { variables } = interpolationSource(source.path, {
    dotenv: source.dotenv,
    processEnvironment: source.processEnvironment ?? {},
    documents: source.documents.map((document) => document.compose),
  });
  const lookup = (name: string): string | undefined =>
    Object.hasOwn(variables, name) ? variables[name] : undefined;
  const images: Record<string, ImageFacts> = {};
  for (const { compose } of source.documents) {
    const services = (compose as { services?: Record<string, unknown> })
      .services;
    for (const service of Object.values(services ?? {})) {
      const image = (service as { image?: unknown }).image;
      if (typeof image !== 'string') continue;
      const reference = interpolate(image, lookup);
      images[reference] ??= contractImageFacts(reference);
    }
  }
  const runtime = contractImageFacts(
    'ghcr.io/tale-project/tale/tale-sandbox-runtime:contract',
  );
  return {
    path: source.path,
    stack: source.stack,
    documents: source.documents,
    variables,
    envFiles: { '.env': source.dotenv },
    declaration: source.declaration,
    images,
    architecture: 'amd64',
    sandboxRuntime: { reference: runtime.reference, digest: runtime.digest },
    ...(source.egressProxy === undefined
      ? {}
      : { egressProxy: source.egressProxy }),
    ...(source.replicas === undefined ? {} : { replicas: source.replicas }),
  };
}

/** The contract of a stack: compiled offline, then described. */
export function contractOf(source: ContractSource): NodeContract {
  const target = requireStackTarget(
    compileStackTarget(contractCompileInput(source)),
  );
  return nodeContract(
    source.declaration,
    target,
    source.egressProxy === undefined ? {} : { egressProxy: source.egressProxy },
  );
}

/**
 * The contract source of the workspace at `directory`: its `tale.json`
 * runtime, its `.env`, and the documents the generators make for it (the
 * stateful tier and one colour; the peak counts the colour twice).
 */
export async function workspaceContractSource(
  directory: string,
  cliVersion: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ContractSource> {
  const project = await readProject(directory);
  const declaration = project.runtime?.incus;
  if (project.runtime?.engine !== 'incus' || declaration === undefined)
    throw preconditionError(
      `tale.json in ${directory} declares no Incus runtime.`,
      'Declare it with tale init --runtime incus and the --incus-* options, or add runtime.engine and runtime.incus to tale.json.',
    );
  const dotenvPath = join(directory, '.env');
  const dotenv = existsSync(dotenvPath) ? readFileSync(dotenvPath, 'utf8') : '';
  const values = parseDotenv(dotenv, (name) => environment[name]);
  const setting = (name: string): string | undefined =>
    environment[name] ?? values[name];
  setProjectId(project.id ?? 'tale');
  const config = {
    version: cliVersion,
    registry: setting('GHCR_REGISTRY') ?? 'ghcr.io/tale-project/tale',
  };
  return {
    path: 'workspace',
    stack: project.id ?? 'tale',
    documents: [
      { compose: buildStatefulCompose(config, setting('HOST') ?? 'localhost') },
      { compose: buildColorCompose(config, 'blue'), colour: 'blue' },
    ],
    dotenv,
    declaration,
    processEnvironment: environment,
    // stdout carries the contract: a clamped count is told on stderr.
    replicas: getReplicaCounts(setting, (message) => console.warn(message)),
  };
}

/**
 * The contract source of a managed deployment: its specification and the
 * runtime's `compose.yml` (the bundle's `runtime/compose.yml`, or the
 * repository's at the runtime revision).
 */
export async function managedContractSource(
  specPath: string,
  composePath: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ContractSource> {
  const spec = resolveDeploymentSpec(
    await resolveConfigurationSource(
      parseDeclarationText(readFileSync(specPath, 'utf8'), specPath),
      specPath,
    ),
    environment,
  );
  const declaration = spec.runtime.incus;
  if (spec.runtime.engine !== 'incus' || declaration === undefined)
    throw preconditionError(
      `The deployment specification ${specPath} declares no Incus runtime.`,
      'Add runtime.engine "incus" and the runtime.incus block to the specification.',
    );
  const sandbox = spec.sandbox as { egressProxy?: string } | undefined;
  return {
    path: 'managed',
    stack: spec.composeProject,
    documents: [{ compose: parseYaml(readFileSync(composePath, 'utf8')) }],
    dotenv: '',
    declaration,
    ...(sandbox?.egressProxy === undefined || sandbox.egressProxy === ''
      ? {}
      : { egressProxy: sandbox.egressProxy }),
  };
}

function bytesOf(size: string, what: string): number {
  const bytes = incusSizeBytes(size);
  if (bytes === undefined)
    throw new Error(`${what} has a size Incus does not read: ${size}`);
  return bytes;
}

/** Bytes as Incus writes a limit: whole GiB where they divide, else MiB. */
export function formatBytes(bytes: number): string {
  if (bytes % GIB === 0) return `${bytes / GIB}GiB`;
  return `${Math.ceil(bytes / MIB)}MiB`;
}

function ipv4Of(url: string, field: string): { host: string; port: number } {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host))
    throw preconditionError(
      `${field} names the host ${host}; the node contract's ACL rules need it as an IPv4 address.`,
      `Declare ${field} with the IPv4 address it resolves to.`,
    );
  const port =
    parsed.port === ''
      ? parsed.protocol === 'https:'
        ? 443
        : 80
      : Number(parsed.port);
  return { host, port };
}

function formatAddress(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function addressValue(address: string): number {
  return address
    .split('.')
    .reduce((total, octet) => total * 256 + Number(octet), 0);
}

/**
 * The bridge's DHCP range: the largest stretch of the subnet that holds
 * neither the block, the gateway, the network nor the broadcast address.
 * Null when the block fills the subnet (then the bridge hands out nothing).
 */
export function dhcpRange(network: IncusDeclaration['network']): string | null {
  const subnet = parseCidr(network.subnet);
  const block = parseCidr(network.block);
  const gateway = addressValue(network.gateway);
  const stretches: [number, number][] = [
    [subnet.first + 1, block.first - 1],
    [block.last + 1, subnet.last - 1],
  ]
    .flatMap(([from, to]): [number, number][] => {
      if (from === undefined || to === undefined || from > to) return [];
      if (gateway < from || gateway > to) return [[from, to]];
      return [
        [from, gateway - 1],
        [gateway + 1, to],
      ].filter(([a, b]) => (a ?? 0) <= (b ?? -1)) as [number, number][];
    })
    .sort((left, right) => right[1] - right[0] - (left[1] - left[0]));
  const best = stretches[0];
  return best === undefined
    ? null
    : `${formatAddress(best[0])}-${formatAddress(best[1])}`;
}

/** The /28 each role's 16 slots of one colour make. */
function slotBlocks(plan: AddressPlan, role: SlotRole): string[] {
  return plan.colours.map((colour) => `${plan.slot(role, colour, 1)}/28`);
}

function single(address: string): string {
  return `${address}/32`;
}

/** The ACL names of a project: global names, so the project is in them. */
function aclNames(project: string): { stack: string; sessions: string } {
  const names = {
    stack: `tale-${project}`,
    sessions: `tale-${project}-sessions`,
  };
  if (names.sessions.length > 63)
    throw preconditionError(
      `The Incus project name ${project} is too long to name its network ACLs (tale-<project>-sessions, at most 63 characters).`,
      'Choose a project name of at most 49 characters.',
    );
  return names;
}

interface RuleContext {
  plan: AddressPlan;
  declaration: IncusDeclaration;
  endpoint: { host: string; port: number };
  egress: { host: string; port: number; own: boolean };
}

/** Every ACL rule of the stack and its sessions (design D-31, R-04, R3-10). */
function contractRules(context: RuleContext): ContractRule[] {
  const { plan, declaration } = context;
  const block = declaration.network.block;
  const sessions = declaration.sessions.subnet;
  const helpers = `${plan.helpers()[0]}/28`;
  const at = (role: SingletonRole): string => single(plan.singleton(role));
  const rules: ContractRule[] = [
    {
      id: 'stack-to-stack',
      acl: 'stack',
      direction: 'egress',
      source: [block],
      destination: [block],
      purpose: "Traffic between the stack's own instances on the app bridge.",
      check: 'listed',
    },
    {
      id: 'stack-from-stack',
      acl: 'stack',
      direction: 'ingress',
      source: [block],
      destination: [block],
      purpose: "Traffic between the stack's own instances on the app bridge.",
      check: 'listed',
    },
    ...(['udp', 'tcp'] as const).map((protocol): ContractRule => ({
      id: `names-to-gateway-${protocol}`,
      acl: 'stack',
      direction: 'egress',
      source: [at('names'), at('names-sessions'), helpers],
      destination: [single(declaration.network.gateway)],
      protocol,
      ports: [DNS_PORT],
      purpose:
        "The stack resolver forwards every name it does not hold to the bridge's own DNS.",
      // The bridge's DNS passes without a rule (R3-10): check asks it a
      // public name to judge its answer, never a drop.
      check: protocol === 'udp' ? 'probe' : 'listed',
    })),
    {
      id: 'spawner-to-incus',
      acl: 'stack',
      direction: 'egress',
      source: [at('sandbox'), helpers],
      destination: [single(context.endpoint.host)],
      protocol: 'tcp',
      ports: [context.endpoint.port],
      purpose:
        'The sandbox spawner drives the sessions through the Incus API (runtime.incus.endpoint).',
      check: 'probe',
    },
    {
      id: 'spawner-to-sessions',
      acl: 'stack',
      direction: 'egress',
      source: [at('sandbox'), helpers],
      destination: [sessions],
      protocol: 'tcp',
      ports: [SESSION_RUNNER_PORT],
      purpose: "The sandbox spawner calls each session's runner.",
      check: 'probe',
    },
    {
      id: 'public-egress',
      acl: 'stack',
      direction: 'egress',
      source: [
        ...PUBLIC_SLOT_ROLES.flatMap((role) => slotBlocks(plan, role)),
        ...PUBLIC_SINGLETONS.map(at),
        helpers,
      ],
      purpose:
        'The roles that reach the internet: the backend, the platform, the sessions egress proxy, the LLM gateway, the proxy (ACME) and the bgutil provider.',
      check: 'probe',
    },
    ...(declaration.operatorReach ?? []).map((reach, index): ContractRule => ({
      id: `operator-reach-${index + 1}`,
      acl: 'stack',
      direction: 'egress',
      source: [block],
      destination: [
        reach.destination.includes('/')
          ? reach.destination
          : single(reach.destination),
      ],
      protocol: reach.protocol,
      ports: [...reach.ports].sort((left, right) => left - right),
      purpose:
        'A destination the declaration names (runtime.incus.operatorReach).',
      // A helper can tell a dropped tcp connection from a refused one;
      // udp has no answer to judge.
      check: reach.protocol === 'tcp' ? 'probe' : 'listed',
    })),
    {
      id: 'public-to-proxy',
      acl: 'stack',
      direction: 'ingress',
      destination: [at('proxy')],
      protocol: 'tcp',
      ports: HTTP_PORTS,
      purpose: `The public reaches the proxy (${declaration.ingress.mode} ingress).`,
      check: 'listed',
    },
  ];
  // What a session reaches of the stack, seen from both bridges: the
  // stack's ACL admits it, the zone's lets it out (R3-10: no NAT between
  // Incus bridges, so the sessions' own subnet is the source).
  const sessionTargets: {
    id: string;
    destination: string;
    protocol: 'tcp' | 'udp';
    port: number;
    purpose: string;
  }[] = [
    {
      id: 'backend-api',
      destination: at('switch'),
      protocol: 'tcp',
      port: SESSION_PORTS.switch,
      purpose: 'A session calls the backend API through the switch.',
    },
    {
      id: 'llm-gateway',
      destination: at('sandbox-llm-gateway'),
      protocol: 'tcp',
      port: SESSION_PORTS['sandbox-llm-gateway'],
      purpose: 'A session calls the LLM gateway.',
    },
    {
      id: 'egress-proxy',
      destination: single(context.egress.host),
      protocol: 'tcp',
      port: context.egress.port,
      purpose: context.egress.own
        ? "A session's outbound traffic goes through the stack's egress proxy."
        : "A session's outbound traffic goes through the declared egress proxy.",
    },
    ...(['udp', 'tcp'] as const).map((protocol) => ({
      id: `names-${protocol}`,
      destination: at('names-sessions'),
      protocol,
      port: DNS_PORT,
      purpose: 'A session resolves the names it may reach.',
    })),
  ];
  for (const target of sessionTargets) {
    rules.push({
      id: `sessions-to-${target.id}`,
      acl: 'sessions',
      direction: 'egress',
      source: [sessions],
      destination: [target.destination],
      protocol: target.protocol,
      ports: [target.port],
      purpose: target.purpose,
      check: 'listed',
    });
    // A declared egress proxy outside the stack is not on the app bridge.
    if (target.id === 'egress-proxy' && !context.egress.own) continue;
    rules.push({
      id: `stack-from-sessions-${target.id}`,
      acl: 'stack',
      direction: 'ingress',
      source: [sessions],
      destination: [target.destination],
      protocol: target.protocol,
      ports: [target.port],
      purpose: target.purpose,
      check: 'listed',
    });
  }
  rules.push({
    id: 'sessions-from-spawner',
    acl: 'sessions',
    direction: 'ingress',
    source: [at('sandbox')],
    destination: [sessions],
    protocol: 'tcp',
    ports: [SESSION_RUNNER_PORT],
    purpose: "The sandbox spawner calls each session's runner.",
    check: 'listed',
  });
  return rules;
}

interface Usage {
  instances: number;
  memoryBytes: number;
  processes: number;
}

function usageOf(instances: StackTarget['instances']): Usage {
  return instances.reduce<Usage>(
    (total, instance) => ({
      instances: total.instances + 1,
      memoryBytes:
        total.memoryBytes +
        bytesOf(
          instance.config['limits.memory'] ?? PROFILE_LIMITS.memory,
          `${instance.name} limits.memory`,
        ),
      processes:
        total.processes +
        Number(instance.config['limits.processes'] ?? PROFILE_LIMITS.processes),
    }),
    { instances: 0, memoryBytes: 0, processes: 0 },
  );
}

function add(left: Usage, right: Usage, times = 1): Usage {
  return {
    instances: left.instances + right.instances * times,
    memoryBytes: left.memoryBytes + right.memoryBytes * times,
    processes: left.processes + right.processes * times,
  };
}

/**
 * The stack at its peak (design 5.1): the stateful tier, two colours during
 * a flip (a workspace; a managed deployment replaces in place), and the
 * helpers. A target compiled with one colour counts it twice; with both,
 * the larger twice.
 */
function peakUsage(target: StackTarget): { usage: Usage; description: string } {
  const stateful = usageOf(target.instances.filter((i) => i.colour === null));
  const colours = new Map<DeploymentColor, StackTarget['instances']>();
  for (const instance of target.instances)
    if (instance.colour !== null)
      colours.set(instance.colour, [
        ...(colours.get(instance.colour) ?? []),
        instance,
      ]);
  const helpers: Usage = {
    instances: PEAK_HELPERS,
    memoryBytes: PEAK_HELPERS * bytesOf(PROFILE_LIMITS.memory, 'profile'),
    processes: PEAK_HELPERS * PROFILE_LIMITS.processes,
  };
  if (target.path === 'managed' || colours.size === 0)
    return {
      usage: add(stateful, helpers),
      description: `every instance of the stack, replaced in place, plus ${PEAK_HELPERS} helpers`,
    };
  const largest = [...colours.values()]
    .map(usageOf)
    .sort((left, right) => right.memoryBytes - left.memoryBytes)[0] as Usage;
  return {
    usage: add(add(stateful, largest, 2), helpers),
    description: `the stateful tier, two colours during a flip, and ${PEAK_HELPERS} helpers`,
  };
}

export interface ContractOptions {
  /** The declared egress proxy of the sessions (a managed deployment's
   * `sandbox.egressProxy`); absent, the stack's own. */
  egressProxy?: string;
}

/** The node contract of `target`, compiled from `declaration`. */
export function nodeContract(
  declaration: IncusDeclaration,
  target: StackTarget,
  options: ContractOptions = {},
): NodeContract {
  const path: InterpolationPath = target.path;
  const plan = addressPlan(declaration.network, path, {
    platform: 1,
    'backend-api': 1,
    'backend-worker': 1,
  });
  const endpoint = ipv4Of(
    declaration.endpoint ?? `https://${declaration.network.gateway}:8443`,
    'runtime.incus.endpoint',
  );
  const ownEgress = `http://${plan.singleton('sandbox-egress')}:${STACK_EGRESS_PORT}`;
  const egressUrl = options.egressProxy ?? ownEgress;
  const egress = {
    ...ipv4Of(egressUrl, 'sandbox.egressProxy'),
    own: options.egressProxy === undefined,
  };
  const acls = aclNames(declaration.project);
  const rootSize = declaration.rootSize ?? DEFAULT_ROOT_SIZE;
  const registries = registryHosts(target.images, declaration.registryMirror);
  const { usage, description } = peakUsage(target);
  const volumeBytes = target.volumes.map((volume) =>
    volume.size === undefined ? null : bytesOf(volume.size, volume.name),
  );
  const diskBytes = volumeBytes.includes(null)
    ? null
    : (volumeBytes as number[]).reduce(
        (total, bytes) => total + bytes,
        usage.instances * bytesOf(rootSize, 'runtime.incus.rootSize'),
      );
  const notes: string[] = [
    'Instance-to-instance traffic on the app bridge and DNS to the bridge itself pass an Incus bridge ACL without a rule; their rules are listed for operators who enforce them elsewhere, and check expects no drop there.',
    "Host firewall state cannot be read with the stack's restricted certificate: check judges forwarding by a helper's connections from the app bridge.",
    `The ${STOP_GROUPS.data}/${STOP_GROUPS.middle}/${STOP_GROUPS.edge} stop groups bound the data services' signal to about ${DATA_SIGNAL_SECONDS} s on a host that runs only Tale; another project's stop priority inside the band adds 30 s per group, so a shared host stops Tale with tale stop first.`,
  ];
  if (diskBytes === null)
    notes.push(
      `limits.disk.pool.${declaration.pool} is left out: Incus refuses a volume without a size in a project that limits the pool, and ${target.volumes
        .filter((volume) => volume.size === undefined)
        .map((volume) => volume.name)
        .join(', ')} declare none (runtime.incus.volumes).`,
    );
  const range = dhcpRange(declaration.network);
  const prefix = parseCidr(declaration.network.subnet).prefix;
  const projectConfig: Record<string, string> = {
    'features.images': 'true',
    'features.networks': 'false',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
    'restricted.backups': 'block',
    'restricted.containers.interception': 'block',
    'restricted.containers.lowlevel': 'block',
    'restricted.containers.nesting': 'block',
    'restricted.containers.privilege': 'isolated',
    'restricted.devices.disk': 'managed',
    'restricted.devices.nic': 'managed',
    'restricted.devices.proxy':
      declaration.ingress.mode === 'proxy-device' ? 'allow' : 'block',
    'restricted.images.servers': registries.join(','),
    'restricted.networks.access': declaration.network.name,
    'restricted.snapshots': 'allow',
    'restricted.storage-pools.access': declaration.pool,
    'limits.instances': String(usage.instances),
    'limits.memory': formatBytes(usage.memoryBytes),
    'limits.processes': String(usage.processes),
    'limits.virtual-machines': '0',
    ...(diskBytes === null
      ? {}
      : { [`limits.disk.pool.${declaration.pool}`]: formatBytes(diskBytes) }),
  };
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: CONTRACT_KIND,
    path,
    stack: target.stack,
    extensions: [...REQUIRED_EXTENSIONS],
    server: { clustered: false, idmappedMounts: true, minimumZfs: '2.2' },
    project: { name: declaration.project, config: sortKeys(projectConfig) },
    profile: {
      name: STACK_PROFILE,
      config: {
        'limits.memory': PROFILE_LIMITS.memory,
        'limits.processes': String(PROFILE_LIMITS.processes),
      },
      devices: {
        root: {
          type: 'disk',
          path: '/',
          pool: declaration.pool,
          size: rootSize,
        },
      },
    },
    network: {
      name: declaration.network.name,
      type: 'bridge',
      subnet: declaration.network.subnet,
      gateway: declaration.network.gateway,
      block: declaration.network.block,
      config: sortKeys({
        'ipv4.address': `${declaration.network.gateway}/${prefix}`,
        'ipv4.nat': 'true',
        ...(range === null
          ? { 'ipv4.dhcp': 'false' }
          : { 'ipv4.dhcp.ranges': range }),
        'ipv6.address': 'none',
        'security.acls': acls.stack,
        // What no rule allows is dropped both ways, as on ops' bridges, so a
        // missing rule times out and check can tell it from a closed port.
        'security.acls.default.egress.action': 'drop',
        'security.acls.default.ingress.action': 'drop',
      }),
    },
    acls: {
      ...acls,
      rules: contractRules({ plan, declaration, endpoint, egress }),
    },
    sessions: { subnet: declaration.sessions.subnet, egressProxy: egressUrl },
    storage: {
      pool: declaration.pool,
      rootSize,
      volumes: target.volumes.map((volume) => ({
        name: volume.name,
        kind: volume.kind,
        ...(volume.size === undefined ? {} : { size: volume.size }),
        config: volume.config,
      })),
    },
    peak: {
      description,
      instances: usage.instances,
      memoryBytes: usage.memoryBytes,
      processes: usage.processes,
      diskBytes,
      imageVersions: PEAK_IMAGE_VERSIONS,
    },
    registries,
    certificate: {
      name: `tale-${declaration.project}`,
      type: 'client',
      restricted: true,
      projects: [declaration.project],
    },
    stopPriorities: {
      groups: { ...STOP_GROUPS },
      reservedBand: { from: STOP_GROUPS.data, to: STOP_GROUPS.edge },
      dataSignalWithinSeconds: DATA_SIGNAL_SECONDS,
      boundHolds: 'on a host that runs only Tale',
    },
    ingress: {
      mode: target.ingress.mode,
      ...(target.ingress.listen === undefined
        ? {}
        : { listen: target.ingress.listen }),
      proxy: target.ingress.proxy,
      ports: HTTP_PORTS,
    },
    notes,
  };
}
